# Protocol、platform、security、accessibility standard

## State authority

各 state の正本は一つに限定する。

| State | Authority |
|---|---|
| workspace files / Git / process | 左プレイヤー側 runtime |
| Codex thread / turn / approval | 公式 Codex app-server / TUI owner |
| model request body | Human Responses gateway が受信した raw body |
| response draft | model-seat client、claim 中だけ編集可能 |
| committed response / game event | companion の append-only ledger |
| terminal rendering | xterm.js、bytes の正本ではない |
| reconnect / replay order | companion の session `seq` |

browser storage、relay、右プレイヤー client を workspace の正本にしてはならない。将来の online mode
でも local companion が outbound `wss:` connection を張り、relay は認証、routing、短期転送だけを
担当する。

```text
SessionTransport
  LoopbackSessionTransport
  RelayWebSocketTransport
```

domain と UI は transport 方式を判定しない。同じ command/event contract を使う。

## Protocol envelope

project-owned command/event は JSON Schema Draft 2020-12 で定義する。event の最低 envelope は次とする。

```json
{
  "schemaVersion": 1,
  "sessionId": "ses_01993f44-7ef1-7d76-ae3d-3fd05dc83e85",
  "seq": 42,
  "eventId": "evt_01993f44-8b09-7aa0-8888-9053906fca9b",
  "causationId": "cmd_01993f44-8792-74b2-a6e2-6391df83f33b",
  "correlationId": "req_01993f44-8115-79c9-b7cc-b7ab193756a7",
  "actor": {
    "role": "model-player",
    "playerId": "ply_01993f44-76f7-754c-a288-e43c7892eaf2"
  },
  "type": "inference.response.committed",
  "occurredAt": "2026-08-31T00:00:00.000Z",
  "payload": {}
}
```

- `schemaVersion` は integer。unknown major は fail closed。
- `seq` は commit と同じ SQLite transaction で割り当て、session 内で gap を許しても再利用しない。
- command は `commandId` を idempotency key とし、同じ ID の意味を変えて再送しない。
- claim/lease 更新は expected revision を要求する。last-write-wins にしない。
- additive optional field は同じ schema version で許可できる。required field 削除、意味変更、型変更は
  version update と migration/compatibility test を必要とする。
- browser と companion の clock は authority に使わない。deadline/lease は companion の monotonic
  clock、表示時刻は RFC 3339 timestamp を使う。

## JSON and canonical hashing

- wire JSON は RFC 8259 UTF-8。BOM、duplicate key、lone surrogate、non-finite number を拒否する。
- project-owned object member は camelCase。upstream object は original field name を保持する。
- signature/digest 対象だけ RFC 8785 JCS で canonicalize し、通常表示の key order に意味を持たせない。
- digest は `sha256:<lowercase hex>`。raw payload hash と redacted/normalized payload hash を混同しない。
- large binary/raw artifact は event に inline せず、認可された content-addressed reference を使う。
- request size、nesting、array/item count、string/argument size の上限を schema 外でも強制する。

## HTTP, SSE, WebSocket, Socket.IO

### HTTP

- HTTP semantics は RFC 9110、error body は RFC 9457 `application/problem+json`。
- problem detail の `type` は安定 URI、`title` は安定 human label、project machine code は extension
  `code` に置く。stack、secret、host path を detail に含めない。
- state-changing request は認証、Origin check、role grant、content type、body limit、idempotency を検証する。
- secret/capability は URL query に置かない。cacheable でない response は明示的に `no-store`。

### Responses SSE

- `/v1/responses` の upstream request field と SSE event name/order は公式 contract をそのまま扱う。
- right player は semantic response item を作り、gateway encoder が ID、framing、sequence、terminal
  event、completion event を構成する。
- unknown upstream field を都合よく削除・改名しない。表示 projection と raw wire を分ける。
- early EOF、duplicate completion、invalid event order、client abort、deadline、slow consumer を contract
  test する。
- heartbeat は comment frame とし、compatibility fixture が通った Codex version でだけ有効にする。

### Terminal WebSocket

- terminal byte stream は専用 raw binary WebSocket。JSON、base64、Socket.IO event に包まない。
- control message は versioned JSON subprotocol、byte data は binary frame として分離する。
- bounded queue と high-water mark を持ち、slow client で無制限 buffer を作らない。
- reconnect ring buffer は memory bounded、短期、output only。raw input は replay 保存しない。
- remote は `wss:`。Origin、short-lived token、session/role binding を handshake で検証する。

### Game channel

