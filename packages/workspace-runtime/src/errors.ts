export type WorkspaceErrorCode =
  | "invalid_logical_path"
  | "path_escape"
  | "path_not_found"
  | "revision_conflict"
  | "resource_limit"
  | "terminal_bridge_closed"
  | "terminal_not_running";

export class WorkspaceError extends Error {
  readonly code: WorkspaceErrorCode;
  readonly context: Readonly<Record<string, string | number | boolean>>;

  constructor(
    code: WorkspaceErrorCode,
    message: string,
    context: Readonly<Record<string, string | number | boolean>> = {},
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "WorkspaceError";
    this.code = code;
    this.context = context;
  }
}
