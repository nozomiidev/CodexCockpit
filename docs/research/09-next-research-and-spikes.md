# 次の調査と実証スパイク

更新日: 2026-08-31
目的: 文献調査で残った最大リスクを、製品コードを作り込み過ぎる前に実通信で潰す。

## 最優先の結論

次に必要なのは追加の候補列挙ではなく、**公式 Codex TUI → app-server → custom Responses provider → 人間の tool call → Codex harness → 次 request → final text** の一往復を固定 version で通す縦切りである。

UI は一時的な xterm と textarea でよい。この protocol loop が通らなければ、どれだけ凝った静的画面を作っても製品の核が成立しない。

## P0: Vertical contract spike

### 0. Release manifest を固定する

候補 baseline は調査日の最新公開版 `@openai/codex@0.149.1` とするが、lock は次の試験が通った commit で行う。

記録項目:

- Codex CLI version / package integrity
- `codex app-server generate-ts` と JSON Schema の checksum
- `model/list` で得た `gpt-5.5` の metadata hash
- `modelProvider/capabilities/read` の結果
- OS / architecture / Node / shell version
- lesson fixture version

失敗時に自動で `latest` へ逃げず、release manifest を更新する review を要求する。

### 1. Multi-client app-server topology

Linux の session directory に Unix socket を置いて app-server を起動する。

```text
companion connection ─┐
                      ├─ codex app-server --listen unix://SESSION.sock
official TUI ─────────┘
```

検証:

1. 両 client が独立して initialize / initialized を完了する。
2. companion connection が sandboxed `command/exec` で `bash -i` PTY を開く。
3. PTY 内の `codex --remote unix://SESSION.sock` が TUI を描画する。
4. resize、Ctrl+C、IME/Unicode、alternate screen、exit が壊れない。
5. TUI を thread/turn/approval owner としたまま、companion は active thread を誤って resume しない。
6. browser reload 相当で companion connection を落とした時、PTY/TUI lifecycle が仕様どおり終了し、孤児 process が残らない。

判定:

- pass: `command/exec` を v1 terminal backend にする。
- sandbox から socket へ到達不可: session container 内の `process/*` を試す。
- app-server PTY が不安定: node-pty で shell を持ち、TUI だけ Unix socket app-server へ接続する。
- multi-client が不安定: standalone `codex` を使う簡易 topology へ落とし、app-server live mirror を延期する。

### 2. Human Responses gateway

最小の Node.js / TypeScript + Fastify service を作る。

- `POST /v1/responses` の exact route
- body/depth/item/tool limit
- pairing bearer、Origin、session binding
- pending request は同時 1 件
- response type は text または single function call
- Ajv validation
- Node stream を直接使う SSE encoder
- cancel、deadline、keepalive、backpressure

Codex provider:

```toml
model = "gpt-5.5"
model_provider = "cockpit"

[model_providers.cockpit]
name = "CodexCockpit Human Model"
base_url = "http://127.0.0.1:PORT/v1"
wire_api = "responses"
supports_websockets = false
request_max_retries = 0
stream_max_retries = 0
stream_idle_timeout_ms = 1800000
```

`env_key` を使う場合は OpenAI key ではなく短命 session bearer にする。gateway が loopback/session boundary で別認証する設計なら省略する。

### 3. 一回の tool loop

最初の lesson は一つの安全な command に固定する。

1. 左席が「現在の作業ディレクトリを確認して」と入力する。
2. 右席に raw `instructions` / `input` / `tools` が届く。
3. 右席が request で提示された shell tool と arguments を form で選ぶ。
4. gateway が `function_call` item と `response.completed` を送る。
5. Codex harness が approval/policy を処理して tool を実行する。
6. 次の request に対応する tool output が含まれる。
7. 右席が final assistant message を返す。
8. TUI の turn が正常完了する。

合格条件:

- gateway は tool 自体を実行しない。
- call ID と item 順序が request 間で対応する。
- raw body hash、parsed projection、送信 SSE、Codex result を相関できる。
- Ctrl+C、右席 reload、二重 submit で tool が二重実行されない。
- `response.completed` 前 EOF は明示 failure になる。

### 4. Golden capture

公式 `codex-responses-api-proxy` を prebuilt child process として使い、実 upstream の成功する text/tool response を capture する。

- Authorization、cookie、path、content secret を scrub する。
- raw fixture と normalized semantic fixture を分ける。
- current Codex と一つ前の release で replay する。
- manual gateway の SSE を公式 parser fixture と実 Codex の双方で試す。

## P0: Security spike

### Runtime isolation

Hosted mode は session ごとの disposable container/VM、non-root user、read-only base、workspace volume、PID/CPU/memory/disk/time limit、default-deny egress を前提にする。Docker socket、host home、SSH agent、cloud metadata を渡さない。

Local mode でも app-server/gateway は loopbackまたは Unix socket、session 固有 `CODEX_HOME`、環境変数 allowlist、process group cleanup を使う。

