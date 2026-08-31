# 命名と TypeScript standard

## Repository layout

初期 monorepo は次を正本とする。二つ目の利用者が現れる前に package を増やさない。

```text
apps/
  web/                 static browser application
  companion/           local/remote session companion
packages/
  domain/              framework-free state machines and policies
  protocol/            project-owned schemas and codecs
  codex-protocol/      generated upstream Codex types/schemas
  test-fixtures/       reviewed language-neutral contract fixtures
tooling/                shared build/test configuration and generators
docs/
  adr/                  architecture decision records
  research/             evidence and spikes
  standards/            normative engineering rules
```

依存方向は `apps -> protocol/domain`、adapter / infrastructure から `domain` とする。
`domain` は browser、Node.js I/O、Fastify、Socket.IO、xterm.js、SQLite driver、generated Codex
client を import してはならない。複数 package を横断する import は各 package の `exports` だけを
使い、`../../other-package/src` や monorepo 全体の path alias を使わない。

## Path と file naming

| 対象 | 規則 | 例 |
|---|---|---|
| directory | `kebab-case` | `response-composer/` |
| TypeScript / TSX | `kebab-case` | `claim-lease.ts`, `model-seat.tsx` |
| test | source 名 + 種別 | `claim-lease.test.ts` |
| E2E | `kebab-case.spec.ts` | `two-window-reconnect.spec.ts` |
| package | `@codex-cockpit/<kebab-case>` | `@codex-cockpit/protocol` |
| generated file | `generated/` 配下 | `generated/app-server-schema.ts` |
| ADR | 4 桁連番 + kebab | `0003-terminal-transport.md` |
| fixture | protocol version と scenario を明示 | `v1/single-tool-call.json` |

React component の symbol は PascalCase だが file は kebab-case にする。case-insensitive filesystem
で衝突する名前を作らない。`index.ts` は package public surface に限定し、directory 内の実装を隠す
barrel file は作らない。

## Symbol naming

| 対象 | 規則 | 例 |
|---|---|---|
| class / type / interface / component | `PascalCase` | `PendingInference`, `ModelSeat` |
| function / variable / property | `camelCase` | `claimRequest`, `occurredAt` |
| boolean | `is` / `has` / `can` / `should` | `isClaimed`, `canResume` |
| React hook | `use` prefix | `useSessionEvents` |
| constant | 通常 `camelCase` | `defaultLeaseDurationMs` |
| wire literal map | `SCREAMING_SNAKE_CASE` を許可 | `ROLE_GRANTS` |
| environment | `CODEX_COCKPIT_` + upper snake | `CODEX_COCKPIT_SESSION_TOKEN` |
| SQL table / column / index | `snake_case` | `session_events`, `occurred_at_ms` |
| project-owned JSON | `camelCase` | `schemaVersion`, `sessionId` |
| machine error code | lower `snake_case` | `claim_already_held` |

- interface に `I`、type に `T` を機械的に付けない。
- implementation に `Impl` を付けない。役割か方式を名前にする。例:
  `LoopbackSessionTransport`、`RelayWebSocketTransport`。
- `Manager`、`Helper`、`Util`、`Data`、`Info` は責務を説明できない限り使わない。
- 単位を名前に含める。`timeoutMs`、`byteLength`、`rowCount`。曖昧な `timeout`、`size` は禁止。
- collection は複数形、map は key/value を説明する。例: `eventsBySequence`。
- acronym は通常語として扱う。`HttpServer`、`JsonSchema`、`Uuid`。上流名は例外。

## Project ID と correlation

project-owned ID は `<prefix>_<UUIDv7>` とする。UUID の文字は lowercase。型は branded string にし、
任意の string と混同させない。

| Entity | Prefix |
|---|---|
| session | `ses_` |
| event | `evt_` |
| command | `cmd_` |
| request | `req_` |
| response | `rsp_` |
| terminal stream | `pty_` |
| artifact | `art_` |
| player | `ply_` |

`seq` は session 内の replay order を表す 1 始まりの単調増加整数であり、ID の時間順に代用しない。
`causationId` は直接の原因、`correlationId` は一つの user-visible operation 全体を示す。

公式 Codex / OpenAI が発行した thread、turn、item、call 等の ID は prefix を付け直さず、その値と
field 名を保持する。project ID と同じ column に混在させない。

## Command と event naming

serialized type は lowercase dot notation とする。

- command は意図を命令形で表す: `inference.response.commit`
- event は起きた事実を過去形で表す: `inference.response.committed`
- request/response、command/event を同じ語で曖昧にしない。
- version を名前に埋め込まず envelope の `schemaVersion` に置く。
- 既存 event の意味を変えない。意味が変わる場合は新しい event と migration を作る。

