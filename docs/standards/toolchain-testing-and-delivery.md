# Toolchain、testing、delivery standard

## Version baseline

| Tool | Adopted line | Role |
|---|---|---|
| Node.js | 24 LTS | runtime / CI |
| pnpm | 11.24.0 | workspace、lockfile、script runner |
| TypeScript | 5.9.x exact | compiler / type checker |
| Vite | tested stable | static web build / dev server |
| Fastify | 5 | companion HTTP server |
| Ajv | 8 | JSON Schema 2020-12 validation |
| Pino | Fastify-supported stable | structured/redacted logging |
| Biome | 2.5.x exact | TS/JS/TSX/JSON/CSS/HTML format/lint/import organization |
| Prettier | 3 | Markdown/MDX/YAML formatting only |
| markdownlint-cli2 | tested stable | Markdown structure/lint |
| Taplo | tested stable | TOML format/validation |
| shfmt / ShellCheck | tested stable | shell format/static analysis |
| Vitest | 4.1 | unit/integration/contract runner |
| fast-check | tested stable | property-based test generator |
| Playwright Test | tested stable | browser/E2E/two-window runner |
| axe-core | Playwright-supported stable | automated accessibility checks |
| dependency-cruiser | tested stable | package/layer dependency rules |
| Knip | tested stable | unused file/export/dependency detection |

`packageManager` と `devEngines.packageManager` に pnpm の exact version を固定する。root lockfile は一つだけ。
CI は frozen lockfile で install し、lockfile を生成し直さない。toolchain devDependency は exact version、
runtime dependency は compatible range + lockfile、internal private package は `workspace:*` を使う。

Vite 等の「tested stable」は scaffold / upgrade ADR の release manifest で exact version と integrity を固定する。
`latest` tag を build、CI、Dockerfile、generator command に書かない。

## 選定理由

- Node.js 24 は Active LTS で、local companion と CI の production baseline を一つにできる。
- pnpm は strict dependency layout、workspace protocol、frozen lockfile、install script approval を一つで扱える。
  11.24.0 は 11 系の最後の安定版で、公開直後の 12 系は bake policy により待つ。
- TypeScript 5.9 は実績のある stable line。公開直後の 6.0 を protocol spike と同時に導入しない。
- Biome は code/config の format、lint、import organization を一つの高速な engine に集約できる。
  Markdown/YAML は対象が違うため Prettier に限定し、二重 formatting を避ける。
- Vitest は Vite/ESM/TypeScript と同じ module graph を使えるため unit から Node integration/contract までの
  primary runner にする。Vitest 自身は type check をしないので `tsc --build` は独立 gate にする。
- Playwright は Chromium、Firefox、WebKit、複数 browser context、trace を同じ runner で扱え、この製品の
  two-window、reconnect、keyboard/IME test に合う。
- fast-check は event reducer、path guard、SSE fragmentation の手書き example では見落とす組み合わせを生成する。
- dependency-cruiser と Knip は style linter では検出しにくい layer 逸脱と不要依存をそれぞれ担当する。

ESLint + Prettier を TypeScript code に併用せず、Jest/Cypress を追加しない。必要な Biome rule が存在しない場合は、
まず custom test、dependency-cruiser rule、または narrow Biome plugin で表現できるか検討する。ESLint 導入は
明確な欠落 rule と exit criteria を示す ADR がある場合だけ認める。

## One owner per concern

同じ source を複数 tool で競合して直さない。

| Files | Formatter | Linter / validator |
|---|---|---|
| `*.ts`, `*.tsx`, `*.js`, `*.jsx`, JSON, CSS, HTML | Biome | Biome |
| `*.md`, `*.mdx`, `*.yml`, `*.yaml` | Prettier | markdownlint / schema validation |
| `*.toml` | Taplo | Taplo |
| `*.sh`, `*.bash` | shfmt | ShellCheck |
| generated code / golden wire fixture | generator or none | schema/contract test only |

Prettier と Biome の glob を重ねない。generated schema、raw capture、golden SSE は formatter で書き換えない。
Markdown の prose line wrap は `preserve` とし、URL、table、日本語を機械的に破壊しない。

