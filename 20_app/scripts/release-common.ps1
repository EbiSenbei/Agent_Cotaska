<#
.SYNOPSIS
Cotaskaのリリース処理で共通利用する、バージョン取得と成果物検証の関数群です。

.DESCRIPTION
このファイルは単独で実行するスクリプトではありません。
release-all.ps1、sync-task-master-release.ps1、upload-r2.ps1から
ドットソースで読み込まれ、次の処理を共通化します。

- package.jsonを正本としたリリースバージョンの取得
- コマンド引数で指定されたバージョンとの整合性確認
- リリース元のGitコミットID取得
- 未コミット変更がある作業ツリーへの警告
- Portable ZIP、SHA-256、必須ファイルの検証

これらを一か所にまとめることで、生成・ローカル同期・R2公開が
異なるバージョンや不完全な成果物を扱う事故を防ぎます。
#>

<#
.SYNOPSIS
package.jsonからCotaskaのバージョンを取得します。

.PARAMETER AppDir
package.jsonが置かれているCotaskaアプリディレクトリです。

.OUTPUTS
package.jsonのversionを文字列で返します。
#>
function Get-CotaskaPackageVersion {
    param([Parameter(Mandatory = $true)][string]$AppDir)

    # 呼び出し元が指定したアプリディレクトリからpackage.jsonの絶対的な参照先を組み立てます。
    $packagePath = Join-Path $AppDir "package.json"

    # バージョンの正本が存在しなければ、後続処理を行わず直ちに失敗させます。
    if (-not (Test-Path -LiteralPath $packagePath)) { throw "package.json not found: $packagePath" }

    # JSONを読み込み、リリースで使用するversionプロパティだけを取り出します。
    $version = (Get-Content -Raw -Encoding UTF8 -LiteralPath $packagePath | ConvertFrom-Json).version

    # package.jsonが存在してもversionが未定義・空の場合は、不正なリリースを防ぐため失敗させます。
    if (-not $version) { throw "version is missing in package.json: $packagePath" }

    # PowerShellの型解釈による差異を避けるため、必ず文字列として返します。
    return [string]$version
}

<#
.SYNOPSIS
要求されたリリースバージョンがpackage.jsonと一致することを確認します。

.PARAMETER AppDir
package.jsonが置かれているCotaskaアプリディレクトリです。

.PARAMETER RequestedVersion
呼び出し元が明示的に指定したバージョンです。省略時はpackage.jsonのversionをそのまま採用します。

.OUTPUTS
検証済みのpackage.jsonバージョンを文字列で返します。
#>
function Resolve-CotaskaReleaseVersion {
    param([Parameter(Mandatory = $true)][string]$AppDir, [string]$RequestedVersion)

    # リリースバージョンの正本は常にpackage.jsonとします。
    $packageVersion = Get-CotaskaPackageVersion -AppDir $AppDir

    # 明示指定がある場合だけ照合し、同じバージョン名で異なる内容を公開する事故を防ぎます。
    if ($RequestedVersion -and $RequestedVersion -ne $packageVersion) {
        throw "Requested version ($RequestedVersion) does not match package.json ($packageVersion)."
    }

    # 呼び出し元は、この検証済みバージョンを成果物名や公開情報に使用します。
    return $packageVersion
}

<#
.SYNOPSIS
指定リポジトリの現在のGitコミットIDを取得します。

.PARAMETER RepoRoot
Gitリポジトリのルートディレクトリです。

.OUTPUTS
取得できたコミットID、またはGit情報を取得できない場合はunknownを返します。
#>
function Get-CotaskaGitCommit {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    # 公開した成果物をソースへ追跡できるよう、現在のHEADを取得します。
    # Git未導入環境などでは標準エラーを表示せず、呼び出し元で扱える値へフォールバックします。
    $commit = (& git -C $RepoRoot rev-parse HEAD 2>$null)
    if ($LASTEXITCODE -eq 0) {
        return [string]$commit
    }
    return "unknown"
}

<#
.SYNOPSIS
作業ツリーに未コミット変更がある場合、リリース担当者へ警告します。

.PARAMETER RepoRoot
確認対象となるGitリポジトリのルートディレクトリです。

