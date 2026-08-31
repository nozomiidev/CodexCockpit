export type RuntimeErrorCode =
  | "codex_not_found"
  | "codex_probe_failed"
  | "invalid_app_server_message"
  | "app_server_not_ready"
  | "app_server_exited"
  | "request_cancelled"
  | "request_timeout"
  | "unsupported_capability";

export class CodexRuntimeError extends Error {
  readonly code: RuntimeErrorCode;
  readonly context: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: RuntimeErrorCode,
    message: string,
    context: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "CodexRuntimeError";
    this.code = code;
    this.context = context;
  }
}
