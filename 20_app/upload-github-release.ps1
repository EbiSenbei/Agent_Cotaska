<#
.SYNOPSIS
CotaskaのNSISリリース成果物をGitHub Releasesへ公開します。

.DESCRIPTION
package.json、インストーラ、blockmap、latest.ymlの整合性を検証し、
指定したGitHubリポジトリへ通常Releaseとして3成果物を公開します。
同名タグのReleaseが存在する場合は上書きせず停止します。

.PARAMETER Version
公開するバージョンです。省略時はpackage.jsonのversionを使用します。

.PARAMETER Repository
公開先のowner/repositoryです。既定値はEbiSenbei/cotaska-siteです。

.PARAMETER NotesPath
GitHub Release本文に使うMarkdownファイルです。省略時はCotaskaの
リリースノートフォルダから、対象バージョンを含むファイルを一意に検索します。

.PARAMETER Draft
指定した場合はDraft Releaseとして作成します。

.PARAMETER Prerelease
指定した場合はPrereleaseとして作成します。

.PARAMETER WhatIf
ローカル成果物とリリースノートだけを検証し、GitHubは変更しません。

.EXAMPLE
.\upload-github-release.ps1 -Version 0.4.1

.EXAMPLE
.\upload-github-release.ps1 -Version 0.4.1 -WhatIf
#>
param(
    [string]$Version,
    [ValidatePattern('^[^/\s]+/[^/\s]+$')]
    [string]$Repository = "EbiSenbei/cotaska-site",
    [string]$NotesPath,
    [switch]$Draft,
    [switch]$Prerelease,
    [switch]$WhatIf
)

$ErrorActionPreference = "Stop"

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$repoRoot = (Resolve-Path (Join-Path $scriptDir "..")).Path
. (Join-Path $scriptDir "scripts\release-common.ps1")

function Resolve-ReleaseNotesPath {
    param(
        [Parameter(Mandatory = $true)][string]$Root,
        [Parameter(Mandatory = $true)][string]$ReleaseVersion,
        [string]$RequestedPath
    )

    if ($RequestedPath) {
        $candidate = if ([System.IO.Path]::IsPathRooted($RequestedPath)) {
            $RequestedPath
        } else {
            Join-Path (Get-Location) $RequestedPath
        }
        if (-not (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            throw "Release notes not found: $candidate"
        }
        return (Resolve-Path -LiteralPath $candidate).Path
    }

    $notesDir = Join-Path $Root "10_docs\30_変更管理\50_リリース"
    $matches = @(Get-ChildItem -LiteralPath $notesDir -File -Filter "*v$ReleaseVersion*.md")
    if ($matches.Count -eq 0) {
        throw "Release notes for v$ReleaseVersion were not found in: $notesDir"
    }
    if ($matches.Count -gt 1) {
        $paths = ($matches.FullName -join [Environment]::NewLine)
        throw "Multiple release notes matched v$ReleaseVersion. Specify -NotesPath explicitly.$([Environment]::NewLine)$paths"
    }
    return $matches[0].FullName
}

function Invoke-Gh {
    param([Parameter(Mandatory = $true)][string[]]$Arguments)

    $output = @(& gh @Arguments 2>&1)
    if ($LASTEXITCODE -ne 0) {
        throw "gh command failed: gh $($Arguments -join ' ')$([Environment]::NewLine)$($output -join [Environment]::NewLine)"
    }
    return $output
}

$releaseVersion = Resolve-CotaskaReleaseVersion -AppDir $scriptDir -RequestedVersion $Version
$artifacts = Assert-CotaskaInstallerReleaseArtifacts -AppDir $scriptDir
$releaseNotesPath = Resolve-ReleaseNotesPath -Root $repoRoot -ReleaseVersion $releaseVersion -RequestedPath $NotesPath
$tag = "v$releaseVersion"
$title = "Cotaska v$releaseVersion"
$expectedAssets = @(
    Get-Item -LiteralPath $artifacts.InstallerPath
    Get-Item -LiteralPath $artifacts.BlockmapPath
    Get-Item -LiteralPath $artifacts.LatestYamlPath
)

Write-Host "Cotaska GitHub Release preflight passed." -ForegroundColor Green
Write-Host "  Repository: $Repository"
Write-Host "  Tag:        $tag"
Write-Host "  Notes:      $releaseNotesPath"
foreach ($asset in $expectedAssets) {
    Write-Host "  Asset:      $($asset.Name) ($($asset.Length) bytes)"
}

if ($WhatIf) {
    Write-Host "WhatIf: GitHub Release was not created or modified." -ForegroundColor Yellow
    exit 0
}

if (-not (Get-Command gh -ErrorAction SilentlyContinue)) {
    throw "GitHub CLI (gh) was not found. Install it and run 'gh auth login' first."
}

Invoke-Gh -Arguments @("auth", "status", "--hostname", "github.com") | Out-Null

$viewOutput = @(& gh release view $tag --repo $Repository --json tagName 2>&1)
if ($LASTEXITCODE -eq 0) {
    throw "GitHub Release already exists and will not be overwritten: https://github.com/$Repository/releases/tag/$tag"
}
$viewText = $viewOutput -join [Environment]::NewLine
if ($viewText -notmatch '(?i)release not found') {
    throw "Unable to confirm that the Release is absent.$([Environment]::NewLine)$viewText"
}

$createArguments = @(
    "release", "create", $tag,
    "--repo", $Repository,
    "--title", $title,
    "--notes-file", $releaseNotesPath
)
if ($Draft) {
    $createArguments += "--draft"
} elseif ($Prerelease) {
    $createArguments += "--prerelease"
} else {
    $createArguments += "--latest"
}
$createArguments += $expectedAssets.FullName

$releaseUrl = (Invoke-Gh -Arguments $createArguments | Select-Object -Last 1).Trim()

$releaseJson = (Invoke-Gh -Arguments @(
    "release", "view", $tag,
    "--repo", $Repository,
    "--json", "url,isDraft,isPrerelease,assets"
) | Out-String | ConvertFrom-Json)

foreach ($expected in $expectedAssets) {
    $uploaded = @($releaseJson.assets | Where-Object { $_.name -eq $expected.Name })
    if ($uploaded.Count -ne 1) {
        throw "Published Release does not contain exactly one asset named: $($expected.Name)"
    }
    if ([int64]$uploaded[0].size -ne [int64]$expected.Length) {
        throw "Published asset size does not match: $($expected.Name)"
    }
    if ($uploaded[0].state -ne "uploaded") {
        throw "Published asset is not in uploaded state: $($expected.Name)"
    }
}

Write-Host "GitHub Release published and verified." -ForegroundColor Green
Write-Host "  URL: $($releaseJson.url ?? $releaseUrl)"
Write-Host "  Installer SHA-256: $($artifacts.InstallerSha256)"
Write-Host "  Blockmap SHA-256:  $($artifacts.BlockmapSha256)"
Write-Host "  latest.yml SHA-256: $($artifacts.LatestYamlSha256)"
