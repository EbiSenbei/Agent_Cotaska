# Cotaska release-all.ps1
# ステップ 1: npm run dist:dir (レンダラービルド + Electron パッケージング)
# ステップ 2: C# ランチャービルド (setup/launcher/build.ps1)
# ステップ 3: organize-release.ps1 (配布フォルダの再構成)
# ステップ 4: ランチャー EXE を配布ルートへコピー
# ステップ 5: 出荷前検証
# ステップ 6: Cotaska-Portable.zip 作成
# 追加: CotaskaCore.exe にアイコンと表示名メタデータを後書き
#
# 使い方:  cd 20_app  ;  .\release-all.ps1
#          .\release-all.ps1 -Version "0.2.0"

param(
    [string]$Version = "0.2.8"
)

$ErrorActionPreference = "Stop"

$scriptDir   = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot    = (Resolve-Path (Join-Path $scriptDir "..")).Path
$nodeDir     = Resolve-Path (Join-Path $scriptDir "..\..\v22.14.0")
$launcherDir = Join-Path $scriptDir "setup\launcher"
$updaterDir  = Join-Path $scriptDir "setup\updater"
$distRoot    = Join-Path $scriptDir "release\Cotaska-Portable"
$distZip     = Join-Path $scriptDir "release\Cotaska-Portable.zip"
$distZipSha256 = "$distZip.sha256"
$legacyDistRoot = Join-Path $scriptDir "release\Cotaska-dist"
$legacyDistZip = Join-Path $scriptDir "release\Cotaska-dist.zip"
$distCoreExe = Join-Path $distRoot "_app\CotaskaCore.exe"
$launcherIcon = Join-Path $launcherDir "icon.ico"
$sourceDataDir = Join-Path $scriptDir "..\data"
$distDataDir = Join-Path $distRoot "data"
$sourceToolsDir = Join-Path $scriptDir "scripts"
$distToolsDir = Join-Path $distRoot "tools"
$sourceUpdaterExe = Join-Path $sourceToolsDir "CotaskaUpdater.exe"
$sourceAiAgentRule = Join-Path $repoRoot "10_docs\20_実装準備\10_運用ルール\Cotaska_AIエージェント運用ルール.md"
$aiAgentRuleFileName = Split-Path -Leaf $sourceAiAgentRule
$distAiAgentRule = Join-Path $distRoot $aiAgentRuleFileName
$sourceReadme = Join-Path $repoRoot "README.md"
$distReadme = Join-Path $distRoot "README.md"
$npmCmd = Join-Path $nodeDir "npm.cmd"

$env:PATH = "$nodeDir;$env:PATH"

function Remove-PathWithRetry {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [int]$Retries = 5,
        [int]$DelayMilliseconds = 500
    )

    for ($i = 1; $i -le $Retries; $i++) {
        try {
            Remove-Item -LiteralPath $Path -Recurse -Force -ErrorAction Stop
            return
        } catch {
            if ($i -eq $Retries) {
                throw
            }
            Start-Sleep -Milliseconds $DelayMilliseconds
        }
    }
}

function Invoke-NpmChecked {
    param(
        [Parameter(Mandatory = $true)][string[]]$Arguments,
        [Parameter(Mandatory = $true)][string]$FailureMessage
    )

    & $npmCmd @Arguments
    if ($LASTEXITCODE -ne 0) {
        Write-Host $FailureMessage -ForegroundColor Red
        exit 1
    }
}

function Test-RequiredCommonJsDependency {
    param(
        [Parameter(Mandatory = $true)][string]$PackageName
    )

    $resolveScript = "require.resolve('$PackageName')"
    & node -e $resolveScript | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[失敗] 必須依存関係が見つかりません: $PackageName" -ForegroundColor Red
        exit 1
    }
}

function Test-RequiredEsmDependency {
    param(
        [Parameter(Mandatory = $true)][string]$PackageName
    )

    $importScript = "await import('$PackageName')"
    & node --input-type=module -e $importScript | Out-Null
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[失敗] 必須依存関係が見つかりません: $PackageName" -ForegroundColor Red
        exit 1
    }
}

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Cotaska リリース一括作成  v$Version" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