Biome は recommended rules を baseline とし、suspicious/correctness rule を error にする。ignore は file 全体ではなく
最小行・最小 rule にし、理由を添える。TypeScript の semantic correctness は Biome だけに任せず `tsc --build`
を独立 gate にする。

dependency-cruiser は次を fail させる。

- cycle
- undeclared / orphan package dependency
- `domain` から apps/framework/platform/generated package への import
- package `exports` を迂回する deep import
- browser bundle から Node built-in / server-only module への import

Knip は unused export/file/dependency を fail させる。dynamic entry/generator は個別 entry として列挙し、broad ignore を
置かない。

## Canonical scripts

root `package.json` は少なくとも次を提供する。

```text
pnpm format             write all owned formats
pnpm format:check       verify formatting without writes
pnpm lint               Biome + markdownlint + Taplo + ShellCheck
pnpm lint:architecture  dependency-cruiser + Knip
pnpm typecheck          tsc --build --pretty false
pnpm test:unit          deterministic unit/property tests
pnpm test:integration   filesystem/SQLite/process/stream integration tests
pnpm test:contract      Codex/Responses/schema/golden protocol tests
pnpm test:e2e           Playwright browser and two-window tests
pnpm test:a11y          Playwright + axe + ARIA snapshots
pnpm verify             format:check + lint + lint:architecture + typecheck + unit + contract
pnpm ci                 frozen install is performed by CI, then verify and required suites
```

workspace package に同名 script がある場合、root から recursive に実行できるよう揃える。CI 専用の隠れた test command を
作らず、local と CI は同じ script を使う。

## Test taxonomy

| Kind | Naming | Runner | Must cover |
|---|---|---|---|
| Unit | `*.test.ts` | Vitest | pure reducer、policy、parser、builder |
| Property | `*.property.test.ts` | Vitest + fast-check | path、event replay、SSE chunks、idempotency |
| Integration | `*.integration.test.ts` | Vitest | real temp FS、SQLite、Node stream、child lifecycle |
| Contract | `*.contract.test.ts` | Vitest | generated Codex schema、Responses SSE、golden capture |
| Browser E2E | `tests/e2e/*.spec.ts` | Playwright | routes、two-window、reconnect、keyboard、IME |
| Accessibility | `tests/a11y/*.spec.ts` | Playwright + axe | WCAG automation + ARIA state |

Jest、Mocha、Cypress 等の別 general-purpose runner は導入しない。既存 OSS を selective import する際は、test を
Vitest/Playwright へ移植するか、移行 ADR で短期例外を期限付きにする。

## Test design rules

- behavior を test し、private method や implementation detail を固定しない。
- test title は English で observable behavior を書く。
- test は credentials、public Internet、developer home、global Codex config に依存しない。
- temporary workspace と session-specific `CODEX_HOME` を使い、process/socket/file を必ず cleanup する。
- unit/property test は wall-clock sleep を使わない。fake clock か explicit scheduler を注入する。
- random/property test は failure seed/path を表示し、CI replay 可能にする。
- unit/integration retry は 0。Playwright CI retry は最大 1 回で、trace/video/screenshot を failure artifact に残す。
- snapshot は小さく review 可能な semantic projection に限定する。巨大 raw JSON の blind snapshot 更新は禁止。
- golden fixture は raw、redacted、normalized を別 artifact とし、source version/hash/provenance を持つ。
- mock は port boundary に限定する。domain object 自体を mock しない。

## Mandatory critical-path tests

次の module は happy path だけでは merge できない。

### Human Responses gateway

- valid text、single/multiple tool call、invalid schema、unknown item
- fragmented SSE chunk、slow consumer、heartbeat、abort、deadline、early EOF
- duplicate commit、reconnect、lease expiry、idempotent replay
- current pinned Codex と previous supported Codex の golden contract

### Terminal and process lifecycle

- arbitrary byte boundary、Unicode、Japanese IME、resize、Ctrl+C、alternate screen
- backpressure、bounded buffer、disconnect/reconnect、process group cleanup
- malicious OSC/hyperlink、oversize frame、role violation

### Workspace

- path traversal、symlink escape、case collision、rename race、watch overflow
- binary/large file、atomic save、dirty-editor conflict、external Codex edit

### Session ledger

