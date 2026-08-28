---
id: T-0158
title: 'CHG-058-04 実装: GitHub Copilot CLIプロバイダ追加'
status: todo
priority: normal
progress_status: 未着
due_date: null
list: 仕様変更
parent: T-0154
tags:
  - CHG-057
  - 実装
  - GitHub Copilot
  - AI連携
sort_order: 144
delete_flag: 1
created_at: '2026-05-14T11:10:00+09:00'
updated_at: '2026-07-05T03:47:04.161Z'
completed_at: null
deleted_at: '2026-07-05T03:47:04.161Z'
---

## 作業内容

ローカルAI CLI連携基盤にGitHub Copilot CLIプロバイダを追加する。

## 実装方針

- GitHub Copilot CLIの実行コマンド、引数、認証確認方法を調査する。
- 共通CLIプロバイダ定義にGitHub Copilot CLIを追加する。
- CotaskaのチャットUIで選択または表示できるようにする。
- stdout/stderr、終了コード、未認証時の表示をCodex CLIと同じ枠組みで扱う。

## 完了条件

- [ ] GitHub Copilot CLIの実行可否をCotaskaから確認できる。
- [ ] CotaskaからGitHub Copilot CLIへメッセージを送信できる。
- [ ] 応答がチャット欄に表示される。
- [ ] 未認証/未インストール時のエラーが表示される。
- [ ] 既存のCodex CLI連携を壊していない。