Socket.IO は role、presence、claim、低量 command/event、ack に限定する。delivery は at-least-once と仮定し、
command ID で deduplicate する。terminal bytes、大きな artifact、raw Codex RPC は流さない。

## Workspace path and file rules

- UI/protocol の workspace path は `/` 区切り、session root 相対の logical absolute path とする。
- `.`、`..`、empty segment、NUL、backslash、platform drive、UNC path を canonical input として拒否する。
- host absolute path は companion 内だけに保持し、browser/event/log/error へ出さない。
- authorization は string prefix 比較ではなく、open/fstat/realpath 相当を含む race-aware path guard で行う。
- symlink traversal、case folding、rename race、watch overflow、binary、大容量 file、atomic save を test する。
- file content を Unicode normalize しない。user-visible label は valid Unicode scalar value とし、spoofing
  risk がある identifier は confusable display を補助する。
- write は expected revision/hash を受け、dirty editor を silent overwrite しない。

## Security invariants

OWASP ASVS 5.0 Level 2 を browser/companion の baseline checklist にする。ただし shell と agent runtime は
通常の Web app より強い危険境界なので、次を別の mandatory threat model とする。

### Runtime

- app-server、PTY、gateway を public Internet に直接 bind しない。
- local mode は loopback/Unix socket、session token、session 固有 `CODEX_HOME`、process group cleanup。
- hosted mode は session ごとの disposable OS/container boundary、non-root、read-only base、bounded writable
  workspace、CPU/memory/PID/disk/time limit、default-deny network egress。
- Docker socket、host home、SSH/GPG agent、cloud credential、metadata endpoint を expose しない。
- browser-callable API に arbitrary argv、arbitrary app-server method、host filesystem path を渡させない。
- unsandboxed `process/*` は isolated runtime 内の allowlisted adapter からだけ利用できる。

### Browser and session

- static asset と companion は可能なら same-origin。CSP Level 3 は nonce/hash を使い、`unsafe-eval` と
  broad `connect-src` を許可しない。
- terminal OSC clipboard、hyperlink、image、notification は threat model と user grant が完成するまで無効。
- capability は短命、role-specific、session-bound。reconnect token と model-provider token を分ける。
- token を URL、localStorage、log、command line、replay に置かない。
- DNS rebinding、CSRF、clickjacking、malicious workspace filename/content を security test に含める。

### Model-seat safety

- right player が選べる tool と arguments は、その request が実際に提示した schema の範囲だけ。
- schema validation、domain lint、danger preview、approval state を response commit 前に表示する。
- UI helper は semantic decision を勝手に変えない。auto-fix は diff を示し、user confirmation を要する。
- 二重 submit / reconnect / lease expiry で tool call を二重実行しない。
- one-player upstream pass-through は manual mode と credential/retention policy を分離する。

## Logging, privacy, retention

Pino の structured JSON log を使う。console text log を service logic に置かない。

default で記録してよいのは、event type、project ID、duration、byte/item count、status/error code、
version/hash などの operational metadata だけである。次は default deny とする。

- Authorization、cookie、token、environment value
- prompt/instructions/input/tool arguments/model output の raw content
- terminal input/output、clipboard、file contents
- host username、absolute path、IP を含む不要な client metadata

content capture は lesson/replay ごとの explicit opt-in、目的、上限、TTL、redaction、削除/export UI を必要とする。
redaction 前 payload を通常 log pipeline に送らない。curated fixture は human review と secret scan を通す。

W3C `traceparent` と project correlation ID は別に保持する。trace/span attribute に raw content を入れない。

## Accessibility and international input

目標は WCAG 2.2 AA。native HTML semantics を優先し、WAI-ARIA 1.2 と APG pattern は native element で
表現できない composite widget にだけ使う。

release gate:

- keyboard only で terminal/model seat 切替、claim、validation、commit、cancel が完結する。
- focus order、visible focus、focus restoration、modal trap が正しい。
- error は color だけでなく text と programmatic association を持つ。
- contrast、zoom 200%、reflow、reduced motion、screen reader name/role/value を確認する。
- live region は token/terminal stream を逐次読み上げず、要約された重要 state だけ通知する。
- 日本語 IME composition 中の Enter を submit と誤認しない。
- xterm canvas だけを必須情報源にせず、重要 event の accessible timeline/projection を提供する。

Playwright + `@axe-core/playwright` は自動検出、ARIA snapshot は role/name regression に使う。自動検査だけで
合格とせず、keyboard、screen reader、IME の manual checklist を release ごとに実施する。
