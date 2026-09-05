# AGENTS.md

このリポジトリで作業するエージェント向けのガイドラインです。

## 作業前に読むもの

あらゆるタスクを開始する前に、下記を必ず把握してください。

- `README.md`
- `SPEC.md` — protocol と tool の規範仕様
- 下の「タスク一覧」と、着手するタスクの `tasks/` ファイル

完了タスク・実測値・過去の意思決定を辿るときは `HISTORY.md` を参照し、
設計知識・公開契約・作業手順は `docs/` を正典とします。

### タスク管理の使い分け

- `tasks/` — 未完了タスク。1 タスク 1 ファイルで、背景・やること・進捗・申し送りを
  そのファイルに直接記載する
- `HISTORY.md` — 完了した作業、実測値、過去の意思決定
- `docs/` — 設計知識、公開契約、再利用する手順
- 各 component の `CHANGELOG.md` — 配布物ごとの利用者向け変更履歴

運用ルール:

- タスクに着手したら、進捗・未検証の懸念・踏んだ落とし穴・次の一手を該当の
  `tasks/` ファイルへ直接追記する
- 新しいタスク（今すぐ着手しない将来候補も含む）は `tasks/` にファイルを作り、
  下の「タスク一覧」へ 1 行追記する
- **タスクが完了したら、実測値・意思決定を `HISTORY.md` へ、再利用する知見を該当する
  `docs/` へ移した上で、タスクファイルを削除し、「タスク一覧」から行を消す。**
  削除したファイルの全文は git 履歴で辿れるため、転記は要点だけで良い

## ドキュメントの扱い

**現在の状態・仕様・方針を表す記述の矛盾は放置せず、発見したら解消してください。**
どちらが正しいか根拠から判断できる場合は、正典と影響する記述を更新します。判断できない
場合は、修正する前に必ずユーザーへ相談します。特に次の食い違いを対象とします。

- ドキュメント間で仕様が食い違っている
- 同じものが別の名前で呼ばれている
- ユーザーの指示とドキュメントの記述が食い違っている
- 実装とドキュメントの記述が食い違っている

誤字、リンク切れ、実在しないパス、実装済みだが記載が漏れている事項など、判断を伴わない
ものは相談せずに直して構いません。役割の分担、名称の方針、値の定義など判断が要るものは
相談します。

ただし `HISTORY.md` は、ある時点の事実・判断を記録するデータです。現在の知識と食い違っても
矛盾とはみなさず、現在に合わせて過去の記録を改変しないでください。

このリポジトリは公開 OSS です。`README.md`、`SPEC.md`、`PRIVACY.md`、`docs/` は英語で
書き、`AGENTS.md` と `tasks/` は作業者向けの記述として現在の言語を保ってください。

## 依存の version 制約（Dependency version bounds）

公開する Python distribution（`packages/mcp`、`packages/sdk`）の `[project].dependencies`
には、**実証された根拠のない上限を書きません。** 利用者の環境を不必要に制限し、他の
package との共存を壊すためです。「次の major が出たら壊れるかもしれない」という予防的な
上限は根拠になりません。

上限を書いてよいのは、次のどちらかを満たす場合だけです。

- 実際にその version を入れて壊れることを確認した
- upstream が非互換を明示的に宣言している

上限を残すときは、**阻害する package・制約文字列・確認した現象**を該当の `pyproject.toml`
にコメントとして書き、下の一覧にも記載してください。解除に判断が要るものは `tasks/` に
移行タスクを作り、コメントからそのファイルを指してください。

### 現在維持している上限（2026-09-05 時点）

- `packages/mcp`: `mcp[cli]>=1.27,<2`
  — MCP Python SDK 2.x には `mcp.server.fastmcp` が存在せず、import すると
  `ModuleNotFoundError` になる（移行案内 <https://py.sdk.modelcontextprotocol.io/v2/migration/>
  を指す）。rename 自体は機械的だが、2.1.0 は tool handler の想定外例外を
  `Error executing tool <name>` という汎用メッセージへ置換する。ここで raise している
  domain 例外のメッセージは `docs/concepts/api.md` が公開 error contract として
  規定しており、これが壊れる。解除は `tasks/mcp-sdk-v2-migration.md`。
- `packages/sdk`: `chrome-bridge-mcp>=0.4,<0.5`
  — 第三者 package への制約ではなく、このリポジトリから同時に release する 2 つの
  distribution の lockstep。`scripts/validate_static.py` が server と SDK の version 一致を
  検査するため、片方だけ別 minor に進むことはない。version を上げるときは両方同時に上げる。

