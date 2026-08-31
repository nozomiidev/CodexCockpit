import { CodexRuntimeError } from "./errors.js";
import type { AppServerMessage, JsonObject, JsonValue } from "./types.js";

export class JsonlDecoder {
  #buffer = "";

  push(chunk: string): AppServerMessage[] {
    this.#buffer += chunk;
    const lines = this.#buffer.split("\n");
    this.#buffer = lines.pop() ?? "";
    return lines.filter((line) => line.trim().length > 0).map(decodeAppServerMessage);
  }

  finish(): AppServerMessage[] {
    if (this.#buffer.trim().length === 0) return [];
    const line = this.#buffer;
    this.#buffer = "";
    return [decodeAppServerMessage(line)];
  }
}

export function encodeAppServerMessage(message: AppServerMessage): string {
  return `${JSON.stringify(message)}\n`;
}

export function decodeAppServerMessage(line: string): AppServerMessage {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch (cause: unknown) {
    throw new CodexRuntimeError(
      "invalid_app_server_message",
      "app-server emitted invalid JSON.",
      {},
      { cause },
    );
  }
  if (!isObject(parsed) || !("method" in parsed || "id" in parsed)) {
    throw new CodexRuntimeError(
      "invalid_app_server_message",
      "app-server message lacks method and id.",
    );
  }
  if ("method" in parsed && typeof parsed.method !== "string") {
    throw new CodexRuntimeError(
      "invalid_app_server_message",
      "app-server method must be a string.",
    );
  }
  if ("id" in parsed && typeof parsed.id !== "string" && typeof parsed.id !== "number") {
    throw new CodexRuntimeError(
      "invalid_app_server_message",
      "app-server id must be a string or number.",
    );
  }
  if ("params" in parsed && !isJsonValue(parsed.params)) {
    throw new CodexRuntimeError("invalid_app_server_message", "app-server params are not JSON.");
  }
  if ("result" in parsed && !isJsonValue(parsed.result)) {
    throw new CodexRuntimeError("invalid_app_server_message", "app-server result is not JSON.");
  }
  if ("error" in parsed && !isObject(parsed.error)) {
    throw new CodexRuntimeError(
      "invalid_app_server_message",
      "app-server error must be an object.",
    );
  }
  if ("method" in parsed) {
    const params = "params" in parsed ? parsed.params : undefined;
    if ("id" in parsed) {
      return {
        id: parsed.id,
        method: parsed.method,
        ...(params === undefined ? {} : { params }),
      };
    }
    return { method: parsed.method, ...(params === undefined ? {} : { params }) };
  }
  const result = "result" in parsed ? parsed.result : undefined;
  const error = "error" in parsed ? parsed.error : undefined;
  const id = parsed.id;
  if (typeof id !== "string" && typeof id !== "number") {
    throw new CodexRuntimeError("invalid_app_server_message", "app-server response id is missing.");
  }
  return {
    id,
    ...(result === undefined ? {} : { result }),
    ...(error === undefined ? {} : { error }),
  };
}

function isObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isJsonValue(value: unknown): value is JsonValue {
  if (value === null || typeof value === "string" || typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  if (Array.isArray(value)) return value.every(isJsonValue);
  return isObject(value) && Object.values(value).every(isJsonValue);
}
