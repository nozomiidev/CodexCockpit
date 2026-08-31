import { randomUUID } from "node:crypto";
import { delimiter } from "node:path";
import { createPayloadViews, isTerminalControlMessage } from "@codex-cockpit/protocol";
import { HostWorkspace, TerminalBridge } from "@codex-cockpit/workspace-runtime";
import cors from "@fastify/cors";
import websocket from "@fastify/websocket";
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from "fastify";
import type { RawData } from "ws";
import { CompanionError, sendProblem, toProblem } from "./problem.js";
import { validateCommittedResponse, validateResponsesRequest } from "./response-validator.js";
import { SessionLedger } from "./session-ledger.js";
import {
  encodeCompletedResponse,
  encodeSse,
  startHeartbeat,
  writeWithBackpressure,
} from "./sse.js";

export interface CompanionOptions {
  readonly token: string;
  readonly allowedOrigins?: readonly string[];
  readonly heartbeatMs?: number;
  readonly humanResponseTimeoutMs?: number;
  readonly logger?: boolean;
  readonly workspaceRoot?: string;
  readonly codexBinDirectory?: string;
}

export function createCompanion(options: CompanionOptions): FastifyInstance {
  const ledger = new SessionLedger();
  const activeResponses = new Set<AbortController>();
  const activeTerminals = new Set<TerminalBridge>();
  const terminalSetups = new Set<AbortController>();
  const terminalTickets = new Map<
    string,
    { readonly sessionId: string; readonly expiresAt: number }
  >();
  const workspace =
    options.workspaceRoot === undefined ? undefined : HostWorkspace.open(options.workspaceRoot);
  let workspaceState: "unconfigured" | "initializing" | "ready" | "failed" =
    workspace === undefined ? "unconfigured" : "initializing";
  void workspace?.then(
    () => {
      workspaceState = "ready";
    },
    () => {
      workspaceState = "failed";
    },
  );
  let ready = false;
  const app = Fastify({
    bodyLimit: 2_097_152,
    logger:
      options.logger === false
        ? false
        : {
            level: "info",
            redact: {
              paths: [
                "req.headers.authorization",
                "req.headers.cookie",
                "request",
                "response",
                "*.apiKey",
              ],
              censor: "[REDACTED]",
            },
          },
    requestIdHeader: "x-request-id",
    genReqId: () => `http_${randomUUID()}`,
  });

  app.addContentTypeParser("application/json", { parseAs: "buffer" }, (_request, body, done) => {
    try {
      const rawText = body.toString("utf8");
      const value: unknown = JSON.parse(rawText);
      done(null, new ParsedJsonBody(value, rawText));
    } catch (error) {
      done(error instanceof Error ? error : new Error("Invalid JSON body"));
    }
  });
  app.register(cors, {
    origin: (origin, callback) => {
      if (origin === undefined || (options.allowedOrigins ?? []).includes(origin)) {
        callback(null, origin === undefined ? false : origin);
      } else {
        callback(
          new CompanionError(403, "origin_not_allowed", "The request origin is not allowed."),
          false,
        );
      }
    },
    credentials: true,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["authorization", "content-type", "x-request-id"],
    maxAge: 600,
    strictPreflight: false,
  });
  app.register(websocket);

  app.addHook("onReady", async () => {
    ready = true;
  });
  app.addHook("preClose", async () => {
    for (const controller of activeResponses) {
      controller.abort(
        new CompanionError(503, "companion_shutting_down", "Companion is shutting down."),
      );
    }
    for (const controller of terminalSetups) controller.abort();
    await Promise.all([...activeTerminals].map(async (bridge) => bridge.close()));
  });
  app.addHook("onClose", async () => {
    ready = false;
    activeResponses.clear();
  });
  app.setErrorHandler((error, request, reply) => {
    if (!(error instanceof CompanionError)) request.log.error({ err: error }, "request failed");
    return sendProblem(reply, toProblem(error, request.url));
  });

  app.get("/healthz", async () => ({ status: "ok" }));
  app.get("/capabilities", async () => ({
    schemaVersion: 1,
    responses: true,
    browserHttp: true,
    pendingNotifications: "poll",
    terminal:
      workspaceState !== "ready"
        ? { available: false, reason: `workspace_${workspaceState}` }
        : { available: true, transport: "websocket-binary", pty: false, resize: false },
    codex: { available: false, reason: "codex_runtime_not_initialized" },
  }));
  app.get("/readyz", async (_request, reply) =>
    ready
      ? { status: "ready", ...ledger.diagnostics() }
      : sendProblem(
          reply,
          toProblem(new CompanionError(503, "not_ready", "Companion startup is not complete.")),
        ),
  );

  app.register(async (protectedRoutes) => {
    protectedRoutes.addHook("onRequest", async (request) => {
      if (request.headers.upgrade?.toLowerCase() === "websocket") {
        authenticateTerminal(request, options, terminalTickets);
      } else authenticate(request, options);
    });
    protectedRoutes.post("/sessions", async (_request, reply) =>
      reply.code(201).send(ledger.createSession()),
    );
    protectedRoutes.get<{ Params: { sessionId: string } }>(
      "/sessions/:sessionId",
      async (request) => ledger.getSession(request.params.sessionId),
    );
    protectedRoutes.post<{ Params: { sessionId: string } }>(
      "/sessions/:sessionId/terminal-ticket",
      async (request, reply) => {
        ledger.getSession(request.params.sessionId);
        for (const [candidate, record] of terminalTickets) {
          if (record.expiresAt < Date.now()) terminalTickets.delete(candidate);
        }
        if (terminalTickets.size >= 1_024) {
          throw new CompanionError(
            503,
            "terminal_ticket_capacity",
            "Terminal ticket capacity reached.",
          );
        }
        const ticket = `wst_${randomUUID()}`;
        const expiresAt = Date.now() + 30_000;
        terminalTickets.set(ticket, { sessionId: request.params.sessionId, expiresAt });
        return reply.code(201).send({ ticket, expiresAt });
      },
    );
    protectedRoutes.post<{ Params: { sessionId: string }; Body: unknown }>(
      "/sessions/:sessionId/exercises",
      async (request, reply) => {
        const body = recordBody(request.body);
        const prompt = requiredString(body, "prompt");
        if (prompt.length > 32_768)
          throw new CompanionError(400, "prompt_too_large", "Prompt exceeds 32768 characters.");
        const pending = ledger.createPending(request.params.sessionId, {
          model: "gpt-5.5",
          input: [{ role: "user", content: [{ type: "input_text", text: prompt }] }],
          stream: true,
          tools: [],
          metadata: { simulator: true, source: "teaching_exercise" },
        });
        return reply.code(201).send(toPendingView(pending));
      },
    );
    protectedRoutes.get<{ Params: { sessionId: string } }>(
      "/sessions/:sessionId/pending",
      async (request) => ({
        items: ledger.listPending(request.params.sessionId).map(toPendingView),
      }),
    );

    const handleResponse = async (
      request: FastifyRequest<{
        Params: { sessionId?: string };
        Body: unknown;
        Headers: { "x-codex-cockpit-session-id"?: string };
      }>,
      reply: FastifyReply,
    ): Promise<void> => {
      const parsed = unwrapBody(request.body);
      const body = recordBody(parsed.value);
      validateResponsesRequest(body);
      const sessionId = request.params.sessionId ?? request.headers["x-codex-cockpit-session-id"];
      if (sessionId === undefined || sessionId.length === 0) {
        throw new CompanionError(
          400,
          "session_id_required",
          "x-codex-cockpit-session-id is required.",
        );
      }
      const pending = ledger.createPending(sessionId, body, parsed.rawText);
      const controller = new AbortController();
      activeResponses.add(controller);
      const deadline = setTimeout(
        () =>
          controller.abort(
            new CompanionError(503, "human_response_timeout", "Human response deadline expired."),
          ),
        options.humanResponseTimeoutMs ?? 15 * 60_000,
      );
      deadline.unref();
      reply.raw.once("close", () => {
        if (!reply.raw.writableEnded) controller.abort();
      });
      reply.hijack();
      let stopHeartbeat = (): void => {};
      try {
        reply.raw.writeHead(200, {
          "content-type": "text/event-stream; charset=utf-8",
          "cache-control": "no-cache, no-transform",
          connection: "keep-alive",
          "x-accel-buffering": "no",
          "x-codex-cockpit-request-id": pending.id,
        });
        await writeWithBackpressure(
          reply.raw,
          encodeSse({
            type: "response.created",
            sequence_number: 0,
            response: { id: pending.responseId, status: "in_progress", output: [] },
          }),
        );
        stopHeartbeat = startHeartbeat(reply.raw, options.heartbeatMs ?? 10_000);
        try {
          const response = await ledger.waitForCommit(pending.id, controller.signal);
          for (const event of encodeCompletedResponse(pending.responseId, response)) {
            await writeWithBackpressure(reply.raw, event);
          }
        } catch (error) {
          if (!(error instanceof CompanionError) || error.code !== "client_disconnected") {
            await writeWithBackpressure(
              reply.raw,
              encodeSse({
                type: "response.failed",
                sequence_number: 1,
                response: { id: pending.responseId, status: "failed", error: toProblem(error) },
              }),
            );
          }
        }
      } finally {
        stopHeartbeat();
        clearTimeout(deadline);
        activeResponses.delete(controller);
        const current = ledger.getPending(sessionId, pending.id);
        if (current.state === "pending" || current.state === "claimed")
          ledger.cancel(sessionId, pending.id);
        if (!reply.raw.destroyed) reply.raw.end();
      }
    };
    protectedRoutes.post<{
      Params: { sessionId?: string };
      Body: unknown;
      Headers: { "x-codex-cockpit-session-id"?: string };
    }>("/sessions/:sessionId/responses", handleResponse);
    // Codex custom providers target this upstream-compatible path. Session context is
    // carried separately so the parsed OpenAI request remains semantically unchanged.
    protectedRoutes.post<{
      Params: { sessionId?: string };
      Body: unknown;
      Headers: { "x-codex-cockpit-session-id"?: string };
    }>("/v1/responses", handleResponse);

    protectedRoutes.post<{ Params: { sessionId: string; requestId: string }; Body: unknown }>(
      "/sessions/:sessionId/pending/:requestId/claim",
      async (request) => {
        const { playerId } = playerBody(request.body);
        const claimed = ledger.claim(request.params.sessionId, request.params.requestId, playerId);
        if (claimed.domainState.status !== "claimed")
          throw new CompanionError(500, "invalid_claim_transition", "Claim receipt unavailable.");
        return {
          schemaVersion: 1,
          sessionId: claimed.sessionId,
          inferenceId: claimed.id,
          claimId: claimed.domainState.claimId,
          playerId: claimed.domainState.playerId,
          revision: claimed.domainState.revision,
          leaseExpiresAt: new Date(claimed.domainState.expiresAtMs).toISOString(),
        };
      },
    );
    protectedRoutes.post<{ Params: { sessionId: string; requestId: string }; Body: unknown }>(
      "/sessions/:sessionId/pending/:requestId/commit",
      async (request) => {
        const body = recordBody(request.body);
        const playerId = requiredString(body, "playerId");
        const claimId = requiredString(body, "claimId");
        const expectedRevision = requiredInteger(body, "expectedRevision");
        const response = normalizeResponse(body["response"]);
        const pending = ledger.getPending(request.params.sessionId, request.params.requestId);
        validateCommittedResponse(pending.request, response);
        return ledger.commit(
          request.params.sessionId,
          request.params.requestId,
          playerId,
          response,
          { claimId, expectedRevision },
        );
      },
    );
    protectedRoutes.post<{ Params: { sessionId: string; requestId: string } }>(
      "/sessions/:sessionId/pending/:requestId/cancel",
      async (request) => ledger.cancel(request.params.sessionId, request.params.requestId),
    );
    protectedRoutes.get<{ Params: { sessionId: string } }>(
      "/sessions/:sessionId/terminal",
      { websocket: true },
      (socket, request) => {
        ledger.getSession(request.params.sessionId);
        if (workspace === undefined) {
          socket.close(1013, "workspace_root_not_configured");
          return;
        }
        let bridge: TerminalBridge | undefined;
        const setupController = new AbortController();
        terminalSetups.add(setupController);
        const queued: { readonly data: Buffer; readonly isBinary: boolean }[] = [];
        let queuedBytes = 0;
        const dispatch = (data: Buffer, isBinary: boolean): void => {
          if (bridge === undefined) {
            if (queuedBytes + data.byteLength > 1_048_576) {
              setupController.abort();
              socket.close(1009, "terminal input limit exceeded");
              return;
            }
            queued.push({ data: Buffer.from(data), isBinary });
            queuedBytes += data.byteLength;
            return;
          }
          if (isBinary) {
            void bridge.input(data).catch(() => bridge?.close({ code: "transport_error" }));
            return;
          }
          const value = parseJsonValue(data.toString("utf8"));
          if (!isTerminalControlMessage(value)) {
            void bridge.close({ code: "transport_error", message: "invalid terminal control" });
          } else if (value.type === "terminal.resize") {
            void bridge
              .resize(value.cols, value.rows)
              .catch(() => bridge?.close({ code: "transport_error" }));
          } else {
            void bridge.close();
          }
        };
        socket.on("message", (data: RawData, isBinary: boolean) =>
          dispatch(rawDataBuffer(data), isBinary),
        );
        socket.once("close", () => {
          setupController.abort();
          void bridge?.close();
        });
        void workspace
          .then((opened) => {
            if (setupController.signal.aborted) return;
            const path = [options.codexBinDirectory, process.env["PATH"]].filter(
              (part): part is string => part !== undefined && part.length > 0,
            );
            const session = opened.openTerminal({ environment: { PATH: path.join(delimiter) } });
            if (setupController.signal.aborted) {
              void session.cancel();
              return;
            }
            bridge = new TerminalBridge({
              session,
              sink: {
                send: (bytes, signal) => sendWebSocket(socket, bytes, signal),
                close: async (reason) => {
                  if (socket.readyState === 1) socket.close(1000, reason.code);
                },
              },
              onStatus: (diagnostic) => {
                if (socket.readyState === 1) {
                  socket.send(
                    JSON.stringify({
                      schemaVersion: 1,
                      type: "terminal.status",
                      state: diagnostic.state,
                      ...(diagnostic.exitCode === undefined
                        ? {}
                        : { exitCode: diagnostic.exitCode }),
                      ...(diagnostic.signal === undefined ? {} : { signal: diagnostic.signal }),
                      ...(diagnostic.message === undefined ? {} : { message: diagnostic.message }),
                    }),
                  );
                }
              },
            });
            const terminalBridge = bridge;
            activeTerminals.add(terminalBridge);
            void terminalBridge.closed.finally(() => activeTerminals.delete(terminalBridge));
            setImmediate(() => {
              if (setupController.signal.aborted) return;
              terminalBridge.start();
              for (const message of queued.splice(0)) {
                queuedBytes -= message.data.byteLength;
                dispatch(message.data, message.isBinary);
              }
            });
          })
          .catch((error: unknown) => {
            if (!setupController.signal.aborted) socket.close(1011, "terminal setup failed");
          })
          .finally(() => terminalSetups.delete(setupController));
      },
    );
  });
  return app;
}

