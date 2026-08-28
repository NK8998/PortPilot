---
name: native-dependency-analysis
description: Audits native dependency manifests, archives, vendored binaries, and acquisition scripts until every shipped dependency has an ARM64 disposition. Use when entering S2, when a dependency or loader failure appears, or before choosing native ARM64 versus ARM64EC.
---

# Native Dependency Analysis (S2)

This is where most ARM64 ports become blocked or become simple. Prove the native
payload graph, not the README. A dependency with no ARM64 build, no source, and
no viable replacement is a project-level blocker, not a coding task.

## Inputs

- Exact source commit and S0/S1 artifacts from `arm64-readiness`
- Dependency manifests, lock files, restore scripts, submodules, vendored trees,
  download URLs, checksums, and package caches
- Restored archive contents when available
- Build-tool layout and final target package or staging layout
- Any known loader traces, copy scripts, import libraries, plugins, services, or
  installer payloads

## Procedure

1. Read acquisition scripts and lock files before inspecting binaries. Identify
   all sources of native payload: vcpkg, NuGet, Conan, ZIP/tar downloads, npm,
   Python wheels, Rust crates with native build scripts, Go cgo, vendor SDKs,
   checked-in binaries, generated installers, and toolchain-provided DLLs.
2. Enumerate transitively with the ecosystem's own tool where possible:
   `vcpkg list`, `dotnet list package --include-transitive`, `npm ls --all`,
   `cargo tree`, `pip freeze`, `go list -m all`, and build-script scans for
   `ExternalProject_Add`, submodules, and custom download steps.
3. Require immutable versions and SHA-256 verification before extraction. Mutable
   `latest` endpoints are supply-chain findings even when architecture-neutral.
4. Expand every NuGet, ZIP, SDK, or archive inventory. Do not infer contents from
   package names, docs, or directory labels.
5. Run `patterns/rules.json` as a seed pass and judge each hit in context.
6. Follow `references/archive-audit.md` to classify every executable or library
   as shipped runtime, link input, host build tool, test-only target, or data.
7. Prove the target compiler and CRT exist. Retain vcpkg/compiler detection
   output, and compare `VCToolsVersion`, `LIB`, `INCLUDE`, `cl`, and `link` paths
   against the project build. A restore with a different MSVC version is not
   valid target evidence.
8. Trace every target native dependency to an ARM64 build, a source-build plan,
   an upgrade, a replacement, an ARM64EC bridge decision, or a blocker. Record
   license obligations and source/package location.
9. Feed the final staging tree to `arm64-artifact-verification` during S6.
   Dependency analysis does not replace PE inspection of the shipped bytes.

## Required classifications

Every dependency gets exactly one status. `unknown` is not an end state.

| Status | Meaning | Next action |
|---|---|---|
| `native-ok` | Ships or builds native ARM64 now | retain evidence |
| `portable` | Managed or source-only payload with no native target bytes | retain evidence |
| `rebuild` | Source exists, ARM64 build must be added | route to `build-retarget` |
| `upgrade` | Newer version adds ARM64 support | plan version bump |
| `replace` | No ARM64 path, viable alternative exists | feed `arm64-strategy-selection` |
| `emulate` | x64-only in-process dependency must remain | forces ARM64EC consideration in `arm64-strategy-selection` |
| `blocker` | No ARM64 path, no replacement, cannot bridge | escalate as project blocker |
| `host-tool` | Runs only during build and never ships | keep out of target package |

## Silent blockers to hunt

- NuGet packages with `runtimes/win-x64/native` or `runtimes/win-x86/native` and
  no `win-arm64` sibling.
- vcpkg triplets pinned to `x64-windows` or `x86-windows` without an
  `arm64-windows` plan.
- Node `.node` native addons, optional prebuild downloads, and `node-gyp` paths.
- Python `.pyd` files and C-extension wheels lacking `win_arm64` coverage.
- Closed-source vendor SDKs, license-locked import libraries, drivers, services,
  and installers.
- Plugins loaded in-process. Emulated x64 code cannot load native ARM64 DLLs, and
  native ARM64 cannot load x64 DLLs unless the process strategy is ARM64EC.
- Toolchain-shipped runtime DLLs not named in manifests. The DIA SDK example is
  `msdia140.dll`: the default `DIA SDK\bin\` copy is x86, `bin\amd64` is x64,
  and `bin\arm64` is the ARM64 payload. The filename is identical, so verify the
  staged copy by PE header.

## Host tool versus target payload

Do not reject a valid port because the build host runs x64 tools. `protoc.exe`,
code generators, compilers, package managers, or restore helpers may match the
host architecture if they are not copied to the package and not loaded into the
product. Conversely, any DLL, EXE, `.node`, `.pyd`, or `.lib` that is linked,
loaded, tested on ARM64, or shipped must be ARM64, ARM64EC, ARM64X, or portable
managed IL as appropriate.

Trace copy, link, and load behavior. Folder names are evidence, not proof. The
final staged bytes decide.

## Judgment rules

- Restore success is not ARM64 support. It may have restored host tools, cached
  x64 packages, or failed before compiler detection.
- A package containing only x86/x64 target payload cannot satisfy an ARM64 target
  dependency. No linker switch turns an x64 import library into ARM64 objects.
- An ARM64 restore that fails because the toolchain is absent is an environment
  blocker for `arm64-build-environment`, not proof the dependency lacks ARM64.
- An x64-only in-process dependency is S3 strategy evidence. It may force ARM64EC
  or feature removal; do not bury it as a TODO.
- A build tool used out-of-process is not a reason to select ARM64EC.
- ATL macros, delay-load hooks, plugins, and installer custom actions can hide
  native load edges. Enumerate what the product loads, not only what manifests
  declare.
- Every `emulate` or `blocker` entry must include impact: affected feature,
  options considered, owner, and decision needed.

## Output

Write `artifacts/s2-deps/dependency-matrix.md` and update `PORT_STATE.json`:

```markdown
| Dependency | Version | Role | Status | Evidence | Action | Owner |
|---|---|---|---|---|---|---|
| zlib | 1.3 | link input | native-ok | arm64-windows builds | — | — |
| vendor-sdk | 9.0 | shipped runtime | blocker | PE machine 8664, closed source | escalate | @lead |
```

Also retain archive inventory, download URL, version, SHA-256, package/source
location, license notes, copied output path, and final classification. Hand the
matrix to `arm64-strategy-selection` only when no dependency remains `unknown`.
If a target payload is blocked, stop the stage and record a project blocker
rather than continuing into code migration.
