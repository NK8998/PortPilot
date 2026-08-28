# MSBuild ARM64 checklist

## Toolchain gate

```powershell
vswhere -latest -products * `
  -requires Microsoft.VisualStudio.Component.VC.Tools.ARM64 `
  -property installationPath
```

Treat this as component-discovery evidence, not the final probe. ASAN components can install
ARM64-named payloads under paths such as `lib\arm64` and `bin\HostArm64\arm64` without installing
the C++ compiler. Directory existence is therefore never sufficient.

Require both a target compiler and a target CRT library:

```powershell
$vs = vswhere -latest -products * -property installationPath
$toolset = Get-ChildItem -LiteralPath "$vs\VC\Tools\MSVC" -Directory |
  Sort-Object Name |
  Select-Object -Last 1
$compiler = @(
  "$($toolset.FullName)\bin\Hostx64\arm64\cl.exe",
  "$($toolset.FullName)\bin\HostArm64\arm64\cl.exe"
) | Where-Object { Test-Path -LiteralPath $_ } | Select-Object -First 1
$crt = "$($toolset.FullName)\lib\arm64\libcpmt.lib"

if (-not $compiler -or -not (Test-Path -LiteralPath $crt -PathType Leaf)) {
  throw "The MSVC ARM64 compiler and CRT are not both installed."
}
```

An empty `vswhere` result or failed compiler/CRT probe is a blocked build environment, not
evidence that source cannot target ARM64. Record the Visual Studio version, component query,
resolved compiler and CRT paths, SDK version, host architecture, and exact MSBuild command.

## Visual Studio Installer recovery

Run `setup.exe modify` from a PowerShell process that was already started **as Administrator**.
Do not assume an installer UAC prompt repairs a non-elevated parent process.

- Exit 5007: restart from an elevated shell and rerun the exact modify command.
- Exit 8006: close every Visual Studio instance and quiesce MSBuild, compiler-server, test,
  debugger, and installer activity before retrying. Verify no relevant process remains rather
  than immediately repeating the command.

Retain the installer command, exit code, and log. After a reported success, rerun the compiler/CRT
probe; installer success alone does not prove the toolchain is usable.

## Compiler identity consistency

Do not let vcpkg choose one compiler while MSBuild compiles the product with another. Before
restore and again inside the MSBuild job, record and compare:

```powershell
Write-Host "VCToolsVersion=$env:VCToolsVersion"
Write-Host "WindowsSDKVersion=$env:WindowsSDKVersion"
Write-Host "cl=$((Get-Command cl.exe -ErrorAction Stop).Source)"
Write-Host "link=$((Get-Command link.exe -ErrorAction Stop).Source)"
cl.exe /Bv
where.exe cl.exe
where.exe link.exe
Write-Host "LIB=$env:LIB"
Write-Host "INCLUDE=$env:INCLUDE"
```

Assert that vcpkg's compiler-detection log and MSBuild resolve the same installed
`VCToolsVersion`, and that `cl.exe`, `link.exe`, `LIB`, and `INCLUDE` all share that toolset root.
Start from a clean developer environment; inherited paths from a prior `vcvars` invocation are a
hard failure. Explicitly log `PlatformToolset` and `WindowsTargetPlatformVersion`.

The verified OpenCppCoverage failure mixed vcpkg MSVC 14.44.35207 with project MSVC 14.29.30133
(`v142`) and SDK 10.0.26100.0. ARM64 compilation then failed in `winnt.h` with C3861
`_CountOneBits64`. Treat SDK-header failures involving compiler built-ins as likely toolset/SDK
identity mismatches before changing application source.

## Configuration completeness

- The solution has an ARM64 configuration.
- Every shipping and test project maps that configuration to ARM64 rather than x64.
- No project required for the product is silently skipped.
- Output/intermediate directories are architecture-distinct.
- Custom build tools are classified as host tools; their architecture is not confused with the
  target package architecture.
- A binary log proves the selected platform and imported property sheets.

Run both configurations far enough to load every project before restoring target dependencies:

```powershell
foreach ($configuration in "Debug", "Release") {
  msbuild CppCoverage.sln /m /t:PrepareForBuild `
    /p:Configuration=$configuration /p:Platform=ARM64 `
    /bl:"preflight-$configuration-arm64.binlog"
  if ($LASTEXITCODE -ne 0) { throw "ARM64 $configuration graph preflight failed." }
}
```

Reject logs containing `BaseOutputPath/OutputPath property is not set`, `not selected for
building`, invalid configuration/platform, or a shipping/test project mapped to x86/x64. This
preflight catches a solution that advertises ARM64 while individual projects remain x64-only,
even on a host where the ARM64 compiler is absent.

