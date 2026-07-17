# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260709-02 |
| 報告日 | 2026-07-09 |
| 報告者 | AIエージェント |
| 対象機能 | 起動時ログ / main process 初期化 |
| 重要度 | 高 |
| 状態 | ユーザー確認待ち |

## 現象

Cotaska 起動時に Electron の `A JavaScript error occurred in the main process` ダイアログが表示されても、`logs/app-YYYY-MM-DD.log` に原因やスタックトレースが残らない場合がある。

確認された例:

- `Error: Cannot find module 'sql.js'`
- 発生箇所: `src/main/aiService.js` の `require("sql.js")`

## 再現手順

1. `sql.js` が解決できない配布状態または実行環境で Cotaska を起動する。
2. main process 初期化中に `require("sql.js")` が失敗する。
3. Electron の JavaScript error ダイアログは表示されるが、アプリログに require stack が残らない。

## 期待動作

画面表示前の main process 初期化エラーでも、`logs/app-YYYY-MM-DD.log` にエラー内容、スタックトレース、require stack、実行環境情報が出力される。

## 調査メモ

- 既存の `process.on("uncaughtException")` / `unhandledRejection` は `main.js` の通常 import 完了後に登録されていた。
- `aiService.js` がトップレベルで `require("sql.js")` していたため、依存解決失敗時は既存の `appLogger` 初期化や process ハンドラ登録より前に main process が落ちる可能性があった。
- 既存の `appLogger` は有効だが、初期 import 前の例外を捕捉するには、Electron やアプリサービスへ依存しない最小ロガーが必要。

## 修正方針

- `earlyStartupLogger.js` を追加し、`main.js` の最上部付近で process error handler を登録する。
- 早期ロガーは `process.cwd()/../logs` など複数候補に best-effort でログを書き、ログ失敗で起動をさらに壊さない。
- `aiService.js` の `sql.js` 読み込みを `openAiService()` 時の遅延読み込みに変更し、失敗時に require stack と DB パスを記録する。
- Electron の `child-process-gone` も app log に記録する。

## 検証結果

- `node --check 20_app/src/main/earlyStartupLogger.js`
- `node --check 20_app/src/main/main.js`
- `node --check 20_app/src/main/aiService.js`
- `node -e "require('./20_app/src/main/aiService'); console.log('aiService require ok')"`
- `sql.js` の `MODULE_NOT_FOUND` を疑似発生させ、`logs/app-2026-07-09.log` に `Failed to require sql.js for AI database initialization`、`MODULE_NOT_FOUND`、`requireStack` が出力されることを確認。

いずれも成功。`aiService` のトップレベル require では `sql.js` を即時読み込みしないことを確認した。

補足: `npm run build` は実行環境の Node.js が `20.18.1` で、Vite の要求する `20.19+` / `22.12+` を満たさないため失敗。あわせて既存 `vite.config.js` の CommonJS から Vite ESM を require する問題が表示された。

## 関連ファイル

- `20_app/src/main/earlyStartupLogger.js`
- `20_app/src/main/main.js`
- `20_app/src/main/aiService.js`
- `00_mgmt/Cotaska_タスク管理ツール/data/tasks/T-0380.md`
