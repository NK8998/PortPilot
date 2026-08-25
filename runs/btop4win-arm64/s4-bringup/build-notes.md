# S4 — Build Bring-up Notes

**Goal:** compile and link `btop4win.exe` for ARM64.
**Result: ✅ achieved — and with zero `TODO(arm64)` stubs.**

## Summary

| Configuration | Result | `dumpbin /headers` |
|---|---|---|
| `Release\|ARM64` | ✅ builds & links | **`AA64 machine (ARM64)`** |
| `Debug\|ARM64` | ✅ builds & links | — |
| `Release\|x64` | ✅ **still** builds (no regression) | `8664 machine (x64)` |
| `Debug\|x64` | ✅ **still** builds (no regression) | — |

ARM64 Release binary: `ARM64\Release\btop4win.exe`, 3,499,008 bytes
(x64: 3,083,776 bytes — ARM64 is ~13% larger, normal for a fixed-width ISA).

## Change 1 — build system *(workstream: build)*

Added `Debug|ARM64` and `Release|ARM64`, mirroring the x64 configurations.
The LHM variants were deliberately **not** extended to ARM64 (see ADR 0001 §D).

`btop4win.sln` — 2 edits:
- `SolutionConfigurationPlatforms`: `+ Debug|ARM64`, `+ Release|ARM64`
- `ProjectConfigurationPlatforms`: `+ ActiveCfg`/`Build.0` for both

`btop4win.vcxproj` — 5 edits, one per required group:
1. `ItemGroup Label="ProjectConfigurations"` — 2 `ProjectConfiguration` entries
2. `PropertyGroup Label="Configuration"` — `ConfigurationType`, `UseDebugLibraries`,
   `PlatformToolset`, `CharacterSet`, `WholeProgramOptimization`
3. `ImportGroup Label="PropertySheets"` — the standard `.user.props` import
4. `PropertyGroup` — `IncludePath` (+ `LinkIncremental=false` for Release)
5. `ItemDefinitionGroup` — `ClCompile` / `Link` / `Manifest`

`<TargetMachine>` is deliberately **not** set; MSBuild infers it from
`$(Platform)`. (The legacy `Win32` configs hardcode `MachineX86` — do not copy
that pattern.)

## Change 2 — remove the ATL dependency *(workstream: dependencies)*

### Failure 1 — `atls.lib`

All 8 translation units compiled for ARM64 on the **first attempt**. The only
error was at link:

```
LINK : fatal error LNK1104: cannot open file 'atls.lib'
```

Cause: `#include <atlstr.h>` (`btop_collect.cpp:43`) auto-links `atls.lib` via
`#pragma comment`. ATL is a **per-architecture** VS component; `atls.lib` exists
under `atlmfc\lib\x64\` but not `atlmfc\lib\arm64\` on this host.

The initial recon under-counted this: a grep for `CString`/`CComPtr`/`ATL::`
returned **zero** hits, suggesting the include was vestigial. Removing it
produced the real error.

### Failure 2 — `CW2A`

```
error C3861: 'CW2A': identifier not found
error C2593: 'operator =' is ambiguous
```

`btop_collect.cpp:1112`, in `get_cpuName()` — one call site, converting a
`wchar_t[255]` registry value (`ProcessorNameString`) to `std::string`.

> **Lesson:** grep for ATL *macros* (`CW2A`, `CA2W`, `USES_CONVERSION`), not just
> ATL *types*. A codebase can depend on ATL without naming a single ATL class.

### Fix

The project already has a wide→UTF-8 helper, `Tools::bstr2str()`
(`btop_collect.cpp:123`), used at 10+ sites — including
`bstr2str(pe.szExeFile)` at line 2137, which passes a `WCHAR[MAX_PATH]` array
exactly like `cpuName`. `BSTR` is `wchar_t*`, so array-to-pointer decay applies.

```diff
-#include <atlstr.h>
 #include <tlhelp32.h>
@@
-				name = string(CW2A(cpuName));
+				name = bstr2str(cpuName);
```

**Not guarded by `#if`** — and deliberately so. This is not an x86-vs-ARM64
branch; it removes a build-environment dependency that was never needed on
either architecture. Both platforms take the same path, which is the playbook's
"subtractive, not rewriting" prime directive. x64 was rebuilt and re-smoke-tested
afterwards (below).

**Behavioural note for S6:** `CW2A` converts using the thread ANSI codepage;
`bstr2str` converts to UTF-8. For CPU model strings (ASCII in practice) the
result is identical, and UTF-8 is more correct for btop4win's UTF-8 terminal
output. **Feature #5 (CPU model name) is flagged for explicit S6 verification on
both architectures.**

## Verification

```
> dumpbin /headers ARM64\Release\btop4win.exe | findstr machine
            AA64 machine (ARM64)
```

x64 non-regression:

```
> x64\Release\btop4win.exe --version
btop4win version: 1.0.5
> x64\Release\btop4win.exe --help
usage: btop [-h] [-v] [-/+t] [-p <id>] [--utf-force] [--debug]
```

## `TODO(arm64)` inventory

**Empty.** No SIMD, assembly, or x86-only intrinsic required stubbing.

```
$ grep -rn "TODO(arm64)" src/ include/
(no matches)
```

Consequence: **S5 (Code Migration) has no migration debt to burn down.** Its
workstreams — memory ordering, CPU feature detection, scalar intrinsics, SIMD,
assembly, runtime codegen, path/arch strings — are all empty for this app (see
S1). S5 reduces to confirming that emptiness and validating the one behavioural
change above, which is really S6 evidence work.

## Exit gate

- [x] ARM64 build succeeds from clean, x64 build **still** succeeds
- [x] `dumpbin` reports `AA64`
- [ ] **App launches and reaches a known-good point** — ⚠️ **BLOCKED**, cannot be
      done on this x64 host. Requires the ARM64 VM; see blocker `b-001`.
- [x] Every stub carries a `TODO(arm64):` marker — vacuous, there are no stubs

## Reproduce

```bat
set MSB="C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
cd C:\portpilot\btop4win
%MSB% btop4win.sln /p:Configuration=Release /p:Platform=ARM64 /p:PlatformToolset=v145 /m /v:minimal /nologo
```

Note `/p:PlatformToolset=v145` — the project pins `v143`, which is not installed
on this host (see S0). On a VS 2022 machine, omit it.
