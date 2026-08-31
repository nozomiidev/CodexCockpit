export interface PayloadViews {
  /** Exact caller-owned payload used for protocol processing; never render or log it directly. */
  readonly raw: unknown;
  /** Exact original wire text when the boundary retained it. */
  readonly rawText?: string;
  /** Detached projection intended for authenticated diagnostic UI display. */
  readonly display: unknown;
}

export interface PayloadViewOptions {
  readonly rawText?: string;
  readonly maximumDepth?: number;
  readonly maximumNodes?: number;
}

const redacted = "[REDACTED]";
const redactionLimit = "[REDACTION_LIMIT]";
const circular = "[CIRCULAR]";
const sensitiveKeys = new Set([
  "authorization",
  "proxyauthorization",
  "apikey",
  "openaiapikey",
  "xapikey",
  "token",
  "accesstoken",
  "refreshtoken",
  "sessiontoken",
  "cookie",
  "setcookie",
  "password",
  "clientsecret",
  "privatekey",
]);
const bearerPattern = /\bBearer\s+[A-Za-z0-9._~+/-]+=*/gi;
const apiKeyPattern = /\b(?:sk|sess)-[A-Za-z0-9_-]{8,}/g;

/**
 * Creates a safe display copy without modifying or replacing the authoritative raw value.
 * Limits fail closed in the display projection and never cause callers to fall back to raw data.
 */
export function createPayloadViews(raw: unknown, options: PayloadViewOptions = {}): PayloadViews {
  const state = {
    nodes: 0,
    maximumDepth: options.maximumDepth ?? 32,
    maximumNodes: options.maximumNodes ?? 10_000,
    ancestors: new WeakSet<object>(),
  };
  return {
    raw,
    ...(options.rawText === undefined ? {} : { rawText: options.rawText }),
    display: redactValue(raw, 0, state),
  };
}

interface RedactionState {
  nodes: number;
  readonly maximumDepth: number;
  readonly maximumNodes: number;
  readonly ancestors: WeakSet<object>;
}

function redactValue(value: unknown, depth: number, state: RedactionState): unknown {
  state.nodes += 1;
  if (depth > state.maximumDepth || state.nodes > state.maximumNodes) return redactionLimit;
  if (typeof value === "string") return redactString(value);
  if (typeof value !== "object" || value === null) return value;
  if (state.ancestors.has(value)) return circular;
  state.ancestors.add(value);
  let result: unknown;
  if (Array.isArray(value)) {
    result = value.map((item) => redactValue(item, depth + 1, state));
  } else {
    result = Object.fromEntries(
      Object.entries(value).map(([key, child]) => [
        key,
        isSensitiveKey(key) ? redacted : redactValue(child, depth + 1, state),
      ]),
    );
  }
  state.ancestors.delete(value);
  return result;
}

function redactString(value: string): string {
  return value.replace(bearerPattern, redacted).replace(apiKeyPattern, redacted);
}

function isSensitiveKey(key: string): boolean {
  return sensitiveKeys.has(key.toLowerCase().replaceAll(/[-_.]/g, ""));
}
