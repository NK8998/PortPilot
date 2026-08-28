[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string]$Path,
    [Parameter(Mandatory)][ValidateSet("ModuleGraph", "Plan")][string]$Kind,
    [string]$AssessmentPath,
    [string]$ModuleGraphPath
)

$ErrorActionPreference = "Stop"
$resolved = (Resolve-Path -LiteralPath $Path).Path
$document = Get-Content -Raw -LiteralPath $resolved | ConvertFrom-Json

# Hashes are computed by the read-only validators so that no validator can make its own input pass.
if ($Kind -eq "ModuleGraph") {
    $arguments = @{ Path = $resolved; Json = $true }
    if ($AssessmentPath) { $arguments.AssessmentPath = $AssessmentPath }
    $report = & (Join-Path $PSScriptRoot "Test-PortpilotModuleGraph.ps1") @arguments | ConvertFrom-Json
    $document.contentHash = $report.computedHash
    $document.review.reviewedHash = $report.computedHash
} else {
    $arguments = @{ Path = $resolved; Json = $true }
    if ($ModuleGraphPath) { $arguments.ModuleGraphPath = $ModuleGraphPath }
    $report = & (Join-Path $PSScriptRoot "Test-PortpilotPlan.ps1") @arguments | ConvertFrom-Json
    $document.contentHashes.assessment = $report.computedHashes.assessment
    $document.contentHashes.strategies = $report.computedHashes.strategies
    $document.contentHashes.plan = $report.computedHashes.plan
    $document.planReview.assessmentHash = $report.computedHashes.assessment
    $document.planReview.strategiesHash = $report.computedHashes.strategies
    $document.planReview.planHash = $report.computedHashes.plan
}

$document | ConvertTo-Json -Depth 30 | Set-Content -LiteralPath $resolved -Encoding utf8NoBOM
Write-Host "Wrote canonical $Kind hashes to '$resolved'."