### Browser boundary

- static assets と gateway を same-origin にする。
- short-lived session capability、role grant、Origin allowlist、frame/body/rate limit。
- absolute host path と任意 app-server JSON-RPC を browser へ公開しない。
- terminal URL handler、OSC clipboard/image は threat model 完了まで無効。
- localhost を public HTTPS page から無差別に操作できないよう DNS rebinding/CSRF を試験する。

### Retention

| Mode | terminal input | terminal output | model raw body | retention |
|---|---|---|---|---|
| default manual | 非永続 | 非永続、memory ring のみ | 非永続 | connection/session 終了まで |
| lesson replay opt-in | raw 非保存 | scrub 済みのみ、上限付き | scrub + 暗号化 blob | 既定 7 日、明示削除/export |
| curated fixture | secret を含まない固定入力 | 固定出力 | review 済み fixture | repository version と一緒に管理 |

## P1: RealtimeMarkdownEditor import spike

protocol loop の合格後に着手する。

1. `37ab5c31e0b3f1ea271cb495792b18c2999c794d` から必要ファイルだけ選択コピーする。
2. Apache-2.0 `LICENSE`、`THIRD_PARTY_NOTICES.md`、`provenance.json` に source repo/commit/path/hash を残す。
3. 現行 smoke test を先に作る。
4. `FileManager` を `IndexedDbWorkspaceStore` で包む。
5. `WorkspaceStore`, `TerminalSession`, `CockpitSession`, `EditorPort` を追加する。
6. Vite build で dependency/version/CSP を固定し、成果物は静的配信可能にする。
7. `/sessions/{id}/terminal`, `/model`, `/solo`, `/dev/dual` の route shell を作る。

完了条件:

- offline mode の既存 workspace/import/export を壊さない。
- connected mode で IndexedDB への file write を止める。
- shell の file change が watch を通じて editor に現れる。
- dirty editor と Codex edit が競合したら diff/reload choice を出し、silent overwrite しない。
- two-window mode は同じ companion event seq を独立 client として適用する。

## P1: Playable session spike

- Socket.IO: role、claim、presence、ack、低量 game command/event。
- terminal: 専用 binary WebSocket と bounded ring buffer。
- app-server: generated schema の allowlisted adapter。
- artifact: 認可 HTTP + hash reference。
- SQLite: command idempotency、session seq、event、snapshot metadata。

reconnect test は切断中に 1,000 event、二重 command、古い revision、role 違反、snapshot 復帰を含める。CRDT は導入しない。

## P2: Deep-learning lenses

P0/P1 の wire truth が安定した後に追加する。

- `@huggingface/jinja` と pin した model/template hash による rendered view
- tokenizer asset がある場合だけ token lens
- parallel tool calls、structured output、reasoning summary の advanced lesson
- native OpenAI/vLLM/Ollama pass-through capability report
- optional OTLP exporter

OpenAI 内部の非公開 prompt/tokenizer を再現したとは表示しない。

## 未解決の判断表

| 問い | 今決めない理由 | 決めるための証拠 | Gate |
|---|---|---|---|
| app-server `command/exec` で login shell を維持できるか | OS/sandbox/job-control差 | P0 PTY E2E | terminal backend |
| multi-client の approval/subscription を mirror できるか | connection ownership が複雑 | TUI owner + observer contract test | live protocol timeline |
| `gpt-5.5` を最初の lesson profile に固定するか | catalog は release 固有 | model preflight + tool fixture | release manifest |
| keepalive comment が Codex retry/UIに影響しないか | long human wait は通常 API と異なる | 30分/Cancel/reload test | manual timeout |
| parallel tool call を MVP に入れるか | UI/競合/採点が増える | single tool lesson user test | level 2 |
| Windows の remote TUI topology | Unix socket が前提 | loopback WS auth + ConPTY test | Windows support |
| remote isolation を container か microVM にするか | threat/cost/起動時間次第 | escape threat model + benchmark | hosted beta |
| textarea を CodeMirror へ置換するか | protocol riskを減らさない | JSON schema diagnostics user test | editor upgrade |
| Dockview を入れるか | two-window boundaryの解ではない | advanced layout user test | customizable workbench |
| Yjs を入れるか | core loopに共同編集不要 | simultaneous edit requirement | collaboration feature |

## Research phase の完了条件

次の全てが揃った時点で、調査フェーズから product implementation へ移る。

- P0 tool loop が固定 release で再現可能。
- generated schema、request/response fixture、release manifest が commit される。
- terminal backend と fallback が一つ選ばれる。
- human gateway の cancellation/idempotency/security test が通る。
- local/hosted の最低 isolation boundary が決まる。
- RealtimeMarkdownEditor import list と provenance 形式が review 済み。
- two-window route と role permission の state machine が fixture 化される。

この gate を通るまでは、画面の装飾、スコア演出、大規模 editor 移行、inference provider の追加を主作業にしない。
