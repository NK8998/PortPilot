---
name: arm64-artifact-verification
description: Prove that built and packaged artifacts are really native ARM64 by inspecting executable headers and bundled binaries, not by trusting build success, path names, or package tags. Use at S6 after every ARM64 build and before packaging, release, or parity claims.
---

# ARM64 Artifact Verification (S6)

## Purpose

A successful build exit code is not proof of architecture. Build systems can
silently reuse stale x64 artifacts, fall back to default targets, copy a wrong
runtime DLL into an ARM64 package, or produce a compatibility/hybrid binary when
you expected classic native ARM64.

This skill proves what the artifact is by reading the binary format itself. Use
it after every build that is supposed to produce ARM64 output, on every file you
ship, before `port-packaging`, `arm64-remote-verification`, or release claims.

## Tools

The consolidated scripts live in `/home/t-neilkainga/hackathon/.consolidated/scripts/`:

- `verify_arch.py` — cross-platform PE/ELF/Mach-O header reader, pure Python, no
  native inspection tools required.
- `Test-PeArchitecture.ps1` — Windows PE verifier for `.exe`, `.dll`, `.pyd`,
  `.node`, `.sys`, and related native payloads.
- `Test-WheelArchitecture.ps1` — audits Python wheel tags and bundled PE files.
- `Get-PortpilotArchitecture.ps1` — direct PE parser with ARM64EC/ARM64X
  heuristics from load-config/hybrid metadata.

## PE facts to preserve

| PE machine | Meaning |
|---|---|
| `0xAA64` | ARM64 machine field |
| `0x8664` | x64 / AMD64 |
| `0x014c` | x86 / I386 |

Important nuance: **`AA64` alone does NOT distinguish classic ARM64 from
ARM64EC.** ARM64EC/ARM64X classification needs load-config and hybrid metadata.
`verify_arch.py` currently reports the machine architecture and does not make
that distinction; when the distinction matters, use `Get-PortpilotArchitecture.ps1`.

Some tools or older scripts may expose ARM64EC as a separate machine value such
as `0xA641`, but do not rely on the machine field alone for modern hybrid PE
classification. Record exactly which script made the determination.

## Basic usage

Verify one binary:

```bash
python /home/t-neilkainga/hackathon/.consolidated/scripts/verify_arch.py \
  path/to/app.exe --expect arm64
```

Verify a package directory recursively:

```bash
python /home/t-neilkainga/hackathon/.consolidated/scripts/verify_arch.py \
  path/to/dist --expect arm64 --recurse
```

On Windows, collect JSON evidence with the PowerShell verifier:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/Test-PeArchitecture.ps1 `
  -Path C:\port\dist `
  -ExpectedMachine ARM64 `
  -OutputPath artifacts\s6-parity\pe-architecture.json
```

For ARM64EC or ARM64X decisions:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/Get-PortpilotArchitecture.ps1 `
  C:\port\dist -Expected Arm64EC -Json
```

Wire these commands into CI as hard gates. The command must exit nonzero on a
mismatch, on no binaries found when binaries are expected, and on unreadable
artifacts.

## What to scan

Scan the actual release candidate, not just the compiler output directory:

- main `.exe` files
- every `.dll`, `.pyd`, `.node`, `.sys`, and native helper executable
- plugin directories and optional feature modules
- bundled runtimes and redistributables
- installer payloads after layout/copy steps
- archive contents after unpacking
- Python wheels and any native libraries inside them

Do not trust directory names, compiler selection, `PROCESSOR_ARCHITECTURE`, wheel
filename tags, NuGet runtime IDs, or CI matrix labels.

Hard-won packaging trap: **Microsoft's own `arm64` VC redist directory ships an
x64 `vcruntime140_1.dll` (Machine `0x8664`)**. Therefore scan every file you
package; a trusted vendor path or directory named `arm64` is not evidence.

## Python wheel audit

A Windows ARM64 wheel must satisfy both checks:

1. The filename tag ends in `win_arm64.whl`.
2. Every bundled PE image (`.pyd`, `.dll`, `.exe`, and similar native payloads)
   is native ARM64 for a pure native wheel.

Run:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/Test-WheelArchitecture.ps1 `
  -WheelPath wheelhouse\package-version-cp312-cp312-win_arm64.whl `
  -OutputPath artifacts\s6-parity\wheel-architecture.json
```

Reject a wheel that has the right tag but carries x64 payloads. For native
extension projects, also record the Python process architecture from the build
log and validate clean install/import/tests in a separate native ARM64 job.

## Stale artifact defenses

- Clean the output directory before the verified build, or record a manifest of
  file hashes before and after.
- Verify timestamps and SHA-256 hashes in the evidence report so a copied old
  binary cannot masquerade as a new one.
- Verify the packaged layout after installer/package generation, not only the
  intermediate build output.
- Fail if the scan inspects zero binaries; that is vacuous green.
- Keep JSON reports with the build artifacts.

## Interpreting results

| Result | Meaning | Next step |
|---|---|---|
| All expected files report ARM64 | This artifact set is architecture-confirmed | Continue to `arm64-remote-verification` and `port-completeness` |
| Any file reports `0x8664` or x64 | Wrong-target or stale x64 artifact | Return to `build-retarget` or dependency audit; do not package |
| Any file reports `0x014c` or x86 | 32-bit payload in native package | Remove, rebuild, or document only if deliberately supported out of process |
| Hybrid/ARM64EC appears unexpectedly | Strategy/build target mismatch | Re-check `arm64-strategy-selection` and build flags |
| No binaries found | The verifier measured nothing | Fix the path or package extraction and rerun |
| Architecture matches but app fails | Architecture is proven; bug is runtime correctness | Move to `arm64-failure-diagnosis` |

## Evidence checklist

- [ ] Verification ran against the immutable release candidate path.
- [ ] Every shipped native binary appears in the report.
- [ ] Expected architecture is explicit for each component, including any
      intentional ARM64EC/ARM64X exception from `arm64-strategy-selection`.
- [ ] No x64 (`0x8664`) or x86 (`0x014c`) payload remains in a pure ARM64 package.
- [ ] Python wheels have `win_arm64` tags and ARM64 native payloads.
- [ ] JSON evidence includes paths, architecture, machine value, and hashes.
- [ ] The scan cannot pass over an empty file set.

## Output

Store reports under `artifacts/s6-parity/` and summarize: files inspected,
architectures found, mismatches, tool/script used, and any honest limitation
(such as `verify_arch.py` not distinguishing classic ARM64 from ARM64EC).