例:

```text
terminal.input.submit        -> terminal.input.submitted
terminal.resize              -> terminal.resized
inference.request.claim      -> inference.request.claimed
approval.resolve             -> approval.resolved
workspace.file.write         -> workspace.file.written
```

app-server の `thread/start` のような upstream method は dot notation に翻訳しない。

## TypeScript compiler policy

共通 base config は少なくとも次を有効にする。

```json
{
  "compilerOptions": {
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "exactOptionalPropertyTypes": true,
    "noImplicitOverride": true,
    "noFallthroughCasesInSwitch": true,
    "noImplicitReturns": true,
    "noPropertyAccessFromIndexSignature": true,
    "noUncheckedSideEffectImports": true,
    "useUnknownInCatchVariables": true,
    "verbatimModuleSyntax": true,
    "isolatedModules": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

browser app は `moduleResolution: "Bundler"`、Node.js package は `module` と
`moduleResolution` に `NodeNext` を使う。両環境を曖昧な一つの config で兼用しない。
source target は ES2022 を baseline とする。`skipLibCheck` を理由に自分たちの public type error を
無視しない。

## Type and API rules

- handwritten code の `any` は禁止。外部入力は `unknown` として schema で narrow する。
- native `enum` は禁止。string union と `as const` object を使う。
- non-null assertion (`!`) は禁止。状態を型か明示的 invariant check で狭める。
- unchecked `as Foo` は禁止。generated code、`satisfies`、literal narrowing、検証直後の局所 cast だけを
  narrow exception とする。
- optional property と `undefined` 値は別の意味として設計する。
- public function の引数は positional boolean を避け、意味のある options object にする。
- 外部 I/O を行う async API は、可能な限り `AbortSignal`、deadline、resource limit を受け取る。
- Promise を浮かせない。明示的に await するか、所有者と error path を示して `void` を使う。
- `switch` は discriminated union を exhaustive に扱い、`assertNever` で future variant を検出する。
- domain error は typed code を持つ。message text を制御フローに使わない。
- date/time の domain type は `Date` を暗黙共有せず、wire timestamp と monotonic duration を分ける。

## Boundary validation

次はすべて untrusted boundary とする。

- browser message、HTTP body/header、WebSocket / Socket.IO frame
- Codex app-server notification、Responses request/stream
- SQLite row、fixture、config、environment variable
- filesystem path、watch event、import file、replay archive

境界では JSON Schema 2020-12 + Ajv により検証し、coercion、unknown property 除去、default 挿入を
暗黙に行わない。schema validation と domain validation は分ける。parse 結果だけが domain へ進める。
上流 schema は generated package に隔離し、project schema と混ぜて編集しない。

## Imports、exports、side effects

- ESM only。relative import の runtime extension は NodeNext の規則に従う。
- Node built-in は `node:` prefix を使う。
- type-only import/export は `import type` / `export type` を使う。
- package の public surface は `package.json#exports` に列挙する。
- module import 時に process、network、filesystem、timer を起動しない。entrypoint の composition root で
  lifecycle を所有する。
- dependency injection container を導入せず、constructor/function parameter で port を渡す。
- singleton mutable state を置かない。session state は session instance に閉じ込める。

## Streaming and binary data

- terminal stdin/stdout と artifact byte stream は `Uint8Array` を正本にする。
- terminal boundary より前で UTF-8 text に変換しない。
- SSE は dedicated encoder が event order、flush、heartbeat、cancel、EOF を所有する。
- stream producer は backpressure を無視して write し続けてはならない。
- disconnect、abort、deadline は正常な lifecycle branch として test する。

## UI、CSS、test selector

- component は一つの feature responsibility を持つ。route が domain logic を直接所有しない。
- semantic HTML を優先し、クリック可能な `div` を作らない。
- CSS class は kebab-case。CSS custom property は `--cc-` prefix を使う。
- color、spacing、z-index、motion duration は token 化し、magic number を component に散らさない。
- `data-testid` は user semantics で query できない場合だけ使い、`kebab-case` にする。
- user-visible state は色だけで表現しない。focus style を消さない。
- animation は `prefers-reduced-motion` に従う。

## Documentation and generated code

- identifier、schema description、public API TSDoc、code comment、commit subject は English。
- product / research document と user-facing copy は Japanese を許可する。
- comment は処理内容ではなく、制約、理由、upstream quirk、security invariant を説明する。
- public contract と security-sensitive function は TSDoc を必要とする。
- generated file は先頭に generator、version、source hash、再生成 command を記録する。
- generated diff は input/generator update と同じ PR に含め、review 不能な巨大 snapshot で隠さない。
