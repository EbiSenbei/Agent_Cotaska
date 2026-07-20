# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260720-01 |
| 報告日 | 2026-07-20 |
| 報告者 | ユーザー |
| 対象機能 | Portable 版 `Cotaska.exe` の起動監視 |
| 重要度 | 中 |
| 状態 | 解決済み |
| 解決日 | 2026-07-20 |
| 関連タスク | T-0521 |

---

## 現象

`Cotaska.exe` を実行すると、CotaskaCore が既に正常起動しているにもかかわらず、次の復旧ダイアログが表示される。

```text
CotaskaCore.exe が起動後 10 秒以内に終了しました。終了コード: 0
最新の debug.log エラー: debug.log はありません。
```

復旧ダイアログからは更新前バックアップを用いた `_app` の復元が提案される。

## 再現手順

1. Portable 配布先の `Cotaska.exe` から CotaskaCore を起動する。
2. CotaskaCore が起動済みの状態で、同じ `Cotaska.exe` を再度実行する。
3. CotaskaCore の既存ウィンドウは表示されたまま、ランチャーが上記の起動失敗ダイアログを表示することを確認する。

## 期待動作

- 同一 Portable ルートで CotaskaCore が起動済みの場合、既存ウィンドウを前面化する。
- 二重起動のために終了コード 0 で終了した子プロセスを、異常終了および復元対象として扱わない。

## 調査メモ

### 証跡

- `launcher.log` の 2026-07-20 22:39:29 では、子プロセス起動後約 0.9 秒で「10 秒以内に終了」「終了コード: 0」が記録されている。
- 同日の `logs/app-2026-07-20.log` には、先行プロセスが正常にウィンドウを表示した記録があり、その後 `Single instance lock not acquired. Existing instance may already be running.` と記録されている。
- 同ログには先行プロセスのウィンドウが `isVisible: true`、`isFocused: true` であることも記録されている。

### 原因

Electron 本体は同一ルートの二重起動を `requestSingleInstanceLock()` で検出し、重複プロセスを `app.quit()` で正常終了させる設計である。一方、`LauncherFallback.cs` の `StartChild` は、起動後 10 秒以内に子プロセスが終了した場合、終了コードを問わず障害として復旧ダイアログを表示する。

このため、二重起動時に意図どおり終了した終了コード 0 が「起動失敗」と誤判定される。`debug.log` がないことは原因ではなく、誤判定時の補助診断が空であることを示すだけである。

## 修正内容

ランチャーが子プロセスの終了コード 0 を検出した場合、直ちに復旧対象にせず、同一 Portable ルートの既存 `CotaskaCore` プロセスの有無を確認する。既存プロセスがある場合は、Electron 側の `second-instance` 通知による既存ウィンドウの前面化を正常な二重起動として扱い、復旧ダイアログを表示せず成功として終了する。

既存プロセスがない終了コード 0 の早期終了は、従来どおり診断可能な起動失敗として扱う。

## 検証結果

- `20_app/setup/launcher/build.ps1` により修正後ランチャーをビルドし、成功を確認した。
- タスク管理ツール配下の `Cotaska.exe` を更新後ランチャーへ差し替えた。
- 同一 Portable ルートの CotaskaCore 起動中に `Cotaska.exe` を実行したところ、ランチャーは終了コード 0 で終了した。
- `launcher.log` に `Child exited normally because an existing CotaskaCore instance accepted the launch request.` が記録され、復旧ダイアログは表示されなかった。

## 関連ファイル

- `20_app/setup/launcher/LauncherFallback.cs`
- `20_app/src/main/main.js`
- `00_mgmt/Cotaska_タスク管理ツール/launcher.log`
- `00_mgmt/Cotaska_タスク管理ツール/logs/app-2026-07-20.log`
