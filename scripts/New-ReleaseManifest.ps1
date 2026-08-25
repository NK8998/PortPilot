[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$StagePath,

    [Parameter(Mandatory)]
    [string]$OutputPath
)

$ErrorActionPreference = "Stop"
$resolvedStage = (Resolve-Path -LiteralPath $StagePath).Path
$items = @(Get-ChildItem -LiteralPath $resolvedStage -Recurse -Force)
$reparsePoints = @($items | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint })

if ($reparsePoints.Count -gt 0) {
    $paths = $reparsePoints.FullName -join ", "
    throw "Release staging tree contains reparse points: $paths"
}

$files = @(
    $items |
        Where-Object { -not $_.PSIsContainer } |
        Sort-Object FullName |
        ForEach-Object {
            [ordered]@{
                path = [IO.Path]::GetRelativePath($resolvedStage, $_.FullName).Replace("\", "/")
                size = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
)

if ($files.Count -eq 0) {
    throw "Release staging tree is empty: $resolvedStage"
}

$manifest = [ordered]@{
    schemaVersion = "1.0"
    files = $files
}

$outputDirectory = Split-Path -Parent ([IO.Path]::GetFullPath($OutputPath))
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $OutputPath -Encoding utf8NoBOM
Write-Host "Wrote manifest for $($files.Count) file(s): $OutputPath"
