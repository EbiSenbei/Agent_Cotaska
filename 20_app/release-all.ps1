# Cotaska NSIS installer release builder (CHG-126)
#
# Usage:
#   cd 20_app
#   .\release-all.ps1
#   .\release-all.ps1 -Version "0.3.7"

param([string]$Version)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
$releaseDir = Join-Path $scriptDir "release"
$nodeDir = Resolve-Path (Join-Path $scriptDir "..\..\v22.14.0")
$npmCmd = Join-Path $nodeDir "npm.cmd"
$npmCacheDir = Join-Path ([System.IO.Path]::GetTempPath()) "cotaska-npm-cache"

. (Join-Path $scriptDir "scripts\release-common.ps1")
$Version = Resolve-CotaskaReleaseVersion -AppDir $scriptDir -RequestedVersion $Version
Write-CotaskaDirtyTreeWarning -RepoRoot $repoRoot

$artifactBaseName = "Cotaska-$Version-win-x64.exe"
$installerPath = Join-Path $releaseDir $artifactBaseName
$blockmapPath = "$installerPath.blockmap"
$latestYamlPath = Join-Path $releaseDir "latest.yml"
$legacyInstallerPath = Join-Path $releaseDir "CotaskaCore-$Version-win-x64.exe"
$legacyBlockmapPath = "$legacyInstallerPath.blockmap"
$unpackedDir = Join-Path $releaseDir "win-unpacked"
$codexRelativePath = "resources\app.asar.unpacked\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
$claudeRelativePath = "resources\app.asar.unpacked\node_modules\@anthropic-ai\claude-agent-sdk-win32-x64\claude.exe"

$env:PATH = "$nodeDir;$env:PATH"

function Invoke-NpmChecked {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $npmCmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        throw $FailureMessage
    }
}

function Test-RequiredCommonJsDependency {
    param([Parameter(Mandatory = $true)][string]$PackageName)

    & node -e "require.resolve('$PackageName')" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "必須依存関係が見つかりません: $PackageName"
    }
}

function Test-RequiredEsmDependency {
    param([Parameter(Mandatory = $true)][string]$PackageName)

    & node --input-type=module -e "await import('$PackageName')" | Out-Null
    if ($LASTEXITCODE -ne 0) {
        throw "必須依存関係が見つかりません: $PackageName"
    }
}

function Get-FileSha512Base64 {
    param([Parameter(Mandatory = $true)][string]$Path)

    $stream = [System.IO.File]::OpenRead($Path)
    try {
        $sha512 = [System.Security.Cryptography.SHA512]::Create()
        try {
            return [Convert]::ToBase64String($sha512.ComputeHash($stream))
        }
        finally {
            $sha512.Dispose()
        }
    }
    finally {
        $stream.Dispose()
    }
}

function Assert-ReleaseFile {
    param([Parameter(Mandatory = $true)][string]$Path)

    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) {
        throw "リリース成果物が見つかりません: $Path"
    }
    if ((Get-Item -LiteralPath $Path).Length -le 0) {
        throw "リリース成果物が空です: $Path"
    }
}

function Get-AssociatedIconHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [switch]$ExtractFromExecutable
    )

    Add-Type -AssemblyName System.Drawing
    if ($ExtractFromExecutable) {
        $icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path -LiteralPath $Path).Path)
    }
    else {
        $icon = New-Object System.Drawing.Icon((Resolve-Path -LiteralPath $Path).Path)
    }
    try {
        $bitmap = $icon.ToBitmap()
        try {
            $stream = New-Object System.IO.MemoryStream
            try {
                $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
                $sha256 = [System.Security.Cryptography.SHA256]::Create()
                try {
                    return ([BitConverter]::ToString($sha256.ComputeHash($stream.ToArray()))).Replace("-", "")
                }
                finally {
                    $sha256.Dispose()
                }
            }
            finally {
                $stream.Dispose()
            }
        }
        finally {
            $bitmap.Dispose()
        }
    }
    finally {
        $icon.Dispose()
    }
}

