# CodexCockpit contributor instructions

This file is normative for the whole repository. Read
`docs/standards/README.md` and the documents it links before changing product code.

## Product invariants

- Use the official Codex CLI and app-server. Do not recreate the Codex agent loop,
  shell parser, terminal emulator, Git implementation, or Responses protocol.
- The left player's local workspace is authoritative. The browser receives logical
  workspace paths, never unrestricted host absolute paths.
- Keep the browser UI statically deployable. Native shell, filesystem, Codex, and
  secrets belong to a local companion or an isolated remote runtime.
- Keep transports replaceable. Local and future relay modes must implement the same
  session transport contracts; a relay must not become the workspace or shell owner.
- Preserve upstream Codex/OpenAI field names and method names exactly at wire
  boundaries. Translate only inside explicit adapters.
- The right player chooses semantic model output. The system owns framing, IDs,
  validation, linting, safe defaults, and protocol serialization.
- Fail closed on unknown protocol versions, missing capabilities, role violations,
  path escapes, and invalid response items.

## Repository and language rules

- Runtime baseline: Node.js 24 LTS, pnpm 11.24.0, TypeScript 5.9, ESM only.
- Use `kebab-case` for files/directories/packages, `PascalCase` for types and UI
  components, and `camelCase` for values/functions/JSON owned by this project.
- Use `snake_case` for SQL identifiers and stable machine error codes.
- Prefix environment variables with `CODEX_COCKPIT_`.
- Prefer named exports. Default exports are allowed only where a framework or config
  loader requires them.
- Do not use handwritten `any`, TypeScript `enum`, unchecked type assertions, or
  non-null assertions. Validate `unknown` at every untrusted boundary.
- Keep domain code independent of Fastify, Socket.IO, xterm.js, browser globals,
  Node.js I/O, SQLite drivers, and generated Codex clients.
- Keep generated files under a `generated/` directory. Never edit them by hand; pin
  their generator version and input hash.
- Identifiers, code comments, schemas, commit subjects, and API documentation are in
  English. User-facing product copy and explanatory docs may be Japanese.

## Change workflow

1. Inspect the closest code, tests, standards, and architecture decision before
   editing. Preserve unrelated user changes.
2. Add or update the smallest relevant test with every behavior change.
3. Run the narrow test first, then the repository quality gate before handoff.
4. Update contracts, fixtures, threat notes, and docs in the same change when their
   behavior changes.
5. Do not silently update pinned Codex schemas, protocol fixtures, or dependency
   majors. Record the compatibility evidence and use an ADR for exceptions.

The canonical commands, once the workspace scaffold exists, are:

```sh
pnpm format
pnpm verify
pnpm test:e2e
```

`pnpm verify` is the required local/CI gate. It includes formatting checks, static
analysis, type checking, unit tests, and contract tests. E2E is additionally required
for UI, transport, terminal, session, or accessibility changes.

## Tests

- Use Vitest for unit, property, integration, and protocol contract tests. Use
  Playwright Test for real-browser, two-window, IME, reconnect, and accessibility
  behavior. Do not introduce Jest or another general test runner.
- Tests must be deterministic: fixed clocks where appropriate, explicit random seeds,
  temporary workspaces, bounded waits, and no dependence on developer credentials.
- Treat terminal bytes as bytes until the rendering boundary. Preserve backpressure,
  cancellation, and disconnect behavior in tests.

## Git and review

- Use Conventional Commits with the approved scopes in
  `docs/standards/toolchain-testing-and-delivery.md`.
- Keep commits single-purpose. A behavior change is incomplete without tests and any
  required documentation or migration.
- Never bypass a failing quality gate by weakening a rule, deleting a test, updating a
  snapshot blindly, or adding a broad ignore. Fix the cause or document a narrow,
  time-bounded exception in an ADR.
