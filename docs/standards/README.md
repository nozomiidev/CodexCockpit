# CodexCockpit engineering standards

更新日: 2026-08-31  
状態: Accepted / 実装開始時から必須

## 決定

CodexCockpit は、次の一本化した標準で開発する。

| 領域 | 採用 |
|---|---|
| Runtime | Node.js 24 LTS |
| Package manager | pnpm 11.24.0、exact pin、単一 lockfile |
| Language | TypeScript 5.9、ESM only、strictest practical settings |
| Web build | Vite の検証済み stable release |
| Companion | Fastify 5、Ajv 8、Pino structured logging |
| Primary formatter/linter | Biome 2 |
| 文書 | Prettier 3 + markdownlint-cli2 |
| TOML | Taplo |
| Shell | shfmt + ShellCheck |
| Type checker | `tsc --build` |
| Unit / integration / contract | Vitest 4.1 |
| Property test | Vitest + fast-check |
| Browser / two-window / a11y | Playwright Test + axe-core |
| Architecture / dead code | dependency-cruiser + Knip |
| Security automation | Gitleaks、OSV-Scanner、CodeQL |
| Commit convention | Conventional Commits 1.0.0 |
| Versioning | Semantic Versioning 2.0.0 |

pnpm 12 と TypeScript 6 は 2026-08-31 時点で公開直後のため採らない。新 major は公開後 30 日以上、
互換性検証、移行 issue、CI 全通過を満たしてから更新する。緊急 security update はこの待機期間を
適用しない。

## 規範の優先順位

矛盾した場合は上から優先する。

1. 実行中の公式 Codex が生成した schema、公式 OpenAI Responses wire contract
2. この文書で採用した外部標準の normative requirement
3. `docs/standards/` と `AGENTS.md`
4. package / framework の一般的な慣例

上流 field、method、event 名は、こちらの命名規則より常に優先し、そのまま保持する。内部表現を
綺麗にするために wire contract を改名してはならない。

本文書の `MUST`、`MUST NOT`、`SHOULD`、`SHOULD NOT`、`MAY` は RFC 2119 / RFC 8174
の意味で用いる。規則の例外は、理由、範囲、risk、失効条件、代替案を記録した ADR を必要とする。

## 採用する標準

| 対象 | 標準 | このプロジェクトでの使い方 |
|---|---|---|
| ECMAScript | ECMA-262 | ESM。handwritten CommonJS は作らない |
| JSON | RFC 8259 / ECMA-404 | UTF-8、重複 key 禁止、`NaN` / `Infinity` 禁止 |
| Schema | JSON Schema Draft 2020-12 | 内部 command/event/API の唯一の schema dialect |
| HTTP | RFC 9110 | method、status、cache、header semantics |
| HTTP error | RFC 9457 | HTTP 境界の `application/problem+json` |
| 時刻 | RFC 3339 | 外部 JSON は UTC、millisecond precision、末尾 `Z` |
| 識別子 | RFC 9562 UUIDv7 | project-owned entity ID の sortable random 部分 |
| JSON digest | RFC 8785 JCS + SHA-256 | fixture、artifact、schema の再現可能な hash |
| WebSocket | RFC 6455 + WHATWG WebSockets | remote は `wss:`、binary terminal frame を保持 |
| SSE | WHATWG HTML Standard | Responses-compatible stream の framing |
| Trace correlation | W3C Trace Context | relay / companion 間の `traceparent`、content は含めない |
| Web UI | WHATWG HTML / CSS standards | semantic native element を ARIA より先に使う |
| Accessibility | WCAG 2.2 AA / WAI-ARIA 1.2 / APG | keyboard、focus、contrast、reduced motion、IME を gate 化 |
| Markdown | CommonMark 0.31.2 + GFM | repository 文書 |
| Shell | POSIX.1-2024 Issue 8 | portable script。Bash extension は明示する |
| Container | OCI Image / Runtime / Distribution specs | hosted runtime の交換可能な配布・実行形式 |
| License / SBOM | SPDX 3.0、ISO/IEC 5962:2021 | license expression と release SBOM |
| Security baseline | OWASP ASVS 5.0 Level 2 | Web/companion の検証 checklist。shell isolation は別 threat model |

JSON Schema と OpenAPI は同一視しない。上流 Responses schema と Codex generated schema を
手書き OpenAPI に転記せず、正本から adapter と fixture を生成する。

一次仕様:

- [ECMA-262](https://tc39.es/ecma262/)
- [RFC 8259 JSON](https://www.rfc-editor.org/rfc/rfc8259.html)
- [JSON Schema Draft 2020-12](https://json-schema.org/draft/2020-12)
- [RFC 9110 HTTP Semantics](https://www.rfc-editor.org/rfc/rfc9110.html)
- [RFC 9457 Problem Details](https://www.rfc-editor.org/rfc/rfc9457.html)
- [RFC 3339 Date and Time](https://www.rfc-editor.org/rfc/rfc3339.html)
- [RFC 9562 UUID](https://www.rfc-editor.org/rfc/rfc9562.html)
- [RFC 8785 JSON Canonicalization](https://www.rfc-editor.org/rfc/rfc8785.html)
- [WHATWG HTML Standard](https://html.spec.whatwg.org/)
- [W3C Trace Context](https://www.w3.org/TR/trace-context/)
- [WCAG 2.2](https://www.w3.org/TR/WCAG22/)
- [WAI-ARIA 1.2](https://www.w3.org/TR/wai-aria-1.2/)
- [POSIX.1-2024 Issue 8](https://pubs.opengroup.org/onlinepubs/9799919799/)
- [OCI specifications](https://opencontainers.org/)
- [SPDX specifications](https://spdx.dev/use/specifications/)
- [OWASP ASVS](https://owasp.org/www-project-application-security-verification-standard/)

## 文書一覧

- [命名と TypeScript](./naming-and-typescript.md)
- [Protocol、platform、security、accessibility](./protocol-platform-security-and-accessibility.md)
- [Toolchain、testing、delivery](./toolchain-testing-and-delivery.md)

## 標準を変更する条件

次は ADR と reviewer 一名以上を必要とする。

- runtime、package manager、language、formatter、linter、test runner の major 変更
- wire format、ID、timestamp、event naming、database naming の変更
- security invariant、retention default、workspace ownership の変更
- 新しい framework、transport、state authority、general-purpose test runner の導入
- upstream Codex schema / release manifest の更新

更新は「新しいから」ではなく、解決する具体的問題、互換性、rollback、計測結果で判断する。
