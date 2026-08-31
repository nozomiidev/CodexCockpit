# CodexCockpit

公式 Codex CLI / app-server と OpenAI Responses API の harness を、2 人のプレイヤーが terminal 側と model 側に分かれて学ぶ Web シミュレーターの研究リポジトリです。

現在は動作するMVPを実装済みです。`apps/web` は静的な2席cockpit、`apps/companion` はローカルworkspace・terminal・human Responses gatewayを提供し、`packages/` がprotocol、domain、workspace、公式Codex runtime境界を担当します。起動方法と現在の能力は [docs/implementation](./docs/implementation/README.md)、設計判断とOSS調査は [docs/research](./docs/research/README.md) にまとめています。

公式Codexは`0.151.0`に固定し、workspace環境で`codex --version`と`codex --help`、app-serverのTypeScript/JSON schema生成を確認しています。この管理sandboxでは`/proc/self/exe`が非公開なためlive app-server handshakeは理由付きskipです。現在のportable terminalはpipe fallbackであり、native PTY adapterは次段階です。

実装時に守る命名、TypeScript、protocol、security、accessibility、toolchain、test、Git の規則は [docs/standards](./docs/standards/README.md) を正本とします。
