# バグレポート

## 基本情報

| 項目 | 内容 |
|------|------|
| 番号 | BUG-20260822-01 |
| 報告日 | 2026-08-22 |
| 報告者 | Codex |
| 対象機能 | Portableリリースビルド |
| 重要度 | 高 |
| 状態 | ユーザー確認待ち |

## 現象

`release-all.ps1 -Version 0.3.6` のステップ0.5で `npm ci` が失敗し、依存関係が不完全な状態になったためPortable配布物を生成できない。

## 再現手順

1. 通常の制限実行環境から `20_app/release-all.ps1 -Version 0.3.6` を実行する。
2. 既定npmキャッシュのファイル操作で `EPERM` が発生する。
3. 専用キャッシュに変更しても、npmレジストリへの通信が `EACCES` で拒否される。

## 期待動作

Node.js 22.14.0・npm 10.9.2で依存関係を復元し、出荷前検証済みのPortable ZIPを生成できる。

## 調査メモ

- 同梱Node.jsとnpmのバージョンは要件を満たしていた。
- `package-lock.json` や `release-all.ps1` の不整合ではなく、サンドボックスのファイル・外部通信制限が原因だった。
- 承認付き実行環境で同じ `npm ci` を実行すると正常完了した。

## 修正方針

ソースコードは変更せず、リリース作業時は npm キャッシュとnpmレジストリへアクセス可能な承認付き実行環境で `npm ci` および `release-all.ps1` を実行する。

## 検証結果

- `npm ci --no-audit --no-fund`: 成功（531パッケージ）
- `release-all.ps1 -Version 0.3.6`: 終了コード0
- Portable ZIP: 376,654,548 bytes
- SHA-256: `2d33c980be3bc70bc53a1e41b6bb406ca44f2d0f8c66f9b2c402acf9292115bc`
- ランチャー、Updater、必須ファイル、ZIP内Updater一致を含む全出荷前検証: 成功

## 関連ファイル

- `00_mgmt/Cotaska_タスク管理ツール/data/tasks/T-0558.md` — 対応タスク正本
- `20_app/release-all.ps1` — Portableリリース一括スクリプト
- `20_app/package-lock.json` — npm依存関係の固定定義
