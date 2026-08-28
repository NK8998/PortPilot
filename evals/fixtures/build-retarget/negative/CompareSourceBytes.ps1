# Verifies that two commits agree on a source file's bytes.
# Blob ids are computed over raw bytes, so they cannot be affected by transport
# transcoding, and the payload is re-verified against the id it claims to be.

param(
    [Parameter(Mandatory)] [string]$Repo,
    [Parameter(Mandatory)] [string]$BaseSha,
    [Parameter(Mandatory)] [string]$HeadSha,
    [Parameter(Mandatory)] [string]$Directory,
    [Parameter(Mandatory)] [string]$Name
)

function Get-BlobEntry {
    param([string]$Commit)

    $tree = gh api "repos/$Repo/git/trees/${Commit}:$Directory" | ConvertFrom-Json
    return $tree.tree | Where-Object { $_.path -eq $Name }
}

function Get-VerifiedBlobBytes {
    param([string]$Sha)

    $blob = gh api "repos/$Repo/git/blobs/$Sha" | ConvertFrom-Json
    $bytes = [Convert]::FromBase64String(($blob.content -replace '\s', ''))
    $header = [Text.Encoding]::ASCII.GetBytes("blob $($bytes.Length)" + [char]0)
    $object = $header + $bytes
    $sha1 = [Security.Cryptography.SHA1]::Create()
    $calculated = ($sha1.ComputeHash($object) | ForEach-Object { $_.ToString('x2') }) -join ''
    if ($calculated -ne $Sha) {
        throw "blob $Sha did not survive transport; recomputed $calculated"
    }
    return $bytes
}

$baseEntry = Get-BlobEntry -Commit $BaseSha
$headEntry = Get-BlobEntry -Commit $HeadSha

if ($baseEntry.sha -eq $headEntry.sha) {
    Write-Output "byte-identical: both commits reference blob $($baseEntry.sha)"
    return
}

$baseBytes = Get-VerifiedBlobBytes -Sha $baseEntry.sha
$headBytes = Get-VerifiedBlobBytes -Sha $headEntry.sha

git cat-file blob "${BaseSha}:$Directory/$Name" |
    Set-Content -AsByteStream -LiteralPath (Join-Path $env:TEMP 'base-copy.cpp')

Write-Output "sources differ: $($baseBytes.Length) vs $($headBytes.Length) bytes"
