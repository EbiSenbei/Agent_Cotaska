# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260603-01 |
| 報告日 | 2026-06-03 |
| 報告者 | ユーザー |
| 対象機能 | 設定 > アプリ情報 > 更新確認 |
| 重要度 | 中 |
| 状態 | 解決済み |

## 現象

Cotaska の設定 > アプリ情報 > 更新確認をクリックすると、`fetch failed` と表示されて最新版確認ができない。

利用環境は会社ネットワーク内であり、ネットワーク制限の影響が疑われている。

## 再現手順

1. 会社ネットワークに接続された端末で Cotaska を起動する。
2. 設定 > アプリ情報を開く。
3. 更新確認をクリックする。
4. `fetch failed` が表示され、最新版確認が完了しないことを確認する。

## 期待動作

更新確認が正常に完了し、最新版有無または到達不能理由が利用者に分かる形で表示される。

## 調査メモ

- 現行実装では `latestVersionUrl` に対して main process から JSON 取得を行い、失敗時はそのまま `err.message` を返している。
- `fetch failed` は到達先 URL の遮断、社内プロキシ未対応、SSL インスペクション、証明書差し替え、名前解決制限などでも発生しうる。
- 2026-05-16 に `BUG-20260516-02 Portable版更新確認でapp-update.ymlが見つからない` を対応済みだが、今回は `app-update.yml` ではなく更新メタデータ取得時の通信失敗が疑われる。
- `data/settings.yaml` の `update.latestVersionUrl` 設定値と、実際にその URL へ社内ネットワークからアクセス可能か切り分けが必要。
- 実測結果:
	- PowerShell `Invoke-WebRequest` では `latestVersionUrl` / `downloadPageUrl` とも HTTP 200 で到達可能。
	- 同梱 Node (`v22.14.0/node.exe`) の `fetch` では同URLで `TypeError: fetch failed` を再現。
	- 例外詳細は `cause.code=ECONNRESET`、`Client network socket disconnected before secure TLS connection was established`。
	- 以上より、Windows 通信スタックでは到達できるが Node fetch/TLS 経路で切断される環境差が主因候補。
- 追加確認（2026-06-03）:
	- 実行時参照設定 `Cotaska/data/settings.yaml` の `update.latestVersionUrl` が旧URL `https://api.github.com/repos/csho10051/Agent_Cotaska/releases/latest` のままであることを確認。
	- そのため、Cloudflare ではなく旧GitHub APIへ問い合わせて HTTP 404 になっていた。

## 修正方針

- 更新確認先 URL、レスポンス形式、社内ネットワークからの到達性を確認する。
- 必要に応じてプロキシ環境考慮、到達失敗時のエラーメッセージ改善、手動ダウンロード案内へのフォールバックを検討する。
- アプリログに失敗 URL と失敗要因を残し、利用者向け表示は原因切り分けしやすい文言へ改善する。

## 対応内容（2026-06-03）

- `20_app/src/main/main.js` の `fetchJson` に、Node `fetch` 失敗時の `electron.net` フォールバック処理を追加。
- `app:checkForUpdates` の失敗ログへ `url` / `code` / `cause` を追加し、調査時に根拠が残るよう改善。
- 利用者向け失敗メッセージを `ECONNRESET` / `ENOTFOUND` / `ETIMEDOUT` で分岐し、ネットワーク制限の可能性と確認先 URL を明示する文言に改善。
- `SettingsPane.jsx` の更新確認処理を修正し、`updates.check()` が `unsupported` の場合は終了せず `app:checkForUpdates` へフォールバックするようにした。
- `Cotaska/data/settings.yaml` の更新URL設定を Cloudflare R2 と公式ダウンロードページに更新した。
- `settingsService.js` に旧GitHub URL（`EbiSenbei` / `csho10051`）の自動移行ロジックを追加し、旧設定が残っていてもCloudflare既定値へ寄せるようにした。

## 検証結果（2026-06-03）

- 疎通試験:
	- PowerShell `Invoke-WebRequest` で更新URL到達成功（HTTP 200）。
	- 同梱 Node `fetch` では失敗再現（`ECONNRESET`）。
- 実装検証:
	- `20_app/src/main/main.js` の構文チェックを実行し成功。
	- `release/win-unpacked/CotaskaCore.exe` では `updates.check()` の `unsupported` 表示が先に出ることを確認。
	- `20_app/src/renderer/components/SettingsPane.jsx` のフォールバック修正後、`npm run build` 成功。
	- 修正後の実機UI表示確認は未実施（ユーザー確認待ち）。
- 最終確認（2026-06-03）:
	- Portable版（`release/Cotaska-Portable/Cotaska.exe`）で「更新をダウンロード」ボタン押下後、electron.netフォールバック経由でダウンロード正常完了を確認。
	- `fetchText` / `downloadFile` にも electron.net フォールバックを追加し、チェックサム取得・バイナリダウンロードともに会社ネットワーク環境で動作することを確認。
	- 不具合解消を確認し、対応完了。

## 関連ファイル

- `20_app/src/main/main.js` — 更新確認の取得処理と失敗時の戻り値
- `20_app/src/renderer/components/SettingsPane.jsx` — 更新確認ボタン押下時の表示制御
- `data/settings.yaml` — 更新確認先 URL 設定
- `10_docs/30_実装・検証/10_不具合対応/20260516_02_Portable版更新確認でapp-update-ymlが見つからない.md` — 関連する更新確認不具合