上限を撤廃した依存（`jsonschema`、`uvicorn`、`websockets`、`httpx2`）については、
撤廃時点の実測を `HISTORY.md` に記録しています。

### `dependency-groups` は対象外

`dependency-groups`（`dev`）は distribution metadata に含まれず、利用者の環境へ届きません。
ここでの上限は CI の toolchain を固定するためのもので、上の規則の対象外です。ただし
`ruff` のように、上限が実際に version を抑えている場合は解除タスクを `tasks/` に持たせます。

## docs 以下の参照ガイド

作業内容に応じて、`docs/` 以下の該当ドキュメントを着手前に読んでください。
`docs/` 以下にドキュメントを追加・更新した場合は、ここに、読む条件とファイルパスを記載して
ください。**必ずファイル単位で記載します。** ディレクトリの役割分担は `docs/README.md` を
参照してください。

### 設計・公開契約・調査・確定値（`docs/concepts/`）

- component 境界、transport、shared operation coordination、connection 所有、
  page operation 設計、security 判断を変更するとき:
  `docs/concepts/architecture.md`
- MCP tool の公開引数、戻り値、共通 routing、target/ref lifecycle、error contract、
  利用例を変更するとき: `docs/concepts/api.md`
- 複数 Chrome profile、browser identity、connection registry、protocol v1/v2 移行、
  tool routing を変更するとき: `docs/concepts/multiple-browser-routing.md`
- browser native dialog、dialog PageState、dialog 応答、debugger 監視 scope を
  変更するとき: `docs/concepts/browser-dialogs.md`
- target tab の動画録画、debugger session 共有、offscreen encoding、Downloads 出力、
  screenshot/video 解像度を変更するとき: `docs/concepts/video-recording.md`
- isolated Chromium、extension E2E、test process/profile lifecycle、failure artifact を
  変更するとき: `docs/concepts/isolated-chrome-e2e.md`
- Chrome Web Store の listing、privacy 申告、権限説明、審査、公開・更新、API 自動化の
  設定値を扱うとき: `docs/concepts/chrome-web-store.md`

### 判断を含む作業の型（`docs/playbooks/`）

- 新しい MCP tool や page operation を追加するとき、実装順と検証範囲を決めるとき:
  `docs/playbooks/adding-tools-and-page-operations.md`

### 実行手順（`docs/runbooks/`）

- setup、test、validation 一式、isolated Chromium E2E、複数 profile 検証を行うとき:
  `docs/runbooks/development.md`
- 通常運用、server 設定、MCP client 接続、health、ログ、障害復旧を扱うとき:
  `docs/runbooks/operations.md`
- extension ZIP、Python wheel/sdist、checksum、changelog、version 更新、
  install/upgrade/rollback、公開手順を扱うとき: `docs/runbooks/release.md`

## タスク一覧

各タスクの内容は `tasks/` のファイルだけに書き、ここはポインタ（1 ファイル 1 行）に保ちます。
docs 参照ガイドと同じく、ファイルの追加・削除のたびにこの一覧を更新してください。

### 次に着手・進行中

- [Ruff 0.16 へ移行する](tasks/ruff-0.16-migration.md)
  — 新規 38 診断の方針決定と `ruff<0.16` 制約の解除
- [Playwright を 1.61.1 より先へ上げる](tasks/playwright-upgrade.md)
  — 1.63.0 / Chromium 153 で残る 1 件（複数 profile の再起動 identity）の原因特定
- [MCP Python SDK v2 へ移行する](tasks/mcp-sdk-v2-migration.md)
  — `mcp<2` の解除と、tool error contract を `ToolError` へ対応付ける判断

### 待機中（前提が揃ったら着手する）

- [v0.4.0 の Chrome Web Store 公開を確認する](tasks/chrome-web-store-v0.4.0-rollout.md)
  — Store 審査の完了待ち。審査中は再提出しない

## コミットするとき

**次の作業は別の担当者に引き継がれる**前提で作業してください。コミット後の担当者へ追加で
伝えるべきこと（未検証の懸念・踏んだ落とし穴・次の一手）は、該当する `tasks/` ファイルへ
記載します。今すぐ着手しない作業候補は新しい `tasks/` ファイル、仕組みとして残す価値のある
知見は該当する `docs/`、完了した作業の記録は `HISTORY.md` へ振り分けてください。
利用者から見える変更は、該当する component の `CHANGELOG.md` の `Unreleased` にも
同じ変更の中で追記します。
