# Local development and verification

## Prerequisites

- Node.js 24 LTS
- Corepack with the repository-pinned pnpm 11.24.0
- A supported Chromium installation for the fastest UI loop
- Linux for native Codex, PTY, Unix-socket, and workspace integration work

Do not rely on a globally installed Codex or pnpm version. `codex-runtime` pins and verifies Codex `0.151.0`; companion-owned live app-server wiring remains pending. PATH-only version/help success does not imply TUI or handshake readiness: this sandbox blocks `/proc/self/exe`, and the portable terminal is currently pipe-based.

## Setup

From the repository root:

```sh
corepack enable
pnpm install --frozen-lockfile
pnpm exec playwright install chromium
```

Use an unfrozen install only while intentionally changing dependency declarations, then review and commit the lockfile with that change.

## Feedback loops

Use the narrowest command while editing, then run the full required gate before handoff.

```sh
# Static web development server
pnpm --filter @codex-cockpit/web dev

# One browser scenario with trace-on-retry
pnpm exec playwright test tests/e2e/solo-flow.spec.ts --project=chromium

# Unit or contract tests matching a changed module
pnpm exec vitest run path/to/file.test.ts

# Repository gate
pnpm verify

# Browser, transport, terminal, session, and accessibility gate
pnpm test:e2e
```

Playwright starts the configured web server and waits for an explicit URL response. Tests must not add fixed sleeps. Local E2E session IDs include worker and retry identity so parallel runs cannot leak state.

## E2E acceptance map

| Spec                               | Protects in the current demo/MVP                                    |
| ---------------------------------- | ------------------------------------------------------------------- |
| `solo-flow.spec.ts`                | Request inspection, semantic text/tool drafting, validation, submit |
| `two-window-session.spec.ts`       | Left prompt delivery, right response, and one shared session        |
| `keyboard-ime.spec.ts`             | Keyboard completion path and composition-safe shortcuts             |
| `responsive-accessibility.spec.ts` | Mobile/desktop fit, automated WCAG checks, reduced motion           |

`apps/companion/test/acceptance.test.ts` is the decisive native boundary test. It covers a
validated Responses claim/commit with canonical SSE ordering and an authenticated terminal
ticket, marker command, resize diagnostic, and close lifecycle, including adversarial ticket
and Origin cases.

The selectors prefer accessible roles and names. `data-testid` is reserved for composite surfaces whose semantic role does not uniquely identify the observed subsystem. A renamed visible label is a deliberate UX contract change and should update its test in the same commit.

## Deterministic fixtures

`tests/fixtures/responses/text-loop.json` covers a final text response. `tool-call-loop.json` covers a function call, harness-provided output in the next request, and final text. IDs, commands, and output are fixed. Never place credentials, machine-specific paths, timestamps, or nondeterministic tokens in golden fixtures.

To refresh a fixture from official Codex traffic:

1. Record the pinned Codex version and generated schema input hash.
2. Capture the smallest successful interaction.
3. Redact authorization, host paths, usernames, and unrelated content.
4. Normalize only unstable project-owned IDs; preserve upstream field names and item order.
5. Run parser, encoder, replay, and E2E contract tests before accepting the change.
6. Review the complete semantic diff; never update a fixture solely to make a test green.

## Before handoff

Run `pnpm verify` and `pnpm test:e2e` for relevant changes. Inspect Playwright HTML output, traces, screenshots, server logs, and process cleanup on failure. The main agent owns commit/push and must verify the remote branch and clean worktree.
