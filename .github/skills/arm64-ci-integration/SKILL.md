---
name: arm64-ci-integration
description: Adds authoritative native Windows ARM64 CI using GitHub-hosted windows-11-arm runners. Use in S7 when making ARM64 builds, tests, package verification, and release gates run continuously instead of as one-off local checks.
---

# ARM64 CI integration

Use this skill when a Windows ARM64 port needs permanent CI coverage. GitHub-
hosted `windows-11-arm` runners are what make native ARM64 CI possible. When no
local ARM64 hardware is available, CI is the authoritative verification path.

CI does not replace `arm64-artifact-verification` or `arm64-remote-verification`.
It must assert the runner is really ARM64 and verify artifact architecture. A
green build on an ARM64 runner does not prove the artifact is ARM64, because
Windows on Arm can run x64 binaries under emulation.

## Inputs and references

- Build target from `build-retarget`.
- Toolchain strategy from `arm64-build-environment`.
- Artifact checks from `arm64-artifact-verification`.
- Optional hardware smoke expectations from `arm64-remote-verification`.

Reference templates: `/home/t-neilkainga/hackathon/.consolidated/templates/ci/windows-arm64.yml`, `/home/t-neilkainga/hackathon/.consolidated/.github/workflows/pocketsphinx-arm64.yml`, and `/home/t-neilkainga/hackathon/.consolidated/.github/workflows/prove-native-arm64-rust.yml`.

## Non-negotiables

1. Use `windows-11-arm` for native Windows ARM64 build and runtime jobs.
2. Keep x64 and ARM64 in the same required workflow so x64 cannot regress.
3. Assert host/toolchain architecture before trusting results.
4. Inspect produced `.exe`, `.dll`, `.pyd`, or package payloads directly.
5. Run tests natively; do not cross-compile and skip execution.
6. Upload evidence artifacts even on failure.
7. Let parallel jobs upload unique artifacts; publish once downstream.
8. Make secret-dependent steps skip cleanly when secrets are unavailable.

## Procedure

### 1. Extend the existing workflow style

Add ARM64 to the project's existing matrix or job structure:

Use a matrix with `windows-latest` for x64 and `windows-11-arm` for ARM64, with `fail-fast: false`, matching the consolidated template.

Check the Windows ARM64 runner image before installing tools; MSVC ARM64, CMake,
vcpkg, .NET, Node, Python, Rust, and Go may already be present.

### 2. Assert the host is ARM64

At the start of every ARM64 runtime job:

```powershell
$ErrorActionPreference = 'Stop'
"PROCESSOR_ARCHITECTURE=$env:PROCESSOR_ARCHITECTURE"
$osArch = [System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture
"OSArchitecture=$osArch"
if ($env:PROCESSOR_ARCHITECTURE -ne 'ARM64' -and "$osArch" -ne 'Arm64') {
  throw 'This job is not running on native ARM64 Windows.'
}
```

Assert language toolchains too. The Rust reference workflow checks `rustc -vV`
and requires `aarch64-pc-windows-msvc`, which an emulated x64 process would not
report.

### 3. Build and test natively

Use the project's normal target mechanism:

For CMake/MSVC, configure with `-A ARM64`, build Release, then run `ctest` on `windows-11-arm`.

Do not treat skipped tests as success. Parse output when a runner can exit 0 for
zero executed tests. The Rust workflow fails `0 passed`; the PocketSphinx
workflow records CTest failures and fails unexpected ARM64 failures.

### 4. Verify artifact architecture

After every ARM64 build, scan the actual output files:

```powershell
$binaries = Get-ChildItem -Path build -Recurse -Include *.exe,*.dll,*.pyd -File
if (-not $binaries) { throw 'No binaries found to verify.' }
foreach ($b in $binaries) {
  $line = (dumpbin /headers $b.FullName | Select-String 'machine \(' | Select-Object -First 1).ToString()
  "$($b.Name): $($line.Trim())"
  if ($line -notmatch 'AA64') { throw "Not ARM64: $($b.FullName) => $line" }
}
```

If `dumpbin` is unavailable, use a PE COFF machine-field parser. For packages,
expand the package first and scan the payload, not just the build directory.

### 5. Add package-specific native checks

For Python wheels, use `actions/setup-python` with `architecture: arm64`, build a
`win_arm64` wheel, scan bundled PE payloads for `0xAA64`, then validate in a
separate clean-install `windows-11-arm` job without importing from the source
tree.

For Rust, verify the host triple, build release, run non-vacuous tests, parse PE
machine `0xAA64`, package the exact binary, and upload a checksum-pinned
artifact.

For installers or archives, call `port-packaging`: re-expand, scan all PE files,
run from packaged bytes on ARM64, and include the x64 negative control.

### 6. Prove release candidates with positive and negative controls

For release evidence, combine:

- positive control on `windows-11-arm`: checksum, expand/install, scan, execute;
- negative control on non-ARM64 Windows: same checksum, assert PE `0xAA64`, then
  require launch refusal with native error `193` or `216`.

The same checksum-pinned bytes must run on ARM64 and refuse on x64; an emulated
x64 binary cannot satisfy both directions.

### 7. Avoid parallel-job races

Parallel x64/ARM64 jobs should each upload a uniquely named artifact. Do not let
each matrix leg create or mutate the same release, package feed, cache key, or
external publish target. That causes intermittent `not found` or `already exists`
failures.

Fix pattern: N parallel build-and-upload jobs, then one downstream job depending
on all of them that downloads artifacts, verifies lineage/checksums, and performs
the single shared publish action.

### 8. Guard optional secrets inside step scripts

Forks, personal branches, and dry runs often lack signing or publish secrets.
Check for each secret inside the step script, not in a workflow-level condition,
because CI systems can reject or restrict secret references in conditions.

Pattern: set the secret into the step environment, test it in PowerShell, print a clear skip message, and `exit 0` when absent.

Missing production secrets should not fail a fork PR, but publication jobs must
still refuse to publish unsigned artifacts when signing is mandatory.

## Evidence to upload

Upload runner/toolchain architecture, x64 and ARM64 logs, native test summaries, PE reports for shipped binaries, package manifests/checksums/scans, `windows-11-arm` runtime output, and x64 negative-control output for release candidates.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| Green ARM64 job emits x64 | Missing target mapping or cached output | Add PE assertion and clean build paths. |
| Tests show `0 passed` | Vacuous invocation/filter | Parse executed counts and fail zero-test runs. |
| ARM64 job skipped | Matrix condition excludes it | Check matrix and per-step conditions. |
| x64 regresses | ARM64-only workflow | Keep x64 and ARM64 required together. |
| Publish randomly fails | Parallel jobs mutate one resource | Publish once downstream. |
| Fork PR fails on missing secret | Secret required unconditionally | Check inside the step and skip clearly. |
| PR page is stale | UI/cache lag | Inspect actual commit/ref or run jobs. |

## Handoff

Once CI is green and evidence uploaded, finish S7 with `port-packaging`. If CI
exposes target-only failures, use `arm64-failure-diagnosis` and verify fixes
through the same `windows-11-arm` path.
