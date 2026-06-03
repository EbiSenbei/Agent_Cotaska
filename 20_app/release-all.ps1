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
    [string]$Version = "0.2.7"
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

Write-Host ""
Write-Host "=======================================" -ForegroundColor Green
Write-Host " Cotaska Release All  v$Version" -ForegroundColor Green
Write-Host "=======================================" -ForegroundColor Green

if (Test-Path -LiteralPath $legacyDistRoot) {
    Write-Host "Removing legacy portable folder: $legacyDistRoot" -ForegroundColor Yellow
    Remove-PathWithRetry -Path $legacyDistRoot
}
if (Test-Path -LiteralPath $legacyDistZip) {
    Write-Host "Removing legacy portable zip: $legacyDistZip" -ForegroundColor Yellow
    Remove-Item -LiteralPath $legacyDistZip -Force
}

# -------------------------------------------------------
# ステップ 1: レンダラービルド + Electron パッケージング
# -------------------------------------------------------
Write-Host "`n[Step 1] npm run dist:dir ..." -ForegroundColor Cyan
Set-Location $scriptDir
npm run dist:dir
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] npm run dist:dir" -ForegroundColor Red
    exit 1
}
$winUnpackedCore = Join-Path $scriptDir "release\win-unpacked\CotaskaCore.exe"
if (-not (Test-Path $winUnpackedCore)) {
    Write-Host "[FAILED] win-unpacked\CotaskaCore.exe not found" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: Electron パッケージング完了" -ForegroundColor Green

# -------------------------------------------------------
# ステップ 2: C# ランチャービルド
# -------------------------------------------------------
Write-Host "`n[Step 2] Building C# launcher ..." -ForegroundColor Cyan
$buildPs1 = Join-Path $launcherDir "build.ps1"
if (-not (Test-Path $buildPs1)) {
    Write-Host "  [WARN] $buildPs1 not found. Skipping launcher build." -ForegroundColor Yellow
} else {
    & powershell -ExecutionPolicy Bypass -File $buildPs1
    $launcherBuildExitCode = $LASTEXITCODE
    if ($launcherBuildExitCode -ne 0) {
        Write-Host "  [WARN] Launcher build failed. Using existing launcher if available." -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    else {
        Write-Host "  OK: ランチャービルド完了" -ForegroundColor Green
    }
}

# -------------------------------------------------------
# ステップ 2.5: updater ビルド
# -------------------------------------------------------
Write-Host "`n[Step 2.5] Building updater ..." -ForegroundColor Cyan
$updaterBuildPs1 = Join-Path $updaterDir "build.ps1"
if (-not (Test-Path $updaterBuildPs1)) {
    Write-Host "  [WARN] $updaterBuildPs1 not found. Skipping updater build." -ForegroundColor Yellow
} else {
    & powershell -ExecutionPolicy Bypass -File $updaterBuildPs1
    $updaterBuildExitCode = $LASTEXITCODE
    if ($updaterBuildExitCode -ne 0) {
        Write-Host "  [WARN] Updater build failed. PowerShell updater fallback remains available." -ForegroundColor Yellow
        $global:LASTEXITCODE = 0
    }
    elseif (Test-Path -LiteralPath $sourceUpdaterExe) {
        Write-Host "  OK: updater build complete" -ForegroundColor Green
    }
    else {
        Write-Host "  [WARN] Updater was not built. PowerShell updater fallback remains available." -ForegroundColor Yellow
    }
}

# -------------------------------------------------------
# ステップ 3: 配布フォルダの再構成
# -------------------------------------------------------
Write-Host "`n[Step 3] Organizing release folder ..." -ForegroundColor Cyan
Set-Location $scriptDir
& ".\organize-release.ps1" -Version $Version
if ($LASTEXITCODE -ne 0) {
    Write-Host "[FAILED] organize-release.ps1 failed" -ForegroundColor Red
    exit 1
}
Write-Host "  OK: リリースフォルダ整理完了" -ForegroundColor Green

if (Test-Path $sourceDataDir) {
    Write-Host "  Syncing data/ to dist root ..." -ForegroundColor Cyan
    if (Test-Path $distDataDir) {
        Remove-Item $distDataDir -Recurse -Force
    }
    Copy-Item $sourceDataDir -Destination $distDataDir -Recurse -Force
    Write-Host "  OK: data/ synced" -ForegroundColor Green
}
else {
    Write-Host "  [WARN] Source data folder not found: $sourceDataDir" -ForegroundColor Yellow
}

Write-Host "  Syncing tools/ to dist root ..." -ForegroundColor Cyan
if (Test-Path $distToolsDir) {
    Remove-Item $distToolsDir -Recurse -Force
}
New-Item -ItemType Directory -Path $distToolsDir | Out-Null
$toolScripts = Get-ChildItem -LiteralPath $sourceToolsDir -File -ErrorAction SilentlyContinue |
    Where-Object { $_.Extension -in @(".ps1", ".cmd", ".bat") -or $_.Name -eq "CotaskaUpdater.exe" }
if ($toolScripts.Count -gt 0) {
    $toolScripts | Copy-Item -Destination $distToolsDir -Force
    Write-Host "  OK: tools/ synced ($($toolScripts.Count) script(s))" -ForegroundColor Green
}
else {
    Write-Host "  [WARN] No tool scripts found: $sourceToolsDir" -ForegroundColor Yellow
}

# -------------------------------------------------------
# ステップ 4: ランチャー EXE を配布ルートへコピー
# -------------------------------------------------------
Write-Host "`n[Step 4] Copying launcher to dist root ..." -ForegroundColor Cyan
$launcherExe  = Join-Path $launcherDir "Cotaska.exe"
$distLauncher = Join-Path $distRoot    "Cotaska.exe"
if (Test-Path $launcherExe) {
    Copy-Item $launcherExe -Destination $distLauncher -Force
    $sizeKB = [math]::Round((Get-Item $distLauncher).Length / 1KB, 1)
    Write-Host "  OK: Launcher copied -> $distLauncher ($sizeKB KB)" -ForegroundColor Green
} else {
    Write-Host "  [WARN] $launcherExe not found. Using existing launcher." -ForegroundColor Yellow
}

if (-not (Test-Path -LiteralPath $sourceAiAgentRule)) {
    Write-Host "  [FAILED] AI agent rule not found: $sourceAiAgentRule" -ForegroundColor Red
    exit 1
}
Copy-Item -LiteralPath $sourceAiAgentRule -Destination $distAiAgentRule -Force
Write-Host "  OK: AI agent rule copied -> $distAiAgentRule" -ForegroundColor Green

if (-not (Test-Path -LiteralPath $sourceReadme)) {
    Write-Host "  [FAILED] README not found: $sourceReadme" -ForegroundColor Red
    exit 1
}
Copy-Item -LiteralPath $sourceReadme -Destination $distReadme -Force
Write-Host "  OK: README copied -> $distReadme" -ForegroundColor Green

if ((Test-Path $distCoreExe) -and (Test-Path $launcherIcon)) {
    Write-Host "  Updating CotaskaCore.exe icon and metadata ..." -ForegroundColor Cyan
    $setIconPs1 = Join-Path $launcherDir "Set-ExeIcon.ps1"
    & powershell -ExecutionPolicy Bypass -File $setIconPs1 -ExePath $distCoreExe -IconPath $launcherIcon -Version $Version
    if ($LASTEXITCODE -ne 0) {
        Write-Host "[FAILED] CotaskaCore.exe icon/metadata update failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: CotaskaCore.exe icon and metadata updated" -ForegroundColor Green
}

if ((Test-Path $distLauncher) -and (Test-Path $launcherIcon)) {
    Write-Host "  Updating Cotaska.exe icon and metadata ..." -ForegroundColor Cyan
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
        Write-Host "[FAILED] Cotaska.exe icon/metadata update failed" -ForegroundColor Red
        exit 1
    }
    Write-Host "  OK: Cotaska.exe icon and metadata updated" -ForegroundColor Green
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
        Write-Host "  Restoring CotaskaCore.exe to dist _app ..." -ForegroundColor Yellow
        Copy-Item -LiteralPath $winUnpackedCore -Destination $distCoreExe -Force
        if (Test-Path $launcherIcon) {
            $setIconPs1 = Join-Path $launcherDir "Set-ExeIcon.ps1"
            & powershell -ExecutionPolicy Bypass -File $setIconPs1 -ExePath $distCoreExe -IconPath $launcherIcon -Version $Version
            if ($LASTEXITCODE -ne 0) {
                Write-Host "[FAILED] Restored CotaskaCore.exe metadata update failed" -ForegroundColor Red
                exit 1
            }
        }
    }
}

# -------------------------------------------------------
# ステップ 5: 出荷前検証
# -------------------------------------------------------
Write-Host "`n[Step 5] Pre-ship verification ..." -ForegroundColor Cyan

$checks = @(
    @{ Path = $distRoot;                                       Label = "dist root" },
    @{ Path = (Join-Path $distRoot "Cotaska.exe");             Label = "Cotaska.exe (launcher)" },
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
        Write-Host ("  OK  " + $c.Label) -ForegroundColor Green
    } else {
        Write-Host ("  NG  " + $c.Label) -ForegroundColor Red
        $allOk = $false
    }
}

