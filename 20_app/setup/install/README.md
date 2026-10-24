# Cotaska インストール手順

## 前提条件

- Windows 10/11
- nvm-windows がインストール済み（推奨 v1.2.2 以上）
- プロキシ環境の場合、プロキシURLを把握していること

## インストール手順

### 1. Node.js セットアップ

```powershell
.\01_setup_nodejs.ps1
```

- nvm-windows 経由で Node.js v24.22.1（同梱npm 11.19.1） をインストール
- プロキシ環境の場合は `-Proxy` オプションを指定

```powershell
.\01_setup_nodejs.ps1 -Proxy "http://your-proxy:8080"
```

### 2. npm パッケージインストール

```powershell
.\02_install_packages.ps1
```

- プロキシ環境の場合：

```powershell
.\02_install_packages.ps1 -Proxy "http://your-proxy:8080"
```

### 3. データベース初期化

```powershell
.\03_init_database.ps1
```

- `20_app/db/cotasker.sqlite3` が生成される
- 既存DBがある場合は `.bak_<タイムスタンプ>` として退避される

---

## 今回のセットアップで発生した問題と対策

### better-sqlite3 → sql.js への変更

- better-sqlite3 はネイティブビルド（C++コンパイル）が必要
- プロキシ環境ではprebuildバイナリのダウンロードに失敗（tunneling socket ECONNRESET）
- フォールバックのnode-gypビルドにはPython + VS Build Toolsが必要だが未インストール
- **対策**: pure JavaScript/WASM実装の sql.js に切り替え（ネイティブビルド不要）

### nvm-windows でのNode.jsインストール失敗

- `nvm install` がプロキシ環境でTLS/EOFエラーを出す場合がある
- **対策**: PowerShell `Invoke-WebRequest -Proxy` で直接ZIPをダウンロードし、nvm管理下に配置
  （01_setup_nodejs.ps1 にフォールバック処理を実装済み）
