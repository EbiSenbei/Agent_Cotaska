# sync-task-master-release.ps1
# release\Cotaska-Portable に作成された最新リリース成果物を、
# 00_mgmt 配下のタスクマスター用配布フォルダへ反映する同期スクリプト。
# 既存の配布フォルダはタイムスタンプ付きでバックアップしてから置き換える。
# 目的:
# 1) タスクマスター配布フォルダをタイムスタンプ付きでバックアップ
# 2) バックアップを zip 化し、元の退避フォルダを削除
# 3) 最新リリース出力から Cotaska.exe を差し替え
# 4) 最新リリース出力から _app フォルダを差し替え
#
# 使い方:
#   cd 20_app
#   .\sync-task-master-release.ps1

param(
    [bool]$StopRunningCotaska = $true,
    [ValidateRange(1, 100)][int]$BackupRetentionCount = 3
)

$ErrorActionPreference = "Stop"

# app.asar のロック元プロセスを調べるため、Windows Restart Manager API を
# PowerShell から呼び出せる .NET 型として一度だけ登録する。
function Ensure-RestartManagerTypes {
    if ("Cotaska.RestartManager" -as [type]) {
        return
    }

    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace Cotaska {
    public static class RestartManager {
        public const int CCH_RM_MAX_APP_NAME = 255;
        public const int CCH_RM_MAX_SVC_NAME = 63;

        [StructLayout(LayoutKind.Sequential)]
        public struct RM_UNIQUE_PROCESS {
            public int dwProcessId;
            public System.Runtime.InteropServices.ComTypes.FILETIME ProcessStartTime;
        }

        public enum RM_APP_TYPE {
            RmUnknownApp = 0,
            RmMainWindow = 1,
            RmOtherWindow = 2,
            RmService = 3,
            RmExplorer = 4,
            RmConsole = 5,
            RmCritical = 1000
        }

        [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
        public struct RM_PROCESS_INFO {
            public RM_UNIQUE_PROCESS Process;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_APP_NAME + 1)]
            public string strAppName;
            [MarshalAs(UnmanagedType.ByValTStr, SizeConst = CCH_RM_MAX_SVC_NAME + 1)]
            public string strServiceShortName;
            public RM_APP_TYPE ApplicationType;
            public uint AppStatus;
            public uint TSSessionId;
            [MarshalAs(UnmanagedType.Bool)]
            public bool bRestartable;
        }

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmStartSession(out uint pSessionHandle, int dwSessionFlags, string strSessionKey);

        [DllImport("rstrtmgr.dll")]
        public static extern int RmEndSession(uint pSessionHandle);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmRegisterResources(uint pSessionHandle, uint nFiles, string[] rgsFilenames, uint nApplications, RM_UNIQUE_PROCESS[] rgApplications, uint nServices, string[] rgsServiceNames);

        [DllImport("rstrtmgr.dll", CharSet = CharSet.Unicode)]
        public static extern int RmGetList(uint dwSessionHandle, out uint pnProcInfoNeeded, ref uint pnProcInfo, [In, Out] RM_PROCESS_INFO[] rgAffectedApps, ref uint lpdwRebootReasons);
    }
}
"@
}

function Get-LockingProcesses {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    Ensure-RestartManagerTypes

    # Restart Manager の一時セッションに対象ファイルを登録し、
    # そのファイルを開いているプロセス一覧を取得する。
    $sessionKey = [Guid]::NewGuid().ToString()
    $handle = 0
    $startResult = [Cotaska.RestartManager]::RmStartSession([ref]$handle, 0, $sessionKey)
    if ($startResult -ne 0) {
        return @()
    }

    try {
        $registerResult = [Cotaska.RestartManager]::RmRegisterResources($handle, 1, @($Path), 0, $null, 0, $null)
        if ($registerResult -ne 0) {
            return @()
        }

        $needed = 0
        $count = 0
        $rebootReasons = 0
        $result = [Cotaska.RestartManager]::RmGetList($handle, [ref]$needed, [ref]$count, $null, [ref]$rebootReasons)
        if ($result -ne 234) {
            return @()
        }

        $infos = New-Object Cotaska.RestartManager+RM_PROCESS_INFO[] $needed
        $count = $needed
        $result = [Cotaska.RestartManager]::RmGetList($handle, [ref]$needed, [ref]$count, $infos, [ref]$rebootReasons)
        if ($result -ne 0) {
            return @()
        }

        return $infos | ForEach-Object {
            [pscustomobject]@{
                ProcessId = $_.Process.dwProcessId
                AppName = $_.strAppName
                AppType = $_.ApplicationType.ToString()
            }
        }
    }
    finally {
        [Cotaska.RestartManager]::RmEndSession($handle) | Out-Null
    }
}

