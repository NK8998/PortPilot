# S1 — Architecture Surface Inventory

**Scope:** `src/`, `include/`, `*.vcxproj`, `*.sln`, `*.manifest`, `*.rc`, `resource.h`
**Commit:** `4b4bda27`
**Verdict:** exceptionally clean. btop4win is **portable C++20 over Win32 APIs**,
with no hand-written x86 anywhere.

## Counts

| Category | Hits | Classification |
|---|---:|---|
| SIMD intrinsics (`_mm_`, `__m128`, `immintrin.h`, …) | **0** | — |
| Inline / external assembly (`__asm`, `.asm`, masm) | **0** | — |
| Arch macros (`_M_X64`, `__x86_64__`, `_M_IX86`, `_WIN64`) | **0** | — |
| CPU feature detection (`__cpuid`, `xgetbv`) | **0** | — |
| x86-only scalar intrinsics | **2** | trivial |
| Atomics / memory ordering | 61 | trivial |
| Hardcoded arch strings (`amd64`, `SysWOW64`, `WOW6432Node`) | **0** | — |
| Prebuilt binaries committed to the repo | **0** | — |
| Runtime codegen (JIT, `PAGE_EXECUTE`, detours) | **0** | — |
| Alignment / punning (`#pragma pack`, `__unaligned`) | **0** | — |
| Build-system architecture | 1 | mechanical — **the real work** |
| ATL dependency | 2 | needs-thought — **the real blocker** |

## Hits that matter

### 1. Build system — no ARM64 platform *(mechanical, this is the port)*

`btop4win.sln` / `btop4win.vcxproj` define only `Win32` and `x64` across four
configurations (`Debug`, `Release`, `Debug-LHM`, `Release-LHM`). No `ARM64`.

This is ~95% of the port's actual effort.

### 2. ATL — `<atlstr.h>` + `CW2A` *(needs-thought → resolved subtractively)*

| File:line | Code |
|---|---|
| `src/btop_collect.cpp:43` | `#include <atlstr.h>` |
| `src/btop_collect.cpp:1112` | `name = string(CW2A(cpuName));` |

`<atlstr.h>` auto-links `atls.lib` via `#pragma comment`. **ATL is a separate
Visual Studio component per-architecture, and the ARM64 one is frequently not
installed**, which surfaces only at link time:

```
LINK : fatal error LNK1104: cannot open file 'atls.lib'
```

`atls.lib` present for `x64`, **missing for `arm64`** on this host.

`CW2A` is the only ATL construct used in the entire codebase — one call site,
converting a `wchar_t[255]` registry value to `std::string`. Resolved in S4 by
reusing the project's own `Tools::bstr2str()` helper. See S4 notes.

### 3. `_BitScanForward64` in vendored `robin_hood.h` *(trivial — no action)*

`include/robin_hood.h:139-141`, guarded by `#ifdef _MSC_VER` + bitness:

```cpp
#        if ROBIN_HOOD(BITNESS) == 32
#            define ROBIN_HOOD_PRIVATE_DEFINITION_BITSCANFORWARD() _BitScanForward
#        else
#            define ROBIN_HOOD_PRIVATE_DEFINITION_BITSCANFORWARD() _BitScanForward64
#        endif
```

**`_BitScanForward` / `_BitScanForward64` are supported MSVC intrinsics on
ARM64.** The guard keys off *bitness*, not architecture, so ARM64 (64-bit) takes
the `_BitScanForward64` branch and compiles correctly. Confirmed: `robin_hood.h`
compiled for ARM64 with no diagnostics. **No change required.**

### 4. Atomics — 61 hits, all `std::atomic` *(trivial — no action)*

Every hit is `std::atomic<T>` from `<atomic>` (`btop_collect.cpp`,
`btop_config.cpp`, `btop_tools.hpp`). Default `memory_order_seq_cst` is correct
and portable on ARM64's weak memory model.

**Explicitly checked for and NOT found** — the classic ARM64 heisenbug sources:

- ❌ no `volatile` used for thread communication
- ❌ no `_Interlocked*` / `MemoryBarrier` / `_ReadWriteBarrier`
- ❌ no hand-rolled spinlocks, double-checked locking, or lock-free structures

`btop_config.cpp:39-40` uses `atomic<bool> locked/writelock` with an
`atomic_lock` RAII guard — sequentially consistent, so it is safe by
construction.

> This is the single biggest risk category in ARM64 ports and btop4win has
> **zero** exposure to it.

### 5. UI framework — none *(no risk)*

Pure ANSI-escape-sequence console output to the Win32 console. No GUI
framework, no renderer, no ARM64 story required.

## Win32 API surface (all architecture-neutral)

`ntdll`, `Pdh`, `Psapi`, `WbemIdl`/COM (WMI), `winioctl`, `WS2tcpip`,
`iphlpapi`, `powerbase`/`PowrProf`, `tlhelp32`, `comdef` (`_bstr_t`).

## Exit gate

- [x] Every category searched, hits recorded with classification
- [x] Runtime-codegen findings explicitly called out — **none exist**
- [x] Prebuilt-binary findings explicitly called out — **none in-repo**; one
      optional external (LHM), see S2
- [x] `PORT_STATE.json.arch_surface` populated
