# Workspace runtime

This package is the local companion's ownership boundary for host files and terminal
processes. Browser and relay code must exchange `LogicalWorkspacePath` values and must
not receive the host root.

## Integration contract

- Open one `HostWorkspace` from a user-authorized root. List and read operations return
  logical paths and binary bytes. Send the returned SHA-256 revision back as
  `expectedSha256` on writes; a conflict is reported as `revision_conflict` rather than
  overwriting newer content.
- Await `watch()` and use it only as an invalidation hint. Filesystem watcher events can
  be coalesced or lost by the OS, so consumers must re-list or re-read after an event.
- Depend on the `TerminalSession` interface. `PortableTerminalSession` is a pipe-based
  fallback for shell, Node, and npm commands; it is not a PTY. A node-pty or Codex
  app-server adapter can implement the same interface without changing consumers.
- Create the fallback through `HostWorkspace.openTerminal()` so the companion never
  needs the host root. Connect it to a browser transport with `TerminalBridge`; binary
  frames call `input()`, resize controls call `resize()`, and its `TerminalBinarySink`
  serializes outbound bytes. The sink should honor the optional abort signal so a
  blocked WebSocket send is released promptly during cancellation or overflow. Input
  writes are also serialized and aggregate-bounded; callers must close or slow the
  producer when `resource_limit` reports input pressure.
- When `environment` is supplied it is the complete child-process environment, not a
  merge with the companion environment. Build an explicit allow-list containing only
  values such as `PATH`, locale, terminal metadata, and a session-scoped `CODEX_HOME`;
  never forward the companion bearer token or unrelated host credentials.
- Forward output as bytes and enforce downstream backpressure at the transport. The
  local output snapshot is a bounded diagnostic tail, not a durable transcript.
- Correlate lifecycle diagnostics using `sessionId`. A resize diagnostic saying
  `resize_unsupported_by_pipe_backend` is a capability result, not a successful PTY
  resize.

## Failure behavior

`WorkspaceError.code` is stable for transport mapping. Its message and context are for
diagnostics and may grow. File writes use an adjacent temporary file, `fsync`, an
optimistic revision recheck, and atomic rename. Cross-process edits in the final gap
remain possible on platforms without a shared lock; clients must still handle a later
watch invalidation.

Run `pnpm --filter @codex-cockpit/workspace-runtime test` and `typecheck` from the repo
root. Tests use isolated temporary roots and fixed fast-check seeds.