function Remove-DirectoryTree {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return
    }

    $fullPath = [System.IO.Path]::GetFullPath((Resolve-Path -LiteralPath $Path).Path)
    $extendedPath = if ($fullPath.StartsWith("\\?\")) { $fullPath } else { "\\?\$fullPath" }
    & cmd.exe /c rmdir /s /q $extendedPath
    $exitCode = $LASTEXITCODE
    $global:LASTEXITCODE = 0

    if ($exitCode -ne 0 -and (Test-Path -LiteralPath $Path)) {
        throw "フォルダを削除できませんでした: $Path"
    }
}

function Remove-PathWithLockHint {
    param(
        [Parameter(Mandatory = $true)][string]$Path
    )

    # _app フォルダ削除時に app.asar が掴まれていることがあるため、
    # 短いリトライ後も失敗する場合はロック元プロセスを表示して終了する。
    for ($try = 1; $try -le 3; $try++) {
        try {
            Remove-DirectoryTree -Path $Path
            return
        }
        catch {
            if ($try -lt 3) {
                Start-Sleep -Milliseconds 700
                continue
            }

            $lockedFile = Join-Path $Path "resources\app.asar"
            $lockers = @()
            if (Test-Path -LiteralPath $lockedFile) {
                $lockers = Get-LockingProcesses -Path $lockedFile
            }

            if ($lockers.Count -gt 0) {
                Write-Host "[ロック] app.asar はまだ使用中です:" -ForegroundColor Yellow
                $lockers | Format-Table -AutoSize | Out-String | Write-Host
                throw "_app を置き換えられませんでした。app.asar が使用中です。表示されたプロセスを閉じてから再実行してください。"
            }

            throw
        }
    }
}

function Compress-BackupAndRemoveFolder {
    param(
        [Parameter(Mandatory = $true)][string]$BackupRoot,
        [Parameter(Mandatory = $true)][string]$BackupDir
    )

    $resolvedBackupRoot = (Resolve-Path -LiteralPath $BackupRoot).Path
    $resolvedBackupDir = (Resolve-Path -LiteralPath $BackupDir).Path
    $backupRootFullPath = [System.IO.Path]::GetFullPath($resolvedBackupRoot)
    $backupDirFullPath = [System.IO.Path]::GetFullPath($resolvedBackupDir)

    if (-not $backupRootFullPath.StartsWith($backupDirFullPath + [System.IO.Path]::DirectorySeparatorChar, [System.StringComparison]::OrdinalIgnoreCase)) {
        throw "バックアップディレクトリ外のフォルダ削除は拒否しました: $backupRootFullPath"
    }

    $backupZip = "$backupRootFullPath.zip"
    if (Test-Path -LiteralPath $backupZip) {
        Remove-Item -LiteralPath $backupZip -Force
    }

    $backupParent = Split-Path -Parent $backupRootFullPath
    $backupLeaf = Split-Path -Leaf $backupRootFullPath
    & tar.exe -a -cf $backupZip -C $backupParent $backupLeaf
    if ($LASTEXITCODE -ne 0) {
        throw "バックアップZIPの作成に失敗しました: $backupZip"
    }
    $global:LASTEXITCODE = 0

    if (-not (Test-Path -LiteralPath $backupZip)) {
        throw "バックアップZIPが作成されていません: $backupZip"
    }

    Remove-DirectoryTree -Path $backupRootFullPath
    return $backupZip
}

function Remove-ExpiredBackupArchives {
    param(
        [Parameter(Mandatory = $true)][string]$BackupDir,
        [Parameter(Mandatory = $true)][int]$RetentionCount
    )

    # このスクリプトが作成するバックアップZIPだけを対象にし、他用途のファイルは保持する。
    $backupArchives = Get-ChildItem -LiteralPath $BackupDir -File -Filter "Cotaska-0.1.0-dist_*.zip" |
        Where-Object { $_.Name -match '^Cotaska-0\.1\.0-dist_\d{8}_\d{6}\.zip$' } |
        Sort-Object LastWriteTime, Name -Descending

    $expiredArchives = @($backupArchives | Select-Object -Skip $RetentionCount)
    foreach ($archive in $expiredArchives) {
        Remove-Item -LiteralPath $archive.FullName -Force -ErrorAction Stop
        Write-Host "  削除: 保持世代数を超えたバックアップ -> $($archive.Name)" -ForegroundColor Yellow
    }
}

function Assert-PathExists {
    param(
        [Parameter(Mandatory = $true)][string]$Path,
        [Parameter(Mandatory = $true)][string]$Label
    )
    if (-not (Test-Path -LiteralPath $Path)) {
        throw "$Label が見つかりません: $Path"
    }
}

function Invoke-RobocopyChecked {
    param(
        [Parameter(Mandatory = $true)][string]$Source,
        [Parameter(Mandatory = $true)][string]$Destination,
        [string[]]$Options = @("/E")
    )

    $robocopyArgs = @($Source, $Destination) + $Options + @("/R:2", "/W:1", "/NFL", "/NDL", "/NP")
    & robocopy @robocopyArgs | Out-Host
    $exitCode = $LASTEXITCODE
    $global:LASTEXITCODE = 0

    if ($exitCode -ge 8) {
        throw "robocopy に失敗しました。exitCode=$exitCode source=$Source destination=$Destination"
    }
}

# スクリプト配置場所を基準に、リリース元とタスクマスター反映先を決定する。
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path

$releaseRoot = Join-Path $scriptDir "release\Cotaska-Portable"
$taskMasterRootItem = Get-ChildItem -LiteralPath (Join-Path $repoRoot "00_mgmt") -Directory |
    Where-Object {
        $_.Name -like "Cotaska_*" -and
        (Test-Path -LiteralPath (Join-Path $_.FullName "data\tasks"))
    } |
    Select-Object -First 1
if ($null -eq $taskMasterRootItem) {
    throw "タスクマスターのルートフォルダが見つかりません: $(Join-Path $repoRoot '00_mgmt')"
}
$taskMasterRoot = $taskMasterRootItem.FullName

# リリース成果物側の Cotaska.exe、_app、tools、AIエージェント運用ルールを同期対象にする。
$srcExe = Join-Path $releaseRoot "Cotaska.exe"
$srcApp = Join-Path $releaseRoot "_app"
$srcTools = Join-Path $releaseRoot "tools"
$srcAiAgentRuleItem = Get-ChildItem -LiteralPath $releaseRoot -Filter "Cotaska_AI*.md" -File |
    Select-Object -First 1
if ($null -eq $srcAiAgentRuleItem) {
    throw "リリース側のAIエージェント運用ルールが見つかりません: $releaseRoot\Cotaska_AI*.md"
}
$aiAgentRuleFileName = $srcAiAgentRuleItem.Name
$srcAiAgentRule = $srcAiAgentRuleItem.FullName

$dstExe = Join-Path $taskMasterRoot "Cotaska.exe"
$dstApp = Join-Path $taskMasterRoot "_app"
$dstTools = Join-Path $taskMasterRoot "tools"
$dstAiAgentRule = Join-Path $taskMasterRoot $aiAgentRuleFileName
$codexCliRelativePath = "resources\app.asar.unpacked\node_modules\@openai\codex-win32-x64\vendor\x86_64-pc-windows-msvc\bin\codex.exe"
$srcCodexCli = Join-Path $srcApp $codexCliRelativePath
$dstCodexCli = Join-Path $dstApp $codexCliRelativePath

# 置き換え前の配布フォルダ全体を backup 配下へ退避するための保存先を作る。
$timestamp = Get-Date -Format "yyyyMMdd_HHmmss"
$backupDir = Join-Path $repoRoot "00_mgmt\10_task\backup"
if (-not (Test-Path -LiteralPath $backupDir)) { New-Item -ItemType Directory -Path $backupDir | Out-Null }
$backupRoot = Join-Path $backupDir "Cotaska-0.1.0-dist_$timestamp"

if ($StopRunningCotaska) {
    # 実行中の Cotaska 関連プロセスがあると _app\resources\app.asar を置換できないため停止する。
    Write-Host "[1/6] 関連プロセスを停止しています..."
    Get-Process -Name "Cotaska", "CotaskaCore", "electron", "crashpad_handler" -ErrorAction SilentlyContinue |
        Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 500
}

Write-Host "[2/6] コピー元/コピー先のパスを検証しています..."
# コピー元とコピー先に必要なファイル・フォルダが揃っていることを先に検証する。
Assert-PathExists -Path $releaseRoot -Label "リリースルート"
Assert-PathExists -Path $taskMasterRoot -Label "タスクマスタールート"
Assert-PathExists -Path $srcExe -Label "リリース版 Cotaska.exe"
Assert-PathExists -Path $srcApp -Label "リリース版 _app フォルダ"
Assert-PathExists -Path $srcCodexCli -Label "リリース版 同梱 Codex CLI"
Assert-PathExists -Path (Join-Path $srcTools "validate-tasks.ps1") -Label "リリース版 validate-tasks.ps1"
Assert-PathExists -Path (Join-Path $srcTools "CotaskaUpdater.exe") -Label "リリース版 CotaskaUpdater.exe"
Assert-PathExists -Path $srcAiAgentRule -Label "リリース版 AIエージェント運用ルール"

Write-Host "[3/6] バックアップを作成しています: $backupRoot"
# 失敗時に戻せるよう、現在のタスクマスター配布フォルダを丸ごとバックアップする。
Invoke-RobocopyChecked -Source $taskMasterRoot -Destination $backupRoot

Write-Host "[4/6] バックアップをZIP化し、一時フォルダを削除しています..."
# 退避フォルダは zip にまとめ、圧縮成功後はフォルダを削除して backup 配下を軽く保つ。
$backupZip = Compress-BackupAndRemoveFolder -BackupRoot $backupRoot -BackupDir $backupDir
Remove-ExpiredBackupArchives -BackupDir $backupDir -RetentionCount $BackupRetentionCount

Write-Host "[5/6] Cotaska.exe とAIエージェント運用ルールを置き換えています..."
# 実行ファイルとAIエージェント運用ルールを最新リリースから上書きする。
Copy-Item -LiteralPath $srcExe -Destination $dstExe -Force
Copy-Item -LiteralPath $srcAiAgentRule -Destination $dstAiAgentRule -Force

Write-Host "[6/6] _app フォルダを置き換えています..."
# Electron アプリ本体はフォルダ単位で差し替える。
if (Test-Path -LiteralPath $dstApp) {
    Remove-PathWithLockHint -Path $dstApp
}
Invoke-RobocopyChecked -Source $srcApp -Destination $dstApp
Assert-PathExists -Path $dstCodexCli -Label "同期後 同梱 Codex CLI"

Write-Host "      tools フォルダを同期しています..."
# 検証スクリプトなどの補助ツールもリリース成果物に合わせて同期する。
if (Test-Path -LiteralPath $dstTools) {
    Remove-Item -LiteralPath $dstTools -Recurse -Force
}
Copy-Item -LiteralPath $srcTools -Destination $dstTools -Recurse -Force

Write-Host ""
Write-Host "完了しました"
Write-Host "バックアップ: $backupZip"
Write-Host "更新先: $taskMasterRoot"
