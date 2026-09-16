---
name: build-retarget
description: Retarget an existing build system so Windows ARM64 or ARM64EC is a first-class compile and link target without x64 fallback. Use when S3 has selected the ABI and S4 must produce a genuine ARM64 build graph.
---

# Build Retarget (S4)

Goal: make the project **compile and link** for the ABI chosen by
`arm64-strategy-selection`. This is build bring-up, not code migration.
Correctness work belongs in `arm64-correctness` after S4 is green.

## Non-negotiable S4 rule: bring-up is not migration

If SIMD, inline assembly, or an x86-only intrinsic blocks compilation:

1. Guard it out for ARM64/ARM64EC.
2. Select a scalar/reference path, or add a safe stub.
3. Mark the debt exactly as `// TODO(arm64): <what and why>`.
4. Move on to the next build break.

Do **not** hand-port SSE/AVX/asm to NEON in S4. Mixing bring-up with migration is
the fastest way to stall a port. S5 owns correctness and performance. Preserve
x64 behavior; never delete the old branch to make ARM64 compile.

## Inputs

- S3 ADR at `docs/adr/NNNN-arm64-strategy.md`
- Build and dependency findings from `arm64-readiness` and
  `native-dependency-analysis`
- Existing working same-OS target to copy from
- Toolchain capability from `arm64-build-environment`
- For MSBuild audits, seed rules in [`patterns/rules.json`](patterns/rules.json)

## General retargeting pattern

Follow the project's existing build system. Do not introduce a parallel toolchain
unless the project already has no usable target mechanism.

1. Find how the build represents target architecture: matrix axis, target triple,
   named platform/configuration, or compiler/linker flags.
2. Copy an existing working target for the **same OS**.
3. Change only the architecture identifier plus required dependent settings.
4. Apply it to every product, test, helper, generated-code, and package project.
5. Keep the original x64 target building; ARM64 is additive.

Examples:

```bat
cmake -G "Visual Studio 17 2022" -A ARM64 -B build-arm64
cmake --build build-arm64 --config Release
cmake -G "Visual Studio 17 2022" -A ARM64EC -B build-arm64ec
msbuild App.sln /p:Configuration=Release /p:Platform=ARM64
vcpkg install <ports> --triplet arm64-windows
dotnet publish -r win-arm64 -c Release
cargo build --release --target aarch64-pc-windows-msvc
set GOOS=windows&& set GOARCH=arm64&& go build
```

## MSBuild and Visual Studio checklist

1. Inventory solution configurations, project configurations, property sheets,
   custom build steps, output directories, dependency restore, and packaging.
2. Run the seed patterns in [`patterns/rules.json`](patterns/rules.json), then
   inspect each match in context. `x64` text is a lead; the defect is ARM64
   fallback, skipped projects, or target-path contamination.
3. Add ARM64/ARM64EC at solution level **and** to every shipping/test `.vcxproj`.
   A solution ARM64 platform does not prove projects are selected for ARM64.
4. Run a graph preflight before restore/compile. For MSBuild, use
   `PrepareForBuild` for Debug and Release and fail on missing `OutputPath`,
   invalid configuration/platform, `not selected for building`, or non-ARM64
   mapping.
5. Ensure output and intermediate paths are architecture-distinct to avoid stale
   x64 artifacts.
6. Resolve SDK and toolset paths by target architecture. For DIA, ARM64 uses
   `DIA SDK\lib\arm64\diaguids.lib` and `DIA SDK\bin\arm64\msdia140.dll`; do
   not package the amd64 DIA runtime.
7. Capture exact commands, binlogs/logs, exit codes, artifact manifest, and PE
   machine classification in `build.json` or `artifacts/s4-bringup/`.

## Toolchain host determinism

For ARM64 jobs, the compiler host matters. The build must use the intended host
flavour consistently; in the proven failure, `HostX86\arm64` was selected even
where `HostArm64\arm64` was required. `HostArm64` is the expected native host on
Windows ARM64 runners; `HostX86` is not acceptable for that case.

Use the consolidated scripts, not trust:

```powershell
/home/t-neilkainga/hackathon/.consolidated/scripts/ResolveMSBuild.ps1 `
  -HostArchitecture arm64 -Project App.sln -Configuration Release -Platform ARM64

/home/t-neilkainga/hackathon/.consolidated/scripts/Assert-BuildToolchain.ps1 `
  -BuildLog build.log -ExpectedHost HostArm64 -SummaryPath artifacts/s4-bringup/toolchain.json
```