function Invoke-CotaskaStartupSmokeTest {
    param([Parameter(Mandatory = $true)][string]$ExecutablePath)

    $resolvedExecutablePath = (Resolve-Path -LiteralPath $ExecutablePath).Path
    $smokeRoot = Join-Path ([System.IO.Path]::GetTempPath()) ("cotaska-startup-smoke-" + [Guid]::NewGuid().ToString("N"))
    $markerPath = Join-Path $smokeRoot "renderer-ready.json"
    $previousMarker = $env:COTASKA_STARTUP_MARKER
    $previousSmokeTest = $env:COTASKA_SMOKE_TEST
    $previousInstanceId = $env:COTASKA_SMOKE_INSTANCE_ID
    $process = $null

    try {
        New-Item -ItemType Directory -Path $smokeRoot -Force | Out-Null
        $env:COTASKA_STARTUP_MARKER = $markerPath
        $env:COTASKA_SMOKE_TEST = "1"
        $env:COTASKA_SMOKE_INSTANCE_ID = [Guid]::NewGuid().ToString("N")
        $process = Start-Process -FilePath $resolvedExecutablePath -WorkingDirectory (Split-Path -Parent $resolvedExecutablePath) -PassThru -WindowStyle Hidden

        $deadline = [DateTime]::UtcNow.AddSeconds(30)
        while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
            if ($process.HasExited) { break }
            Start-Sleep -Milliseconds 250
        }

        if (-not (Test-Path -LiteralPath $markerPath -PathType Leaf)) {
            $exitDescription = if ($process.HasExited) { "exitCode=$($process.ExitCode)" } else { "process is still running" }
            throw "Cotaska.exeのRenderer起動を確認できませんでした: $exitDescription"
        }

        $marker = Get-Content -Raw -Encoding UTF8 -LiteralPath $markerPath | ConvertFrom-Json
        if ([string]::IsNullOrWhiteSpace([string]$marker.url)) {
            throw "起動マーカーにRenderer URLが記録されていません。"
        }

        if (-not $process.WaitForExit(10000)) {
            throw "スモークテスト後にCotaska.exeが終了しませんでした。"
        }
        if ($process.ExitCode -ne 0) {
            throw "スモークテスト終了コードが異常です: $($process.ExitCode)"
        }
    }
    finally {
        $env:COTASKA_STARTUP_MARKER = $previousMarker
        $env:COTASKA_SMOKE_TEST = $previousSmokeTest
        $env:COTASKA_SMOKE_INSTANCE_ID = $previousInstanceId
        if ($null -ne $process -and -not $process.HasExited) {
            Stop-Process -Id $process.Id -Force -ErrorAction SilentlyContinue
        }
        if (Test-Path -LiteralPath $smokeRoot -PathType Container) {
            Remove-Item -LiteralPath $smokeRoot -Recurse -Force
        }
    }
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Cotaska NSISリリース一括作成 v$Version" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $npmCmd -PathType Leaf)) {
    throw "npmが見つかりません: $npmCmd"
}

Set-Location $scriptDir

foreach ($legacyPath in @($legacyInstallerPath, $legacyBlockmapPath)) {
    if (Test-Path -LiteralPath $legacyPath -PathType Leaf) {
        Remove-Item -LiteralPath $legacyPath -Force
        Write-Host "旧成果物名を削除しました: $legacyPath" -ForegroundColor Yellow
    }
}

Write-Host "`n[ステップ 1/5] Node依存関係を復元・検証しています..." -ForegroundColor Cyan
New-Item -ItemType Directory -Path $npmCacheDir -Force | Out-Null
Invoke-NpmChecked -Arguments @("ci", "--no-audit", "--no-fund", "--cache", $npmCacheDir) -FailureMessage "npm ciに失敗しました。"
Test-RequiredCommonJsDependency -PackageName "sql.js"
Test-RequiredEsmDependency -PackageName "@openai/codex-sdk"
Test-RequiredEsmDependency -PackageName "@anthropic-ai/claude-agent-sdk"
Test-RequiredCommonJsDependency -PackageName "electron-updater"
Write-Host "  完了: 必須依存関係を確認しました" -ForegroundColor Green

Write-Host "`n[ステップ 2/5] 自動テストを実行しています..." -ForegroundColor Cyan
Invoke-NpmChecked -Arguments @("test") -FailureMessage "自動テストに失敗しました。"
Write-Host "  完了: 自動テストが成功しました" -ForegroundColor Green

Write-Host "`n[ステップ 3/5] NSISインストーラーを生成しています..." -ForegroundColor Cyan
Invoke-NpmChecked -Arguments @("run", "dist:installer") -FailureMessage "NSISインストーラーの生成に失敗しました。"
Write-Host "  完了: electron-builderによるNSISビルドが成功しました" -ForegroundColor Green

Write-Host "`n[ステップ 4/5] リリース成果物を検証しています..." -ForegroundColor Cyan
foreach ($path in @($installerPath, $blockmapPath, $latestYamlPath)) {
    Assert-ReleaseFile -Path $path
}

