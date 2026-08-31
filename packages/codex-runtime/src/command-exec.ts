import { CodexRuntimeError } from "./errors.js";
import type { JsonObject, JsonValue, RpcNotification, RpcPeer } from "./types.js";

export interface CommandExecRequest {
  readonly processId: string;
  readonly command: readonly string[];
  readonly cwd: string;
  readonly rows: number;
  readonly cols: number;
  readonly permissionProfile?: string;
  readonly signal?: AbortSignal;
  readonly controlTimeoutMs?: number;
  readonly outputBytesCap?: number;
}

export interface CommandExecSession {
  readonly processId: string;
  readonly completed: Promise<CommandExecResult>;
  write(bytes: Uint8Array): Promise<void>;
  resize(rows: number, cols: number): Promise<void>;
  terminate(): Promise<void>;
}

export interface CommandExecResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
}

/**
 * Thin adapter for the stable command/exec family. Output stays base64 at this
 * boundary; the terminal transport decides when bytes become text or xterm input.
 */
export class CommandExecBackend {
  readonly #peer: RpcPeer;

  constructor(peer: RpcPeer) {
    this.#peer = peer;
  }

  async open(request: CommandExecRequest): Promise<CommandExecSession> {
    validateDimensions(request.rows, request.cols);
    if (request.processId.length === 0) throw new RangeError("processId must not be empty.");
    if (request.command.length === 0) throw new RangeError("command must not be empty.");
    const completion = this.#peer.request(
      "command/exec",
      {
        command: [...request.command],
        processId: request.processId,
        cwd: request.cwd,
        tty: true,
        disableTimeout: true,
        outputBytesCap: request.outputBytesCap ?? 4 * 1024 * 1024,
        size: { rows: request.rows, cols: request.cols },
        ...(request.permissionProfile === undefined
          ? {}
          : { permissionProfile: request.permissionProfile }),
      },
      request.signal === undefined ? undefined : { signal: request.signal },
    );
    const processId = request.processId;
    const controlOptions = {
      ...(request.signal === undefined ? {} : { signal: request.signal }),
      timeoutMs: request.controlTimeoutMs ?? 5_000,
    };
    return {
      processId,
      completed: completion.then(readCommandResult),
      write: async (bytes) => {
        await this.#peer.request(
          "command/exec/write",
          {
            processId,
            deltaBase64: Buffer.from(bytes).toString("base64"),
          },
          controlOptions,
        );
      },
      resize: async (rows, cols) => {
        validateDimensions(rows, cols);
        await this.#peer.request(
          "command/exec/resize",
          { processId, size: { rows, cols } },
          controlOptions,
        );
      },
      terminate: async () => {
        await this.#peer.request("command/exec/terminate", { processId }, controlOptions);
      },
    };
  }

  async *output(signal?: AbortSignal): AsyncIterable<{ processId: string; bytes: Uint8Array }> {
    for await (const notification of this.#peer.notifications(signal)) {
      if (notification.method !== "command/exec/outputDelta") continue;
      const params = readObject(notification);
      const processId = readString(params, "processId");
      const data = readString(params, "deltaBase64");
      if (!isCanonicalBase64(data)) throw invalidPayload("deltaBase64 is not canonical base64");
      yield { processId, bytes: Buffer.from(data, "base64") };
    }
  }
}

function isCanonicalBase64(value: string): boolean {
  if (
    value.length % 4 !== 0 ||
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value)
  ) {
    return false;
  }
  return Buffer.from(value, "base64").toString("base64") === value;
}

function validateDimensions(rows: number, cols: number): void {
  if (!Number.isInteger(rows) || !Number.isInteger(cols) || rows < 1 || cols < 1) {
    throw new RangeError("Terminal rows and cols must be positive integers.");
  }
}

function readCommandResult(value: JsonValue): CommandExecResult {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidPayload("command/exec result must be an object");
  }
  const exitCode = value.exitCode;
  if (typeof exitCode !== "number" || !Number.isInteger(exitCode)) {
    throw invalidPayload("exitCode must be an integer");
  }
  return { exitCode, stdout: readString(value, "stdout"), stderr: readString(value, "stderr") };
}

function readObject(notification: RpcNotification): JsonObject {
  const value = notification.params;
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw invalidPayload("command notification params must be an object");
  }
  return value;
}

function readString(object: JsonObject, key: string): string {
  const value = object[key];
  if (typeof value !== "string") throw invalidPayload(`${key} must be a string`);
  return value;
}

function invalidPayload(detail: string): CodexRuntimeError {
  return new CodexRuntimeError(
    "invalid_app_server_message",
    `Invalid command/exec payload: ${detail}.`,
  );
}
