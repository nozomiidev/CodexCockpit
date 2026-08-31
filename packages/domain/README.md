# `@codex-cockpit/domain`

Deterministic, framework-free state machines for product policy. The package performs
no I/O and does not read a clock; authoritative time is an explicit transition input.

## Inference response lifecycle

An inference starts `pending`, becomes `claimed` under a bounded lease, and ends
`committed`. Renew, release, expiry, and commit require the current claim and revision.
This prevents a disconnected model player from committing through a stale lease.

Persist emitted events atomically in order, then rebuild state with
`reduceInferenceEvents`. An identical response commit command is idempotent. A different
commit after completion fails with the stable `response_already_committed` code.

Adapters should translate `DomainError.code` into their transport error representation;
they must not branch on message text. Run
`pnpm --filter @codex-cockpit/domain test` for unit and property tests.
