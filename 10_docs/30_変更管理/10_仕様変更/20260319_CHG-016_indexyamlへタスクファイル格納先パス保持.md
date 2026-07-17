# 仕様変更ファイル

## 変更ID

CHG-016

## 変更内容

`30_data/tasks/_index.yaml` に各タスクの実ファイル格納先パスを保持する。
タスクファイルが単一フォルダに集約されていない場合でも、UI と AI が参照できるようにする。

## 変更理由

現状の `_index.yaml` はタスク概要のみで、実ファイルの所在情報を持っていない。
タスクファイルが複数フォルダへ分散した場合に、再読込や外部編集連携で参照先が不明確になりやすいため。

## 影響範囲

- **UI**:
  - タスク操作時に `task_file_path` を利用して実ファイルへアクセスする導線へ更新
- **データ構造**:
  - `_index.yaml` の各タスク要素へ `task_file_path`（相対パス）を追加
  - 必要に応じて探索対象ルート一覧（例: `task_file_roots`）を追加
- **API/IPC**:
  - Main 側のタスク読み込み・更新時に `task_file_path` を返却/利用
- **既存機能影響**:
  - 既存タスクは移行時に `task_file_path` を補完する必要がある

## 設計反映先

- `10_docs/10_設計/10_システム設計/システム全体設計.md`
- `10_docs/10_設計/20_基本設計/02_タスク管理.md`
- `00_mgmt/CURRENT_SPRINT.md`

## 実装タスク分解

1. `_index.yaml` スキーマ拡張（`task_file_path` 追加）
2. `indexService.js` の書き出し処理を更新（パス埋め込み）
3. `taskService.js` の読み込み/更新処理を `task_file_path` 優先へ更新
4. 既存 `_index.yaml` 向け移行処理を追加（パス未設定タスクの補完）
5. 監視処理（`watcher.js`）の対象ルート見直し
6. 動作確認（分散配置ファイルの読込・更新・再起動後維持）

## 完了条件

- [ ] `_index.yaml` の各タスクに `task_file_path` が保持される
- [ ] タスクファイルが複数フォルダに分散していても一覧表示・更新できる
- [ ] 既存データを破壊せず移行できる
- [ ] `npx vite build` が成功する

## テスト観点

- [ ] 既存配置（`30_data/tasks/`）で回帰がない
- [ ] 分散配置（例: `30_data/tasks/projectA/`, `30_data/tasks/projectB/`）で読込・更新できる
- [ ] `_index.yaml` 再生成後も `task_file_path` が正しく維持される
- [ ] 外部編集後の watcher 反映が成立する

## 状態

未着手

---

## 関連ドキュメント

- `00_mgmt/CURRENT_SPRINT.md`
- `00_mgmt/DECISIONS.md`