- monotonic sequence、transaction rollback、duplicate command、stale revision
- snapshot + tail replay が full replay と同じ state になる property test
- redaction/retention/export が secret と host path を漏らさない

## Coverage policy

Vitest V8 coverage の initial floor は次とする。

| Scope | Lines / statements / functions | Branches |
|---|---:|---:|
| repository total | 80% | 75% |
| protocol codecs、event reducer、path guard、SSE encoder、auth/claim policy | 95% | 90% |

coverage は未実行 path の signal であり、quality score ではない。generated code、types-only file、reviewed static fixture は
除外できる。業務ロジックを coverage 除外して threshold を満たしてはならない。critical module の threshold 低下は ADR を
必要とする。

## Browser matrix

- pull request: Chromium、desktop viewport。該当 change は keyboard/a11y/two-window test も実行。
- main/nightly: Chromium、Firefox、WebKit。desktop + one narrow/reflow viewport。
- release: 上記に加え、日本語 IME manual check、screen reader smoke、reduced motion、200% zoom。

Playwright project は role ごとに独立 browser context/page を使う。同一 page の state を切り替えて two-player test の代用に
しない。future relay mode は loopback と同じ contract suite を transport parameterized test で通す。

## Security and supply-chain gates

- Gitleaks: commit/PR と curated fixture の secret scan。
- OSV-Scanner: lockfile と release image の known vulnerability scan。
- CodeQL JavaScript/TypeScript: PR/main と weekly full scan。
- `pnpm audit --prod`: supplemental signal。これ単独を vulnerability gate にしない。
- GitHub Actions は full commit SHA で pin し、comment に upstream version を書く。
- release image は non-root OCI image、digest pin、SPDX 3.0 SBOM、provenance を生成する。
- dependency license は SPDX expression で inventory 化する。incompatible/unknown license は import 前に止める。

security finding を無視する場合は、CVE/advisory、到達可能性、補償 control、owner、期限を記録する。`allow all` の ignore は
禁止。

## Git, commits, and review

short-lived branch + pull request を基本にし、`main` は常に `pnpm verify` を通す。commit は Conventional Commits
1.0.0 を使う。

```text
<type>(<scope>): <imperative English summary>
```

types:

```text
feat fix refactor perf test docs build ci chore revert
```

approved scopes:

```text
web companion domain protocol codex-protocol terminal workspace gateway session
lesson replay security a11y docs deps ci release
```

breaking change は `!` と `BREAKING CHANGE:` footer を使う。issue/ADR/provenance は footer に置く。generated diff だけを
意味不明な `chore` にせず、更新した contract を subject に書く。

public package/protocol の release は Semantic Versioning 2.0.0。publish が始まる時点で Changesets を導入する。
pre-1.0 でも wire/schema breaking change は minor bump と migration note を必要とする。

PR は最低限次を説明する。

- user-visible behavior / reason
- architecture and wire impact
- tests executed and evidence
- security/privacy/retention impact
- compatibility/migration/rollback
- screenshot/trace for meaningful UI change

## Dependency and upgrade policy

- dependency 追加前に standard library、既存 dependency、公式 upstream module で解決できないか確認する。
- package は一つの明確な責務、active maintenance、license、bundle/runtime cost、security history、exit path を評価する。
- dependency major、Node/pnpm/TypeScript/Codex update は一変更に分離し、release note と compatibility fixture を添える。
- normal major は公開後最低 30 日待つ。security fix は待たず、rollback と targeted regression test を用意する。
- Dependabot は週次で patch/minor を ecosystem ごとに group 化する。major は自動 merge しない。
- pinned Codex は自動で `latest` に追随しない。generated schema hash と P0 tool-loop contract が pass した版だけ採る。

## Definition of Done

変更は次をすべて満たして完了とする。

- scope と architecture invariant を満たし、車輪を再発明していない。
- formatter/linter/typecheck と relevant test が pass。
- behavior change に positive、negative、cancel/retry の relevant test がある。
- schema、fixture、migration、docs、threat/retention note が同じ変更で更新済み。
- new dependency / copied OSS の license と provenance が記録済み。
- UI change は keyboard、focus、axe、IME/reflow の relevant check 済み。
- secret、raw content、absolute host path が log/fixture/artifact に含まれない。
- rollback または backwards-compatible migration path が説明できる。
