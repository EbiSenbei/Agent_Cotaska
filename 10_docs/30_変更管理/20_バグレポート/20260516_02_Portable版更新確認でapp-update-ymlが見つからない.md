# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260516-02 |
| 報告日 | 2026-05-16 |
| 報告者 | ユーザー |
| 対象機能 | 設定 > アプリ情報 > 更新確認 |
| 重要度 | 中 |
| 状態 | 解決済み |

## 現象

Cotaska のアプリ情報で更新確認を実行すると、次のエラーが表示され、自動更新確認が完了しない。

```text
ENOENT: no such file or directory, open 'D:\Development\Git\EbiSenbei_dev\Agent_Cotaska\Cotaska\00_mgmt\Cotaska_タスク管理ツール\_app\resources\app-update.yml'
```

## 再現手順

1. タスク正本配布フォルダの Cotaska を起動する。
2. 設定 > アプリ情報を開く。
3. 更新確認を実行する。

## 期待動作

Cotaska-Portable 版では自動更新を実行せず、自動更新対象外であることと手動更新またはインストール版利用の案内を表示する。

## 調査メモ

タスク正本配布は `_app/CotaskaCore.exe` をランチャーから起動する Cotaska 独自 portable 構成である。  
従来の判定は electron-builder portable の `PORTABLE_EXECUTABLE_*` 環境変数のみを見ていたため、Cotaska-Portable 構成を自動更新対象として扱っていた。

その結果、`electron-updater` が `resources/app-update.yml` を読み込もうとして ENOENT になっていた。

## 修正方針

- `process.execPath` の親フォルダ名が `_app` の場合は Cotaska-Portable 構成とみなし、自動更新対象外にする。
- `app-update.yml` が存在しない場合も `electron-updater` を呼び出さず、案内メッセージを返す。

## 関連ファイル

- `20_app/src/main/main.js`

## 検証結果

- `node --check 20_app/src/main/main.js` 成功。
- `release-all.ps1 -Version "0.2.0"` 成功。
- `sync-task-master-release.ps1` でタスク正本へ反映済み。
- タスク正本の `app.asar` 内に Cotaska-Portable 判定と `app-update.yml` 不在判定が含まれることを確認。
