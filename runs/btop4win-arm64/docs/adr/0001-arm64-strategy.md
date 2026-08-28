# 0001 — ARM64 strategy for btop4win

- **Status:** Accepted
- **Date:** 2026-08-16
- **Stage:** S3
- **App:** btop4win @ `4b4bda27`

## Context

btop4win is a single-binary C++20 console application (13.9 kLOC) built with
MSBuild. S1 found **zero** SIMD intrinsics, **zero** inline assembly, **zero**
architecture macros, **zero** `__cpuid` calls, **zero** runtime code generation
and **zero** hardcoded architecture strings. All 61 concurrency hits are
`std::atomic` with default sequential consistency.

S2 found every dependency to be either a Windows SDK import library (all present
for ARM64) or a header-only vendored library. There is exactly **one** x64-only
binary dependency — `LHM-CppExport` — and it is optional, absent from the default
build, and gated behind `#ifdef LHM_Enabled`.

The choice of ABI is driven by one question: **must x64 code be loaded into this
process?**

## Options considered

### A. Classic ARM64 — *chosen*

Full-native code generation, best performance and power, simplest toolchain, and
the smallest possible deviation from the upstream project file.

Viable because the S2 `emulate` list is effectively empty for the shipping
configuration. btop4win loads no plugins, hosts no third-party extensions, and
exposes no in-process extensibility surface. Nothing external is ever loaded
into it.

### B. ARM64EC — rejected

ARM64EC exists to let **x64 code live inside an ARM64 process** — for x64-only
dependencies or a plugin ecosystem, or to port a large codebase module by module.

None of those apply:

- The only x64-only dependency (LHM) is optional and excluded (see D below).
- btop4win has no plugin/extension model.
- At 13.9 kLOC with no x86-specific code, incremental porting is unnecessary —
  the whole thing compiled for ARM64 on the first attempt.

Choosing ARM64EC here would forfeit performance and battery life for no benefit,
which the playbook explicitly names as an anti-pattern.

### C. ARM64X — rejected

ARM64X is for a **DLL that must load into both native ARM64 and ARM64EC/x64
processes**. btop4win ships a single console `.exe` (`<ConfigurationType>Application`)
and no DLL. Not applicable.

### D. LHM configurations

`Debug-LHM` / `Release-LHM` depend on the x64-only `external\CPPdll.lib`.
Supporting them on ARM64 would require an upstream ARM64 rebuild of
LHM-CppExport — a separate project, and per the playbook a dependency problem to
escalate rather than code around.

**These configurations are left x64/Win32-only.** They are not part of the
default build and were not in the S0 baseline.

## Decision

**Classic ARM64 for the single shipped binary, `btop4win.exe`.**

| Binary | ABI | Rationale |
|---|---|---|
| `btop4win.exe` | **ARM64** | No x64 code needs to load in-process; no plugins; no x86-specific code |

New configurations added: `Debug|ARM64`, `Release|ARM64`.
Not added: `Debug-LHM|ARM64`, `Release-LHM|ARM64` (see D).

## Build matrix

| Configuration | Win32 | x64 | ARM64 |
|---|:---:|:---:|:---:|
| `Debug` | ✅ existing | ✅ existing | ✅ **added** |
| `Release` | ✅ existing | ✅ existing | ✅ **added** |
| `Debug-LHM` | ✅ existing | ✅ existing | ❌ excluded |
| `Release-LHM` | ✅ existing | ✅ existing | ❌ excluded |

## Consequences

**Positive**

- Full native ARM64 performance and power; no emulation layer anywhere.
- Toolchain stays simple — no `/arm64EC` flags, no `_M_ARM64EC` guards, no
  ARM64X mixed-binary linking.
- x64 and Win32 are untouched; existing configurations build byte-identically.
- The port needed **zero `TODO(arm64)` stubs**, so S5 has no migration debt.

**Negative**

- CPU/GPU temperature (feature #7) is unavailable on ARM64 until LHM-CppExport
  ships ARM64. Affects only the LHM build variants, which are already optional.
- Adds two configurations to a `.vcxproj` that must be kept in sync by hand;
  mitigated by the S7 CI matrix building x64 **and** ARM64 so neither can
  silently regress.

**Revisit if** btop4win ever gains a plugin/extension model, or an x64-only
dependency becomes mandatory in the default build. Either would reopen the
ARM64EC question.

## References

- `artifacts/s1-recon/arch-surface.md`
- `artifacts/s2-deps/dependency-matrix.md`
- `docs/DECISION_MATRIX.md`
- <https://learn.microsoft.com/en-us/windows/arm/arm64ec>
