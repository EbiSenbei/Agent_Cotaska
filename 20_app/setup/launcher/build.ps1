$ErrorActionPreference = "Stop"
$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$sourcePath = Join-Path $scriptDir "LauncherFallback.cs"
$outputExe = Join-Path $scriptDir "Cotaska.exe"
$iconPath = Join-Path $scriptDir "icon.ico"

$cscCandidates = @(
    (Get-Command "csc.exe" -ErrorAction SilentlyContinue | Select-Object -First 1 -ExpandProperty Source),
    "C:\Windows\Microsoft.NET\Framework64\v4.0.30319\csc.exe",
    "C:\Windows\Microsoft.NET\Framework\v4.0.30319\csc.exe"
) | Where-Object { $_ -and (Test-Path $_) }

$cscExe = $cscCandidates | Select-Object -First 1
if (-not $cscExe) {
    Write-Host "Build FAILED: csc.exe was not found." -ForegroundColor Red
    exit 1
}
if (-not (Test-Path $sourcePath)) {
    Write-Host "Build FAILED: $sourcePath not found." -ForegroundColor Red
    exit 1
}

Write-Host "Building C# launcher..." -ForegroundColor Cyan
$args = @(
    "/nologo",
    "/target:winexe",
    "/out:$outputExe",
    "/reference:System.Windows.Forms.dll",
    "/reference:System.Drawing.dll",
    "/reference:System.IO.Compression.dll",
    "/reference:System.IO.Compression.FileSystem.dll"
)
if (Test-Path $iconPath) {
    $args += "/win32icon:$iconPath"
}
$args += $sourcePath

& $cscExe $args
if (($LASTEXITCODE -eq 0) -and (Test-Path $outputExe)) {
    $size = [math]::Round((Get-Item $outputExe).Length / 1KB, 1)
    Write-Host "Build SUCCESS: Cotaska.exe ($size KB)" -ForegroundColor Green
    exit 0
}

Write-Host "Build FAILED: Cotaska.exe" -ForegroundColor Red
exit 1
