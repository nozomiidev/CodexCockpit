# 再利用候補の統合比較

更新日: 2026-08-31
状態: 調査フェーズの暫定採否。実装開始時に対象 release/tag の license と API を再確認する。

## 結論

CodexCockpit の高品質化に効くのは、巨大な「ブラウザ IDE」や「AI gateway」を一つ選ぶことではない。完成度の高い部品を、責務が重ならない細い境界で組み合わせることである。

MVP の再利用核は次の通り。

1. OpenAI 公式 Codex binary / app-server / generated schema / Responses protocol
2. RealtimeMarkdownEditor の UI、Explorer、Markdown、i18n、offline IndexedDB
3. xterm.js の terminal frontend
4. 実 shell・Git・Node・npm/npx を持つ隔離 runtime
5. Responses 専用の薄い human gateway と Ajv
6. Socket.IO + SQLite の低量 game event / reconnect 層
7. CSS Grid + Split.js と native dialog による軽量 workbench

## 判定記号

| 記号 | 意味 |
|---|---|
| A | MVP で採用する |
| B | contract spike 合格後に採用する |
| C | optional mode / 将来要件だけで使う |
| R | 設計・テスト・UX の参考にする |
| X | core path では採用しない |

## Core runtime / protocol

| 候補 | 判定 | 再利用する責務 | 導入境界 | 主な注意 |
|---|---:|---|---|---|
| [`@openai/codex` / `codex app-server`](https://github.com/openai/codex) | A | 公式 harness、thread/turn/item、approval/auth、history、filesystem、command | session companion の子 process | version pin。app-server/一部 API は experimental |
| `app-server generate-ts` / `generate-json-schema` | A | 実行 binary と一致する型・schema | CI / contract package | 手書き型を正本にしない |
| app-server `command/exec` PTY | B | sandboxed shell、stdin、resize、stream | `TerminalBackend` | 長時間 shell、npm cache、OS 差を spike |
| app-server `process/*` | C | 高忠実度の host PTY | disposable container 内のみ | experimental、Codex sandbox 外 |
| [`node-pty`](https://github.com/microsoft/node-pty) | C | app-server PTY が不安定な時の fallback | 同じ `TerminalBackend` | native build、同権限 process、別 lifecycle |
| app-server `fs/*` / `fs/watch` | B | host workspace の read/write/list/watch | path 制限付き `HostWorkspaceStore` | absolute path、symlink、remove 既定値を gateway で制限 |
| Codex rollout JSONL / State DB | R | app-server の永続実装 | public API 越しにだけ利用 | SQL/file schema へ直接依存しない |
| `codex --remote` | B | 公式 TUI を同じ app-server へ接続 | terminal 内の wrapper | multi-client socket、OS、ownership を E2E 検証 |

## Human model / API gateway

| 候補 | 判定 | 再利用する責務 | 導入境界 | 主な注意 |
|---|---:|---|---|---|
| 専用 Responses gateway | A | human wait/claim、validation、SSE synthesis、cancel/replay | companion の `/v1/responses` | 独自実装はこの固有責務に限定 |
| [Fastify 5.x](https://fastify.dev/) + `@fastify/websocket` | A | HTTP route/body limit、raw WS、TypeScript companion | Node companion | SSE は専用 encoder。Socket.IO は game control だけに併用 |
| [`codex-responses-api-proxy`](https://github.com/openai/codex/tree/main/codex-rs/responses-api-proxy) | A/R | pass-through capture、strict route、redaction、hardening、golden fixture | one-player 子 process / contract oracle | manual queue はない。whole fork しない |
| [Ajv](https://github.com/ajv-validator/ajv) | A | tool arguments と structured output の JSON Schema 検証 | response composer / gateway | request の dialect を fixture で確認 |
| OpenAI native Responses upstream | A | one-player pass-through | `UpstreamAdapter` | key は browser へ渡さない |
| [LiteLLM](https://github.com/BerriAI/litellm) | C | 多 provider 変換が必要な deployment | 外部 adapter | manual core には重い。license 境界を tag ごとに確認 |
| [vLLM](https://github.com/vllm-project/vllm) | C | GPU local inference、Responses endpoint | 外部 endpoint | engine を vendor しない。tool loop conformance 必須 |
| [Ollama](https://github.com/ollama/ollama) | C | 導入しやすい local inference | 外部 endpoint | API parity を自己申告だけで判断しない |
| llama.cpp / LM Studio | C | user-owned local model endpoint | 外部 endpoint | Responses/tool compatibility probe 必須 |
| TGI | X | inference | — | maintenance mode、Responses-first 新規基盤に不適 |
| Portkey / Helicone Gateway | X/C | routing/observability | 必要なら外部 service | core と責務重複。license / pre-release 注意 |
| [`@huggingface/jinja`](https://github.com/huggingface/huggingface.js/tree/main/packages/jinja) | C | pinned chat template の教材用派生表示 | lazy-loaded browser lens | wire truth ではない。model/template hash を表示 |

## Frontend / workbench

| 候補 | 判定 | 再利用する責務 | 導入境界 | 主な注意 |
|---|---:|---|---|---|
| RealtimeMarkdownEditor | A | theme、pane、Explorer、Markdown、i18n、offline store | provenance を保った source import | ExtensionManager は未完成。`App` 直結を分割 |
| [xterm.js](https://github.com/xtermjs/xterm.js) | A | terminal rendering/input/IME/CJK/curses | `TerminalChannel` | shell/PTY/sandbox ではない。Attach addon は使わない |
| CSS Grid + [Split.js](https://github.com/nathancahill/split) | A | 固定2席 layout と resize | `WorkbenchShell` | literal 2-player window の session 境界にはしない |
| `CommandRegistry` + native `<dialog>` | A | keyboard command と palette | framework-neutral core | command 数が増えるまで library 不要 |
| Ninja Keys | C | fuzzy/nested palette | `CommandRegistry` adapter | 要件が出てから採用 |
| Dockview | C | advanced docking / personal layout | `WorkbenchShell` 内部 | player window/auth boundary には使わない |
| 現行 textarea editor | A | Markdown/lesson の初期編集 | `EditorPort` | JSON diagnostics/diff が弱い |
| CodeMirror 6 | C | JSON/Jinja editor、diagnostics | `EditorPort` | 必要箇所だけ導入。開発正本移転に注意 |
| Monaco | C | VS Code 相当の diff/TS service | `EditorPort` | worker/bundle/内部 API コスト |
| VS Code/code-server/OpenVSCode/Theia | X/R | 完成 IDE の設計 | UX/architecture 参照 | Cockpit を覆い、upstream追随が主業務になる |
| ttyd / WeTTY | R | PTY relay の E2E 基準 | 1日 PoC / reference | 製品では二重 xterm・二重 auth になる |
| Sandpack / JupyterLite | X/R | live preview / static notebook UX | 将来の限定 panel | 公式 Codex runtime ではない |

## Workspace / browser-only mode

| 候補 | 判定 | 再利用する責務 | 導入境界 | 主な注意 |
|---|---:|---|---|---|
| host filesystem | A | Official runtime の唯一の workspace 正本 | `HostWorkspaceStore` | session root、revision、watch、symlink policy |
| 既存 IndexedDB `FileManager` | A | offline/simulated workspace | `IndexedDbWorkspaceStore` | connected mode との二重正本を禁止 |
| native Git / Node / npm / npx | A | Official runtime の実ツール | isolated runtime | arbitrary code execution として隔離 |
| just-bash | C | simulated offline shell lesson | `BrowserTerminalBackend` | official badge を付けない。beta/互換差 |
| isomorphic-git | C | offline Git lesson | browser workspace のみ | CORS proxy、別 Git DB、flush |
| OPFS | C | 大容量 cache/snapshot | benchmark 後 | shell/fs API そのものではない |
| ZenFS | C/X | browser Node `fs` 互換 | 要件が証明された場合だけ | LGPL + web exception、既存実装と重複 |
| BrowserFS | X | browser VFS | — | deprecated。新規採用しない |
| LightningFS | C | isomorphic-git 専用 FS | offline Git mode | 汎用 workspace 正本にしない |
| MoonBash / npm-in-browser | R/C | pure-JS shell/npm の研究 | 非公式 tutorial spike | 規模/停滞/互換性。official runtime ではない |
| WebContainers / Nodebox | X | browser Node runtime | — | native Codex 不可、WASM/利用条件/COOP-COEP |
| v86 / JSLinux | X | browser OS emulation | — | 重量、WASM、権利/API、目的と逆方向 |

## Multiplayer / replay

| 候補 | 判定 | 再利用する責務 | 導入境界 | 主な注意 |
|---|---:|---|---|---|
| [Socket.IO](https://github.com/socketio/socket.io) | A | game command、presence、room、ack、再接続 | 低量 control/event channel | terminal byte stream と raw app-server proxy には使わない |
| SQLite append-only event log | A | seq、idempotency、snapshot metadata | companion 内 | broadcast 前 commit。raw content 既定非保存 |
| dedicated binary WebSocket | A | terminal I/O | `TerminalChannel` | ring buffer と backpressure、再認証 |
| typed app-server adapter | A | 限定された RPC/event | generated schema | browser に汎用 RPC proxy を公開しない |
| Yjs + y-websocket | C | 将来の共同 Markdown | editor channel のみ | terminal/tool/response state へ使わない |
| Colyseus | R | server authority / room lifecycle | pattern 参照 | 2人の protocol game には重い |
| PartyServer / PartySocket | C | Cloudflare-hosted room 版 | deployment variant | local companion と権威を分裂させない |
| Automerge / Liveblocks / WebRTC core | X | CRDT/P2P/hosted sync | — | 順序付き副作用と監査ログに不適・過剰 |

## 実装するもの／しないもの

| 責務 | 決定 | 理由 |
|---|---|---|
| Codex agent loop | 公式を利用 | 学習対象そのもの。再実装は価値を壊す |
| app-server protocol type | binary から生成 | version drift を最小化 |
| terminal emulation | xterm.js | 成熟領域 |
| PTY / shell | 公式 app-server または node-pty fallback | OS 機能を再実装しない |
| browser↔host security bridge | 薄く実装 | product 固有の trust boundary |
| human response queue / builder | 薄く実装 | 他 OSS にないゲーム固有部分 |
| provider routing / inference | 外部 adapter | 巨大 AI gateway/GPU engine を抱えない |
| game state / replay | command + append-only event | 順序・権限・採点が product 固有 |
| collaborative editor | 後回し | core loop に不要 |
| Jinja renderer | optional OSS | wire と分離した教材レンズ |

## Version pin と昇格ゲート

採用は package 名だけで固定せず、次を lock する。

- Codex CLI release と生成 schema checksum
- app-server contract fixture と Responses SSE fixture
- npm lockfile、license snapshot、静的 asset integrity
- RealtimeMarkdownEditor import 元 commit と attribution
- local/remote runtime image digest
- lesson bundle が要求する protocol capability

`B` / `C` 候補は、[参照アーキテクチャ](./08-reference-architecture.md)の spike と各担当文書の合格条件を満たした場合だけ `A` へ昇格する。