$latestYaml = Get-Content -Raw -Encoding UTF8 -LiteralPath $latestYamlPath
$escapedVersion = [Regex]::Escape($Version)
$escapedArtifactName = [Regex]::Escape($artifactBaseName)
if ($latestYaml -notmatch "(?m)^version:\s*$escapedVersion\s*$") {
    throw "latest.ymlのversionがpackage.jsonと一致しません: $Version"
}
if ($latestYaml -notmatch "(?m)^\s*(?:url|path):\s*$escapedArtifactName\s*$") {
    throw "latest.ymlが生成済みインストーラーを参照していません: $artifactBaseName"
}

$installerSha512 = Get-FileSha512Base64 -Path $installerPath
$sha512Matches = [Regex]::Matches($latestYaml, "(?m)^\s*sha512:\s*(\S+)\s*$")
$declaredSha512Values = @($sha512Matches | ForEach-Object { $_.Groups[1].Value.Trim() })
if ($declaredSha512Values -notcontains $installerSha512) {
    throw "latest.ymlのSHA-512が生成済みインストーラーと一致しません。"
}

$installerSize = (Get-Item -LiteralPath $installerPath).Length
$sizeMatches = [Regex]::Matches($latestYaml, "(?m)^\s*size:\s*(\d+)\s*$")
$declaredSizes = @($sizeMatches | ForEach-Object { [long]$_.Groups[1].Value })
if ($declaredSizes.Count -gt 0 -and $declaredSizes -notcontains $installerSize) {
    throw "latest.ymlのファイルサイズが生成済みインストーラーと一致しません。"
}

if (-not (Test-Path -LiteralPath $unpackedDir -PathType Container)) {
    throw "win-unpackedが見つかりません: $unpackedDir"
}

$codexPath = Join-Path $unpackedDir $codexRelativePath
$claudePath = Join-Path $unpackedDir $claudeRelativePath
$coreExecutablePath = Join-Path $unpackedDir "Cotaska.exe"
$sourceIconPath = Join-Path $scriptDir "setup\launcher\icon.ico"
Assert-ReleaseFile -Path $codexPath
Assert-ReleaseFile -Path $claudePath
Assert-ReleaseFile -Path $coreExecutablePath
Assert-ReleaseFile -Path $sourceIconPath

$coreVersionInfo = (Get-Item -LiteralPath $coreExecutablePath).VersionInfo
if ($coreVersionInfo.ProductName -ne "Cotaska" -or $coreVersionInfo.FileDescription -ne "Cotaska") {
    throw "Cotaska.exeの製品名または説明がCotaskaではありません。"
}

$sourceIconHash = Get-AssociatedIconHash -Path $sourceIconPath
$coreIconHash = Get-AssociatedIconHash -Path $coreExecutablePath -ExtractFromExecutable
if ($sourceIconHash -ne $coreIconHash) {
    throw "Cotaska.exeのアイコンがCotaskaロゴと一致しません。"
}

Write-Host "`n[ステップ 5/5] 展開版のRenderer起動を確認しています..." -ForegroundColor Cyan
Invoke-CotaskaStartupSmokeTest -ExecutablePath $coreExecutablePath
Write-Host "  完了: Renderer読込と正常終了を確認しました" -ForegroundColor Green

$installerHash = (Get-FileHash -LiteralPath $installerPath -Algorithm SHA256).Hash.ToLowerInvariant()
$blockmapHash = (Get-FileHash -LiteralPath $blockmapPath -Algorithm SHA256).Hash.ToLowerInvariant()
$latestYamlHash = (Get-FileHash -LiteralPath $latestYamlPath -Algorithm SHA256).Hash.ToLowerInvariant()

Write-Host "  正常: $artifactBaseName" -ForegroundColor Green
Write-Host "  正常: $artifactBaseName.blockmap" -ForegroundColor Green
Write-Host "  正常: latest.yml" -ForegroundColor Green
Write-Host "  正常: Codex Windows実行ファイル" -ForegroundColor Green
Write-Host "  正常: Claude Windows実行ファイル" -ForegroundColor Green
Write-Host "  正常: Cotaska.exeの製品名とCotaskaロゴ" -ForegroundColor Green
Write-Host ""
Write-Host "NSISリリース成果物の生成と検証が完了しました。" -ForegroundColor Green
Write-Host "  EXE SHA-256      : $installerHash"
Write-Host "  blockmap SHA-256 : $blockmapHash"
Write-Host "  latest.yml SHA-256: $latestYamlHash"
Write-Host "  出力先: $releaseDir"
Write-Host ""
Write-Host "公開時は上記EXE、blockmap、latest.ymlを同じリリースへセットでアップロードしてください。" -ForegroundColor Yellow
