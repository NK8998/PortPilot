# S5 — Code Migration

**App:** btop4win (upstream `4b4bda2`)
**Branch:** `user/neil/arm64-support`
**Status:** complete — **no migration work was required**

## Summary

S5 exists to burn down the debt that S4 is allowed to create: SIMD stubbed out,
inline assembly commented away, features disabled behind `TODO(arm64)` just to
reach a link. **None of that debt was ever created**, because none of it was
needed to link.

This is the rare case where S5 is genuinely a no-op. It is recorded rather than
skipped, so a future session does not go looking for missing work.

## Exit gate

| Gate | Result | Evidence |
|---|---|---|
| Zero `TODO(arm64)` in shipping paths | **0** | `grep -rn 'TODO(arm64)' src/ *.vcxproj *.sln` → 0 |
| Unit tests green | **N/A** | No test suite exists (recorded in S0 baseline) |
| x64 not regressed | pass | `Release\|x64` + `Debug\|x64` rebuilt, still `8664`, still runs |

Also verified: **0** occurrences of `_M_ARM64` / `ARM64` conditionals in `src/`.
The port introduced no architecture branches at all.

## Why there was nothing to migrate

The S1 recon found an essentially empty architecture surface, re-verified at S5:

| Construct | Hits |
|---|---|
| `_M_X64` / `_M_AMD64` / `__x86_64__` / `_M_IX86` | 0 |
| `__cpuid` / `__cpuidex` | 0 |
| SSE/AVX intrinsics (`_mm_`, `__m128`, `__m256`) | 0 |
| Inline assembly (`__asm`) | 0 |
| Hardcoded architecture strings | 0 |

btop4win delegates all expensive work to the OS (PDH, WMI, NTAPI) rather than
hand-vectorising it, so there were no x86 fast paths to translate to NEON.

### Memory model

The usual #1 source of ARM64 heisenbugs did not apply. All 61 concurrency sites
use `std::atomic` with default `seq_cst` ordering — no `volatile`-as-a-barrier,
no hand-rolled lock-free structures, no relaxed orderings relying on x86's
stronger TSO guarantees. Nothing to harden.

### `_BitScanForward64` (`external/robin_hood.h:139-141`)

Investigated and dismissed. The guard keys off **bitness**, not architecture,
and MSVC provides `_BitScanForward`/`_BitScanForward64` as intrinsics on ARM64.
Compiles clean.

## The one behavioural change carried in from S4

S4 removed the ATL dependency, replacing `CW2A` with the project's existing
`bstr2str()` helper in `Cpu::get_cpuName()` (`src/btop_collect.cpp:1112`).

This is not an architecture branch — it removes a build-environment dependency
neither architecture needed — but it *is* a semantic change:

| | Conversion |
|---|---|
| `CW2A` (old) | wide → thread ANSI codepage |
| `bstr2str` (new) | wide → UTF-8 |

For CPU model strings these are identical in practice (ASCII), and UTF-8 is the
better match for btop4win's terminal rendering. **Carried into S6 as an explicit
parity check (feature #5, CPU model name).** It is the only behaviour in the
entire port that could differ from the x64 baseline.

## Files changed in S5

None. S5 changed no code.
