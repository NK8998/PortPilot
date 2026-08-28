[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$PackagePath,

    [Parameter(Mandatory)]
    [string]$ManifestPath,

    [Parameter(Mandatory)]
    [ValidatePattern("^[0-9a-fA-F]{64}$")]
    [string]$ExpectedSha256,

    [string]$ScannerProject = (
        Join-Path $PSScriptRoot "..\..\..\..\..\src\tools\winport-scan"
    )
)

$ErrorActionPreference = "Stop"
$resolvedPackage = (Resolve-Path -LiteralPath $PackagePath).Path
$resolvedManifest = (Resolve-Path -LiteralPath $ManifestPath).Path
$resolvedScanner = (Resolve-Path -LiteralPath $ScannerProject).Path
$actualPackageHash = (Get-FileHash -LiteralPath $resolvedPackage -Algorithm SHA256).Hash

if ($actualPackageHash -ne $ExpectedSha256) {
    throw "Package SHA-256 mismatch. Expected $ExpectedSha256, got $actualPackageHash."
}

$manifest = Get-Content -LiteralPath $resolvedManifest -Raw | ConvertFrom-Json
if ($manifest.schemaVersion -ne "1.0" -or @($manifest.files).Count -eq 0) {
    throw "Manifest is missing schemaVersion 1.0 or has no files."
}

$extractPath = Join-Path ([IO.Path]::GetTempPath()) "winport-release-$([Guid]::NewGuid().ToString('N'))"
New-Item -ItemType Directory -Path $extractPath | Out-Null

try {
    Expand-Archive -LiteralPath $resolvedPackage -DestinationPath $extractPath
    $actualFiles = @(
        Get-ChildItem -LiteralPath $extractPath -Recurse -File -Force |
            Sort-Object FullName |
            ForEach-Object {
                [ordered]@{
                    path = [IO.Path]::GetRelativePath($extractPath, $_.FullName).Replace("\", "/")
                    size = $_.Length
                    sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            }
    )

    $expectedByPath = @{}
    foreach ($file in @($manifest.files)) {
        if ($expectedByPath.ContainsKey($file.path)) {
            throw "Manifest contains duplicate path: $($file.path)"
        }
        $expectedByPath[$file.path] = $file
    }

    if ($actualFiles.Count -ne $expectedByPath.Count) {
        throw "Package file count $($actualFiles.Count) does not match manifest count $($expectedByPath.Count)."
    }

    foreach ($file in $actualFiles) {
        $expected = $expectedByPath[$file.path]
        if ($null -eq $expected) {
            throw "Package contains unmanifested file: $($file.path)"
        }
        if ($file.size -ne $expected.size -or $file.sha256 -ne $expected.sha256) {
            throw "Manifest mismatch for $($file.path)"
        }
    }

    & dotnet run --project $resolvedScanner -c Release -- $extractPath --quiet
    if ($LASTEXITCODE -ne 0) {
        throw "Strict Arm64 purity scan failed with exit code $LASTEXITCODE."
    }

    Write-Host "PASS package hash, manifest, re-expansion, and Arm64 purity checks."
}
finally {
    if (Test-Path -LiteralPath $extractPath) {
        Remove-Item -LiteralPath $extractPath -Recurse -Force
    }
}
