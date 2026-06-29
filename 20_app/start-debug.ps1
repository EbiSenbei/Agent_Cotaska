# Cotaska debug launcher
# Starts Cotaska with NODE_ENV=development.
# Run this script from any directory:
#   powershell -ExecutionPolicy Bypass -File .\start-debug.ps1

param(
    [bool]$StopExisting = $true,
    [int]$Port = 5173,
    [switch]$NoDevTools
)

$ErrorActionPreference = "Stop"

function Stop-CotaskaDebugProcesses {
    param(
        [Parameter(Mandatory = $true)][string]$AppDir
    )

    $processes = Get-CimInstance Win32_Process |
        Where-Object {
            ($_.Name -in @("Cotaska.exe", "CotaskaCore.exe")) -or
            ($_.CommandLine -and ($_.CommandLine -like "*$AppDir*") -and ($_.Name -in @("electron.exe", "node.exe")))
        }

    foreach ($proc in $processes) {
        try {
            Stop-Process -Id $proc.ProcessId -Force -ErrorAction Stop
            Write-Host "Stopped process: $($proc.Name) ($($proc.ProcessId))" -ForegroundColor DarkGray
        } catch {
            Write-Host "Could not stop process: $($proc.Name) ($($proc.ProcessId))" -ForegroundColor Yellow
        }
    }
}

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$electronCli = Join-Path $scriptDir "node_modules\electron\cli.js"

$nodeCandidates = @(
    (Join-Path $scriptDir "..\..\v22.14.0\node.exe"),
    (Join-Path $env:USERPROFILE ".cache\codex-runtimes\codex-primary-runtime\dependencies\node\bin\node.exe"),
    "node.exe"
)

$nodeExe = $null
foreach ($candidate in $nodeCandidates) {
    try {
        $resolved = (Resolve-Path $candidate -ErrorAction Stop).Path
        if (Test-Path -LiteralPath $resolved) {
            $nodeExe = $resolved
            break
        }
    } catch {
        $command = Get-Command $candidate -ErrorAction SilentlyContinue
        if ($command) {
            $nodeExe = $command.Source
            break
        }
    }
}

if ([string]::IsNullOrWhiteSpace($nodeExe) -or -not (Test-Path -LiteralPath $nodeExe)) {
    throw "Node.js was not found. Install Node.js or provide bundled node.exe."
}
if (-not (Test-Path -LiteralPath $electronCli)) {
    throw "Electron CLI was not found. Run npm install first: $electronCli"
}

Set-Location $scriptDir

if ($StopExisting) {
    Write-Host "Stopping existing Cotaska debug processes..." -ForegroundColor Cyan
    Stop-CotaskaDebugProcesses -AppDir $scriptDir
    Start-Sleep -Milliseconds 800
}

$nodeDir = Split-Path -Parent $nodeExe
$env:Path = "$nodeDir;$scriptDir\node_modules\.bin;$env:Path"
$env:NODE_ENV = "development"
$env:VITE_PORT = [string]$Port
$env:NODE_TLS_REJECT_UNAUTHORIZED = "0"
if ($NoDevTools) {
    $env:COTASKA_NO_DEVTOOLS = "1"
} else {
    Remove-Item Env:COTASKA_NO_DEVTOOLS -ErrorAction SilentlyContinue
}

Write-Host "Starting Cotaska in debug mode..." -ForegroundColor Cyan
Write-Host "AppDir : $scriptDir" -ForegroundColor DarkGray
Write-Host "Node   : $nodeExe" -ForegroundColor DarkGray
Write-Host "Vite   : http://localhost:$Port/" -ForegroundColor DarkGray
Write-Host ""

& $nodeExe $electronCli "."

Write-Host ""
Write-Host "Cotaska debug mode exited." -ForegroundColor Cyan