`/p:PreferredToolArchitecture=arm64` alone is only a request.
`Microsoft.Cpp.ToolsetLocation.props` treats `PreferredToolArchitecture` as a
local property, so imports may reassign it. `ResolveMSBuild.ps1` chooses the host
MSBuild binary and checks evaluated properties when available;
`Assert-BuildToolchain.ps1` parses the real `cl.exe` and `link.exe` invocations
from the retained build log. The log parse is authoritative.

Also require one coherent `VCToolsVersion`, matching `cl.exe`/`link.exe` roots,
clean ARM64 `LIB`/`INCLUDE`, and a deliberate Windows SDK/toolset pair. A vcpkg
probe with one compiler does not validate a product build with another.

## Source-file encoding gate

Treat encoding as part of the build contract. MSVC decodes source as UTF-8 only
with a UTF-8 BOM or `/utf-8`; otherwise it uses the active code page. Retargeting
edits that rewrite upstream Windows-1252 files as BOM-less UTF-8 can surface as
`C1083` with mojibake include names such as `FileWithSpecialCharÃ©Ã Ã¨.hpp`.

Decide by bytes, not editor rendering. Do not rename/delete non-ASCII fixtures,
do not bulk-normalize source files, and do not add project-wide `/utf-8` when
the tree contains legitimate ANSI fixtures. Keep correct ANSI files as-is; add a
BOM only to files that are meant to be UTF-8. See
[`references/msbuild-arm64.md`](references/msbuild-arm64.md) and
[`references/evidence-integrity.md`](references/evidence-integrity.md).

## Handling code that will not compile yet

- `immintrin.h`, `emmintrin.h`, SSE, AVX: guard the include/use and select the
  scalar path or stub with `// TODO(arm64): <what and why>`.
- MSVC supports no inline `__asm` on ARM64. Stub it now; later use intrinsics or
  separate `armasm64` files in `arm64-correctness`.
- NEON is 128-bit. There is no 256-bit AVX equivalent; every `__m256i` port is
  two 128-bit operations in S5, not S4.
- `_M_ARM64` is also defined on ARM64EC. Classic-only code must use
  `#if defined(_M_ARM64) && !defined(_M_ARM64EC)` or check `_M_ARM64EC` first.
- Never vendor a prebuilt x64 `.lib` or `.dll` to make the link succeed. Return
  to `native-dependency-analysis` and update the blocker/remediation plan.

## Verification

- Clean ARM64/ARM64EC build command succeeds.
- Existing x64 build still succeeds.
- Every required project is selected and mapped to the target platform.
- Build logs show one intended host toolchain and coherent toolset version.
- No ARM64 target links/packages x64 libraries except ADR-approved ARM64EC bridges.
- Source encoding gate passed or byte-level repairs were made.
- `arm64-artifact-verification` confirms every shipped binary is AA64/expected PE.
- Runtime verification is deferred to `arm64-remote-verification` or
  `arm64-ci-integration` when local native ARM64 execution is unavailable.
- If only the S4 functional launch gate is blocked by unavailable hardware,
  `arm64-qemu-verification` may run the artifact in Windows ARM64 WinPE.
- S4 stubs are inventoried from `rg -n 'TODO\(arm64\)'` in `PORT_STATE.json`.

## Failure modes

| Symptom | Likely cause | Fix |
|---|---|---|
| Green build produces `8664` | Project mapping fell back to x64 or stale artifact copied | Audit every project and run artifact verification |
| ARM64 solution skips a project | Missing per-project `ProjectConfiguration` | Add ARM64 mapping; fail on skipped shipping/test projects |
| SDK header fails on built-ins | Mixed toolset/SDK or stale env | Pin and assert one toolset/SDK |
| `__asm` unsupported | MSVC ARM64 has no inline asm | Stub with `TODO(arm64)`; port later |
| `immintrin.h` missing | x86-only intrinsics | Guard and use scalar/stub now |
| Mojibake include `C1083` | Source encoding changed | Repair bytes; preserve fixtures |
| `HostX86` appears in ARM64 job | Host toolchain not pinned/proven | Resolve host MSBuild and parse build log |
| Runtime claimed after cross-build | No target run occurred | Use `arm64-remote-verification` or CI |
| No hardware for the S4 launch gate | Native target unavailable | Use `arm64-qemu-verification` for functional startup only |