if (Test-Path -LiteralPath $legacyDistRoot) {
    Write-Host "旧ポータブルフォルダを削除しています: $legacyDistRoot" -ForegroundColor Yellow
    Remove-PathWithRetry -Path $legacyDistRoot
}
if (Test-Path -LiteralPath $legacyDistZip) {
    Write-Host "旧ポータブルZIPを削除しています: $legacyDistZip" -ForegroundColor Yellow
    Remove-Item -LiteralPath $legacyDistZip -Force
}

# -------------------------------------------------------
# ステップ 0.5: Node 依存関係の復元と検証
# -------------------------------------------------------
Write-Host "`n[ステップ 0.5] Node 依存関係を復元しています..." -ForegroundColor Cyan
Set-Location $scriptDir
if (-not (Test-Path -LiteralPath $npmCmd)) {
    Write-Host "[失敗] npm が見つかりません: $npmCmd" -ForegroundColor Red
    exit 1
}
Invoke-NpmChecked -Arguments @("ci", "--no-audit", "--no-fund") -FailureMessage "[失敗] npm ci"
Test-RequiredCommonJsDependency -PackageName "sql.js"
Test-RequiredEsmDependency -PackageName "@openai/codex-sdk"
Write-Host "  完了: Node 依存関係の復元と検証が完了しました" -ForegroundColor Green

# -------------------------------------------------------
# ステップ 1: レンダラービルド + Electron パッケージング
# -------------------------------------------------------
Write-Host "`n[ステップ 1] npm run dist:dir を実行しています..." -ForegroundColor Cyan
Set-Location $scriptDir
Invoke-NpmChecked -Arguments @("run", "dist:dir") -FailureMessage "[失敗] npm run dist:dir"
$winUnpackedCore = Join-Path $scriptDir "release\win-unpacked\CotaskaCore.exe"
if (-not (Test-Path $winUnpackedCore)) {
    Write-Host "[失敗] win-unpacked\CotaskaCore.exe が見つかりません" -ForegroundColor Red
    exit 1
}
Write-Host "  完了: Electron パッケージング完了" -ForegroundColor Green

