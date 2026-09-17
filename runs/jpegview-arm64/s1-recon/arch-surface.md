# JPEGView Windows ARM64 architecture surface

## Scope

- Repository: `https://github.com/sylikc/jpegview`
- Commit: `efd55a1a0b922bd7274c1d44717dac4104bb0fa3`
- Tree state: clean and unmodified
- Target: classic native Windows ARM64

Static scanning covered the Visual Studio projects, workflows, packaging scripts,
product C/C++ sources, checked-in dependency interfaces, and pinned submodules.

## Findings

| ID | Evidence | Category | ARM64 impact | Classification | Planned disposition |
|---|---|---|---|---|---|
| JPV-ARCH-001 | `src/JPEGView/Helpers.cpp:179-280` | CPU detection | `_WIN64` is true on ARM64, so ARM64 enters x86 `__cpuid`, `__cpuidex`, and `_xgetbv` code. This is a compile blocker and incorrectly assumes every 64-bit processor has SSE2. | needs-thought | Add an explicit ARM64 CPU result and restrict CPUID probing to x86/x64. Use generic processing for bring-up; add NEON only as measured S5 work. |
| JPV-ARCH-002 | `src/JPEGView/BasicProcessing.cpp:7-10,1904-2002` | SSE2 intrinsics | `_WIN64` includes `ApplyFilterAVX.h` and compiles `__m128i`/`_mm_*` filtering for ARM64. MSVC ARM64 cannot compile these x86 intrinsics. | needs-thought | Guard x86 SIMD by `_M_IX86`/`_M_X64`; route ARM64 through existing generic high-quality resampling first. |
| JPV-ARCH-003 | `src/JPEGView/ApplyFilterAVX.cpp:1-112` | AVX2 intrinsics | The file is guarded only by `_WIN64` and contains `__m256i`/`_mm256_*`. ARM64 NEON is 128-bit and has no direct 256-bit equivalent. | needs-thought | Exclude this translation unit from ARM64. Preserve x64 AVX2; a future NEON implementation must use a separate 128-bit path. |
| JPV-ARCH-004 | `src/JPEGView/JPEGView.vcxproj:299-302` | Build configuration | `ApplyFilterAVX.cpp` is included for every platform; AVX is enabled only for x64, but the source still compiles on a new ARM64 platform unless explicitly excluded. | mechanical | Add ARM64 configurations and mark the AVX source excluded for ARM64. |
| JPV-ARCH-005 | `src/JPEGView.sln:17-46`, `src/JPEGView/JPEGView.vcxproj:1-289`, `src/WICLoader/WICLoader.vcxproj` | Build graph | Solutions/projects define only Win32 and x64 output, library, target-machine, and post-build layouts. | mechanical | Add ARM64 as a first-class platform to both native projects and solution mappings; use distinct `bin\\arm64`/`obj\\arm64` paths. |
| JPV-ARCH-006 | `src/JPEGView/stdafx.h:43-72` | ABI/manifest | Pointer arithmetic uses an ad-hoc `_WIN64` typedef; manifest architecture lists x86, IA64, and AMD64 but not ARM64. The wildcard fallback is functional but not explicit. | trivial | Replace pointer arithmetic type with `uintptr_t` or add a verified ARM64-safe definition; add an ARM64 manifest branch. |
| JPV-ARCH-007 | `src/JPEGView/WorkThread.h:25-27,70`, `WorkThread.cpp:88-130`, `ProcessingThreadPool.cpp:91-109`, `ImageLoadThread.h:64,93` | Weak memory ordering | Cross-thread state uses `volatile bool` and casts a volatile `int` to `LONG*`. `volatile` is not synchronization; x64 ordering can hide visibility races that ARM64 exposes. | needs-thought | Audit each flag against its event/critical-section lifecycle. Replace unsynchronized communication with interlocked operations or `std::atomic` using explicit ordering while preserving Win32 event semantics. |
| JPV-ARCH-008 | `src/JPEGView/BasicProcessing.h:8-14`, `JPEGImage.cpp:34-58,576-655` | Runtime dispatch | The processing architecture model names only MMX, SSE, and AVX2. Existing non-SIMD methods provide a correctness fallback when `ProbeCPU()` returns `CPU_Generic`. | mechanical | Make ARM64 select `CPU_Generic` for initial correctness. Add NEON as a distinct enum/path only if later parity/performance evidence justifies it. |
| JPV-ARCH-009 | `.github/workflows/*.yml`, `.github/actions/bin-cache/action.yml`, `extras/scripts/*.bat` | CI/packaging | Workflows, cache keys, dependency scripts, and package copy rules are hardcoded to Win32/x64, `lib`/`lib64`, and `bin`/`bin64`. | mechanical | Add ARM64 dependency outputs, cache paths, workflow job, package directory, and architecture gates without changing x86/x64 paths. |
| JPV-ARCH-010 | `src/JPEGView/ParameterDB.h:5-78` | Packed layout | Persistent parameter records use one-byte packing. This is intentional serialization layout, not automatically an ARM64 defect, but unaligned field access must be observed in runtime tests. | needs-thought | Preserve the on-disk layout; verify access patterns and ARM64 runtime behavior rather than changing the format. |

## Suppressed findings

- `VirtualAlloc` in `XMMImage.cpp` allocates `PAGE_READWRITE`, not executable
  memory. It is aligned image storage, not runtime code generation.
- `InterlockedDecrement` and Win32 event operations are valid ARM64
  synchronization primitives; the surrounding plain `volatile` flags remain the
  risk.
- `_WIN64` is valid for pointer width but invalid where the code means x64 SIMD
  or CPUID.
- The common-controls manifest wildcard fallback would work on ARM64, but an
  explicit ARM64 branch improves auditability.
- Checked-in product directories contain dependency headers, not shipped `.lib`
  or `.dll` payloads. Native binaries are rebuilt and staged by scripts.

## Effort signal

The minimal correct port is feasible:

1. add ARM64 MSBuild/solution configurations;
2. restrict x86 CPU detection and SIMD translation units to x86/x64;
3. select the existing generic image-processing paths on ARM64;
4. rebuild every native codec dependency for ARM64;
5. migrate unsafe cross-thread volatile communication before parity claims.

An optimized NEON resampler is optional S5 performance work, not required for
the first correct native binary.

## Static-analysis limitations

This inventory cannot prove weak-memory behavior, packed-structure access,
third-party runtime correctness, image-output parity, or GUI/device behavior.
Those require native Windows ARM64 execution with representative image fixtures.

## Gate

S1 is complete. Architecture-specific production code and build/package
assumptions are identified with no unresolved source category. Proceed to
`native-dependency-analysis`; do not select an ABI until every shipped native
dependency has an ARM64 disposition.
