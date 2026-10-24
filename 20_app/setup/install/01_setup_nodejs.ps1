<#
.SYNOPSIS
    Node.js v24.22.1 を nvm-windows 経由でセットアップする
.PARAMETER Proxy
    プロキシURL（例: http://proxygate2.nic.nec.co.jp:8080）
.EXAMPLE
    .\01_setup_nodejs.ps1
    .\01_setup_nodejs.ps1 -Proxy "http://your-proxy:8080"
#>
param(
    [string]$Proxy
)

$ErrorActionPreference = "Stop"
$appDir = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path
$NodeVersion = (Get-Content -LiteralPath (Join-Path $appDir ".nvmrc") -Raw).Trim()

Write-Host "=== Cotaska: Node.js セットアップ ===" -ForegroundColor Cyan

# --- nvm-windows 確認 ---
$nvmCmd = Get-Command nvm -ErrorAction SilentlyContinue
if (-not $nvmCmd) {
    Write-Host "[ERROR] nvm-windows が見つかりません。" -ForegroundColor Red
    Write-Host "  https://github.com/coreybutler/nvm-windows/releases からインストールしてください。"
    exit 1
}
Write-Host "[OK] nvm-windows 検出" -ForegroundColor Green

# --- プロキシ設定 ---
if ($Proxy) {
    Write-Host "[INFO] nvm プロキシ設定: $Proxy"
    nvm proxy $Proxy
}

# --- Node.js インストール ---
Write-Host "[INFO] Node.js v$NodeVersion をインストール中..."
$nvmResult = nvm install $NodeVersion 2>&1
Write-Host $nvmResult

# nvm install が失敗した場合のフォールバック（手動ダウンロード）
$nvmRoot = $env:NVM_HOME
if (-not $nvmRoot) {
    $nvmRoot = Join-Path $env:APPDATA "nvm"
    if (-not (Test-Path $nvmRoot)) {
        $nvmRoot = Join-Path $env:LOCALAPPDATA "nvm"
    }
}
$nodeDir = Join-Path $nvmRoot "v$NodeVersion"

if (-not (Test-Path (Join-Path $nodeDir "node.exe"))) {
    Write-Host "[WARN] nvm install が失敗した可能性があります。手動ダウンロードを試みます..." -ForegroundColor Yellow

    $arch = if ([Environment]::Is64BitOperatingSystem) { "x64" } else { "x86" }
    $zipUrl = "https://nodejs.org/dist/v$NodeVersion/node-v$NodeVersion-win-$arch.zip"
    $zipFile = Join-Path $env:TEMP "node-v$NodeVersion-win-$arch.zip"

    Write-Host "[INFO] ダウンロード中: $zipUrl"
    $webParams = @{ Uri = $zipUrl; OutFile = $zipFile; UseBasicParsing = $true }
    if ($Proxy) { $webParams.Proxy = $Proxy }
    Invoke-WebRequest @webParams

    Write-Host "[INFO] 展開中..."
    $extractDir = Join-Path $env:TEMP "node-v$NodeVersion-extract"
    if (Test-Path $extractDir) { Remove-Item -Recurse -Force $extractDir }
    Expand-Archive -Path $zipFile -DestinationPath $extractDir

    # nvm管理下にコピー
    $extractedFolder = Get-ChildItem $extractDir | Select-Object -First 1
    if (-not (Test-Path $nodeDir)) { New-Item -ItemType Directory -Path $nodeDir | Out-Null }
    Copy-Item -Path (Join-Path $extractedFolder.FullName "*") -Destination $nodeDir -Recurse -Force

    # クリーンアップ
    Remove-Item $zipFile -ErrorAction SilentlyContinue
    Remove-Item $extractDir -Recurse -ErrorAction SilentlyContinue

    Write-Host "[OK] 手動ダウンロード完了" -ForegroundColor Green
}

# --- nvm use ---
Write-Host "[INFO] Node.js v$NodeVersion をアクティブ化..."
nvm use $NodeVersion

# Use the selected runtime for this session even if nvm activation has not propagated.
$env:Path = "$nodeDir;$env:Path"
& (Join-Path $nodeDir "node.exe") (Join-Path $appDir "scripts\verify-runtime.js")
if ($LASTEXITCODE -ne 0) { throw "Node.js runtime validation failed." }

# --- 確認 ---
$nodeVer = node -v 2>&1
$npmVer = npm -v 2>&1
Write-Host ""
Write-Host "=== セットアップ結果 ===" -ForegroundColor Cyan
Write-Host "  Node.js: $nodeVer"
Write-Host "  npm:     $npmVer"
Write-Host "  場所:    $nodeDir"
Write-Host ""
Write-Host "[OK] Node.js セットアップ完了" -ForegroundColor Green
