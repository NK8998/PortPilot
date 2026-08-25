---
name: port-packaging
description: Builds and audits evidence-backed Windows ARM64 release packages after the binaries have been verified. Use in S7 when producing ZIP, MSIX/MSIXBundle, MSI, wheels, checksums, release manifests, and packaged-runtime proof.
---

# Port packaging

Package only what should ship, prove the packaged bytes are native ARM64, and
preserve lineage back to the source commit. Use this after
`arm64-artifact-verification` and native runtime evidence from
`arm64-remote-verification` or `arm64-ci-integration`.

This skill focuses on ARM64 release traps: x64 binaries leaking into archives,
foreign redistributables in vendor folders, package tests that run build output
instead of shipped bytes, and Windows on Arm silently running x64 under emulation.

## Inputs

- Source commit, patch identity, dependency and license inventory.
- Final ARM64 Release output and retained x64 baseline.
- Product allowlist: files and required directories that belong in the package.
- S6 native runtime evidence from real ARM64 hardware or `windows-11-arm` CI.
- Existing package format, signing, and release conventions.

## Required supporting files

The eval harness depends on verbatim copies of `patterns/rules.json` and `references/verified-release.md` from Lynn's port-packaging skill.

Use helper scripts from the consolidated tree:

- `/home/t-neilkainga/hackathon/.consolidated/scripts/New-ReleaseManifest.ps1`
- `/home/t-neilkainga/hackathon/.consolidated/scripts/Test-ReleaseCandidate.ps1`

Do not edit, reorder, or renumber `patterns/rules.json` unless the golden evals
are intentionally updated.

## Procedure

### 1. Pick the package format deliberately

Use an allowlisted ZIP for portable tools. Use MSIX/MSIXBundle when the app
needs package identity, capabilities, Store-style deployment, or install/uninstall
semantics. Use MSI/WiX when that is already the project convention.

ARM64 checks by format:

- MSIX: set `ProcessorArchitecture="arm64"`; for multi-arch releases, test the
  ARM64 package from the bundle on ARM64 Windows.
- MSI/WiX: audit hardcoded `Program Files (x86)`, x64 launch conditions, x64
  custom actions, and `WOW6432Node` registry assumptions.
- Python wheels: require a `win_arm64.whl` filename and scan every bundled
  `.pyd`, `.dll`, and `.exe` for PE machine `0xAA64`.

### 2. Stage from an allowlist

Create a fresh staging directory from named product files. Never compress a
build root with wildcards. Exclude generators such as `protoc.exe`, package
managers such as `nuget.exe`, tests, caches, logs, object files, and host-only
helpers.

Materialize every required runtime directory with at least one placeholder file.
ZIP packages do not reliably preserve empty directories; OpenCppCoverage needed
`Plugins\Exporter` to survive because startup enumerated it.

### 3. Filter redistributables by PE machine

Do not copy vendor redistributable folders by glob. Microsoft's own `arm64` VC
redist directory ships an x64 `vcruntime140_1.dll` with Machine `0x8664`; the
packaging gate must reject it.

Filter runtime DLLs by PE machine value, assert required ARM64 DLLs such as
`vcruntime140.dll` and `msvcp140.dll` survived, and record accepted/rejected
files in a manifest. Dropping a DLL is safe only when the packaged end-to-end run
proves nothing imports it.

### 4. Scan staging, then package

Run a strict PE scan on staging and keep the command, exit code, commit, and file
manifest. Then generate release metadata from the exact staged bytes:

```powershell
$consolidated = '/home/t-neilkainga/hackathon/.consolidated'
& "$consolidated/scripts/New-ReleaseManifest.ps1" `
  -StagePath .\stage `
  -OutputPath .\release\manifest.json
Compress-Archive -Path .\stage\* -DestinationPath .\release\app-arm64.zip -Force
Get-FileHash .\release\app-arm64.zip -Algorithm SHA256
```

Write `SHA256SUMS.txt`, package name, source commit, license inventory, and the
packaging command line into release evidence.

### 5. Re-expand and scan the package

Do not trust the build output directory. Re-expand the built package, compare
every file and hash to the manifest, then recursively scan every PE image inside
the expanded package. Lynn's OpenCppCoverage evidence scanned 34 PE images across
154 files in the packaged ZIP; that package-byte scan is the standard.

For ZIPs:

```powershell
& "$consolidated/scripts/Test-ReleaseCandidate.ps1" `
  -PackagePath .\release\app-arm64.zip `
  -ManifestPath .\release\manifest.json `
  -ExpectedSha256 '<64 lowercase hex chars>'
```

For MSIX/MSIXBundle, unpack and scan payloads, verify signatures, then install,
launch, and uninstall on ARM64 hardware. For wheels, unzip or use the wheel
architecture script, then validate in a clean ARM64 venv without importing from
the source tree.

### 6. Execute packaged bytes on ARM64

A PE scan cannot prove runnability. Execute from the re-expanded or installed
package, not from build output. Cover the real entry point: CLI, GUI launch,
service start, plugin enumeration, or deterministic workload. Preserve output and
exit codes.

For Python wheels, model PocketSphinx: build a `win_arm64` wheel, audit bundled
PE files, download it in a separate `windows-11-arm` job, install into a new
virtual environment, import, run tests, and execute a representative workload.

### 7. Ship a matched x64 negative control

A positive ARM64 run alone is not proof because Windows on Arm can emulate x64.
Send the same checksum-pinned ARM64 artifact to an x64 runner and require it to
refuse to start. Also retain or ship the x64 artifact as a genuinely different
binary.

The x64 control must verify checksum, assert PE `0xAA64`, attempt launch on
non-ARM64 Windows, and pass only if the process does **not** start with native
error `193` (`ERROR_BAD_EXE_FORMAT`) or `216`
(`ERROR_EXE_MACHINE_TYPE_MISMATCH`). A process that starts is a failure. Use
`/home/t-neilkainga/hackathon/.consolidated/.github/workflows/prove-native-arm64-rust.yml`
as the reference pattern.

### 8. Publish only after download verification

Follow `references/verified-release.md`: publish from a protected tag or manual
workflow, never from a pull request. After publication, download the assets over
HTTPS, verify `SHA256SUMS.txt`, re-expand, repeat the PE scan, and run the ARM64
smoke on downloaded bytes. Only then mark `release.json` as `published`.

## Release evidence

Record source commit, patch identity, package command/script version, full file manifest, package SHA-256, staged and re-expanded scans, packaged runtime output, x64 negative-control output, x64 artifact identity, licenses, attributions, and source availability.

## Judgment rules

- Refuse readiness if build, tests, PE scan, package expansion, or native runtime
  evidence is missing.
- Independently parse test logs; a green workflow cannot override failed counts,
  nonzero exits, or `0 passed` vacuous runs.
- Treat the scanner as a gate and also as suspect: reproduce surprising scanner
  failures with an independent PE parser. Arm64X CRT modules can have code-map
  ranges spanning adjacent sections.
- Any gate relaxation must prove the gate still rejects a known-bad input.
## Output

Emit `PKG-` findings for defects. A successful S7 package includes the artifact,
manifest, checksums, license/source references, strict scan evidence, packaged
runtime evidence, x64 negative-control evidence, and schema-valid `release.json`.
