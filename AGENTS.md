# CodexCockpit contributor instructions

This file is normative for the whole repository. Read
`docs/standards/README.md` and the documents it links before changing product code.

## Intent and decision making

- Treat a request as an expression of product intent, not necessarily a literal or
  complete specification. Correct obvious typos, character-width mistakes, and
  wording omissions from context instead of propagating them into names or behavior.
- Reconcile the current request with repository evidence and prior accepted decisions.
  Ask only when an ambiguity would materially change architecture, compatibility,
  destructive behavior, cost, or the user-visible result. Otherwise state and record
  the smallest reasonable assumption.
- Target top-tier commercial quality. A spike may intentionally be temporary only when
  its scope, success criteria, discarded parts, and path to production are explicit.
- Convert broad quality requests into verifiable acceptance criteria, tests, metrics,
  or documented invariants. Do not claim quality from visual polish or test coverage
  alone.

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

## Commercial quality bar

- Evaluate every design and change for maintainability, portability, extensibility,
  encapsulation, reuse, correctness, error resilience, operability, observability,
  performance, accessibility, security, privacy, compatibility, and recoverability.
  Record material trade-offs instead of optimizing one attribute invisibly at the
  expense of another.
- Keep modules cohesive and public surfaces minimal. Encapsulate volatile libraries,
  platform APIs, transports, persistence, and upstream protocols behind typed ports;
  do not leak framework or vendor types into the domain.
- Put operating-system and deployment differences behind adapters and capability
  checks. Do not assume a developer's CWD, home directory, shell startup files,
  credentials, browser, architecture, locale, or globally installed tools.
- Design external I/O for bounded resources, cancellation, deadlines, backpressure,
  idempotency, partial failure, retry classification, and deterministic cleanup.
  Errors must preserve a stable machine code, useful context, and an actionable next
  step without exposing implementation internals.
- Preserve backward compatibility where practical. Protocol, schema, storage, config,
  and public API changes require explicit versioning, migration, compatibility tests,
  and a rollback path.
- Reuse an abstraction when it represents a real stability boundary or multiple real
  consumers. Do not create speculative generality, but do not duplicate a proven
  domain concept across apps.
- Establish correctness and an observable baseline first, then optimize from profiles
  and measurements. Aggressively improve latency, throughput, memory, bundle size, and
  startup cost without weakening behavior, diagnostics, portability, or tests.

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

## Research and external reuse

- At every material decision point, check current primary documentation, standards,
  upstream source, release notes, and real integrations. Do not rely on stale memory
  when an API, library, standard, browser, Codex release, or ecosystem practice may
  have changed.
- Search GitHub and the wider Web for maintained repositories, OSS libraries, UI
  components, assets, demos, APIs, CDN offerings, design patterns, and production
  examples before writing infrastructure or interaction primitives from scratch.
- Prefer official upstream implementations and mature community assets over custom
  code when they satisfy the product intent. Integrate them through narrow adapters so
  they remain replaceable and testable.
- Evaluate candidates by fit, maintenance activity, release discipline, documentation,
  interoperability, accessibility, performance evidence, license, provenance,
  security history, transitive cost, customization surface, and exit path. Record the
  source URL, evaluated version/commit, access date, decision, and rejected alternatives
  in research notes or an ADR.
- Do not reject a useful dependency merely because it is large or sophisticated.
  Multiple proven dependencies are acceptable when each contributes distinct value.
  Make the intended experience correct first, then measure and optimize loading,
  splitting, caching, rendering, memory, and transport paths without silently removing
  capability.
- For UI architecture, state management, animation, layout, editor, and visualization,
  research current de facto OSS and high-quality reference implementations. Select for
  interaction quality and accessibility as well as appearance.
- Do not production-hotlink a third-party CDN/API/asset without an availability,
  integrity, caching, privacy, licensing, version pinning, and fallback decision.
- Revisit `docs/standards/` and the relevant standards body whenever introducing a new
  protocol, identifier, serialized format, platform boundary, language, or toolchain.
  Document deviations through an ADR.

## Change workflow

