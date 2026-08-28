# S2 — Dependency Matrix

**Commit:** `4b4bda27`
**Result: zero `unknown`, zero `blocker` for the shipping configuration.**

btop4win has **no package manager** — no vcpkg, NuGet, Conan, or submodules.
Dependencies are (a) Windows SDK import libraries, (b) two vendored header-only
libraries, (c) one *optional* external DLL. Enumeration is therefore exhaustive
by inspection rather than by a tool.

## Windows SDK import libraries

Sourced from `#pragma comment(lib, ...)` in `src/` plus `AdditionalDependencies`
in the `.vcxproj`. Verified by presence in
`C:\Program Files (x86)\Windows Kits\10\Lib\10.0.28000.0\um\arm64\`.

| Dependency | Declared at | ARM64 evidence | Status |
|---|---|---|---|
| `psapi.lib` | `.vcxproj` + `btop_collect.cpp:46` | `um\arm64\psapi.lib` present | `native-ok` |
| `wbemuuid.lib` | `btop_collect.cpp:49` | `um\arm64\wbemuuid.lib` present | `native-ok` |
| `Ws2_32.lib` | `btop_collect.cpp:52` | `um\arm64\Ws2_32.lib` present | `native-ok` |
| `iphlpapi.lib` | `btop_collect.cpp:54` | `um\arm64\iphlpapi.lib` present | `native-ok` |
| `PowrProf.lib` | `btop_collect.cpp:56` | `um\arm64\PowrProf.lib` present | `native-ok` |
| `ntdll.lib` | `btop_collect.cpp:40` | SDK, all arches | `native-ok` |
| `Pdh.lib` | `btop_collect.cpp:42` | SDK, all arches | `native-ok` |
| `$(CoreLibraryDependencies)` | `.vcxproj` | MSBuild-expanded per-platform | `native-ok` |

All confirmed by a successful ARM64 link (S4) — the strongest evidence available.

## Vendored header-only libraries

| Dependency | Version | Evidence | Status |
|---|---|---|---|
| `include/robin_hood.h` | 3.11.5 | Header-only. Only arch-sensitive construct is `_BitScanForward64`, which MSVC supports on ARM64 (see S1 §3). Compiles clean for ARM64. | `native-ok` |
| `include/widechar_width.hpp` | — | Pure C++ Unicode width tables, no arch dependency. | `native-ok` |

## Toolchain components (not libraries, but they gate the build)

| Component | ARM64 status | Status |
|---|---|---|
| MSVC `Hostx64\arm64` cross-compiler | Installed (14.51.36231) | `native-ok` |
| MSBuild `ARM64` + `ARM64EC` platform targets | Present under `MSBuild\Microsoft\VC\v180\Platforms` | `native-ok` |
| Windows SDK 10.0.28000.0 ARM64 libs | Present | `native-ok` |
| **ATL for ARM64** (`atls.lib`) | ❌ **NOT installed** (present for x64) | **`replace`** |
| Platform toolset `v143` | ❌ not installed; `v145` used instead | `upgrade` |

### ATL — the only real finding

`atls.lib` is pulled in implicitly by `#include <atlstr.h>`
(`btop_collect.cpp:43`) and is missing for ARM64 on this host:

```
LINK : fatal error LNK1104: cannot open file 'atls.lib'
```

Two options were considered:

1. **Install** the VS component *"C++ ATL for latest build tools (ARM64/ARM64EC)"*.
   Fixes the link, but makes every future ARM64 build of btop4win depend on an
   optional VS component that most CI images and contributors do not have.
2. **Remove the ATL dependency.** ✅ **Chosen.** ATL is used for exactly one
   thing — the `CW2A` macro at `btop_collect.cpp:1112`. The project already ships
   its own wide→UTF-8 helper, `Tools::bstr2str()`, used at 10+ other sites.

Option 2 is strictly subtractive, benefits x64 and ARM64 equally, removes a
build-environment dependency rather than adding one, and is upstreamable.
Recorded as decision `d-002`.

## Optional external: LibreHardwareMonitor

| Dependency | Status | Detail |
|---|---|---|
| `external\CPPdll.lib` / `.dll` (LHM-CppExport) | **`emulate` / out-of-scope** | x64-only prebuilt |

Used **only** by the `Debug-LHM` / `Release-LHM` configurations, behind
`#ifdef LHM_Enabled` (`btop.cpp:455`, `btop_collect.cpp` ×5). It provides CPU/GPU
**temperature** readings.

- It is **not** in the repo and **not** required by the default `Release` build
  (the S0 baseline built and ran without it).
- Upstream ships it as x64-only, and it is a .NET/C++-CLI export layer —
  a native ARM64 rebuild would require rebuilding LHM-CppExport for ARM64
  upstream.

**Decision:** the ARM64 port targets the **non-LHM configurations only**. The
`Debug-LHM`/`Release-LHM` configurations are deliberately left x64/Win32-only.
Impact: **feature #7 (CPU temperature) is out of scope on ARM64.** This is a
scoped, documented reduction — not a blocker — because it is already optional
and absent from the default build. Recorded as decision `d-003`.

## Exit gate

- [x] Zero dependencies with status `unknown`
- [x] Every `blocker` escalated with an impact statement — **there are none**
- [x] `emulate` list finalised: **`{ LHM-CppExport }`**, and it is excluded from
      the ARM64 build rather than emulated → **classic ARM64 remains viable**