if ((Test-Path $launcherIcon) -and (Test-Path (Join-Path $distRoot "Cotaska.exe")) -and (Test-Path $distCoreExe)) {
    $expectedIconHash = Get-IcoHash -Path $launcherIcon
    $launcherIconHash = Get-AssociatedIconHash -Path (Join-Path $distRoot "Cotaska.exe")
    $coreIconHash = Get-AssociatedIconHash -Path $distCoreExe

    if ($launcherIconHash -eq $expectedIconHash) {
        Write-Host "  OK  Cotaska.exe icon" -ForegroundColor Green
    } else {
        Write-Host "  NG  Cotaska.exe icon" -ForegroundColor Red
        $allOk = $false
    }

    if ($coreIconHash -eq $expectedIconHash) {
        Write-Host "  OK  CotaskaCore.exe icon" -ForegroundColor Green
    } else {
        Write-Host "  NG  CotaskaCore.exe icon" -ForegroundColor Red
        $allOk = $false
    }

    $distLauncher = Join-Path $distRoot "Cotaska.exe"
    if (Test-ExeVersionInfo -Path $distLauncher -ExpectedProductName "Cotaska" -ExpectedFileDescription "Cotaska Launcher" -ExpectedOriginalFilename "Cotaska.exe") {
        Write-Host "  OK  Cotaska.exe metadata" -ForegroundColor Green
    } else {
        $launcherVersionInfo = (Get-Item -LiteralPath $distLauncher).VersionInfo
        Write-Host "  NG  Cotaska.exe metadata" -ForegroundColor Red
        Write-Host "      FileDescription=$($launcherVersionInfo.FileDescription)" -ForegroundColor Red
        Write-Host "      ProductName=$($launcherVersionInfo.ProductName)" -ForegroundColor Red
        Write-Host "      OriginalFilename=$($launcherVersionInfo.OriginalFilename)" -ForegroundColor Red
        Write-Host "      InternalName=$($launcherVersionInfo.InternalName)" -ForegroundColor Red
        $allOk = $false
    }

    if (Test-ExeVersionInfo -Path $distCoreExe -ExpectedProductName "CotaskaCore" -ExpectedFileDescription "CotaskaCore" -ExpectedOriginalFilename "CotaskaCore.exe") {
        Write-Host "  OK  CotaskaCore.exe metadata" -ForegroundColor Green
    } else {
        $coreVersionInfo = (Get-Item -LiteralPath $distCoreExe).VersionInfo
        Write-Host "  NG  CotaskaCore.exe metadata" -ForegroundColor Red
        Write-Host "      FileDescription=$($coreVersionInfo.FileDescription)" -ForegroundColor Red
        Write-Host "      ProductName=$($coreVersionInfo.ProductName)" -ForegroundColor Red
        Write-Host "      OriginalFilename=$($coreVersionInfo.OriginalFilename)" -ForegroundColor Red
        Write-Host "      InternalName=$($coreVersionInfo.InternalName)" -ForegroundColor Red
        $allOk = $false
    }
}

