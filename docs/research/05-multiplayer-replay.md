# マルチプレイヤー同期・権威状態・リプレイ調査

調査日: 2026-08-31
対象: CodexCockpit の2人プレイ、再接続、1人プレイ代行、教材リプレイ

## 結論

CodexCockpit の中核に **CRDT は不要**。端末入力、PTY出力、Codex/app-server の通知、LLM役の応答、承認、ツール実行は順序と所有者が意味を持ち、外部副作用もある。競合した2入力を自動マージすると、履歴に存在しなかったコマンドや応答を作りかねない。

初期実装は次の組み合わせを推奨する。

1. 既存のローカル companion/gateway プロセスをセッション権威サーバーにする。
2. ブラウザとのゲーム制御・低量イベント同期には [Socket.IO](https://socket.io/) を採用し、room、ack、自動再接続を借りる。PTY bytes と app-server RPC は混載せず、型付きadapterの専用transportに分ける。
3. 正本は SQLite の `sessions` + **単調増加 `seq` を持つ追記専用イベント列**とする。Socket.IO の再接続機能だけに履歴を委ねない。
4. Markdown/コード本文を本当に同時編集する要件が出た時だけ、別チャンネルに [Yjs](https://github.com/yjs/yjs) + [y-websocket](https://github.com/yjs/y-websocket) を追加する。
5. 1人プレイの自動LLM役も、人間LLM役と同じ command API、権限検査、イベント化を通す。特別な裏道を作らない。

この構成なら静的フロントエンドを維持しつつ、すでに必要な Codex/PTY companion に小さなセッション機能を足せる。Cloudflare を採用すると決めた場合だけ、Socket.IO 部分を [PartyServer / PartySocket](https://github.com/cloudflare/partykit) に置き換える余地を残す。

## Second-pass cross-check

`08-reference-architecture.md` と照合した結果、初稿の「Socket.IO + SQLite」は **ゲーム面の同期に限る**と訂正する。同じTLS listenerとsession認証は共有してよいが、論理channelとcapabilityは分ける。

| 経路 | 推奨transport / 境界 | 理由 |
| --- | --- | --- |
| game command、採点、presence、低量event | Socket.IO + append-only log | room、ack、再接続offsetが合う |
| terminal stdin/stdout/resize | `TerminalBackend` の専用binary WebSocket | 高量bytes、backpressure、bounded bufferを独立させる。切断中stdinを自動再送しない |
| app-server | 生成schemaに追随する `CodexAppServerAdapter`。companion内のstdio/Unix socketを限定中継 | 任意RPCをbrowserへ露出せず、protocol変更と権限をadapterで吸収する |
| raw inference/workspace artifact | eventにはmetadata/refだけ、内容は認可付きHTTP取得 | 巨大payloadをroom broadcastしない |

Socket.IOへ全trafficを多重化すると、PTY出力がgame eventをhead-of-lineで遅らせ、Socket.IOのbuffer/retryが古いstdinを再投入する危険がある。したがって「同じcompanionに接続する」と「同じメッセージtransportを使う」は分ける。

また、**learnerのterminal入力/出力を全件永続化するのは既定にしない**。stdinには非echo passwordやtoken、outputには`.env`や個人情報が入り、量も無制限に増える。最小保持ポリシーは次の通り。

| mode | terminal保持 | 上限 / 削除 |
| --- | --- | --- |
| `minimal`（既定） | spawn/resize/exit、byte count、時刻などmetadataのみ。stdin/stdout bytesは永続化しない。再接続用output ring bufferだけmemory保持 | 4 MiBまたは5分の早い方。process終了時に消去 |
| `lesson-replay`（開始前に明示opt-in、常時REC表示） | scrub済みPTY outputをchunk保存。stdin rawは保存せず、必要な操作はcontrol metadata、echo済みoutput、教材checkpointで再現 | 64 MiBまたは2時間でcapture停止しevent化。既定TTL 7日、即時delete可 |
| curated fixture | 作者がreview/redactしたscripted入出力だけをversion管理 | lesson lifecycleに従う。learner runから自動昇格しない |

完全raw debug captureが将来必要でも別の二重同意・暗号化・24時間以下TTLとし、通常replay modeへ混ぜない。`strict playback` の端末画面再現は `lesson-replay` または curated fixture でだけ保証し、`minimal` runはゲーム状態・Codex harness・採点のsemantic replayに限定する。この節の保持方針が、後段の「イベント分類」にある保存指定より優先する。

## なぜCRDTではなく権威ログか

| 状態 | 望ましい競合処理 | 正本 |
| --- | --- | --- |
| シェル入力、端末サイズ変更 | 操作者だけが送信。サーバー順序を固定 | イベントログ |
| PTY出力 | ホストだけが生成。live受信順を固定 | 専用stream。opt-in replay時だけイベントログ + バイトblob |
| Codexリクエスト/通知 | 到着順・相関IDを保存 | イベントログ |
| LLM役の最終応答 | 1つの担当役が明示submit | イベントログ |
| 承認、ツール実行 | 権限と期待revisionを検査 | イベントログ |
| プレイヤーpresence、カーソル | 失われてもよい最新値 | メモリ上のTTL状態 |
| LLM応答の入力途中draft | 担当者は1人。必要なら短時間の最新値 | 原則ephemeral |
| Markdown/コードの共同編集 | 複数人の文字挿入を収束 | 任意のYjs文書 |

CRDT は「全レプリカが対等で、オフライン中の並行編集を後で意味を壊さず結合できる」状態に向く。一方、`rm -rf …` と `npm test`、あるいは2つのJSONレスポンスをマージする正しい意味は存在しない。CodexCockpit では **command をサーバーが検証し、受理した結果だけを event として採番**するのが自然である。

Yjs の awareness も永続状態ではなく、各クライアントが定期broadcastし、更新が途絶えた相手をofflineとみなす設計である。presenceを正本ログにしない判断とも整合する（[Yjs Awareness](https://docs.yjs.dev/api/about-awareness)）。

## OSS候補の比較

「活動状況」は調査時点のリリース/公式ドキュメントを確認したもので、採用時には再確認する。

| 候補 | ライセンス / 活動状況 | セルフホスト・静的front | 得意 | 弱点 / 判定 |
| --- | --- | --- | --- | --- |
| [Socket.IO](https://github.com/socketio/socket.io) | MIT。公式v4 docsは2026-06更新 | Node等でself-host。静的ページからclient利用可 | room、ack、再接続、順序保持、幅広い運用知見 | 既定到達保証はat-most-once。永続ログはアプリ側が必要。**採用** |
| [Colyseus](https://github.com/colyseus/colyseus) | MIT。v0.18.5、2026-08-28 | self-host可、Web SDK可 | 権威room、matchmaking、binary delta、reconnection | 2人のプロトコル教材にはstate sync/game機能が重い。永続イベント正本は別途。**設計を借用、MVP不採用** |
| [PartyServer / PartySocket](https://github.com/cloudflare/partykit) | ISC。partyserver 0.5.10、2026-08-03 | Cloudflare Workers/Durable Objects。静的front可 | room単位の単一権威、DO SQLite、WebSocket hibernation、堅牢な再接続client | Cloudflare前提。ローカルCodex/PTY companionと権威が分裂する。**Cloudflare版の有力代替** |
| [Yjs + y-websocket](https://github.com/yjs/y-websocket) | MIT。stable v3.1.0、2026-08-06。Yjs v14用v4はRC | 基本serverはself-host、静的front可 | 共同テキスト、offline、awareness、cross-tab | 基本backendはscaleしにくい。順序付き副作用には不適。**共同editorだけ条件付き採用** |
| [Hocuspocus](https://github.com/ueberdosis/hocuspocus) | MIT。v4.6.0、2026-08-10 | Node/Bun/Deno/Workers、self-host可 | Yjsのauth、persistence、SQLite/Redis、hooks | 共同編集を入れない段階では過剰。**Yjsを本番scaleする時に再評価** |
| [Automerge](https://github.com/automerge/automerge) / [Repo](https://github.com/automerge/automerge-repo) | MIT。Automerge v3.4.1、2026-08-12 | network非依存。ただしbrowser版coreはRust→WASM | local-first、immutable snapshot、CRDT sync | 非WASM方針に不一致。公式sync serverは「unsecured」「demo寄り」。中核用途にもCRDT不要。**不採用** |
| [Liveblocks](https://github.com/liveblocks/liveblocks) | 多くのSDKはApache-2.0、`@liveblocks/server`/CLIはAGPL-3.0-or-later。v3.24.1、2026-08-19 | hosted中心。Sync self-hostはEnterprise有償add-on | presence、CRDT、version history、運用済みedge | コスト/サービス依存が増え、既存companionと重複。**短期不採用** |
| [y-webrtc](https://github.com/yjs/y-webrtc) | MIT。最新v10.3.0は2023-12-28 | signaling/TURN以外はP2P、静的front可 | 小規模Yjs P2P | リリース停滞、権威・永続・監査なし。**不採用** |
| [Trystero](https://github.com/dmotz/trystero) | MIT。v0.25.4が調査時最新 | CDN import可。複数のdiscovery方式とself-host relay | P2P room、E2E、chunking、request/response | 権威ログがなく、NAT失敗時はTURNが必要。教材正本には不向き。**音声等の任意機能だけ再評価** |

### 候補ごとの重要な事実

- Socket.IO は送信順を保証するが、既定の到達は at-most-once である。server→client の確実な再送には、イベントID、DB永続化、clientの最終offsetが必要だと公式にも明記される（[Delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)）。connection state recovery は一時切断を助けるが常に成功するわけではなく、失敗時の完全同期が必要（[Connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)）。したがってSQLiteイベント列は重複ではない。
- Colyseus はserver-authoritative、room、reconnectionを完成品として提供する（[repository](https://github.com/colyseus/colyseus)、[docs](https://docs.colyseus.io/)）。ただしCodexCockpitは高頻度の座標同期より、監査可能な不変履歴が中心である。
- 旧PartyKitの開発先はCloudflareのPartyServerへ移った。PartyServerはDurable Objectを拡張し、PartySocketはreconnection/bufferingを提供する（[current repository](https://github.com/cloudflare/partykit)）。ローカル実行主体をなくしクラウドroomを正本にする版では魅力が高い。
- y-websocket の基本backendは単純なin-memory構成でscaleしにくく、auth/persistence/scaleが必要ならHocuspocus等が候補と公式READMEが案内する（[y-websocket](https://github.com/yjs/y-websocket)）。Hocuspocus v4 は Node/Bun/Deno/Workers、Redis、SQLiteを扱う（[Hocuspocus overview](https://tiptap.dev/docs/hocuspocus/getting-started/overview)）。
- Liveblocks はSDKのソース公開と「自由にself-hostできる全基盤」を同一視しない。ライセンスはpackage別（[LICENSE](https://github.com/liveblocks/liveblocks/blob/main/LICENSE)）で、Sync self-hostはEnterprise add-on（[data storage](https://liveblocks.io/docs/platform/data-storage)）。
- WebRTC は接続交渉用signalingを別途必要とし、直接接続不能時はSTUN/TURNを使う（[MDN protocols](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)）。Trystero自身も一部ネットワークではTURNを要求する。P2P化してもインフラと可用性問題は消えない。self-host TURNには [coturn](https://github.com/coturn/coturn) があるが、本機能だけのために追加運用する価値は薄い。

## 推奨セッションモデル

### command と event を分離する

ブラウザは「事実」を直接追記しない。意図である command を送る。

```json
{
  "schemaVersion": 1,
  "commandId": "UUIDv7",
  "sessionId": "UUIDv7",
  "expectedRevision": 184,
  "actor": { "participantId": "p_right", "role": "llm" },
  "kind": "llm.response.submit",
  "payload": { "responseDraftId": "draft_7" }
}
```

サーバーは認証、role capability、payload schema、`expectedRevision`、`commandId`重複を1トランザクションで検査し、受理した結果を1個以上のeventにする。競合は勝手にマージせず `revision_conflict` を返し、clientに差分取得を促す。

### event envelope

```json
{
  "schemaVersion": 1,
  "eventId": "UUIDv7",
  "sessionId": "UUIDv7",
  "seq": 185,
  "kind": "llm.response.submitted",
  "actor": {
    "participantId": "p_right",
    "role": "llm",
    "type": "human"
  },
  "occurredAt": "2026-08-31T10:00:00.000Z",
  "monotonicOffsetMs": 12452,
  "causationId": "command UUID",
  "correlationId": "turn UUID",
  "visibility": "players",
  "redaction": "scrubbed",
  "payload": { "responseId": "resp_8", "format": "responses-api" },
  "payloadRef": {
    "sha256": "...",
    "mediaType": "application/json",
    "byteLength": 4312
  },
  "prevHash": "...",
  "hash": "..."
}
```

採番はsession単位の整数を正本にする。UUIDv7は全体識別子、`seq` は再接続offsetと順序に使う。hashを作るなら [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785) でenvelopeを正規化し、`prevHash` とpayload hashを含める。hash chainは改ざん検出には役立つが、アクセス制御や真正性の代わりではない。

### 最小ストレージ境界

| テーブル/領域 | 役割 |
| --- | --- |
| `sessions` | 現在revision、lesson version、status、親session/fork seq |
| `commands` | `(session_id, command_id)` uniqueによるidempotency、受理/拒否結果 |
| `events` | `(session_id, seq)` primary/unique、envelope、hash chain |
| `snapshots` | `base_seq` 時点のreducer投影。高速復帰用で正本ではない |
| `blobs` | PTY bytes、raw JSON、初期workspace等。SHA-256内容アドレス |
| `presence` | 永続DBではなくTTL付きメモリ。必要ならjoin/leaveという意味イベントだけ保存 |

SQLiteへの書込み順は `command重複確認 → revision検査 → events INSERT → session revision更新 → COMMIT → broadcast`。broadcastが失敗しても、clientは後で `seq` から回収できる。MVPの1プロセス構成には専用EventStoreやNATSは過剰で、水平分割や多数の非同期consumerが必要になった時だけ、リプレイ可能な [NATS JetStream](https://docs.nats.io/concepts/jetstream) 等を再評価する。

## イベント分類

すべてを細粒度に永続化するとノイズと秘密漏洩が増える。以下を境界にする。

| 分類 | 代表event | 保存方針 |
| --- | --- | --- |
| session | `session.created`, `lesson.loaded`, `session.completed`, `session.forked` | 常時 |
| participant | `participant.joined`, `role.claimed`, `role.released` | 意味のある変化だけ。heartbeatは保存しない |
| terminal control | `terminal.spawned`, `terminal.input.accepted`, `terminal.resized`, `terminal.exited` | 常時。ただし既定はinputのbytesを含めずlength/control metadataのみ |
| terminal stream | `terminal.output.chunk` | `lesson-replay` opt-in時だけ。16–50msまたは32–64KiBでcoalesceし、scrub済みbytesはblob参照 |
| Codex harness | `codex.request.received`, `approval.requested/resolved`, `tool.call.started/completed` | 正規化した概要 + 必要なraw artifact参照 |
| LLM player | `llm.response.submitted`, `llm.response.chunk.emitted`, `llm.response.rejected` | submit後を常時。draft keystrokeは原則presence側 |
| learning | `hint.revealed`, `checkpoint.evaluated`, `score.changed` | 常時。評価rule versionも保存 |
| external effect | `http.response.captured`, `tool.output.captured`, `workspace.snapshot.created` | 再実行せず結果をfixture化できる粒度 |

captureを明示的に有効にしたPTY出力はUnicode文字列へ早期変換せず、scrub後のbytesとrows/colsを保存する。リプレイ時の画面再現に必要なためである。一方、検索用投影は後からUTF-8/ANSI解析して作る。既定modeではbytesを永続化しない。

## 再接続とpresence

1. clientは短寿命のsession token、`participantId`、`lastAppliedSeq` を付けて接続する。
2. サーバーはtokenとroleを再検査する。Socket.IO recovery成功だけを信用しない。
3. `lastAppliedSeq` がsnapshotより古ければ `snapshot(baseSeq)`、続いて `events(seq > baseSeq)`。新しければ差分eventだけ返す。
4. client reducerは`seq`重複を無視し、飛びを検出したら再取得する。
5. 未ack commandは同じ`commandId`で再送する。サーバーのunique制約で二重実行を止める。
6. presenceは `{connectionId, participantId, role, status, lastSeenAt, cursor?}` をTTL管理する。複数tabは別connectionだが同一participantとして扱う。

役の同時操作を防ぐため、`operator` と `llm` には1本の書込みleaseを持たせる。観戦接続はいくつあってもよい。lease切替自体はイベント化し、単なるネットワーク切断で即座に役を奪わない猶予を設ける。

## 1人プレイ自動化

自動役は次の3実装を同じinterfaceに揃える。

- `scripted`: lessonに同梱した決定的な応答列
- `ghost`: 過去の模範runを再生し、現在turnとの条件一致で次のcommandを出す
- `live-model`: 実APIを使う自動LLM役

どれも `{ role: "llm", type: "autoplayer", policyVersion }` のactorとして通常commandを送る。pause/takeoverはevent境界だけで行い、人間へ切り替えた後の自動commandを無効にするlease generationを持たせる。これにより2人プレイと1人プレイで採点・権限・リプレイのコードが分岐しない。

## 教材を再現可能にする

### lesson bundle

各教材は最低限、次をmanifestに固定する。

- `lessonId`, `lessonVersion`, event/reducer/score schema version
- Codex CLI commit/version、app-server protocol version
- request template/Jinja、provider、model設定のversionまたはhash
- 初期workspace snapshotのhashと実行container image digest
- 許可環境変数名、tool policy、network policy。秘密値そのものは含めない
- fixture set、乱数seed、仮想clockの起点
- 正解全文ではなく、順序・schema・副作用・禁止操作を表すsemantic assertions

### 3つの再生モード

| モード | 動作 | 用途 |
| --- | --- | --- |
| strict playback | process/APIを一切再実行せず、保存eventとblobを描画。端末はcapture/curated時だけ再現 | デモ、復習、バグ報告。最も再現可能 |
| deterministic verify | 同じreducerをevent列に適用し、snapshot/state hashと採点を再計算。外部I/Oはfixture | CI、教材version検証 |
| live reenactment | 指定`seq`から新sessionへforkし、以後は実process/API | 練習。元runとbit-identicalとは主張しない |

terminal、HTTP、LLM、toolの外部効果は再生時に再実行せず、記録済み結果を流す。`monotonicOffsetMs` は再生速度に使うが、採点は実時間に依存させない。snapshotは最適化なので、任意時点のstateを先頭から再計算して一致するテストを持つ。

## プライバシーとセキュリティ

- **権限はevent kind単位でserver側検査**する。`operator`だけがterminal input、`llm`だけがresponse submit、`system`だけがPTY/Codex受信eventを生成できる。
- invite tokenはroom IDと分離し、role/sessionにscopeした短寿命・一度限りの値にする。API keyやCodex認証情報をbrowser、相手peer、eventへ送らない。
- WebSocket handshakeのOrigin allowlist、TLS、message size/rate limit、schema validation、backpressureを必須にする。再接続成功時も権限失効を再確認する。
- prompt、端末入力/出力、tool結果にはtoken、`.env`、SSH鍵、個人情報が混ざる。**永続化前**に既知secret patternとworkspace policyでscrubし、`redaction`状態をeventに残す。表示時だけ伏せる方式ではrawが漏れる。
- 「完全raw教材」が必要なら、通常ログと分離した暗号化blob、短いretention、明示同意、session単位delete/exportを用意する。観測ログにもpayloadを複製しない。
- HTML/ANSI/Markdown出力は不信入力としてsanitizeする。ANSI escapeからリンクやclipboard操作を無条件に有効化しない。
- WebRTCを使う場合、P2P接続情報とネットワーク到達性がprivacy面を増やす。権威ログをP2Pに移さず、音声等の任意channelに限定する。
- `prevHash` は事故/改変検出用。採点証明に使うならサーバー署名と鍵rotationを別途設計する。

## 採用・借用・棄却の最終判断

### Adopt now

- Socket.IO client/server: ゲーム制御と低量eventの接続、room、ack、自動再接続
- SQLite: sessionごとの追記event、idempotency、snapshot metadata
- Web Crypto / Node crypto: SHA-256 content addressing
- JSON Schemaまたは既存TypeScript schema validator: command/event境界のruntime検証

### Borrow ideas

- Colyseus: server authority、room lifecycle、role/reconnectionの考え方
- PartySocket: bounded buffer、jittered reconnect、close理由で再接続停止
- Yjs Awareness: TTL付きephemeral presence
- JetStream: offset consumer/replay。ただしMVPでserver追加はしない

### Reject for the core path

- Yjs/Automergeをterminal・Codex protocol stateへ適用
- WebRTC/y-webrtc/Trysteroをsession正本にする
- Liveblocksを初期依存にする
- EventStore/NATS/Redisを1セッション2人のMVPから運用する

## 実装前に検証するスパイク

1. 1つのSocket.IO room + SQLite transactionで、切断中に1,000 eventを生成し `lastAppliedSeq` から欠落/重複なしで復帰できるか。
2. `lesson-replay` opt-inでterminal outputを32KiB chunk + blob参照で記録し、ANSI画面がstrict playbackで一致するか。secret scrub、64MiB停止、負荷とDB容量も測る。
3. 同じ`commandId`の同時再送、古い`expectedRevision`、role違反が二重副作用を起こさず拒否されるか。
4. 既知secretを含むprompt/PTY/tool outputがDB、blob、server logのどこにも平文で残らないか。
5. 1人プレイautoplayerを人間へtakeoverし、同一reducerと採点器で続行できるか。
6. 100 eventごとのsnapshotから復帰したstate hashが、先頭からreplayしたものと一致するか。

## 一次資料

- [Socket.IO repository / MIT](https://github.com/socketio/socket.io)
- [Socket.IO delivery guarantees](https://socket.io/docs/v4/delivery-guarantees/)
- [Socket.IO connection state recovery](https://socket.io/docs/v4/connection-state-recovery/)
- [Colyseus repository / MIT](https://github.com/colyseus/colyseus)
- [Colyseus documentation](https://docs.colyseus.io/)
- [Cloudflare PartyServer / PartySocket repository / ISC](https://github.com/cloudflare/partykit)
- [Cloudflare Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Yjs repository / MIT](https://github.com/yjs/yjs)
- [y-websocket repository and backend notes](https://github.com/yjs/y-websocket)
- [Yjs Awareness](https://docs.yjs.dev/api/about-awareness)
- [Hocuspocus repository / MIT](https://github.com/ueberdosis/hocuspocus)
- [Hocuspocus documentation](https://tiptap.dev/docs/hocuspocus/getting-started/overview)
- [Automerge repository / MIT](https://github.com/automerge/automerge)
- [Automerge design](https://automerge.org/docs/hello/)
- [Automerge Repo Sync Server security note](https://github.com/automerge/automerge-repo-sync-server)
- [Liveblocks repository and package licenses](https://github.com/liveblocks/liveblocks)
- [Liveblocks self-hosting statement](https://liveblocks.io/docs/platform/data-storage)
- [y-webrtc repository / MIT](https://github.com/yjs/y-webrtc)
- [Trystero repository / MIT](https://github.com/dmotz/trystero)
- [MDN: WebRTC protocols, ICE/STUN/TURN](https://developer.mozilla.org/en-US/docs/Web/API/WebRTC_API/Protocols)
- [coturn repository](https://github.com/coturn/coturn)
- [NATS JetStream replay semantics](https://docs.nats.io/concepts/jetstream)
- [RFC 8785 JSON Canonicalization Scheme](https://www.rfc-editor.org/rfc/rfc8785)
