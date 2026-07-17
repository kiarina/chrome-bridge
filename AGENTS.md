# AGENTS.md

このリポジトリで作業するエージェント向けのガイドラインです。

## 作業前に読むもの

あらゆるタスクを開始する前に、下記を必ず把握してください。

- `README.md`
- `SPEC.md` - 仕様書
- `NEXT_TASK.md` — 現在の残タスク

完了タスク・実測値・過去の意思決定を辿るときは `HISTORY.md`（作業手順は `docs/` を正典とする）。

## コミットするとき

**次の作業は別の担当者に引き継がれる**前提で作業してください。コミットの際、次に着手する人へ
追加で伝えるべきことがあれば `NEXT_TASK.md` に記載してください（残タスク・未検証の懸念・
踏んだ落とし穴・次の一手など）。仕組みとして残す価値のある知見は該当する `docs/` へ、
完了した作業の記録は `HISTORY.md` へ振り分け、`NEXT_TASK.md` は残タスクに保ちます。

## docs 以下の参照ガイド

作業内容に応じて、`docs/` 以下の該当ドキュメントを着手前に読んでください。
docs 以下にドキュメントを追加した際に、以下に、読む条件とサマリとリンクを追記してください。

- component 境界、transport、extension protocol、security を変更する場合:
  [Architecture](docs/architecture.md) — Streamable HTTP と WebSocket bridge の責務・制約。
- 通常運用、server設定、MCP client接続、ログ、障害復旧を変更する場合:
  [Operations guide](docs/operations.md) — loopback運用、設定値、health、複数profile、troubleshootingの正典。
- MCP toolの追加・変更、公開引数、戻り値、利用例、error contractを変更する場合:
  [MCP tool API reference](docs/api.md) — 20 toolの入力、結果、共通routing、target/ref lifecycleの利用者向け正典。
- 複数 Chrome profile、browser identity、connection registry、tool routing を変更する場合:
  [Multiple browser routing](docs/multiple-browser-routing.md) — stable ID、protocol移行、公開schema、状態遷移、test matrix。
- isolated Chromium、extension E2E、test process/profile lifecycle、failure artifactを変更する場合:
  [Isolated Chrome E2E](docs/isolated-chrome-e2e.md) — headless実測、2 profile topology、cleanup、CI/manual境界。
- extension ZIP、Python wheel/sdist、checksum、install/upgrade/rollback、release公開を扱う場合:
  [Release artifacts](docs/release.md) — file allowlist、決定的build、clean smoke、license/公開境界。
- Chrome Web Store のlisting、privacy申告、権限説明、審査、公開・更新を扱う場合:
  [Chrome Web Store submission](docs/chrome-web-store.md) — 同一ZIP、Unlisted初版、listing素材、reviewer手順、Store更新境界の正典。
- setup、test、実 Chrome 検証、tool 追加を行う場合:
  [Development guide](docs/development.md) — uv、unpacked extension、validation の正典。
