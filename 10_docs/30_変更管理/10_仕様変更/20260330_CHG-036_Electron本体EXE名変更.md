# 仕様変更ファイル

## 変更ID

CHG-036

## 変更内容

`_app/Cotaska.exe`（Electron 本体）のファイル名を `CotaskaCore.exe` に変更する。
ルートの `Cotaska.exe`（Go 製ランチャー）の名称はそのまま維持する。
`_app/` 配下の EXE は内部実行ファイルとして扱い、正規の起動経路はルートの `Cotaska.exe` とする。

### 現状の問題

```
Cotaska-0.1.0-dist/
  ├── Cotaska.exe        ← Go製ランチャー（ユーザが起動すべきもの）
  └── _app/
       └── Cotaska.exe   ← Electron本体（直接起動すべきでない）
```

同名の `Cotaska.exe` が2箇所に存在するため、AI エージェントが誤って `_app/Cotaska.exe` を直接起動してしまう。

### 変更後

```
Cotaska-0.1.0-dist/
  ├── Cotaska.exe         ← Go製ランチャー（変更なし）
  └── _app/
       └── CotaskaCore.exe  ← Electron本体（名称変更）
```

---

## 変更理由

AI エージェントに起動を指示した際に、`_app/Cotaska.exe` を誤って直接起動してしまい、
ランチャー経由の正規起動フロー（フォアグラウンド権限付与等）がバイパスされる問題を解消するため。

---

## 影響範囲

- UI: なし
- DB: なし
- API/IPC: なし
- ビルド設定: `package.json` の `build.productName` を変更
- ランチャー: `main.go` のターゲットパス、`versioninfo.json` を変更
- 既存機能影響: ランチャー経由の起動フローに変更なし

---

## 設計反映先

- 設計書への反映不要（ビルド設定のみの変更）

---

## 実装タスク分解

1. CHG-036-01: Electron 本体 EXE 名変更（`package.json` の `productName`）+ ランチャー参照先変更（`main.go`）+ ランチャー再ビルド + リリース再生成（T-0051）
2. CHG-036-02: ユーザ確認（ランチャー経由の正常起動確認）（T-0052）

---

## 完了条件

- [x] `_app/` 配下の EXE が `CotaskaCore.exe` になっていること
- [x] ルートの `Cotaska.exe`（ランチャー）から正常に起動できること
- [x] `_app/` 内に旧名 `Cotaska.exe` が残っていないこと

---

## テスト観点

- [x] ランチャー経由で Cotaska が正常起動するか
- [x] タスク一覧が正しく表示されるか
- [x] `_app/` フォルダ内に `CotaskaCore.exe` が生成されているか
- [x] 旧名 `Cotaska.exe` が `_app/` 内に残っていないか

---

## 状態

完了

## 実施結果

- `package.json` の `build.productName` を `CotaskaCore` に変更
- ランチャーの参照先を `_app/CotaskaCore.exe` に変更
- リリース再生成後、`00_mgmt/Cotaska_タスク管理ツール/` に反映
- ユーザ確認により、ランチャー経由の正常起動を確認