## DIA SDK

Visual Studio installs architecture-specific DIA artifacts. For an ARM64 target, prefer:

- `DIA SDK\lib\arm64\diaguids.lib`
- `DIA SDK\bin\arm64\msdia140.dll`

The build-host architecture does not select the packaged DIA runtime. The target architecture
does.

## Source encoding

MSVC decodes a translation unit as UTF-8 only when the file begins with a UTF-8 BOM
(`EF BB BF`) or when `/utf-8` is passed. Otherwise it decodes with the active code page.

A port that rewrites an upstream ANSI (Windows-1252) source as BOM-less UTF-8 therefore changes
what the compiler sees. In the OpenCppCoverage ARM64 port this turned
`#include "TestCoverageConsole/FileWithSpecialChar<e9><e0><e8>.hpp"` into UTF-8 bytes
`C3 A9 C3 A0 C3 A8`, which the compiler read as `FileWithSpecialCharÃ©Ã Ã¨.hpp` and rejected:

```
CodeCoverageRunnerTest.cpp(49,10): error C1083: Cannot open include file:
'TestCoverageConsole/FileWithSpecialCharÃ©Ã Ã¨.hpp': No such file or directory
```

This is not an architecture defect. It reproduces on any target whose compiling host uses a
non-UTF-8 active code page, and it was reproduced locally on `ACP=1252` with MSVC 14.44 using a
two-line fixture. Diagnose it by bytes, not by how an editor renders the file:

```powershell
$bytes = [System.IO.File]::ReadAllBytes($path)
$hasBom = $bytes.Length -ge 3 -and $bytes[0] -eq 0xEF -and $bytes[1] -eq 0xBB -and $bytes[2] -eq 0xBF
$nonAscii = [bool]($bytes | Where-Object { $_ -gt 0x7F })
$validUtf8 = $true
try { [void]([System.Text.UTF8Encoding]::new($false, $true)).GetString($bytes) } catch { $validUtf8 = $false }
# Broken: $nonAscii -and $validUtf8 -and -not $hasBom
# Correct: no BOM and invalid UTF-8 (genuine ANSI), or a UTF-8 BOM, or pure ASCII
```

Fix the file (save as UTF-8 with BOM, or restore the original ANSI bytes) and keep the
non-ASCII fixtures intact; renaming or deleting them removes real test coverage. Gate every
build with a check that also resolves each non-ASCII quoted include against the filesystem, and
never bulk-normalize encodings during a retarget.

## Host toolchain determinism

MSBuild can satisfy one target architecture from either the native or the cross host toolchain.
The choice is invisible in the project files and can differ between runs on the same runner
label, which turns any toolchain-sensitive failure into an intermittent one.

Measured on the OpenCppCoverage ARM64 port, on the same `windows-11-arm` runner label with the
same MSVC `14.44.35207`:

| Run | Commit | Host toolchain in the ARM64 job | Result |
| --- | --- | --- | --- |
| 32347208182 | `bf5cdc1` | `bin\HostArm64\arm64` (70) | `C1083` mojibake include |
| 32349116627 | `e74bc2f7` | `bin\HostX86\arm64` (95) + `bin\HostArm64\arm64` (5) | build succeeded |
| 32350427917 | `0c2ea8d` | `bin\HostArm64\arm64` (134) | build, tests, and end-to-end succeeded |

Read this table carefully, because it is also a worked example of a wrong inference. The mixed
flavour in the middle run is a genuine defect and is worth rejecting on its own terms. It is
**not** why that run passed. Host architecture plays no part in source decoding — only the active
code page does — and the three commits do not share source bytes:

| Commit | Blob | Bytes | First 3 | First non-ASCII run |
| --- | --- | --- | --- | --- |
| `bf5cdc1` | `b5c6e73e…` | 19203 | `2f 2f 20` | `c3 a9 c3 a0 c3 a8` |
| `e74bc2f7` | `822f29ac…` | 19184 | `2f 2f 20` | `e9 e0 e8` |
| `0c2ea8d` | `93f423da…` | 19206 | `ef bb bf` | `c3 a9 c3 a0 c3 a8` |

`e74bc2f7` holds the upstream Windows-1252 bytes and is correct by construction; `bf5cdc1` holds
BOM-less UTF-8 and would have failed under any host flavour. The original analysis claimed the
first two commits were byte-identical because it read them through the GitHub **contents** API,
which transcodes — see `evidence-integrity.md`. Keep the determinism rule; discard the causal
story it was first attached to.