.DESCRIPTION
未コミット変更を含むリリースを禁止する関数ではありません。
意図した差分だけが成果物へ含まれているか、担当者へ再確認を促します。
#>
function Write-CotaskaDirtyTreeWarning {
    param([Parameter(Mandatory = $true)][string]$RepoRoot)

    # porcelain形式を使い、Gitの表示設定に影響されない機械判定用の変更一覧を取得します。
    $changes = @(& git -C $RepoRoot status --porcelain 2>$null)

    # Git状態を取得でき、かつ差分があるときだけ警告します。リリース処理自体は継続します。
    if ($LASTEXITCODE -eq 0 -and $changes.Count -gt 0) {
        Write-Warning "The working tree has uncommitted changes. Confirm that the release includes only intended changes."
    }
}

<#
.SYNOPSIS
Cotaska Portableのリリース成果物が完全で、改ざん・欠落がないことを検証します。

.PARAMETER AppDir
releaseディレクトリを含むCotaskaアプリディレクトリです。

.PARAMETER RequireDirectory
指定した場合、ZIPだけでなく展開済みのrelease/Cotaska-Portable内の必須ファイルも検証します。

.OUTPUTS
検証済みのVersion、ZipPath、Sha256を持つオブジェクトを返します。
#>
function Assert-CotaskaReleaseArtifacts {
    param([Parameter(Mandatory = $true)][string]$AppDir, [switch]$RequireDirectory)

    # 共通の成果物配置規約から、配布ZIPとチェックサムファイルのパスを決定します。
    $releaseDir = Join-Path $AppDir "release"
    $zipPath = Join-Path $releaseDir "Cotaska-Portable.zip"
    $shaPath = "$zipPath.sha256"

    # ZIPとSHA-256ファイルの両方が通常ファイルとして存在することを確認します。
    foreach ($path in @($zipPath, $shaPath)) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Release artifact not found: $path" }
    }

    # チェックサムファイルの先頭フィールドと、ZIPから再計算したSHA-256を比較します。
    $expectedHash = ((Get-Content -Raw -LiteralPath $shaPath).Trim() -split '\s+')[0].ToLowerInvariant()
    $actualHash = (Get-FileHash -LiteralPath $zipPath -Algorithm SHA256).Hash.ToLowerInvariant()
    if ($expectedHash -ne $actualHash) { throw "Cotaska-Portable.zip SHA-256 does not match its .sha256 file." }

    # 起動・実行・更新に最低限必要なファイルをZIP内の必須エントリとして定義します。
    $requiredEntries = @(
        "Cotaska-Portable/Cotaska.exe",
        "Cotaska-Portable/_app/CotaskaCore.exe",
        "Cotaska-Portable/_app/resources/app.asar",
        "Cotaska-Portable/tools/CotaskaUpdater.exe"
    )

    # ZIPを展開せずにエントリ一覧を取得し、壊れたZIPや読めないZIPもここで検出します。
    $zipEntries = @(tar.exe -tf $zipPath)
    if ($LASTEXITCODE -ne 0) { throw "Unable to read release ZIP: $zipPath" }

    # 必須エントリが一つでも欠けていれば、同期・公開へ進む前に処理を中止します。
    foreach ($entry in $requiredEntries) {
        if ($zipEntries -notcontains $entry) { throw "Required release ZIP entry is missing: $entry" }
    }

    # リリース生成直後など、展開済みPortableディレクトリも必要な処理だけ追加検証します。
    if ($RequireDirectory) {
        $portableDir = Join-Path $releaseDir "Cotaska-Portable"

        # ZIP内と同等の主要ファイルが、同期元となる展開済みディレクトリにも存在するか確認します。
        foreach ($relativePath in @("Cotaska.exe", "_app\CotaskaCore.exe", "_app\resources\app.asar", "tools\CotaskaUpdater.exe")) {
            if (-not (Test-Path -LiteralPath (Join-Path $portableDir $relativePath))) {
                throw "Required portable directory file is missing: $relativePath"
            }
        }
    }

    # すべての検証を通過した成果物情報を、後続の同期・公開処理へ渡します。
    return [pscustomobject]@{ Version = Get-CotaskaPackageVersion -AppDir $AppDir; ZipPath = $zipPath; Sha256 = $actualHash }
}
