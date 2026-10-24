# Cotaska

Cotaska は、個人または小規模チーム向けのローカル完結型タスク管理デスクトップアプリです。

タスクの正本を Markdown ファイルとして保存し、UI からの編集と AI エージェントによるファイル編集の両方を扱いやすくすることを目的にしています。TickTick のような一覧性と操作性を参考にしつつ、ローカル PC 上で完結する軽量な運用を重視しています。

製品紹介ページ:
https://ebisenbei.github.io/cotaska-site/

## 特徴

- ローカル PC 上で動作するデスクトップアプリ
- Electron + React + Vite による軽量な UI
- タスクを個別 Markdown ファイルとして管理
- `data/tasks/_index.yaml` によるタスク一覧サマリーの自動生成
- すべて、今日、明日、次の 7 日間、リスト別、完了、ゴミ箱などのビュー
- タスク詳細の Markdown 編集とプレビュー
- ファイル変更監視による UI 反映
- 将来的な AI エージェント連携を前提にしたデータ構造

## システム方針

Cotaska はローカルファーストの設計です。タスクデータはクラウドや外部サービスではなく、リポジトリ内の `data/` 配下に保存します。

主なデータは次の通りです。

```text
data/
  tasks/          個別タスク Markdown ファイル
    T-0001.md
    _index.yaml   自動生成されるタスクサマリー
  archive/        削除済みタスク
  lists.yaml      リスト定義
```

タスクの正本は `data/tasks/T-XXXX.md` です。`_index.yaml` は高速表示や AI 参照のためのサマリーであり、アプリ側で再生成されます。

## 画面構成

Cotaska は 4 カラム構成です。

```text
サイドバー | ナビパネル | メインペイン | 詳細ペイン
```

- サイドバー: 主要機能へのショートカット
- ナビパネル: すべて、今日、明日、リスト、タグ、完了、ゴミ箱などの切り替え
- メインペイン: タスク一覧、クイック追加、セクション表示、並び替え
- 詳細ペイン: タスクタイトル、期限、優先度、進捗、タグ、Markdown 本文の編集

## ディレクトリ構成

```text
Cotaska/
  00_mgmt/    管理資料、作業ログ、運用メモ
  10_docs/    設計書、検証資料、不具合対応記録
  20_app/     Electron / React アプリ本体
  data/       タスク、リスト、アーカイブデータ
```

アプリ本体は `20_app/` にあります。

```text
20_app/
  src/main/       Electron メインプロセス、サービス層
  src/renderer/   React UI
  tests/main/     メインプロセスの自動テスト
  tests/renderer/ React UI の自動テスト（src と同じ階層構成）
  setup/          セットアップ関連ファイル
  package.json    npm scripts と依存定義
```

## 前提環境

- Windows
- Git
- Node.js v22.14.0

移行用フォルダでは、リポジトリの隣に `v22.14.0/` として Node.js が同梱されている想定です。システムに別バージョンの Node.js が入っている場合は、同梱 Node.js を優先して使ってください。

## セットアップ

`20_app` と `20_app/setup` の依存モジュールを復元します。

```powershell
cd 20_app
..\..\v22.14.0\npm.cmd ci

cd .\setup
..\..\..\v22.14.0\npm.cmd ci
```

PowerShell で `npm.ps1` の実行ポリシーによりエラーになる場合は、`npm` ではなく `npm.cmd` を指定してください。

## 開発起動

Vite 開発サーバーを起動します。

```powershell
cd 20_app
..\..\v22.14.0\npm.cmd run dev
```

別ターミナルで Electron を起動します。

```powershell
cd 20_app
..\..\v22.14.0\npm.cmd run start
```

または、既存の起動スクリプトを利用できます。

```powershell
cd 20_app
.\start-dev.ps1
```

## 自動テスト

単体・回帰テストは `20_app/tests/` 配下へ配置し、`src/` 側の階層とファイル名に対応させます。
例: `src/main/settingsService.js` → `tests/main/settingsService.test.js`、
`src/renderer/components/AiChatComposer.jsx` → `tests/renderer/components/AiChatComposer.test.jsx`。
今後追加するテストもこの配置に統一し、テスト専用の補助ファイルやフィクスチャも `tests/` 配下へ置きます。

```powershell
cd 20_app
..\..\v22.14.0\npm.cmd test
..\..\v22.14.0\npm.cmd run test:watch
```

両コマンドは `vite.config.mjs` を使い、アプリルートを基準に
`tests/main/**/*.test.js` と `tests/renderer/**/*.test.{js,jsx}` を検出します。
個別実行は `npm.cmd test -- tests/main/settingsService.test.js` のように指定できます。

`scripts/test-*.mjs` と `scripts/tests/*.fixture.jsx` は非表示Electronを使う独立した操作検証です。
AI履歴の復帰・完了同期と非同期読込の競合は、Node.js 22.23.4の環境で `npm.cmd run test:ai-history` を実行して確認できます。実AI通信・利用者データへの書込は行いません。
スキル配下の `*.test.cjs` はそのスキル専用の検証です。これらは各実行入口との対応を保って現位置に置き、Vitestの探索対象には含めません。
electron-builderは `dist/renderer/**` と `src/main/**` 等を配布対象とし、`tests/` や上記検証スクリプトを同梱しません。

## ビルド

```powershell
cd 20_app
..\..\v22.14.0\npm.cmd run build
```

配布用ディレクトリを生成する場合:

```powershell
..\..\v22.14.0\npm.cmd run dist:dir
```

配布物は再生成可能な成果物のため、Git 管理対象からは除外します。

## 主なサービス

`20_app/src/main/` 配下に、タスク管理の主要ロジックがあります。

- `taskService.js`: タスク CRUD、Markdown 読み書き、メモリキャッシュ管理
- `listService.js`: リスト CRUD、`lists.yaml` の読み書き
- `indexService.js`: `_index.yaml` の自動生成
- `watcher.js`: タスクファイルやリスト定義の変更監視

## Git 運用メモ

このプロジェクトは GitHub の次のリポジトリと連携しています。

```text
https://github.com/EbiSenbei/Agent_Cotaska.git
```

配布物や生成物はコミットしない方針です。特に次のようなディレクトリは履歴に含めないでください。

```text
00_mgmt/10_task/*-dist/
20_app/node_modules/
20_app/dist/
20_app/release/
20_app/temp/
```

## 設計資料

システム全体の設計方針は次の資料を参照してください。

```text
10_docs/20_設計/10_システム設計/システム全体設計.md
```