Extract the flavours from any retained build log and refuse a mixed result:

```powershell
$log = Get-Content $buildLog -Raw
[regex]::Matches($log, 'bin\\Host[A-Za-z0-9]+\\[A-Za-z0-9]+') |
    ForEach-Object { $_.Value.ToLowerInvariant() } |
    Group-Object |
    Sort-Object Count -Descending
# One group per target architecture is required. Two or more means the build is not reproducible.
```

Pin the flavour with `PreferredToolArchitecture` and assert it at two layers, because a preflight
that probes a compiler does not prove which compiler MSBuild then invoked: fail the build from
`Directory.Build.targets` when the resolved value is wrong, and parse the actual `cl.exe`/`link.exe`
command lines out of the retained log afterwards. Pinning alone is not an encoding fix, and neither
is project-wide `/utf-8` when the tree legitimately contains ANSI fixtures: add a BOM to files that
should be UTF-8, leave correct Windows-1252 files as they are, and lock their inventory.

### A command-line pin is not self-enforcing

`Microsoft.Cpp.ToolsetLocation.props` opens with
`<Project TreatAsLocalProperty="PreferredToolArchitecture">`. That attribute is MSBuild's opt-out
from global-property immutability, so a value supplied as `/p:PreferredToolArchitecture=arm64` is
no longer protected and the imported props are free to reassign it. Passing the property is
therefore a request, not a guarantee.

Two runs of the same project on the same `windows-11-arm` label, both passing that `/p:` flag,
disagreed about which compiler ran:

| | `ec2cce74` job 96379608497 | `1a2b75c` job 96383245389 |
| --- | --- | --- |
| `PROCESSOR_ARCHITECTURE` | `ARM64` | `ARM64` |
| MSBuild | `setup-msbuild` `x86` → 32-bit `Bin\MSBuild.exe` | the same 32-bit binary, via `Get-Command` |
| `/p:PreferredToolArchitecture=arm64` | passed | passed |
| compilers invoked | `HostX86\arm64\CL.exe` ×32, `link` ×16 | `HostARM64\ARM64\cl.exe` ×75, `link` ×41 |

Both facts that look like explanations are ruled out by the table. The runner reports `ARM64`, so
the `'$(PROCESSOR_ARCHITECTURE)' != 'ARM64'` demotion in the same props file cannot be firing; and
both runs launched the *same* MSBuild executable, so the host flavour of the MSBuild process does
not distinguish them either. The remaining difference is in the trees, and at the time of writing
it has not been isolated.

That unresolved cause is the point, not a gap in the note. Host selection could not be predicted
from the property, from the runner, from the launched binary, or from a preflight probe — the
preflight in `ec2cce74` recorded `Hostarm64` and passed while the build used `HostX86`. The only
control that classified both runs correctly, without anyone understanding why they differed, was
parsing the invoked command lines out of the build log afterwards. Treat the log parse as the
authority and everything upstream of it as an unverified request.

## LIB purity has more than one legitimate ARM64 root

A gate that asserts "every MSVC library root must be the declared toolset's ARM64 root" is right in
intent and wrong if it tests `endsWith("\lib\arm64")`. The `LibraryPath` a real ARM64 build evaluates,
recovered verbatim from the binlog of a green native run, is:

```
...\VC\Tools\MSVC\14.44.35207\lib\ARM64;
...\VC\Tools\MSVC\14.44.35207\atlmfc\lib\ARM64;
...\Windows Kits\10\lib\10.0.26100.0\ucrt\arm64
```

The `atlmfc` root is the same toolset, the same architecture, and entirely correct. A suffix test
rejects it and so fails a build that is actually pure. Match instead on the path *after* the declared
version, allowing `lib\arm64`, `atlmfc\lib\arm64`, and the `spectre` variants of both, and keep
rejecting `lib\x64`, `lib\arm` (32-bit ARM is not ARM64), an `x86` atlmfc root, a `uwp` or `store`
subdirectory, and any root carrying a different toolset version — the last of these is the mixed-instance
failure this gate exists to catch.

Two procedural points, both learned the expensive way:

- **Read `LIB` and `INCLUDE` from the binlog, not from the job log.** The preflight prints what it
  probed; the binlog records what MSBuild evaluated. Decompress the binlog with GZip and search it, and
  remember values are URL-escaped there, so `;` appears as `%3b`.
- **A relaxation needs a rejection proof attached to it.** Before widening this predicate, run the
  *previous* predicate against the real path and show it returns false. Without that, "I loosened the
  gate and now it passes" is indistinguishable from "I disabled the gate". Every widening in this
  repository is paired with negative cases that still fail.