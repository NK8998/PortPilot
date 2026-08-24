[CmdletBinding()]
param(
    [switch]$SkipTests,
    [switch]$OpenProofs
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$root = Split-Path -Parent $PSScriptRoot
$required = @(
    ".github\workflows\portpilot.yml",
    "manifests\pocketsphinx\portpilot.yml",
    "manifests\whisper-cpp\portpilot.yml",
    "docs\PORTPILOT_ARCHITECTURE.md",
    "docs\HACKATHON_EVIDENCE.md"
)

function Invoke-Checked {
    param([scriptblock]$Command)
    & $Command
    if ($LASTEXITCODE -ne 0) {
        throw "Demo validation command failed with exit code $LASTEXITCODE."
    }
}

Push-Location $root
try {
    Write-Host "PortPilot hackathon demo"
    Write-Host "========================"

    foreach ($path in $required) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) {
            throw "Required demo asset is missing: $path"
        }
    }

    Write-Host "`n[1/5] Repository and contract integrity"
    Invoke-Checked { git --no-pager diff --check }
    Invoke-Checked { python scripts\validate_contracts.py }

    if (-not $SkipTests) {
        Write-Host "`n[2/5] Reusable engine tests"
        Invoke-Checked { python -m unittest discover -s tests -q }
    }
    else {
        Write-Host "`n[2/5] Reusable engine tests skipped for fallback playback"
    }

    Write-Host "`n[3/5] One workflow, two application manifests"
    Write-Host "  PocketSphinx: manifests\pocketsphinx\portpilot.yml"
    Write-Host "  whisper.cpp:  manifests\whisper-cpp\portpilot.yml"
    Write-Host "  Workflow:     .github\workflows\portpilot.yml"

    Write-Host "`n[4/5] Native Windows Arm64 proof"
    Write-Host "  PocketSphinx: https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611"
    Write-Host "  whisper.cpp:  https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799"
    Write-Host "  Expected PE machine: 0xAA64"

    Write-Host "`n[5/5] Evidence and honesty boundary"
    Write-Host "  docs\HACKATHON_EVIDENCE.md"
    Write-Host "  docs\WHISPER_CPP_FINDING_DISPOSITIONS.md"
    Write-Host "  Passing tests do not silently resolve static findings."

    if ($OpenProofs) {
        Start-Process "https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611"
        Start-Process "https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799"
    }
}
finally {
    Pop-Location
}
