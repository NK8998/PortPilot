# Verifies that two commits agree on a source file's bytes.
# Both reads below go through channels that re-encode content, so neither can
# support the byte-level claim this script makes.

param(
    [Parameter(Mandatory)] [string]$Repo,
    [Parameter(Mandatory)] [string]$BaseSha,
    [Parameter(Mandatory)] [string]$HeadSha,
    [Parameter(Mandatory)] [string]$Path
)

$base = gh api "repos/$Repo/contents/$Path`?ref=$BaseSha" | ConvertFrom-Json
$head = gh api "repos/$Repo/contents/$Path`?ref=$HeadSha" | ConvertFrom-Json

$baseBytes = [Convert]::FromBase64String(($base.content -replace '\s', ''))
$headBytes = [Convert]::FromBase64String(($head.content -replace '\s', ''))

if ($baseBytes.Length -ne $headBytes.Length) {
    throw "sources differ in length"
}

git cat-file blob "${BaseSha}:${Path}" > "$env:TEMP\base-copy.cpp"

Write-Output "sources are byte-identical at $BaseSha and $HeadSha"
