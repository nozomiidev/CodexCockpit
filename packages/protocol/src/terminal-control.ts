export type TerminalDataFrame = Uint8Array;

export type TerminalControlMessage =
  | {
      readonly schemaVersion: 1;
      readonly type: "terminal.resize";
      readonly cols: number;
      readonly rows: number;
    }
  | { readonly schemaVersion: 1; readonly type: "terminal.close" };

export interface TerminalStatusEvent {
  readonly schemaVersion: 1;
  readonly type: "terminal.status";
  readonly state: "starting" | "running" | "stopping" | "exited" | "failed";
  readonly exitCode?: number | null;
  readonly signal?: string | null;
  readonly message?: string;
}

export function isTerminalControlMessage(value: unknown): value is TerminalControlMessage {
  if (!isRecord(value)) return false;
  if (value["schemaVersion"] !== 1) return false;
  if (value["type"] === "terminal.close") return hasExactKeys(value, ["schemaVersion", "type"]);
  return (
    value["type"] === "terminal.resize" &&
    hasExactKeys(value, ["schemaVersion", "type", "cols", "rows"]) &&
    isTerminalDimension(value.cols) &&
    isTerminalDimension(value.rows)
  );
}

export function isTerminalStatusEvent(value: unknown): value is TerminalStatusEvent {
  if (!isRecord(value) || value["schemaVersion"] !== 1 || value["type"] !== "terminal.status")
    return false;
  const allowedKeys = new Set(["schemaVersion", "type", "state", "exitCode", "signal", "message"]);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return false;
  if (
    value["state"] !== "starting" &&
    value["state"] !== "running" &&
    value["state"] !== "stopping" &&
    value["state"] !== "exited" &&
    value["state"] !== "failed"
  ) {
    return false;
  }
  const exitCode = value["exitCode"];
  const signal = value["signal"];
  const message = value["message"];
  return (
    (exitCode === undefined ||
      exitCode === null ||
      (typeof exitCode === "number" && Number.isSafeInteger(exitCode))) &&
    (signal === undefined || signal === null || typeof signal === "string") &&
    (message === undefined || typeof message === "string")
  );
}

function isTerminalDimension(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 1_000;
}

function isRecord(value: unknown): value is Readonly<Record<string, unknown>> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasExactKeys<const Keys extends readonly string[]>(
  value: unknown,
  keys: Keys,
): value is { readonly [Key in Keys[number]]: unknown } {
  return (
    isRecord(value) &&
    Object.keys(value).length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key))
  );
}