1. Inspect the closest code, tests, standards, and architecture decision before
   editing. Preserve unrelated user changes.
2. Add or update the smallest relevant test with every behavior change.
3. Run the narrow test first, then the repository quality gate before handoff.
4. Update contracts, fixtures, threat notes, and docs in the same change when their
   behavior changes.
5. Do not silently update pinned Codex schemas, protocol fixtures, or dependency
   majors. Record the compatibility evidence and use an ADR for exceptions.

Run the fastest relevant feedback loop while editing. Parallelize independent checks,
use incremental builds and caches, and avoid repeating unchanged work; this must not
replace the full required gate before handoff.

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

## Observable development loops

- Minimize black-box waiting in builds, tests, runtime startup, debugging, and external
  integrations without reducing product quality or execution speed.
- Long-running operations must expose the current phase, elapsed time, bounded progress
  or heartbeat, completion, and failure. Provide a concise human view and, where useful,
  a structured machine-readable view. Avoid noisy per-item logging on hot paths.
- Use explicit readiness conditions and bounded deadlines instead of arbitrary sleeps.
  Retries must expose attempt count and classified cause; they must not make a failure
  appear to be a hang.
- Make process, session, request, command, and test identifiers visible across relevant
  logs and artifacts so a failure can be traced end to end. Distinguish queueing,
  connection, execution, streaming, parsing, and cleanup time.
- On failure, retain the smallest useful diagnostic artifact: failed phase, exit code,
  relevant versions/configuration, reproducible command, random seed, structured logs,
  and Playwright trace/screenshot when applicable. Never require a second run merely
  to discover where the first run stopped.
- Expose health, readiness, child-process lifecycle, stream pressure, and queue state
  through low-overhead development diagnostics. Production instrumentation must be
  bounded, configurable, and measured so observability does not become a performance
  regression.
- Test helpers and local orchestration must terminate orphan processes and report the
  last observed state on timeout. A timeout without state and correlation context is a
  tooling defect.

## Documentation and handoff

- Keep the repository sufficient for another developer or AI to start development,
  refactoring, debugging, or extension without relying on undocumented conversation
  history.
- Document architecture ownership, dependency direction, state authority, protocols,
  lifecycle/state machines, setup, exact commands, configuration sources, generated
  artifacts, failure modes, diagnostics, migrations, compatibility, known limitations,
  and extension points at the closest durable location.
- Package and subsystem READMEs must explain purpose, boundaries, public contracts,
  how to run and test them, expected outputs, common failures, and where to investigate
  next. Keep root documents navigational rather than duplicating every detail.
- Comments and TSDoc must be precise enough to preserve invariants, intent, non-obvious
  trade-offs, upstream quirks, and failure behavior. Do not narrate obvious syntax or
  allow stale comments to compete with executable behavior.
- Record important decisions as ADRs with context, alternatives, consequences,
  compatibility/rollback implications, and evidence links. Research notes must include
  dates and pinned versions/commits so future readers can assess staleness.
- Update documentation, examples, diagrams, troubleshooting, and comments in the same
  logical commit as the behavior they describe.

## Git and review

- Use Conventional Commits with the approved scopes in
  `docs/standards/toolchain-testing-and-delivery.md`.
- Commit and push at coherent, reviewable milestones. Do not wait until the end of a
  large task to split unrelated research, scaffold, feature, refactor, fix, and docs
  changes after the fact.
- Keep commits single-purpose and independently understandable. Include the tests,
  documentation, generated artifacts, migration, and provenance required for that
  commit's behavior; do not split them into misleading follow-up commits.
- Do not commit a knowingly broken or half-applied state to the shared branch. A named
  checkpoint branch is allowed only when explicitly requested and clearly labeled.
- Before committing, inspect status and the complete diff and run the relevant narrow
  checks. Before handoff, run the required gate, push every intended commit, verify the
  remote branch points at the intended HEAD, and leave the worktree clean or report
  every intentional remaining change.
- Never bypass a failing quality gate by weakening a rule, deleting a test, updating a
  snapshot blindly, or adding a broad ignore. Fix the cause or document a narrow,
  time-bounded exception in an ADR.