function authenticate(
  request: FastifyRequest,
  options: CompanionOptions,
  _allowCookie = true,
): void {
  if (request.headers.authorization !== `Bearer ${options.token}`) {
    throw new CompanionError(401, "invalid_token", "A valid companion bearer token is required.");
  }
  const origin = request.headers.origin;
  if (origin !== undefined && !(options.allowedOrigins ?? []).includes(origin)) {
    throw new CompanionError(403, "origin_not_allowed", "The request origin is not allowed.");
  }
}

function authenticateTerminal(
  request: FastifyRequest,
  options: CompanionOptions,
  tickets: Map<string, { readonly sessionId: string; readonly expiresAt: number }>,
): void {
  const origin = request.headers.origin;
  if (origin === undefined || !(options.allowedOrigins ?? []).includes(origin)) {
    throw new CompanionError(403, "origin_not_allowed", "An allowed Origin is required.");
  }
  const protocols = request.headers["sec-websocket-protocol"]
    ?.split(",")
    .map((value) => value.trim());
  if (protocols?.[0] !== "codex-cockpit" || protocols[1] === undefined) {
    throw new CompanionError(
      401,
      "terminal_ticket_required",
      "A terminal pairing ticket is required.",
    );
  }
  const ticket = tickets.get(protocols[1]);
  tickets.delete(protocols[1]);
  const params = isRecord(request.params) ? request.params : {};
  if (
    ticket === undefined ||
    ticket.expiresAt < Date.now() ||
    ticket.sessionId !== params["sessionId"]
  ) {
    throw new CompanionError(
      401,
      "invalid_terminal_ticket",
      "The terminal pairing ticket is invalid or expired.",
    );
  }
}

