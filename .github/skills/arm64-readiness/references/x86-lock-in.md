# x86 lock-in: the four classes

Readiness work goes wrong when everything is treated as one bucket. These four classes have
different costs, different owners, and different failure signatures. Walk them in order.

## 1. Instruction-level

The code contains machine behaviour expressed as data or as assembly.

| Signal | Why it matters | Cost |
| --- | --- | --- |
| `__asm { }`, `__asm__`, `asm volatile` | MSVC supports no inline assembly for ARM64. There is no flag that relaxes this. | Rewrite |
| `<immintrin.h>` and friends, `__m128`, `_mm_*` | x86 SIMD intrinsics have no ARM64 equivalent header. NEON is a different instruction set with different semantics. | Rewrite or scalar fallback |
| Bare opcode literals written into memory | `0xCC` is `int3`; `0x90` is `nop`; `0xCD` is `int imm8`. On ARM64 a breakpoint is a 4-byte `BRK #0` (`0xD4200000`), and every instruction is 4 bytes. | Abstraction plus tests |
| Program counter arithmetic | x86 leaves `EIP`/`RIP` *after* the trap byte, so recovery decrements by one. ARM64 does not, and instruction width is fixed. | Abstraction plus tests |

The dangerous property of this class is that **it compiles**. A coverage collector that writes
`0xCC` into an ARM64 process builds clean, links clean, and corrupts the target at runtime. Nothing
in the build tells you.

The constants also rarely name an architecture. A field called `originalByte` or a constant called
`kBreakpoint` gives no hint that it is x86-specific, so identifier search does not find them.
Search for the *values* and for the cross-process write APIs that consume them.

## 2. Dependency-level

The product depends on binaries that exist only for x86 and x64.

Check the restored payload, not the manifest. A manifest records a request; the loader records
reality. A NuGet or vcpkg package whose layout contains only `x86-windows` and `x64-windows`
directories is a hard blocker: no toolset setting produces an ARM64 binary from an x64 `.lib`.

The options, in increasing cost:

1. An ARM64 payload already exists upstream and only the triplet or RID needs adding.
2. The dependency builds from source for ARM64 and the package must be rebuilt.
3. Neither — the dependency must be replaced or the feature dropped.

Distinguish *host* tools from *target* payload before costing any of this. A code generator that
runs on the build machine may remain x64 forever without affecting the shipped product. Conflating
the two produces phantom blockers, and shipping the two in one directory produces a package that
fails an architecture purity scan for a reason nobody can explain.

Vendor SDKs deserve a specific look, because they are easy to overlook: they are neither source
nor a package the manifest names. The Debug Interface Access SDK is the worked example — a build
that consumes it must ship `msdia140.dll`, and the ARM64 copy lives in an `arm64` subdirectory
beside the x86 one. See [`native-dependency-analysis`](../../native-dependency-analysis/SKILL.md).

## 3. Build-level

The build refuses to produce ARM64 output, or produces it from the wrong host.

- Platform lists that enumerate `Win32` and `x64` and stop.
- Triplets and RIDs pinned to `x64-windows` / `win-x64`.
- Hard-coded toolchain paths containing `HostX86` or `HostX64`.
- Conditions keyed on `'$(Platform)' == 'x64'` that silently do nothing for ARM64.

The last one is the quiet failure: a property or copy step guarded on `x64` does not error for
ARM64, it simply never runs, and the defect surfaces as a missing file at packaging time.

Host selection belongs to [`build-retarget`](../../build-retarget/SKILL.md), which owns the
measured lesson that `/p:PreferredToolArchitecture` alone does not decide the host.

## 4. Behavioural

Everything that is architecture-dependent but has no lexical signature: weak memory ordering,
alignment tolerance, `char` signedness, structure packing, floating-point contraction. These
cannot be found by scanning. Say so explicitly in the report rather than letting a clean pass
imply they were checked.

## What readiness cannot tell you

Two prerequisites are physical, not analytical:

- Native execution requires ARM64 hardware or a `windows-11-arm` runner.
- Building requires the ARM64 compiler component
  (`Microsoft.VisualStudio.Component.VC.Tools.ARM64`); `vswhere -requires` returning empty means
  the toolset is absent no matter what the IDE version suggests.

Neither can be inferred from the source tree, and no amount of analysis substitutes for them. A
readiness report that omits them implies a validation that never happened.
