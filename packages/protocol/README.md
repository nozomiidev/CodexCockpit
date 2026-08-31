# `@codex-cockpit/protocol`

Framework-neutral project-owned wire contracts for commands, events, correlation IDs,
and inference claim leases.

## Boundary

- Project IDs are lowercase `<prefix>_<UUIDv7>` values. `inf_` identifies a pending
  inference and `clm_` identifies a particular lease claim.
- Official Codex and OpenAI IDs are opaque upstream values. Never parse, prefix,
  regenerate, or place them in a `ProjectId` field.
- Serialized inputs must be validated against the JSON Schema 2020-12 documents under
  `schemas/` before reaching domain code. TypeScript types alone do not validate input.
- `isCommandEnvelope` and `isEventEnvelope` are lightweight fail-closed guards for the
  base envelopes. An adapter must additionally validate the selected command/event
  payload schema; passing the base guard does not authorize a domain operation.
- The caller owns cryptographic entropy. `createProjectId` accepts injected time and
  ten random bytes so browser and Node adapters can use their platform CSPRNG without
  making this package platform-specific.
- Human response submission contains semantic text or tool intent. Gateway-generated
  upstream IDs appear only in `ResponseCommitDraft`. Terminal data is always a binary
  `Uint8Array`; versioned JSON terminal contracts are limited to resize, close, and
  lifecycle status. Missing and unknown terminal schema versions fail closed.
- `InferenceClaimReceipt` is the only claim response DTO. A client must echo its
  `claimId` and `revision` in the guarded commit instead of relying on player identity.
- `createPayloadViews` retains the authoritative raw value and optional exact wire text
  while creating a detached, bounded, redacted display projection. Never fall back to
  rendering `raw` when projection limits are reached.

Run `pnpm --filter @codex-cockpit/protocol test` for the narrow test suite.