function recordBody(value: unknown): Readonly<Record<string, unknown>> {
  const unwrapped = unwrapBody(value).value;
  if (!isRecord(unwrapped)) {
    throw new CompanionError(400, "invalid_request_body", "Request body must be a JSON object.");
  }
  return unwrapped;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

class ParsedJsonBody {
  constructor(
    readonly value: unknown,
    readonly rawText: string,
  ) {}
}

function unwrapBody(value: unknown): { readonly value: unknown; readonly rawText?: string } {
  return value instanceof ParsedJsonBody ? value : { value };
}

function playerBody(value: unknown): { readonly playerId: string } {
  return { playerId: requiredString(recordBody(value), "playerId") };
}

function requiredString(body: Readonly<Record<string, unknown>>, key: string): string {
  const value = body[key];
  if (typeof value !== "string" || value.length === 0)
    throw new CompanionError(400, "invalid_request_body", `${key} must be a non-empty string.`);
  return value;
}

function requiredInteger(body: Readonly<Record<string, unknown>>, key: string): number {
  const value = body[key];
  if (!Number.isSafeInteger(value))
    throw new CompanionError(400, "invalid_request_body", `${key} must be a safe integer.`);
  return value as number;
}

function normalizeResponse(value: unknown): Readonly<Record<string, unknown>> {
  const response = recordBody(value);
  if (Array.isArray(response["output"])) return response;
  if (response["kind"] === "text") {
    const text = requiredString(response, "text");
    return {
      output: [
        {
          id: `msg_${randomUUID()}`,
          type: "message",
          role: "assistant",
          content: [{ type: "output_text", text }],
        },
      ],
    };
  }
  if (response["kind"] === "tool") {
    return {
      output: [
        {
          id: `fc_${randomUUID()}`,
          type: "function_call",
          call_id: `call_${randomUUID()}`,
          name: requiredString(response, "toolName"),
          arguments: requiredString(response, "argumentsJson"),
        },
      ],
    };
  }
  throw new CompanionError(400, "invalid_response_output", "Unknown response submission kind.");
}

function toPendingView(
  pending: ReturnType<SessionLedger["getPending"]>,
): Readonly<Record<string, unknown>> {
  return {
    id: pending.id,
    responseId: pending.responseId,
    sessionId: pending.sessionId,
    request: createPayloadViews(pending.request).display,
    state: pending.state,
    ...(pending.claimedBy === undefined ? {} : { claimedBy: pending.claimedBy }),
    ...(pending.rawRequestText === undefined ? {} : { rawRequestText: pending.rawRequestText }),
    createdAt: pending.createdAt,
    updatedAt: pending.updatedAt,
  };
}

function parseJsonValue(text: string): unknown {
  try {
    const value: unknown = JSON.parse(text);
    return value;
  } catch {
    return undefined;
  }
}

function rawDataBuffer(data: RawData): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (Array.isArray(data)) return Buffer.concat(data);
  return Buffer.from(new Uint8Array(data));
}

function sendWebSocket(
  socket: {
    readonly readyState: number;
    send(data: Uint8Array, options: { binary: true }, callback: (error?: Error) => void): void;
  },
  bytes: Uint8Array,
  signal?: AbortSignal,
): Promise<void> {
  return new Promise((resolve, reject) => {
    if (socket.readyState !== 1 || signal?.aborted) {
      reject(new Error("terminal websocket is closed"));
      return;
    }
    const onAbort = (): void => reject(new Error("terminal websocket send aborted"));
    signal?.addEventListener("abort", onAbort, { once: true });
    socket.send(bytes, { binary: true }, (error) => {
      signal?.removeEventListener("abort", onAbort);
      if (error === undefined) resolve();
      else reject(error);
    });
  });
}
