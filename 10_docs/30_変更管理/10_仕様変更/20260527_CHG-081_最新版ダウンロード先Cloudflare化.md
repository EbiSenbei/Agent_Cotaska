# CHG-081 最新版ダウンロード先Cloudflare化

## 変更ID

CHG-081

## 変更内容

Cotaska の Portable版更新確認・ダウンロード元を、GitHub Releases から Cloudflare R2 の公開配布先へ変更する。
既存利用者の互換性のため、GitHub Releases latest API 形式の更新メタデータも読み取れる状態は維持する。

## 変更理由

最新版配布を GitHub Releases 依存から切り離し、Cloudflare 側で公開する `Cotaska-Portable.zip` を直接取得できるようにするため。

## 影響範囲

- UI: 設定画面の更新確認・ダウンロード導線の文言は既存のまま利用
- DB: なし
- API/IPC: 既存の `updates.check()`、`updates.download()`、`app.checkForUpdates()` の戻り値形式を維持
- 既存機能影響: Portable版自動更新、起動時更新アラート、手動ダウンロード導線、`settings.yaml` の既定値

## 設計反映先

- `10_docs/20_設計/10_システム設計/システム全体設計.md`
- `10_docs/20_設計/20_基本設計/02_タスク管理.md`
- `10_docs/20_設計/20_基本設計/08_設定画面.md`

## 実装タスク分解

1. T-0272 CHG-081-01 設計：最新版ダウンロード先Cloudflare化の仕様反映（完了）
2. T-0273 CHG-081-02 実装：Cloudflare R2更新メタデータ対応（完了）
3. T-0274 CHG-081-03 ユーザー確認：Cloudflare更新確認・ダウンロード確認（未着手）

## 完了条件

- [x] 既定の最新版確認URLが Cloudflare R2 の `latest/version.json` を指す
- [x] 既定の手動ダウンロードページURLが Cotaska サイトのダウンロードページを指す
- [x] 旧GitHub既定URLが保存済みの場合は Cloudflare R2 既定URLへ移行する
- [x] `latest/version.json` の `version` と `files.portable` / `files.sha256` から更新情報を組み立てられる
- [x] 既存の GitHub Releases latest API 形式も互換的に読み取れる
- [ ] Portable版で実際に更新確認・ダウンロードできることをユーザーが確認する

## テスト観点

- [x] Cloudflare R2 形式の `version.json` から zip と sha256 のURLを解決できる
- [x] GitHub Releases latest API 形式の asset URL 解決が壊れていない
- [x] `npm run build` が成功する
- [x] 「ダウンロードを開く」の既定URLが Cotaska サイトのダウンロードページになる
- [ ] 設定画面の「更新を確認」で Cloudflare R2 の最新版情報を取得できる
- [ ] 更新あり状態で「更新をダウンロード」から Cloudflare R2 の zip を取得できる

## 状態

進行中