# -------------------------------------------------------
# ステップ 2: C# ランチャービルド
# -------------------------------------------------------
Write-Host "`n[ステップ 2] C# ランチャーをビルドしています..." -ForegroundColor Cyan
$buildPs1 = Join-Path $launcherDir "build.ps1"
if (-not (Test-Path $buildPs1)) {
    Write-Host "  [警告] $buildPs1 が見つかりません。ランチャービルドをスキップします。" -ForegroundColor Yellow
} else {
    & powershell -ExecutionPolicy Bypass -File $buildPs1
    $launcherBuildExitCode = $LASTEXITCODE
    if ($launcherBuildExitCode -ne 0) {
        Write-Host "  [警告] ランチャービルドに失敗しました。既存ランチャーがあれば使用します。" -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    else {
        Write-Host "  完了: ランチャービルド完了" -ForegroundColor Green
    }
}

# -------------------------------------------------------
# ステップ 2.5: updater ビルド
# -------------------------------------------------------
Write-Host "`n[ステップ 2.5] アップデーターをビルドしています..." -ForegroundColor Cyan
$updaterBuildPs1 = Join-Path $updaterDir "build.ps1"
if (-not (Test-Path $updaterBuildPs1)) {
    Write-Host "  [警告] $updaterBuildPs1 が見つかりません。アップデータービルドをスキップします。" -ForegroundColor Yellow
} else {
    & powershell -ExecutionPolicy Bypass -File $updaterBuildPs1
    $updaterBuildExitCode = $LASTEXITCODE
    if ($updaterBuildExitCode -ne 0) {
        Write-Host "  [警告] アップデータービルドに失敗しました。PowerShell版アップデーターは引き続き利用できます。" -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    elseif (Test-Path -LiteralPath $sourceUpdaterExe) {
        Write-Host "  完了: アップデータービルド完了" -ForegroundColor Green
    }
    else {
        Write-Host "  [警告] アップデーターが生成されませんでした。PowerShell版アップデーターは引き続き利用できます。" -ForegroundColor Yellow
    }
}

# -------------------------------------------------------
# ステップ 3: 配布フォルダの再構成
# -------------------------------------------------------
Write-Host "`n[ステップ 3] リリースフォルダを整理しています..." -ForegroundColor Cyan
Set-Location $scriptDir
& ".\organize-release.ps1" -Version $Version
if ($LASTEXITCODE -ne 0) {
    Write-Host "[失敗] organize-release.ps1 の実行に失敗しました" -ForegroundColor Red
    exit 1
}
Write-Host "  完了: リリースフォルダ整理完了" -ForegroundColor Green

if (Test-Path $sourceDataDir) {
    Write-Host "  data/ を配布ルートへ同期しています..." -ForegroundColor Cyan
    if (Test-Path $distDataDir) {
        Remove-Item $distDataDir -Recurse -Force
    }
    Copy-Item $sourceDataDir -Destination $distDataDir -Recurse -Force
    Write-Host "  完了: data/ 同期完了" -ForegroundColor Green
}
else {
    Write-Host "  [警告] 元の data フォルダが見つかりません: $sourceDataDir" -ForegroundColor Yellow
}

Write-Host "  tools/ を配布ルートへ同期しています..." -ForegroundColor Cyan
if (Test-Path $distToolsDir) {
    Remove-Item $distToolsDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distToolsDir | Out-Null
$toolScripts = Get-ChildItem -LiteralPath $sourceToolsDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".ps1", ".cmd", ".bat") -or $_.Name -eq "CotaskaUpdater.exe" }
if ($toolScripts.Count -gt 0) {
    $toolScripts | Copy-Item -Destination $distToolsDir -Force
    Write-Host "  完了: tools/ 同期完了（$($toolScripts.Count) 件）" -ForegroundColor Green
}
else {
    Write-Host "  [警告] ツールスクリプトが見つかりません: $sourceToolsDir" -ForegroundColor Yellow
}

# -------------------------------------------------------
# ステップ 4: ランチャー EXE を配布ルートへコピー
# -------------------------------------------------------
Write-Host "`n[ステップ 4] ランチャーを配布ルートへコピーしています..." -ForegroundColor Cyan
$launcherExe  = Join-Path $launcherDir "Cotaska.exe"
$distLauncher = Join-Path $distRoot    "Cotaska.exe"
if (Test-Path $launcherExe) {
    Copy-Item $launcherExe -Destination $distLauncher -Force
    $sizeKB = [math]::Round((Get-Item $distLauncher).Length / 1KB, 1)
    Write-Host "  完了: ランチャーをコピーしました -> $distLauncher ($sizeKB KB)" -ForegroundColor Green
} else {
    Write-Host "  [警告] $launcherExe が見つかりません。既存ランチャーを使用します。" -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $sourceAiAgentRule)) {
    Write-Host "  [失敗] AIエージェント運用ルールが見つかりません: $sourceAiAgentRule" -ForegroundColor Red
    exit 1
}
Copy-Item -LiteralPath $sourceAiAgentRule -Destination $distAiAgentRule -Force
Write-Host "  完了: AIエージェント運用ルールをコピーしました -> $distAiAgentRule" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $sourceReadme)) {
    Write-Host "  [失敗] README が見つかりません: $sourceReadme" -ForegroundColor Red
    exit 1
}
Copy-Item -LiteralPath $sourceReadme -Destination $distReadme -Force
Write-Host "  完了: README をコピーしました -> $distReadme" -ForegroundColor Green

if ((Test-Path $distCoreExe) -and (Test-Path $launcherIcon)) {
    Write-Host "  CotaskaCore.exe のアイコンとメタデータを更新しています..." -ForegroundColor Cyan
    $setIconPs1 = Join-Path $launcherDir "Set-ExeIcon.ps1"
    & powershell -ExecutionPolicy Bypass -File $setIconPs1 -ExePath $distCoreExe -IconPath $launcherIcon -Version $Version
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[失敗] CotaskaCore.exe のアイコン/メタデータ更新に失敗しました" -ForegroundColor Red
        exit 1
    }
    Write-Host "  完了: CotaskaCore.exe のアイコンとメタデータを更新しました" -ForegroundColor Green
}

