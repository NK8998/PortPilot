[CmdletBinding()]
param(
    [string]$OutputPath,
    [switch]$Json
)

$ErrorActionPreference = "Stop"
$osArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture.ToString()
$processArchitecture = [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture.ToString()
$windows = [System.Runtime.InteropServices.RuntimeInformation]::IsOSPlatform([System.Runtime.InteropServices.OSPlatform]::Windows)
$installations = @()

if ($windows) {
    $vswhere = Join-Path ${env:ProgramFiles(x86)} "Microsoft Visual Studio\Installer\vswhere.exe"
    if (Test-Path -LiteralPath $vswhere -PathType Leaf) {
        $installationPaths = @(& $vswhere -products * -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath 2>$null | Where-Object { $_ })
        foreach ($installationPath in $installationPaths) {
            $toolsRoot = Join-Path $installationPath "VC\Tools\MSVC"
            $versionDirectory = Get-ChildItem -LiteralPath $toolsRoot -Directory -ErrorAction SilentlyContinue |
                Sort-Object { try { [version]$_.Name } catch { [version]"0.0" } } -Descending |
                Select-Object -First 1
            if ($versionDirectory) {
                $installations += [ordered]@{ installationPath = $installationPath; msvcVersion = $versionDirectory.Name; binPath = Join-Path $versionDirectory.FullName "bin" }
            }
        }
    }
}

function Get-TargetCapability {
    param([Parameter(Mandatory)][string]$Target)
    $compilerPath = $null
    $linkerPath = $null
    foreach ($installation in $installations) {
        foreach ($hostDirectory in @(Get-ChildItem -LiteralPath $installation.binPath -Directory -Filter "Host*" -ErrorAction SilentlyContinue)) {
            $candidateCompiler = Join-Path $hostDirectory.FullName "$Target\cl.exe"
            $candidateLinker = Join-Path $hostDirectory.FullName "$Target\link.exe"
            if ((Test-Path -LiteralPath $candidateCompiler -PathType Leaf) -and (Test-Path -LiteralPath $candidateLinker -PathType Leaf)) {
                $compilerPath = $candidateCompiler
                $linkerPath = $candidateLinker
                break
            }
        }
        if ($compilerPath) { break }
    }

    $targetArchitecture = switch ($Target) { "x86" { "X86" }; "x64" { "X64" }; "arm64" { "Arm64" } }
    $nativeRunCapable = $windows -and $osArchitecture -eq $targetArchitecture
    $runCapable = $nativeRunCapable -or ($windows -and $osArchitecture -eq "X64" -and $targetArchitecture -eq "X86") -or ($windows -and $osArchitecture -eq "Arm64" -and $targetArchitecture -in @("X86", "X64"))
    [ordered]@{
        buildCapable = $null -ne $compilerPath
        runCapable = $runCapable
        nativeRunCapable = $nativeRunCapable
        compilerPath = $compilerPath
        linkerPath = $linkerPath
    }
}

$result = [ordered]@{
    schemaVersion = 1
    generatedAtUtc = [DateTime]::UtcNow.ToString("o")
    operatingSystem = if ($windows) { "Windows" } else { [System.Runtime.InteropServices.RuntimeInformation]::OSDescription }
    osArchitecture = $osArchitecture
    processArchitecture = $processArchitecture
    visualStudioInstallationCount = $installations.Count
    targets = [ordered]@{
        x86 = Get-TargetCapability "x86"
        x64 = Get-TargetCapability "x64"
        arm64 = Get-TargetCapability "arm64"
    }
}

if ($OutputPath) {
    $parent = Split-Path -Parent $OutputPath
    if ($parent) { New-Item -ItemType Directory -Path $parent -Force | Out-Null }
    [System.IO.File]::WriteAllText($OutputPath, ($result | ConvertTo-Json -Depth 8) + [Environment]::NewLine, [System.Text.UTF8Encoding]::new($false))
}
if ($Json -or -not $OutputPath) { $result | ConvertTo-Json -Depth 8 }
