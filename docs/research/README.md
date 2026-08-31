# CodexCockpit 調査索引

更新日: 2026-08-31
対象フェーズ: 既存 OSS・公式資産の再利用可能性調査

## Executive summary

CodexCockpit は実現可能である。ただし「完全静的・非 WASM のブラウザだけで Linux と公式 Codex を動かす」のではなく、**静的 UI と session 専用 companion/runtime を分ける**。

最有力構成:

- 左席: xterm.js + 本物の shell + 公式 `codex --remote`
- 中核: session 専用の公式 `codex app-server`
- 右席: Codex の custom provider から届く実 `POST /v1/responses` JSON と、人間用 response builder
- 同期: role-specific routes + companion の権威 event log
- 保存: Codex 履歴は app-server API、game 固有 state は SQLite append-only event
- UI 資産: RealtimeMarkdownEditor から選択コピーして境界を抽出

独自実装を残すのは、browser/host の安全な bridge、人間が model response を claim/検証/submit する待ちキュー、教材・採点・replay に限定する。

## 確定した調査判断

1. Codex CLI / agent loop / TUI / history index を再実装しない。
2. app-server は session ごとに起動し、version 固定した binary から schema を生成する。
3. Linux v1 は Unix socket listener を使い、companion と `codex --remote` を別 client にする。
4. 同じ app-server でも live thread subscription は接続ごと。v1 は TUI を thread/turn/approval owner にする。
5. Official runtime の terminal は sandboxed `command/exec` PTY を第一 spike、`process/*` と node-pty を fallback にする。
6. RealtimeMarkdownEditor の IndexedDB と host FS を同期するのではなく、connected mode は host workspace だけを正本にする。
7. Codex wire の正本は Responses API JSON。Jinja は特定 model/template の派生教材 view である。
8. 架空の `cockpit-human` model slug を使わない。pinned catalog の実在 slug と custom provider を組み合わせる。
9. custom provider は `supports_websockets = false` とし、最初の教材を HTTP `/v1/responses` + SSE に固定する。
10. manual gateway は TypeScript/Fastify で薄く作る。公式 responses proxy は pass-through/capture に再利用する。
11. 二人プレイは terminal/model の専用 URL。Dockview popout や BroadcastChannel を状態の正本にしない。
12. terminal bytes と app-server RPC を Socket.IO に混ぜない。Socket.IO は game command/presence/低量 event に限定する。
13. CRDT は将来の共同 Markdown だけ。terminal、tool、model response、approval には使わない。
14. raw terminal/request の永続化は既定 OFF。教材 replay は明示 opt-in と redaction/TTL を必須にする。
15. RealtimeMarkdownEditor は固定 commit から一回だけ選択コピーし、Apache-2.0 と provenance を残す。

## 文書一覧

| 文書 | 内容 | 主結論 |
|---|---|---|
| [00-methodology.md](./00-methodology.md) | 調査基準、証拠、採否語 | 一次資料と接続境界で評価する |
| [01-codex-official-runtime.md](./01-codex-official-runtime.md) | 公式 Codex/app-server/source | Unix socket app-server + official TUI + generated schema |
| [02-terminal-shell-vfs.md](./02-terminal-shell-vfs.md) | terminal、PTY、shell、VFS、npm/Git | xterm.js + real runtime。browser OS は tutorial 限定 |
| [03-model-gateway-human-llm.md](./03-model-gateway-human-llm.md) | Responses gateway、SSE、Jinja、inference | 専用 TS gateway。公式 proxy は capture/pass-through |
| [04-web-ide-workbench.md](./04-web-ide-workbench.md) | editor、workbench、layout、terminal UI | 巨大 IDE は使わず軽い部品を組み合わせる |
| [05-multiplayer-replay.md](./05-multiplayer-replay.md) | 2人同期、event log、replay、CRDT | 権威 server + SQLite seq log。CRDT core 不採用 |
| [06-realtime-editor-integration.md](./06-realtime-editor-integration.md) | 既存 private repo のソース棚卸し | UI 資産を選択コピーし adapter 境界を作る |
| [07-reuse-candidate-matrix.md](./07-reuse-candidate-matrix.md) | OSS の統合採否 | Adopt / spike / optional / reject を一表に統合 |
| [08-reference-architecture.md](./08-reference-architecture.md) | 統合トポロジ、security、spike | 静的 UI + companion + app-server + human gateway |
| [09-next-research-and-spikes.md](./09-next-research-and-spikes.md) | 未解決事項と実証順 | 最大リスクを縦切り contract test で先に潰す |

## 調査サイクルで変わった判断

| 初期仮説 | 反証後の判断 | 理由 |
|---|---|---|
| pure-JS Linux を主基盤にする | offline/simulated lesson だけ | 公式 Codex は native binary。app-server が本物の PTY/FS を既に提供 |
| app-server は stdio で十分 | official remote TUI mode は Unix socket | stdio は single client で `codex --remote` endpoint にならない |
| 同じ app-server なら event を自動共有 | TUI を owner、companion は限定 client | subscription/approval は connection lifecycle を持つ |
| `cockpit-human` model 名を使う | catalog にある実 slug を pin | 未知 slug は model metadata fallback で tool 構成を変える |
| `process/*` を terminal 第一候補 | sandboxed `command/exec` を先に試す | `process/*` は experimental かつ unsandboxed |
| terminal/game/app-server を一つの WS へ | transport を責務別に分離 | binary/backpressure、typed RPC、game event の性質が違う |
| terminal を完全 replay 保存 | raw は既定非保存 | 秘密情報、容量、同意の負担が大きい |
| Dockview popout で2人画面 | role-specific routes | UI layout は認証・役割・状態同期の境界ではない |
| CRDT で全同期 | 順序付き event log | command/tool/approval は merge 不能な副作用 |
| RealtimeMD を subtree/package にする | provenance 付き選択コピー | private history、DOM結合、別製品境界の問題 |

## この調査で採用しないと決めた大物

- VS Code/code-server/OpenVSCode/Theia を製品基盤にすること
- WebContainers、v86/JSLinux、browser Node compatibility layer を Official runtime にすること
- LiteLLM、Portkey、Helicone、vLLM のコードを manual gateway として内包すること
- Codex SQLite/JSONL 内部 schema を application model にすること
- BrowserFS/LightningFS/isomorphic-git を connected workspace の正本にすること
- WebRTC/Liveblocks/Automerge を session の権威状態にすること

これらは品質が低いからではなく、今回の責務と重ならない、または巨大すぎるためである。外部 endpoint、将来 panel、offline lesson、設計資料としての価値は各文書に残した。

## 次の進め方

次は UI を作り込む前に、[09-next-research-and-spikes.md](./09-next-research-and-spikes.md) の P0 を一つの縦切りとして実行する。成功条件は、左の公式 TUI から prompt を送り、右の手動 response builder が一回 tool call を返し、Codex harness が tool を実行し、次の request を右へ届け、最後の text で turn を完了すること。この一往復が成立して初めて、RealtimeMarkdownEditor の UI 移植へ進む。