Write-Host ""
if ($allOk) {
    # -------------------------------------------------------
    # ステップ 6: GitHub Releases 添付用 zip 作成
    # -------------------------------------------------------
    Write-Host "`n[Step 6] Creating release zip ..." -ForegroundColor Cyan
    if (-not (Test-Path -LiteralPath $distRoot)) {
        Write-Host "[FAILED] Dist folder not found: $distRoot" -ForegroundColor Red
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
        Write-Host "[FAILED] CotaskaCore.exe missing before zip creation" -ForegroundColor Red
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
        Write-Host "[FAILED] CotaskaCore.exe missing from zip staging folder" -ForegroundColor Red
        exit 1
    }
    Push-Location $zipStagingRoot
    try {
        tar.exe -a -cf $distZip $distName
        if ($LASTEXITCODE -ne 0) {
            Write-Host "[FAILED] Release zip creation failed" -ForegroundColor Red
            exit 1
        }
    }
    finally {
        Pop-Location
        Remove-PathWithRetry -Path $zipStagingRoot
    }
    if (-not (Test-Path -LiteralPath $distZip)) {
        Write-Host "[FAILED] Release zip was not created: $distZip" -ForegroundColor Red
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
            Write-Host "[FAILED] Release zip missing required entry: $entry" -ForegroundColor Red
            exit 1
        }
    }
    Restore-CoreExeIfMissing
    if (-not (Test-Path -LiteralPath $distCoreExe)) {
        Write-Host "[FAILED] CotaskaCore.exe missing from dist after zip creation" -ForegroundColor Red
        exit 1
    }
    $zipSizeMB = [math]::Round((Get-Item -LiteralPath $distZip).Length / 1MB, 1)
    Write-Host "  OK: Release zip created -> $distZip ($zipSizeMB MB)" -ForegroundColor Green
    $zipHash = (Get-FileHash -LiteralPath $distZip -Algorithm SHA256).Hash.ToLowerInvariant()
    Set-Content -LiteralPath $distZipSha256 -Value "$zipHash  Cotaska-Portable.zip" -Encoding ASCII
    Write-Host "  OK: Release zip SHA-256 created -> $distZipSha256" -ForegroundColor Green

    Write-Host "=======================================" -ForegroundColor Green
    Write-Host " Release v$Version Complete!" -ForegroundColor Green
    Write-Host "=======================================" -ForegroundColor Green
    Write-Host "  Dist: $distRoot" -ForegroundColor Cyan
    Write-Host "  Zip : $distZip" -ForegroundColor Cyan
    Write-Host "  Next: Launch $distRoot\Cotaska.exe and verify." -ForegroundColor Cyan
} else {
    Write-Host "=======================================" -ForegroundColor Red
    Write-Host " Release v$Version INCOMPLETE" -ForegroundColor Red
    Write-Host "=======================================" -ForegroundColor Red
    exit 1
}
