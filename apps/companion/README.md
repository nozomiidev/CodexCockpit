# Companion

The companion is the only local HTTP process in the initial architecture. It owns
session coordination and the human Responses wait/claim/commit lifecycle. It does
not expose an arbitrary command, argv, filesystem, or generic RPC endpoint.

## Boundary

- `GET /healthz` is liveness and requires no token.
- `GET /readyz` reports readiness and bounded queue counts.
- Every `/sessions` endpoint requires `Authorization: Bearer <token>`.
- Browser requests with an `Origin` header must match the configured allow-list.
- `POST /v1/responses` (with `x-codex-cockpit-session-id`) is the Codex-compatible
  provider route. `POST /sessions/:sessionId/responses` is its local explicit alias.
  Both create a pending request and keep an SSE response open. It emits a
  `response.created` event, heartbeat comments, completed output items, and a final
  `response.completed`. Pending state is available only through the browser API.
- The right player lists, claims, commits, or cancels pending work through the
  corresponding `/pending` endpoints. A commit is accepted only from its claimant.

The ledger is intentionally behind a framework-free class and delegates UUIDv7 and
claim/commit transitions to the shared protocol/domain packages. A durable event store
can replace it without changing the HTTP handlers. Responses requests retain the exact,
bounded UTF-8 JSON body alongside its parsed projection, including original whitespace.
The in-memory fallback is capped at 1,000 sessions and 10,000 response records and
prunes terminal records before refusing new work.

## Run and diagnose

Set `CODEX_COCKPIT_TOKEN` (at least 16 characters), then run `pnpm start`. The default
bind address is `127.0.0.1:4317`; allowed origins default to
`http://localhost:5173`. Startup logs name each phase. `/readyz` exposes session,
pending-response, and waiter counts so a stalled human turn is distinguishable from a
dead process.

SIGINT/SIGTERM abort active human waits before closing Fastify. Shutdown has a five
second deadline, after which remaining sockets are forcibly closed and the process
reports a non-zero exit status.

Run `pnpm test` and `pnpm typecheck` from this package. Tests cover authentication,
origin checks, claim ownership, cancellation/abort cleanup, SSE framing, and
backpressure.

## Codex 0.151.0 smoke limitation in this sandbox

The pinned `@openai/codex@0.151.0` binary was invoked with a custom Responses provider,
`env_key` bearer authentication, and a static
`http_headers.x-codex-cockpit-session-id`. The executable stopped before making HTTP
with `Error loading config.toml: no /proc/self/exe available. Is /proc mounted?` because
this managed test sandbox does not mount `/proc`. The companion's real-process TCP/SSE
smoke verifies the same provider request shape, but the Codex-originated hop must run in
the normal Linux runtime/container where `/proc/self/exe` exists. This is an environment
capability blocker, not a credential requirement: the local pairing token is supplied
through `env_key`, so no OpenAI credential is needed.
