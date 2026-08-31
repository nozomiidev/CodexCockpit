# Web cockpit

Static React/Vite cockpit for the harness operator and human-model seats. It runs a deterministic demo without a companion and exposes `CockpitTransport` as the replacement boundary for local or relay session transports.

## Routes

- `/sessions/:id/terminal`: left, harness-operator seat
- `/sessions/:id/model`: right, human-model seat
- `/sessions/:id/solo`: both seats in one view
- `/sessions/:id/dev/dual`: integration/debug view
- `/?session=:id&role=left|right`: compatibility alias

## Development

Run `pnpm --filter @codex-cockpit/web dev`, `test`, `typecheck`, or `build` from the workspace root. The companion adapter must implement `src/transport.ts` without leaking WebSocket or server DTOs into components.

The demo deliberately automates response IDs and SSE framing while leaving the semantic choice—text or a valid tool call—to the model seat. The raw lens is read-only; protocol mutation belongs in an explicitly advanced experience rather than the assisted composer.

The left seat's Explorer is a session-scoped browser workspace snapshot backed by
IndexedDB when available. It is a teaching fixture, not host filesystem access;
the companion transport remains authoritative for native files and shell I/O.
In the static demo, xterm input is handled by a bounded readline-style adapter so
Backspace, Delete, cursor movement, history, and control keys work before Enter.
