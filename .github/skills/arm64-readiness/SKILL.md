---
name: arm64-readiness
description: Establishes the S0 x64 baseline and S1 architecture-readiness inventory for a native ARM64 port before code changes. Use when starting a port, estimating feasibility, scanning for x86 assumptions, or deciding whether unresolved evidence blocks planning.
---

# ARM64 Readiness (S0 baseline + S1 architecture recon)

This is the read-only entry assessment. Build a map of what exists, what is
architecture-coupled, and what cannot be validated here. Do not edit source while
running this skill; findings feed `native-dependency-analysis` and
`arm64-strategy-selection`.

## Inputs

- Source tree at an exact commit, preferably clean and unmodified
- Build instructions, manifests, generated project files, wrappers, CI workflows,
  lock files, and packaging scripts
- Dependency manifests and restored package layouts when already available
- Checked-in binaries, vendor SDK references, plugins, services, and runtime
  loading boundaries

## S0: baseline before porting

1. Pin identity: repository URL, commit SHA, requested target, license, last
   release if relevant, and authorization boundaries.
2. Identify every build system: MSBuild, CMake, Meson, Bazel, cargo, npm,
   Python packaging, Go modules, custom scripts, or wrappers around them. Note
   what each builds and whether it has target platform or architecture values.
3. Build the unchanged x64 project when the environment allows it. Record exact
   commands, working directory, environment, toolchain versions, and discovered
   prerequisites. If you cannot build locally, record why rather than inferring.
4. Run the existing tests that match the baseline. Record pass/fail counts and
   the names of pre-existing failing tests.
5. Write 10-30 user-visible features or workflows for the later S6 parity matrix.
6. Capture meaningful performance or startup baselines only when they are already
   available or cheap to run; name the hardware and command.

Artifact: `artifacts/s0-baseline/baseline.md`.

## S1: architecture-surface inventory

Run `patterns/rules.json` as a seed pass, then inspect the surrounding code. A
rule hit is a candidate, not a verdict. Also run targeted searches for:

- x86 SIMD and vector types: `_mm_*`, `_mm256_*`, `_mm512_*`, `__m128`, `__m256`,
  `__m512`, and x86 intrinsic headers.
- Inline or external assembly: `__asm`, `asm volatile`, `.asm`, `.s`, MASM, NASM,
  YASM, `ml64`, and `armasm` build hooks.
- Architecture macros and guards: `_M_X64`, `_M_AMD64`, `_M_IX86`, `__x86_64__`,
  `__i386__`, `__aarch64__`, `_M_ARM64`, `_M_ARM64EC`.
- CPU feature detection and x86-only scalar intrinsics: `__cpuid`, `xgetbv`,
  `_BitScan*`, `__popcnt`, `__rdtsc`, `_umul128`, `_mul128`, rotates.
- Atomics and weak-memory risk: `volatile`, `_Interlocked*`, `MemoryBarrier`,
  `_ReadWriteBarrier`, `std::atomic`, spin locks, and lock-free code.
- Hardcoded architecture strings and paths: `x64`, `amd64`, `x86_64`,
  `Program Files (x86)`, `SysWOW64`, `WOW6432Node`, `win-x64`, `x64-windows`.
- Runtime code generation and patching: `VirtualAlloc`, `PAGE_EXECUTE`, JIT,
  trampoline, detour, hook, `FlushInstructionCache`, breakpoints, profilers, and
  coverage collectors.
- Layout and ABI assumptions: `#pragma pack`, `__unaligned`, `long double`,
  `reinterpret_cast`, pointer-size casts, calling convention assumptions.
- Vendored binaries: `.dll`, `.lib`, `.exe`, `.node`, `.pyd`, `.so`, `.a`, and
  SDK payloads copied by scripts.

For every meaningful hit, record file, line, evidence, category, severity,
`arm64Impact`, effort, and classification: trivial, mechanical, needs-thought,
or blocker. Populate `PORT_STATE.json.arch_surface`.

Artifact: `artifacts/s1-recon/arch-surface.md`.

## Dependency and binary triage in readiness

This skill does not finish S2, but it must identify dependency risk early:

- Enumerate native or binary dependencies, including transitive package layouts,
  optional acceleration modules, vendored SDKs, plugins, services, installers,
  and build downloads.
- Separate host tools from target payload. `protoc.exe` or a package manager may
  remain x64 if it only runs during the build and never ships.
- Record checked-in and staged PE machine types from actual headers when tools
  are available; do not trust README labels or directory names.
- Flag NuGet `runtimes/win-x64/native`, vcpkg `x64-windows`, native Node addons,
  Python C-extension wheels without `win_arm64`, and closed-source SDKs for
  `native-dependency-analysis`.

## Judgment rules

- A clean regex pass is not readiness. State what static scanning cannot see:
  weak memory ordering, alignment tolerance, floating-point differences, and
  runtime-only loader behavior.
- An x86 macro is not a defect when the same file has a correct ARM64 companion.
  `_M_ARM64` also matches ARM64EC; for classic ARM64 use
  `#if defined(_M_ARM64) && !defined(_M_ARM64EC)`.
- `0xCC` is an x86 one-byte `int3`; ARM64 breakpoints are four-byte `BRK #0`.
  Opcode literals written into executable memory can compile cleanly and fail at
  runtime. Route those cases to `arm64-software-breakpoints` during S5.
- ATL/MFC conversion macros such as `CW2A` can hide code-page or dependency
  assumptions; read their call sites when they feed file paths, process launches,
  or external ABI boundaries.
- MSVC has no ARM64 inline `__asm`; replacement is source work, not a compiler
  switch.
- NEON is 128-bit. There is no direct 256-bit AVX equivalent; `__m256i` usually
  becomes two 128-bit operations or a scalar fallback.
- `/clr` C++/CLI needs an explicit measured disposition. Do not assume it works
  or is unsupported. If excluded, hand the decision to `port-completeness`.
- Absence of ARM64 hardware, a `windows-11-arm` runner, or
  `Microsoft.VisualStudio.Component.VC.Tools.ARM64` caps the verdict at
  "cannot be validated here".

## Output

Produce a readiness report with:

- Commit scanned and whether the tree was modified
- S0 build/test baseline, including pre-existing failures and unverified items
- Inventory of build systems, target architecture knobs, CI coverage, packaging,
  runtime boundaries, and checked binaries
- RDY findings from `patterns/rules.json`, with false positives suppressed by
  contextual review
- Architecture-surface table and effort signal
- Initial dependency risks to hand to `native-dependency-analysis`
- Blockers that prevent `plan-ready`
- Next skill: `native-dependency-analysis` if any native or binary dependency is
  present; otherwise `arm64-strategy-selection`

Do not create a migration plan if required evidence is unresolved. Record a
blocker with owner and next evidence step instead.
