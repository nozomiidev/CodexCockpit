# `@codex-cockpit/codex-runtime`

This package supervises the official Codex CLI/app-server boundary. It does not
implement an agent loop or copy generated app-server schemas.

## Responsibilities

- discover and version-probe an official `codex` executable without requiring login;
- create a session-local `CODEX_HOME` and human-model-provider configuration;
- select stdio or Unix-socket app-server listeners;
- enforce `initialize` then `initialized` protocol ordering;
- adapt the documented sandboxed `command/exec` PTY lifecycle while preserving bytes;
- return structured preflight checks when Codex or a platform capability is absent.

## Session orchestration

`CodexSessionRuntimeFactory` is the companion-facing entry point. It verifies the
`0.151.0` runtime pin, creates an isolated provider configuration, starts app-server,
connects an injected request-correlating `RpcPeer`, and performs the mandatory
initialize handshake. A ready runtime can launch the discovered official `codex`
executable through `command/exec` in the authoritative workspace.

Creation returns a `ready | unavailable` discriminated result. The unavailable result
describes an optional fixture demo with `usesOfficialCodex: false`; callers must not
present replay mode as a working Codex runtime. Absolute executable, workspace, and
`CODEX_HOME` paths remain companion-side and must not be projected into browser status
payloads. Provider bearer values stay in the named environment variable, while the
generated config contains only its name and the session correlation header.

Production process spawning and the request-correlating RPC peer implement the ports
exported from `src/types.ts`. Keeping those ports separate makes child-process cleanup,
timeouts, and transports integration-testable without credentials.

## Verification

Run package checks from the repository root:

```sh
pnpm --filter @codex-cockpit/codex-runtime typecheck
pnpm --filter @codex-cockpit/codex-runtime test
```

Reproduce the minimal generic-terminal check with the same workspace cwd and PATH-only
environment used by the companion fallback:

```sh
env -i PATH="$(pwd)/node_modules/.bin:$PATH" /bin/sh -c \
  'codex --version && codex --help >/dev/null'
```

The verified result for the pinned package is `codex-cli 0.151.0`, with exit code zero
for both commands. This managed workspace also prints a warning that `/proc/self/exe`
is unavailable. Version and help success prove executable resolution only; they do not
prove interactive TUI, authentication, app-server, or model-provider readiness.

Run the pinned schema and stdio contract test explicitly:

```sh
CODEX_COCKPIT_CODEX_EXECUTABLE="$(pwd)/node_modules/.bin/codex" \
  pnpm --filter @codex-cockpit/codex-runtime test:integration
```

The integration test creates disposable output directories, invokes both
`generate-ts --experimental` and `generate-json-schema --experimental`, checks the
initialize and `command/exec` seams, and then attempts a credential-free stdio
handshake. Schema generation passes in this environment. The handshake reports an
actionable skip because the managed sandbox hides `/proc/self/exe`, preventing Codex
from configuring its executable helper aliases. A normal Linux runtime with `/proc`
must pass the handshake before release.

## Capability boundary

| Capability                            | Evidence                                 | Current claim                             |
| ------------------------------------- | ---------------------------------------- | ----------------------------------------- |
| Pinned executable resolution          | PATH-only `--version` and `--help`       | Verified for 0.151.0                      |
| Generated TypeScript and JSON Schema  | Pinned binary integration test           | Verified                                  |
| JSONL framing and initialize ordering | Fixtures, unit tests, generated contract | Verified adapter behavior                 |
| stdio process lifecycle               | Real child-process lifecycle tests       | Verified supervisor behavior              |
| Live app-server initialize            | Attempted with pinned binary             | Blocked here by missing `/proc/self/exe`  |
| `command/exec` interactive shell      | Generated contract and adapter tests     | Requires normal-host integration          |
| Unix-socket transport                 | Port and listener selection only         | Not implemented as a concrete client      |
| Companion pipe terminal               | Separate workspace fallback              | Not a PTY and not Codex runtime readiness |
| Fixture demo                          | Deterministic replay                     | Never represents official Codex execution |

For a real terminal session, use an explicit environment allowlist: constructed
`PATH`, isolated `CODEX_HOME` and disposable `HOME`, `TERM`/`COLORTERM`, locale,
`SHELL`, `TMPDIR`, and the exact gateway bearer variable named by `env_key`. Do not
inherit host API keys, cloud credentials, or proxy variables wholesale.

## Upstream seams

`command/exec` is documented, but long-lived interactive-shell behavior remains an
integration seam across Codex versions and operating-system sandboxes. Unix-socket
startup and official TUI multi-client behavior must be verified against the exact
pinned Codex binary before enabling them in a release. Generated schemas have been
verified for 0.151.0 but are intentionally generated only in disposable test output;
they are not committed as hand-maintained protocol copies.
