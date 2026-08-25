---
name: arm64-build-environment
description: Establish and classify the local, CI, or remote toolchain for Windows ARM64 builds and runs. Use when S4 needs to know whether local cross-builds, native execution, or CI/ARM64 VM verification is authoritative.
---

# ARM64 Build Environment (S4)

Set up enough environment to build for the target ABI selected by
`arm64-strategy-selection`, and be explicit about what cannot be verified
locally. A missing local capability is not a source bug.

This skill supports `build-retarget`, `arm64-ci-integration`, and
`arm64-remote-verification`.

## Core rule

Cross-compiling on an x64 dev box is fine. **Runtime claims are not.** The dev
box is x64 Linux/Windows and cannot execute Windows ARM64 binaries natively.
Every statement about startup, tests, plugins, performance, or runtime behavior
must come from CI on ARM64 hardware or the Windows 11 ARM64 VM.

If local verification is impossible because of missing components, permissions,
or managed-machine policy, stop trying to force a workaround. Treat CI or the
remote ARM64 VM as authoritative and record exactly what was and was not proven.

## Inputs

- S3 ABI decision from `arm64-strategy-selection`
- Retarget plan from `build-retarget`
- Required compiler, linker, SDK, package manager, and test/runtime stack
- CI runner availability and ARM64 VM access status

## Probe local capability

Use the consolidated capability probe first when PowerShell is available:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/Get-PortpilotLocalCapability.ps1 -Json
/home/t-neilkainga/hackathon/.consolidated/scripts/Get-PortpilotLocalCapability.ps1 `
  -OutputPath artifacts/s4-bringup/local-capability.json
```

It reports:

- host OS and process architecture
- Visual Studio installation count
- for `x86`, `x64`, and `arm64`: `buildCapable`, `runCapable`,
  `nativeRunCapable`, `compilerPath`, and `linkerPath`

Interpretation:

- `targets.arm64.buildCapable=true`: local Windows ARM64 compilation can be
  attempted.
- `targets.arm64.runCapable=false`: do not run or smoke-test the artifact here.
- `targets.arm64.nativeRunCapable=false`: any runtime result from this machine
  is not native ARM64 proof.
- No compiler/linker path: document the missing component and use CI/VM for the
  build or final link if it cannot be installed safely.

## Visual Studio/MSBuild probes

For MSBuild projects, resolve tools fail-closed:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/ResolveMSBuild.ps1 `
  -HostArchitecture arm64 -Project App.sln -Configuration Release -Platform ARM64 `
  -SummaryPath artifacts/s4-bringup/msbuild-resolution.json
```

Then assert the actual compiler/linker invocations after a build:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/Assert-BuildToolchain.ps1 `
  -BuildLog artifacts/s4-bringup/build.log -ExpectedHost HostArm64 `
  -SummaryPath artifacts/s4-bringup/toolchain-assertion.json
```

Directory existence is not enough. ASAN payloads can create ARM64-named folders
without the C++ ARM64 compiler. Require `cl.exe`, `link.exe`, target CRT
libraries, and a coherent `VCToolsVersion`/SDK pair.

## Choose the authority for each claim

| Claim | Local x64 dev box | Local Windows with ARM64 tools | ARM64 CI/VM |
|---|---|---|---|
| Build graph loads | yes | yes | yes |
| Cross-compile/link | maybe | yes if components exist | yes |
| PE architecture | yes, by inspection | yes, by inspection | yes |
| App starts natively | no | only if native ARM64 hardware | yes |
| Tests/runtime behavior | no | only if native ARM64 hardware | yes |
| Performance/power | no | only if native ARM64 hardware | yes |

Use `arm64-artifact-verification` for PE inspection. Use
`arm64-remote-verification` for the ARM64 VM and `arm64-ci-integration` for
hosted or self-hosted ARM64 CI coverage.

## When local setup is appropriate

Install or enable only the target components the project already needs:

- Visual Studio C++ ARM64/ARM64EC build tools and Windows SDK for MSBuild/CMake
- Target triples/toolchain components for Rust, Go, .NET, Java, Python wheels, or
  project package managers
- Native dependency triplets such as vcpkg `arm64-windows` only when the strategy
  selected native ARM64 for that component

Prefer adding a target/component to an existing toolchain over inventing a new
build route. Respect managed machines: do not enable machine-wide settings,
large installs, symlinks/developer mode, or elevation-heavy workarounds on
infrastructure you do not own.

## When to defer to CI or VM

Defer and document when:

- The ARM64 compiler, linker, CRT, SDK, or package manager target is missing.
- Installing it requires admin approval or would mutate shared infrastructure.
- Local build can compile but final link/package needs unavailable target libs.
- The artifact can be built but not run natively on the local machine.
- The failure reproduces only on the target architecture.

Record a status such as: "Local: graph and compile through object generation
verified; final link requires missing ARM64 CRT. Authority for link/run is
`arm64-ci-integration` run <id>."

## Evidence to capture

- Output JSON from `Get-PortpilotLocalCapability.ps1`
- Exact toolchain commands and versions
- `vswhere`/Visual Studio component evidence when relevant
- `ResolveMSBuild.ps1` summary and post-build `Assert-BuildToolchain.ps1`
  summary for MSBuild
- Clear `verifiedLocally`, `deferredToCi`, and `deferredToVm` entries in
  `PORT_STATE.json`

## Hand-off

- If build files need changes, continue with `build-retarget`.
- If artifact architecture must be proven, run `arm64-artifact-verification`.
- If runtime behavior must be proven, run `arm64-remote-verification` or
  `arm64-ci-integration`.
- If only CI can reproduce a failure, use `arm64-failure-diagnosis` in CI-only
  mode.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| "ARM64 tools installed" from directory names | ASAN or partial payloads present | Probe `cl.exe`, `link.exe`, and CRT |
| Local build treated as runtime proof | Cross-compiled artifact never ran natively | Verify on ARM64 VM/CI |
| Tool install demands admin on managed host | Environment limitation | Record and defer; do not force workaround |
| Build and dependency restore use different compilers | Stale PATH/LIB/INCLUDE or mixed VS versions | Clean env and assert one toolset |
| CI result differs from local | CI is the only native path or has different tools | Diagnose from raw CI evidence |
