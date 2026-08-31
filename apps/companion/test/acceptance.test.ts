import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { expect, test } from "vitest";
import { createCompanion } from "../src/app.js";
import { nextProjectId } from "../src/domain-adapter.js";

const token = "e2e-companion-token-0123456789";
const origin = "https://cockpit.test";

test("companion completes one Responses and terminal lifecycle contract", async () => {
  const workspaceRoot = await mkdtemp(join(process.cwd(), ".tmp-companion-contract-"));
  await writeFile(join(workspaceRoot, "workspace-marker"), "contract-ok\n", "utf8");
  const app = createCompanion({
    token,
    allowedOrigins: [origin],
    heartbeatMs: 100,
    humanResponseTimeoutMs: 5_000,
    logger: false,
    workspaceRoot,
  });

  try {
    await app.ready();
    const authorization = `Bearer ${token}`;
    const sessionResponse = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization, origin },
    });
    expect(sessionResponse.statusCode).toBe(201);
    const sessionId = requiredString(sessionResponse.json(), "id");

    const responseRequest = {
      model: "gpt-5.5",
      input: [{ role: "user", content: [{ type: "input_text", text: "Read the marker." }] }],
      stream: true,
      tools: [],
    };
    const streamed = app.inject({
      method: "POST",
      url: "/v1/responses",
      headers: {
        authorization,
        "content-type": "application/json",
        "x-codex-cockpit-session-id": sessionId,
      },
      payload: responseRequest,
    });
    const pending = await waitForPending(app, authorization, sessionId);
    expect(pending.request).toEqual(responseRequest);
    const playerId = nextProjectId("ply");
    const claim = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pending/${pending.id}/claim`,
      headers: { authorization, "content-type": "application/json" },
      payload: { playerId },
    });
    expect(claim.statusCode).toBe(200);
    const claimReceipt: unknown = claim.json();
    const claimId = requiredString(claimReceipt, "claimId");
    const expectedRevision = requiredInteger(claimReceipt, "revision");

    const invalidCommit = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pending/${pending.id}/commit`,
      headers: { authorization, "content-type": "application/json" },
      payload: {
        playerId,
        claimId,
        expectedRevision,
        response: { output: [{ type: "message", role: "assistant" }] },
      },
    });
    expect(invalidCommit.statusCode).toBe(400);
    expect(invalidCommit.json()).toMatchObject({ code: "invalid_response_output" });

    const outputItem = {
      id: "msg_contract",
      type: "message",
      role: "assistant",
      content: [{ type: "output_text", text: "The marker contains contract-ok." }],
    };
    const commit = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/pending/${pending.id}/commit`,
      headers: { authorization, "content-type": "application/json" },
      payload: { playerId, claimId, expectedRevision, response: { output: [outputItem] } },
    });
    expect(commit.statusCode).toBe(200);

    const streamResponse = await streamed;
    expect(streamResponse.statusCode).toBe(200);
    expect(streamResponse.headers["content-type"]).toContain("text/event-stream");
    const events = parseSseData(streamResponse.payload);
    expect(events.map((event) => event.type)).toEqual([
      "response.created",
      "response.output_text.delta",
      "response.output_item.done",
      "response.completed",
    ]);
    expect(events.map((event) => event.sequence_number)).toEqual([0, 1, 2, 3]);
    expect(events[2]).toMatchObject({ output_index: 0, item: outputItem });
    expect(events[3]).toMatchObject({
      response: { id: pending.responseId, status: "completed", output: [outputItem] },
    });

    const ticketResponse = await app.inject({
      method: "POST",
      url: `/sessions/${sessionId}/terminal-ticket`,
      headers: { authorization, origin },
    });
    expect(ticketResponse.statusCode).toBe(201);
    const ticket = requiredString(ticketResponse.json(), "ticket");
    let inbox: SocketInbox | undefined;
    const socket = await app.injectWS(
      `/sessions/${sessionId}/terminal`,
      { headers: { origin, "sec-websocket-protocol": `codex-cockpit, ${ticket}` } },
      { onInit: (createdSocket) => (inbox = createSocketInbox(createdSocket)) },
    );
    if (inbox === undefined) throw new Error("WebSocket inbox was not initialized");
    try {
      const running = await inbox.next(
        (message) =>
          message.kind === "control" && message.value["type"] === "terminal.status"
            ? message.value["state"] === "running"
            : false,
        "terminal running status",
      );
      expect(running).toMatchObject({ kind: "control", value: { state: "running" } });

      const resizedMessage = inbox.next(
        (message) =>
          message.kind === "control" &&
          message.value["message"] === "resize_unsupported_by_pipe_backend",
        "resize diagnostic",
      );
      socket.send(
        JSON.stringify({ schemaVersion: 1, type: "terminal.resize", cols: 100, rows: 32 }),
      );
      const resized = await resizedMessage;
      expect(resized).toMatchObject({
        kind: "control",
        value: { type: "terminal.status", message: "resize_unsupported_by_pipe_backend" },
      });

      const markerMessage = inbox.next(
        (message) => message.kind === "binary" && message.text.includes("CONTRACT_MARKER"),
        "workspace marker output",
      );
      socket.send(Buffer.from("test -f workspace-marker && printf CONTRACT_MARKER\\n\n"));
      const marker = await markerMessage;
      expect(marker).toMatchObject({ kind: "binary" });

      const closed = waitForSocketClose(socket);
      socket.send(JSON.stringify({ schemaVersion: 1, type: "terminal.close" }));
      await expect(closed).resolves.toMatchObject({ code: 1000 });
    } finally {
      inbox.dispose();
      socket.close();
    }

    await expect(
      app.injectWS(`/sessions/${sessionId}/terminal`, {
        headers: { origin, "sec-websocket-protocol": `codex-cockpit, ${ticket}` },
      }),
    ).rejects.toThrow(/401/);

    const secondSession = await app.inject({
      method: "POST",
      url: "/sessions",
      headers: { authorization, origin },
    });
    const secondSessionId = requiredString(secondSession.json(), "id");
    const wrongSessionTicket = await issueTerminalTicket(app, authorization, sessionId);
    await expect(
      app.injectWS(`/sessions/${secondSessionId}/terminal`, {
        headers: {
          origin,
          "sec-websocket-protocol": `codex-cockpit, ${wrongSessionTicket}`,
        },
      }),
    ).rejects.toThrow(/401/);

    const wrongOriginTicket = await issueTerminalTicket(app, authorization, sessionId);
    await expect(
      app.injectWS(`/sessions/${sessionId}/terminal`, {
        headers: {
          origin: "https://evil.test",
          "sec-websocket-protocol": `codex-cockpit, ${wrongOriginTicket}`,
        },
      }),
    ).rejects.toThrow(/403/);
  } finally {
    await app.close();
    await rm(workspaceRoot, { recursive: true, force: true });
  }
}, 15_000);

interface PendingView {
  readonly id: string;
  readonly responseId: string;
  readonly request: Readonly<Record<string, unknown>>;
}

async function issueTerminalTicket(
  app: ReturnType<typeof createCompanion>,
  authorization: string,
  sessionId: string,
): Promise<string> {
  const response = await app.inject({
    method: "POST",
    url: `/sessions/${sessionId}/terminal-ticket`,
    headers: { authorization, origin },
  });
  expect(response.statusCode).toBe(201);
  return requiredString(response.json(), "ticket");
}

async function waitForPending(
  app: ReturnType<typeof createCompanion>,
  authorization: string,
  sessionId: string,
): Promise<PendingView> {
  const deadline = Date.now() + 2_000;
  while (Date.now() < deadline) {
    const response = await app.inject({
      method: "GET",
      url: `/sessions/${sessionId}/pending`,
      headers: { authorization },
    });
    const value: unknown = response.json();
    if (isRecord(value) && Array.isArray(value["items"]) && isPendingView(value["items"][0])) {
      return value["items"][0];
    }
    await new Promise<void>((resolve) => setImmediate(resolve));
  }
  throw new Error("pending Responses request did not become observable within 2000ms");
}

type SseEvent = Readonly<Record<string, unknown>> & {
  readonly type: string;
  readonly sequence_number: number;
};

function parseSseData(payload: string): readonly SseEvent[] {
  return payload
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => JSON.parse(line.slice(6)) as unknown)
    .map((value) => {
      if (
        !isRecord(value) ||
        typeof value["type"] !== "string" ||
        typeof value["sequence_number"] !== "number"
      ) {
        throw new Error("SSE data is not a sequenced Responses event");
      }
      return value as SseEvent;
    });
}

type SocketMessage =
  | { readonly kind: "binary"; readonly text: string }
  | { readonly kind: "control"; readonly value: Readonly<Record<string, unknown>> };

interface InjectedWebSocket {
  on(event: "message", listener: (data: Buffer, isBinary: boolean) => void): unknown;
  off(event: "message", listener: (data: Buffer, isBinary: boolean) => void): unknown;
  once(event: "close", listener: (code: number, reason: Buffer) => void): unknown;
}

interface SocketInbox {
  readonly next: (
    predicate: (message: SocketMessage) => boolean,
    description: string,
  ) => Promise<SocketMessage>;
  readonly dispose: () => void;
}

function createSocketInbox(socket: InjectedWebSocket): SocketInbox {
  const buffered: SocketMessage[] = [];
  const waiters = new Set<{
    readonly predicate: (message: SocketMessage) => boolean;
    readonly resolve: (message: SocketMessage) => void;
    readonly cancelTimeout: () => void;
  }>();
  const onMessage = (data: Buffer, isBinary: boolean): void => {
    const message: SocketMessage = isBinary
      ? { kind: "binary", text: data.toString("utf8") }
      : { kind: "control", value: jsonRecord(data.toString("utf8")) };
    const waiter = [...waiters].find((candidate) => candidate.predicate(message));
    if (waiter === undefined) buffered.push(message);
    else {
      waiters.delete(waiter);
      waiter.cancelTimeout();
      waiter.resolve(message);
    }
  };
  socket.on("message", onMessage);
  return {
    next: (predicate, description) => {
      const index = buffered.findIndex(predicate);
      if (index >= 0) {
        const message = buffered.splice(index, 1)[0];
        if (message !== undefined) return Promise.resolve(message);
      }
      return new Promise((resolve, reject) => {
        let timeout: NodeJS.Timeout | undefined;
        const waiter = {
          predicate,
          resolve,
          cancelTimeout: () => {
            if (timeout !== undefined) clearTimeout(timeout);
          },
        };
        waiters.add(waiter);
        timeout = setTimeout(() => {
          waiters.delete(waiter);
          reject(
            new Error(
              `WebSocket timed out waiting for ${description}; buffered=${JSON.stringify(buffered)}`,
            ),
          );
        }, 5_000);
      });
    },
    dispose: () => {
      socket.off("message", onMessage);
      for (const waiter of waiters) waiter.cancelTimeout();
      waiters.clear();
      buffered.length = 0;
    },
  };
}

function waitForSocketClose(
  socket: InjectedWebSocket,
): Promise<{ readonly code: number; readonly reason: string }> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("WebSocket close timeout")), 2_000);
    socket.once("close", (code: number, reason: Buffer) => {
      clearTimeout(timeout);
      resolve({ code, reason: reason.toString("utf8") });
    });
  });
}

function requiredString(value: unknown, key: string): string {
  if (!isRecord(value) || typeof value[key] !== "string") throw new Error(`${key} is missing`);
  return value[key];
}

function requiredInteger(value: unknown, key: string): number {
  if (!isRecord(value) || !Number.isSafeInteger(value[key])) throw new Error(`${key} is missing`);
  return value[key] as number;
}

function jsonRecord(text: string): Readonly<Record<string, unknown>> {
  const value: unknown = JSON.parse(text);
  if (!isRecord(value)) throw new Error("JSON value is not an object");
  return value;
}

function isPendingView(value: unknown): value is PendingView {
  return (
    isRecord(value) &&
    typeof value["id"] === "string" &&
    typeof value["responseId"] === "string" &&
    isRecord(value["request"])
  );
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
