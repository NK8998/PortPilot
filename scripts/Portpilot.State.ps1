function Read-PortpilotState {
    param([Parameter(Mandatory)][string]$Path)
    if (-not (Test-Path -LiteralPath $Path -PathType Leaf)) { throw "Portpilot state '$Path' does not exist." }
    try { Get-Content -Raw -LiteralPath $Path | ConvertFrom-Json }
    catch { throw "Portpilot state is not valid JSON: $($_.Exception.Message)" }
}

function Write-PortpilotStateAtomic {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$State
    )
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $temporaryPath = "$Path.$([Guid]::NewGuid().ToString('N')).tmp"
    $backupPath = "$Path.$([Guid]::NewGuid().ToString('N')).bak"
    try {
        [System.IO.File]::WriteAllText($temporaryPath, ($State | ConvertTo-Json -Depth 30) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
        if (Test-Path -LiteralPath $Path) {
            [System.IO.File]::Replace($temporaryPath, $Path, $backupPath, $true)
        } else {
            [System.IO.File]::Move($temporaryPath, $Path)
        }
    } finally {
        if (Test-Path -LiteralPath $temporaryPath) { Remove-Item -LiteralPath $temporaryPath -Force }
        if (-not (Test-Path -LiteralPath $Path) -and (Test-Path -LiteralPath $backupPath)) {
            [System.IO.File]::Move($backupPath, $Path)
        } elseif (Test-Path -LiteralPath $backupPath) {
            Remove-Item -LiteralPath $backupPath -Force
        }
    }
}

function Add-PortpilotJournalRecord {
    param(
        [Parameter(Mandatory)][string]$Path,
        [Parameter(Mandatory)]$Record
    )
    $parent = Split-Path -Parent $Path
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    $line = $Record | ConvertTo-Json -Depth 10 -Compress
    [System.IO.File]::AppendAllText($Path, $line + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}