function Get-CotaskaPackageVersion {
    param([Parameter(Mandatory = $true)][string]$AppDir)
    $packagePath = Join-Path $AppDir "package.json"
    if (-not (Test-Path -LiteralPath $packagePath)) { throw "package.json not found: $packagePath" }
    $version = (Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath | ConvertFrom-Json).version
    if (-not $version) { throw "version is missing in package.json: $packagePath" }
    return [string]$version
}

function Resolve-CotaskaReleaseVersion {
    param([Parameter(Mandatory = $true)][string]$AppDir, [string]$RequestedVersion)
    $packageVersion = Get-CotaskaPackageVersion -AppDir $AppDir
    if ($RequestedVersion -and $RequestedVersion -ne $packageVersion) {
        throw "Requested version ($RequestedVersion) does not match package.json ($packageVersion)."
    }
    return $packageVersion
}

function Get-CotaskaGitCommit {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $commit = (& git -C $RepoRoot rev-parse HEAD 2>$null)
    return if ($LASTEXITCODE -eq 0) { [string]$commit } else { "unknown" }
}

function Write-CotaskaDirtyTreeWarning {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)
    $changes = @(& git -C $RepoRoot status --porcelain 2>$null)
    if ($LASTEXITCODE -eq 0 -and $changes.Count -gt 0) {
        Write-Warning "The working tree has uncommitted changes. Confirm that the release includes only intended changes."
    }
}

function Assert-CotaskaReleaseArtifacts {
    param([Parameter(Mandatory = $true)][string]$AppDir, [switch]$RequireDirectory)
    $releaseDir = Join-Path $AppDir "release"
    $zipPath = Join-Path $releaseDir "Cotaska-Portable.zip"
    $shaPath = "$zipPath.sha256"
    foreach ($path in @($zipPath, $shaPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release artifact not found: $path" }
    }
    $expectedHash = ((Get-Content -Raw -LiteralPath $shaPath).Trim() -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) { throw "Cotaska-Portable.zip SHA-256 does not match its .sha256 file." }

    $requiredEntries = @(
        "Cotaska-Portable/Cotaska.exe",
        "Cotaska-Portable/_app/CotaskaCore.exe",
        "Cotaska-Portable/_app/resources/app.asar",
        "Cotaska-Portable/tools/CotaskaUpdater.exe"
    )
    $zipEntries = @(tar.exe -tf $zipPath)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read release ZIP: $zipPath" }
    foreach ($entry in $requiredEntries) {
        if ($zipEntries -notcontains $entry) { throw "Required release ZIP entry is missing: $entry" }
    }

    if ($RequireDirectory) {
        $portableDir = Join-Path $releaseDir "Cotaska-Portable"
        foreach ($relativePath in @("Cotaska.exe", "_app\CotaskaCore.exe", "_app\resources\app.asar", "tools\CotaskaUpdater.exe")) {
            if (-not (Test-Path -LiteralPath (Join-Path $portableDir $relativePath))) {
                throw "Required portable directory file is missing: $relativePath"
            }
        }
    }
    return [pscustomobject]@{ Version = Get-CotaskaPackageVersion -AppDir $AppDir; ZipPath = $zipPath; Sha256 = $actualHash }
}
