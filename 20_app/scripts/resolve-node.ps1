# Resolve the bundled runtime from .nvmrc, then validate any PATH fallback.
function Resolve-CotaskaNode {
    param([Parameter(Mandatory = $true)][string]$AppDir)

    $version = (Get-Content -LiteralPath (Join-Path $AppDir ".nvmrc") -Raw).Trim()
    $bundledNode = Join-Path $AppDir "..\..\v$version\node.exe"
    if (Test-Path -LiteralPath $bundledNode -PathType Leaf) {
        $nodeExe = (Resolve-Path -LiteralPath $bundledNode).Path
    } else {
        $command = Get-Command node.exe -ErrorAction SilentlyContinue
        if (-not $command) { throw "Node.js v$version was not found. Run setup/install/01_setup_nodejs.ps1." }
        $nodeExe = $command.Source
    }

    & $nodeExe (Join-Path $AppDir "scripts\verify-runtime.js") | Out-Host
    if ($LASTEXITCODE -ne 0) { throw "Unsupported Node.js runtime: $nodeExe" }
    return $nodeExe
}
