param(
	[Parameter(Mandatory = $true)]
	[string]$ExePath,

	[Parameter(Mandatory = $true)]
	[string]$IconPath,

	[string]$FileDescription = "CotaskaCore",

	[string]$ProductName = "CotaskaCore",

	[string]$OriginalFilename = "CotaskaCore.exe",

	[string]$InternalFilename = "CotaskaCore",

	[string]$CompanyName = "EbiSenbei",

	[string]$Version = "0.2.6"
)

$ErrorActionPreference = "Stop"

if (-not (Test-Path $ExePath)) {
	throw "Exe not found: $ExePath"
}

if (-not (Test-Path $IconPath)) {
	throw "Icon not found: $IconPath"
}

$resolvedExePath = (Resolve-Path -LiteralPath $ExePath).Path
$resolvedIconPath = (Resolve-Path -LiteralPath $IconPath).Path

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$appDir = Resolve-Path (Join-Path $scriptDir "..\..")
$nodeDir = Resolve-Path (Join-Path $appDir "..\..\v22.14.0")
$nodeExe = Join-Path $nodeDir "node.exe"
$npmCmd = Join-Path $nodeDir "npm.cmd"
$env:PATH = "$nodeDir;$env:PATH"

if (-not (Test-Path $nodeExe)) {
	throw "node.exe not found: $nodeExe"
}

if (-not (Test-Path $npmCmd)) {
	throw "npm.cmd not found: $npmCmd"
}

$tempDir = Join-Path $env:TEMP "cotaska-rcedit"
New-Item -ItemType Directory -Path $tempDir -Force | Out-Null

$pkgJson = Join-Path $tempDir "package.json"
if (-not (Test-Path $pkgJson)) {
	'{"name":"cotaska-rcedit-temp","private":true}' | Set-Content -Path $pkgJson -Encoding UTF8
}

Push-Location $tempDir
try {
	& $npmCmd install rcedit --no-save --silent | Out-Null
	if ($LASTEXITCODE -ne 0) {
		throw "Failed to install rcedit"
	}

	$rceditModule = Join-Path $tempDir "node_modules\rcedit\lib\index.js"
	if (-not (Test-Path $rceditModule)) {
		throw "rcedit module not found: $rceditModule"
	}

		$rceditModuleUrl = ([System.Uri]$rceditModule).AbsoluteUri

		$nodeScript = @"
import { rcedit } from '$rceditModuleUrl';

await rcedit('$($resolvedExePath.Replace('\', '/'))', {
  icon: '$($resolvedIconPath.Replace('\', '/'))',
  'version-string': {
    FileDescription: '$FileDescription',
    ProductName: '$ProductName',
    OriginalFilename: '$OriginalFilename',
    InternalFilename: '$InternalFilename',
    InternalName: '$InternalFilename',
    CompanyName: '$CompanyName'
  },
  'file-version': '$Version',
  'product-version': '$Version'
});
"@

	$tmpScript = Join-Path $tempDir "run-rcedit.mjs"
	[System.IO.File]::WriteAllText($tmpScript, $nodeScript, (New-Object System.Text.UTF8Encoding($false)))

	& $nodeExe $tmpScript
	if ($LASTEXITCODE -ne 0) {
		throw "rcedit failed with exit code $LASTEXITCODE"
	}
}
finally {
	Pop-Location
}

Write-Host "EXE icon and metadata updated: $ExePath" -ForegroundColor Green
