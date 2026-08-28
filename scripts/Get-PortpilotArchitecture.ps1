[CmdletBinding()]
param(
    [Parameter(Mandatory, Position = 0)][string]$Path,
    [ValidateSet("Any", "X86", "X64", "Arm", "Arm64", "Arm64EC", "Arm64X")]
    [string]$Expected = "Any",
    [switch]$Json
)

$ErrorActionPreference = "Stop"
$inspectorVersion = 1
$resolved = (Resolve-Path -LiteralPath $Path).Path

$machineNames = @{ 0x014c = "X86"; 0x01c0 = "Arm"; 0x01c4 = "Arm"; 0x8664 = "X64"; 0xaa64 = "Arm64" }

function Read-PortpilotPeRecord {
    param([Parameter(Mandatory)][string]$FilePath)

    $stream = [System.IO.File]::Open($FilePath, [System.IO.FileMode]::Open, [System.IO.FileAccess]::Read, [System.IO.FileShare]::ReadWrite)
    try {
        $reader = [System.IO.BinaryReader]::new($stream)
        if ($stream.Length -lt 64 -or $reader.ReadUInt16() -ne 0x5a4d) { return $null }
        $stream.Position = 0x3c
        $peOffset = $reader.ReadInt32()
        if ($peOffset -lt 0 -or ($peOffset + 24) -gt $stream.Length) { return $null }
        $stream.Position = $peOffset
        if ($reader.ReadUInt32() -ne 0x00004550) { return $null }

        $machine = $reader.ReadUInt16()
        $sectionCount = $reader.ReadUInt16()
        $stream.Position += 12
        $optionalHeaderSize = $reader.ReadUInt16()
        $stream.Position += 2
        $optionalHeaderOffset = $stream.Position
        $magic = $reader.ReadUInt16()
        $pe32Plus = $magic -eq 0x20b
        $directoryOffset = $optionalHeaderOffset + $(if ($pe32Plus) { 112 } else { 96 })

        # Section headers follow the optional header and are needed to map RVAs onto file offsets.
        $sections = @()
        $stream.Position = $optionalHeaderOffset + $optionalHeaderSize
        for ($i = 0; $i -lt $sectionCount; $i++) {
            if (($stream.Position + 40) -gt $stream.Length) { break }
            $stream.Position += 8
            $stream.Position += 4
            $virtualAddress = $reader.ReadUInt32()
            $rawSize = $reader.ReadUInt32()
            $rawPointer = $reader.ReadUInt32()
            $stream.Position += 16
            $sections += [pscustomobject]@{ VirtualAddress = $virtualAddress; RawSize = $rawSize; RawPointer = $rawPointer }
        }

        function Convert-RvaToOffset {
            param([uint32]$Rva)
            foreach ($section in $sections) {
                if ($Rva -ge $section.VirtualAddress -and $Rva -lt ($section.VirtualAddress + $section.RawSize)) {
                    return [int64]($section.RawPointer + ($Rva - $section.VirtualAddress))
                }
            }
            return -1
        }

        function Read-DirectoryRva {
            param([int]$Index)
            $entry = $directoryOffset + ($Index * 8)
            if (($entry + 8) -gt $stream.Length) { return 0 }
            $stream.Position = $entry
            return $reader.ReadUInt32()
        }

        $managed = (Read-DirectoryRva 14) -ne 0

        $hybrid = $false
        $dynamicRelocations = $false
        $loadConfigRva = Read-DirectoryRva 10
        if ($pe32Plus -and $loadConfigRva -ne 0) {
            $loadConfigOffset = Convert-RvaToOffset $loadConfigRva
            if ($loadConfigOffset -ge 0 -and ($loadConfigOffset + 4) -le $stream.Length) {
                $stream.Position = $loadConfigOffset
                $loadConfigSize = $reader.ReadUInt32()
                if ($loadConfigSize -ge 208 -and ($loadConfigOffset + 208) -le $stream.Length) {
                    $stream.Position = $loadConfigOffset + 192
                    $dynamicRelocations = $reader.ReadUInt64() -ne 0
                    $hybrid = $reader.ReadUInt64() -ne 0
                }
            }
        }

        $architecture = if ($machineNames.ContainsKey([int]$machine)) { $machineNames[[int]$machine] } else { "Unknown" }
        if ($architecture -eq "Arm64" -and $hybrid) {
            $architecture = if ($dynamicRelocations) { "Arm64X" } else { "Arm64EC" }
        }

        [ordered]@{
            path = $FilePath
            architecture = $architecture
            machine = "0x{0:X4}" -f $machine
            managed = $managed
            sha256 = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    } finally {
        $stream.Dispose()
    }
}

$files = if (Test-Path -LiteralPath $resolved -PathType Container) {
    @(Get-ChildItem -LiteralPath $resolved -File -Recurse | Where-Object { $_.Extension -in ".exe", ".dll", ".sys", ".node", ".pyd", ".lib" })
} else {
    @(Get-Item -LiteralPath $resolved)
}

$records = @()
$skipped = @()
foreach ($file in $files) {
    $record = Read-PortpilotPeRecord -FilePath $file.FullName
    if ($null -eq $record) { $skipped += $file.FullName } else { $records += $record }
}

$architectures = @($records | ForEach-Object { $_.architecture } | Select-Object -Unique | Sort-Object)
$mismatches = if ($Expected -eq "Any") { @() } else { @($records | Where-Object { $_.architecture -ne $Expected }) }

$result = [ordered]@{
    inspectorVersion = $inspectorVersion
    root = $resolved
    expected = $Expected
    inspected = $records.Count
    architectures = $architectures
    uniform = $architectures.Count -le 1
    mismatches = @($mismatches | ForEach-Object { [ordered]@{ path = $_.path; architecture = $_.architecture; machine = $_.machine } })
    nonPeFiles = @($skipped)
    binaries = @($records)
}

if ($Json) { $result | ConvertTo-Json -Depth 6 }
else {
    if ($records.Count -eq 0) { Write-Host "No PE binaries found under '$resolved'." }
    else { Write-Host "Inspected $($records.Count) binary(ies): $($architectures -join ', ')." }
    foreach ($mismatch in $result.mismatches) { Write-Error "Expected $Expected but found $($mismatch.architecture): $($mismatch.path)" -ErrorAction Continue }
}

if ($records.Count -eq 0 -and $Expected -ne "Any") { exit 1 }
if ($mismatches.Count -gt 0) { exit 1 }
