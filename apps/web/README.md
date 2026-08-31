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