if ((Test-Path $distLauncher) -and (Test-Path $launcherIcon)) {
    Write-Host "  Cotaska.exe のアイコンとメタデータを更新しています..." -ForegroundColor Cyan
    $setIconPs1 = Join-Path $launcherDir "Set-ExeIcon.ps1"
    & powershell -ExecutionPolicy Bypass -File $setIconPs1 `
        -ExePath $distLauncher `
        -IconPath $launcherIcon `
        -FileDescription "Cotaska Launcher" `
        -ProductName "Cotaska" `
        -OriginalFilename "Cotaska.exe" `
        -InternalFilename "Cotaska" `
        -Version $Version
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[失敗] Cotaska.exe のアイコン/メタデータ更新に失敗しました" -ForegroundColor Red
        exit 1
    }
    Write-Host "  完了: Cotaska.exe のアイコンとメタデータを更新しました" -ForegroundColor Green
}

function Get-AssociatedIconHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    Add-Type -AssemblyName System.Drawing
    $icon = [System.Drawing.Icon]::ExtractAssociatedIcon((Resolve-Path $Path).Path)
    $bitmap = $icon.ToBitmap()
    $stream = New-Object System.IO.MemoryStream
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return [System.BitConverter]::ToString(
            [System.Security.Cryptography.SHA256]::Create().ComputeHash($stream.ToArray())
        ).Replace("-", "")
    }
    finally {
        $stream.Dispose()
        $bitmap.Dispose()
        $icon.Dispose()
    }
}

function Get-IcoHash {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    Add-Type -AssemblyName System.Drawing
    $icon = New-Object System.Drawing.Icon((Resolve-Path $Path).Path)
    $bitmap = $icon.ToBitmap()
    $stream = New-Object System.IO.MemoryStream
    try {
        $bitmap.Save($stream, [System.Drawing.Imaging.ImageFormat]::Png)
        return [System.BitConverter]::ToString(
            [System.Security.Cryptography.SHA256]::Create().ComputeHash($stream.ToArray())
        ).Replace("-", "")
    }
    finally {
        $stream.Dispose()
        $bitmap.Dispose()
        $icon.Dispose()
    }
}

function Test-ExeVersionInfo {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$ExpectedProductName,
        [Parameter(Mandatory = $true)][string]$ExpectedFileDescription,
        [Parameter(Mandatory = $true)][string]$ExpectedOriginalFilename
    )

    $versionInfo = (Get-Item -LiteralPath $Path).VersionInfo
    return (
        $versionInfo.ProductName -eq $ExpectedProductName -and
        $versionInfo.FileDescription -eq $ExpectedFileDescription -and
        $versionInfo.OriginalFilename -eq $ExpectedOriginalFilename
    )
}

function Restore-CoreExeIfMissing {
    if ((-not (Test-Path -LiteralPath $distCoreExe)) -and (Test-Path -LiteralPath $winUnpackedCore)) {
        Write-Host "  CotaskaCore.exe を配布用 _app へ復元しています..." -ForegroundColor Yellow
        Copy-Item -LiteralPath $winUnpackedCore -Destination $distCoreExe -Force
        if (Test-Path $launcherIcon) {
            $setIconPs1 = Join-Path $launcherDir "Set-ExeIcon.ps1"
            & powershell -ExecutionPolicy Bypass -File $setIconPs1 -ExePath $distCoreExe -IconPath $launcherIcon -Version $Version
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[失敗] 復元した CotaskaCore.exe のメタデータ更新に失敗しました" -ForegroundColor Red
                exit 1
            }
        }
    }
}

# -------------------------------------------------------
# ステップ 5: 出荷前検証
# -------------------------------------------------------
Write-Host "`n[ステップ 5] 出荷前検証を実行しています..." -ForegroundColor Cyan

$checks = @(
    @{ Path = $distRoot;                                       Label = "配布ルート" },
    @{ Path = (Join-Path $distRoot "Cotaska.exe");             Label = "Cotaska.exe（ランチャー）" },
    @{ Path = (Join-Path $distRoot "_app");                    Label = "_app/" },
    @{ Path = (Join-Path $distRoot "_app\resources\app.asar"); Label = "_app/resources/app.asar" },
    @{ Path = (Join-Path $distRoot "data");                    Label = "data/" },
    @{ Path = (Join-Path $distRoot "data\tasks");              Label = "data/tasks/" },
    @{ Path = (Join-Path $distRoot "tools\validate-tasks.ps1"); Label = "tools/validate-tasks.ps1" },
    @{ Path = (Join-Path $distRoot "tools\remove-progress-field.cmd"); Label = "tools/remove-progress-field.cmd" },
    @{ Path = (Join-Path $distRoot $aiAgentRuleFileName);       Label = $aiAgentRuleFileName },
    @{ Path = (Join-Path $distRoot "README.md");                Label = "README.md" },
    @{ Path = (Join-Path $distRoot "logs");                    Label = "logs/" }
)

$allOk = $true
foreach ($c in $checks) {
    if (Test-Path $c.Path) {
        Write-Host ("  正常  " + $c.Label) -ForegroundColor Green
    } else {
        Write-Host ("  異常  " + $c.Label) -ForegroundColor Red
        $allOk = $false
    }
}

if ((Test-Path $launcherIcon) -and (Test-Path (Join-Path $distRoot "Cotaska.exe")) -and (Test-Path $distCoreExe)) {
    $expectedIconHash = Get-IcoHash -Path $launcherIcon
    $launcherIconHash = Get-AssociatedIconHash -Path (Join-Path $distRoot "Cotaska.exe")
    $coreIconHash = Get-AssociatedIconHash -Path $distCoreExe

    if ($launcherIconHash -eq $expectedIconHash) {
        Write-Host "  正常  Cotaska.exe のアイコン" -ForegroundColor Green
    } else {
        Write-Host "  異常  Cotaska.exe のアイコン" -ForegroundColor Red
        $allOk = $false
    }

    if ($coreIconHash -eq $expectedIconHash) {
        Write-Host "  正常  CotaskaCore.exe のアイコン" -ForegroundColor Green
    } else {
        Write-Host "  異常  CotaskaCore.exe のアイコン" -ForegroundColor Red
        $allOk = $false
    }

    $distLauncher = Join-Path $distRoot "Cotaska.exe"
    if (Test-ExeVersionInfo -Path $distLauncher -ExpectedProductName "Cotaska" -ExpectedFileDescription "Cotaska Launcher" -ExpectedOriginalFilename "Cotaska.exe") {
        Write-Host "  正常  Cotaska.exe のメタデータ" -ForegroundColor Green
    } else {
        $launcherVersionInfo = (Get-Item -LiteralPath $distLauncher).VersionInfo
        Write-Host "  異常  Cotaska.exe のメタデータ" -ForegroundColor Red
        Write-Host "      ファイル説明=$($launcherVersionInfo.FileDescription)" -ForegroundColor Red
        Write-Host "      製品名=$($launcherVersionInfo.ProductName)" -ForegroundColor Red
        Write-Host "      元のファイル名=$($launcherVersionInfo.OriginalFilename)" -ForegroundColor Red
        Write-Host "      内部名=$($launcherVersionInfo.InternalName)" -ForegroundColor Red
        $allOk = $false
    }

    if (Test-ExeVersionInfo -Path $distCoreExe -ExpectedProductName "CotaskaCore" -ExpectedFileDescription "CotaskaCore" -ExpectedOriginalFilename "CotaskaCore.exe") {
        Write-Host "  正常  CotaskaCore.exe のメタデータ" -ForegroundColor Green
    } else {
        $coreVersionInfo = (Get-Item -LiteralPath $distCoreExe).VersionInfo
        Write-Host "  異常  CotaskaCore.exe のメタデータ" -ForegroundColor Red
        Write-Host "      ファイル説明=$($coreVersionInfo.FileDescription)" -ForegroundColor Red
        Write-Host "      製品名=$($coreVersionInfo.ProductName)" -ForegroundColor Red
        Write-Host "      元のファイル名=$($coreVersionInfo.OriginalFilename)" -ForegroundColor Red
        Write-Host "      内部名=$($coreVersionInfo.InternalName)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    # -------------------------------------------------------
    # ステップ 6: GitHub Releases 添付用 zip 作成
    # -------------------------------------------------------
    Write-Host "`n[ステップ 6] リリースZIPを作成しています..." -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $distRoot)) {
        Write-Host "[失敗] 配布フォルダが見つかりません: $distRoot" -ForegroundColor Red
        exit 1
    }
    if (Test-Path -LiteralPath $distZip) {
        Remove-Item -LiteralPath $distZip -Force
    }
    if (Test-Path -LiteralPath $distZipSha256) {
        Remove-Item -LiteralPath $distZipSha256 -Force
    }
    Restore-CoreExeIfMissing
    if (-not (Test-Path -LiteralPath $distCoreExe)) {
        Write-Host "[失敗] ZIP作成前の配布フォルダに CotaskaCore.exe がありません" -ForegroundColor Red
        exit 1
    }
    $distName = Split-Path -Leaf $distRoot
    $zipStagingRoot = Join-Path $env:TEMP "cotaska-release-zip"
    $zipStagingDist = Join-Path $zipStagingRoot $distName
    if (Test-Path -LiteralPath $zipStagingRoot) {
        Remove-PathWithRetry -Path $zipStagingRoot
    }
    New-Item -ItemType Directory -Path $zipStagingRoot -Force | Out-Null
    Copy-Item -LiteralPath $distRoot -Destination $zipStagingRoot -Recurse -Force
    if (-not (Test-Path -LiteralPath (Join-Path $zipStagingDist "_app\CotaskaCore.exe"))) {
        Write-Host "[失敗] ZIP作成用一時フォルダに CotaskaCore.exe がありません" -ForegroundColor Red
        exit 1
    }
    Push-Location $zipStagingRoot
    try {
        tar.exe -a -cf $distZip $distName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[失敗] リリースZIPの作成に失敗しました" -ForegroundColor Red
            exit 1
        }
    }
    finally {
        Pop-Location
        Remove-PathWithRetry -Path $zipStagingRoot
    }
    if (-not (Test-Path -LiteralPath $distZip)) {
        Write-Host "[失敗] リリースZIPが作成されていません: $distZip" -ForegroundColor Red
        exit 1
    }
    $zipListing = tar.exe -tf $distZip
    $requiredZipEntries = @(
        "Cotaska-Portable/Cotaska.exe",
        "Cotaska-Portable/_app/CotaskaCore.exe",
        "Cotaska-Portable/_app/resources/app.asar"
    )
    foreach ($entry in $requiredZipEntries) {
        if ($zipListing -notcontains $entry) {
            Write-Host "[失敗] リリースZIPに必須ファイルが含まれていません: $entry" -ForegroundColor Red
            exit 1
        }
    }
    Restore-CoreExeIfMissing
    if (-not (Test-Path -LiteralPath $distCoreExe)) {
        Write-Host "[失敗] ZIP作成後の配布フォルダに CotaskaCore.exe がありません" -ForegroundColor Red
        exit 1
    }
    $zipSizeMB = [math]::Round((Get-Item -LiteralPath $distZip).Length / 1MB, 1)
    Write-Host "  完了: リリースZIPを作成しました -> $distZip ($zipSizeMB MB)" -ForegroundColor Green
    $zipHash = (Get-FileHash -LiteralPath $distZip -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $distZipSha256 -Value "$zipHash  Cotaska-Portable.zip" -Encoding ASCII
    Write-Host "  完了: リリースZIPのSHA-256を作成しました -> $distZipSha256" -ForegroundColor Green

    Write-Host "=======================================" -ForegroundColor Green
    Write-Host " リリース v$Version が完了しました" -ForegroundColor Green
    Write-Host "=======================================" -ForegroundColor Green
    Write-Host "  配布フォルダ: $distRoot" -ForegroundColor Cyan
    Write-Host "  ZIP        : $distZip" -ForegroundColor Cyan
    Write-Host "  次の作業   : $distRoot\Cotaska.exe を起動して確認してください。" -ForegroundColor Cyan
} else {
    Write-Host "=======================================" -ForegroundColor Red
    Write-Host " リリース v$Version は未完了です" -ForegroundColor Red
    Write-Host "=======================================" -ForegroundColor Red
    exit 1
}
