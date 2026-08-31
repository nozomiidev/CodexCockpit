# Implementation guide

This directory is the operational map for implementing, running, and diagnosing CodexCockpit. Architectural rationale lives in [`../research/`](../research/README.md), while normative engineering rules live in [`../standards/`](../standards/README.md).

## Runtime boundaries

| Component                  | Owns                                                                | Must not own                                    |
| -------------------------- | ------------------------------------------------------------------- | ----------------------------------------------- |
| Static web cockpit         | Seat UI, projections, drafts, validation feedback                   | Host paths, credentials, shell processes        |
| Session companion          | Session lifecycle, browser transport, workspace capability boundary | Model semantics, UI state                       |
| Workspace terminal adapter | Terminal bytes, bounded I/O, cancellation, logical paths            | Codex thread semantics                          |
| Codex runtime adapter      | Pinned official CLI/app-server lifecycle and generated contracts    | Cockpit-specific domain policy                  |
| Human Responses gateway    | Pending response queue, claim/submit, validation, SSE encoding      | Tool execution or fabricated tool results       |
| Protocol/domain packages   | Versioned messages, invariants, reducers                            | Framework, browser, filesystem, or network APIs |

Dependency arrows point inward: platform and framework adapters depend on typed domain ports. Domain packages never import React, Fastify, WebSocket, xterm.js, Node I/O, SQLite drivers, or generated Codex clients.

## Target end-to-end flow

1. The companion creates a session and an isolated, authoritative workspace.
2. The left seat attaches to a real PTY and launches the official Codex client.
3. Codex sends a Responses request to the human gateway.
4. The right seat receives a redacted projection plus the untouched wire request for inspection.
5. The player submits either final text or one offered tool call. The gateway validates the semantic draft and owns IDs, ordering, and SSE framing.
6. Codex executes an accepted tool through its harness and sends the resulting `function_call_output` in a later request.
7. Both seats observe the same append-only session events. A reload reconstructs projections from the latest snapshot and subsequent events.

The current MVP implements the two-seat demo, a bounded in-memory companion ledger, the human Responses loop, and a workspace shell over a portable pipe fallback. The pinned `codex --version` and `codex --help` resolve inside that workspace. Native PTY, durable event replay, and companion-owned live app-server initialization remain production targets. The local demo uses the same transport interface as the companion; cross-window synchronization is an adapter behavior, not a second domain model.

## Contract sources

Codex contracts generated from pinned `0.151.0` into disposable integration output are the verification source at the app-server boundary and are never edited by hand. Generated clients are not yet committed or consumed by the companion. Project-owned envelopes and domain events live under `packages/protocol`. Responses examples under `tests/fixtures/responses` are deterministic teaching and regression fixtures; they are not claims of full OpenAI API conformance.

When a contract changes, update its schema, parser/encoder, compatibility tests, fixtures, version notes, and this guide in one coherent change. Unknown protocol versions fail closed. Upstream field and method names remain verbatim at the adapter boundary.

## Extension points

- Add a relay by implementing the session transport contract; do not move workspace authority into the relay.
- Add a terminal backend behind `TerminalBackend`; preserve byte streaming, backpressure, cancellation, and resize semantics.
- Add a model mode behind the gateway upstream port; manual, replay, and pass-through share the event ledger.
- Add editors and inspectors as projections over workspace/session ports rather than direct filesystem access.

See [local development](local-development.md) for commands and [debugging and observability](debugging-and-observability.md) for failure isolation.
