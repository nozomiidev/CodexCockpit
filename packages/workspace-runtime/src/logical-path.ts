import * as path from "node:path";
import { WorkspaceError } from "./errors.js";

export type LogicalWorkspacePath = string & { readonly __logicalWorkspacePath: unique symbol };

/** Parses a canonical, absolute POSIX path in the logical workspace namespace. */
export function parseLogicalWorkspacePath(input: string): LogicalWorkspacePath {
  if (
    input.length === 0 ||
    input.length > 4096 ||
    !input.startsWith("/") ||
    input.includes("\\") ||
    input.includes("\0")
  ) {
    throw new WorkspaceError("invalid_logical_path", "Expected an absolute POSIX workspace path");
  }
  const segments = input.split("/").slice(1);
  if (segments.some((segment) => segment === "." || segment === ".." || segment.length === 0)) {
    if (input !== "/") {
      throw new WorkspaceError("invalid_logical_path", "Workspace paths must be canonical");
    }
  }
  return input as LogicalWorkspacePath;
}

/** Resolves a logical path lexically. Callers performing I/O must also check symlinks. */
export function resolveLogicalWorkspacePath(
  root: string,
  logicalPath: LogicalWorkspacePath,
): string {
  const relative = logicalPath === "/" ? "" : logicalPath.slice(1);
  const resolvedRoot = path.resolve(root);
  const resolved = path.resolve(resolvedRoot, ...relative.split("/"));
  if (resolved !== resolvedRoot && !resolved.startsWith(`${resolvedRoot}${path.sep}`)) {
    throw new WorkspaceError("path_escape", "Workspace path escaped its root");
  }
  return resolved;
}

export function toLogicalWorkspacePath(relativePath: string): LogicalWorkspacePath {
  return parseLogicalWorkspacePath(`/${relativePath.split(path.sep).join("/")}`);
}
