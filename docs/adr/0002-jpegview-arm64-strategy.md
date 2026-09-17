# 0002 - ARM64 strategy for JPEGView

## Status

Accepted - September 17, 2026

## Context

JPEGView 1.3.46 at commit
`efd55a1a0b922bd7274c1d44717dac4104bb0fa3` currently ships an x64 executable
and eleven x64 runtime DLLs. S1 identified x86 CPUID, SSE2, AVX2, build-platform,
and weak-memory assumptions in the product. S2 found no closed or x64-only
in-process dependency: every codec module is source-rebuildable for ARM64, and
Microsoft supplies an ARM64 ATL component.

The x86 intrinsics are implementation work, not ABI evidence. JPEGView already
has generic non-SIMD image-processing paths that can establish correctness
before any optional NEON optimization.

## Options considered

- **Classic ARM64** - Supported by the complete dependency graph. It produces
  the simplest native process and is the correct performance/power destination.
- **ARM64EC** - Rejected. No verified x64-only module must remain inside the
  process, so EC would add thunking, toolchain, and verification complexity
  without preserving a required feature.
- **ARM64X** - Rejected. None of the shipped DLLs must be loaded by both native
  ARM64 and x64/ARM64EC hosts. `WICLoader.dll` and the codec DLLs are private to
  the matching JPEGView process/package.

Moving a dependency out of process was considered but is unnecessary because
all current dependencies have native source-build paths.

## Decision

| Binary | ABI | Rationale |
|---|---|---|
| `JPEGView.exe` | Classic ARM64 | Main application has no x64-only in-process dependency. |
| `WICLoader.dll` | Classic ARM64 | Private DLL loaded only by native JPEGView. |
| `avif.dll` | Classic ARM64 | Rebuilt from pinned libavif source. |
| `dav1d.dll` | Classic ARM64 | Pinned Meson project has Windows AArch64/`armasm64` support. |
| `heif.dll` | Classic ARM64 | Rebuilt against native codec libraries. |
| `libde265.dll` | Classic ARM64 | Source has ARM/generic implementations. |
| `jxl_dec.dll` | Classic ARM64 | Rebuilt with ARM/NEON-capable Highway dispatch. |
| `jxl_threads.dll` | Classic ARM64 | Same native libjxl build graph. |
| `brotlicommon.dll` | Classic ARM64 | Portable source built as part of libjxl. |
| `brotlidec.dll` | Classic ARM64 | Portable source built as part of libjxl. |
| `lcms2.dll` | Classic ARM64 | Portable core Little CMS target. |
| `libraw.dll` | Classic ARM64 | Rebuilt from pinned LibRaw source. |

Static TurboJPEG, PNG, zlib, and WebP libraries must also contain ARM64 objects.
The future installer/package is ARM64-only and must not retain x64 payloads.

## Consequences

- Add an `ARM64` platform to `JPEGView.sln`, `JPEGView.vcxproj`, and
  `WICLoader.vcxproj`.
- Use `/MACHINE:ARM64` and separate `bin\arm64`, `obj\arm64`, `libarm64`, and
  equivalent dependency directories.
- Install `Microsoft.VisualStudio.Component.VC.ATL.ARM64` before the product
  link.
- Restrict CPUID, SSE2, and AVX2 code to x86/x64. Initial ARM64 correctness uses
  the existing generic processing path.
- Preserve all Win32/x64 configurations and optimized paths.
- Audit cross-thread `volatile` communication during S5 before parity claims.
- Inspect every packaged PE and static archive output; successful compilation is
  not architecture proof.

If later evidence discovers an unavoidable x64-only in-process module, return to
S2 and reconsider the smallest possible ARM64EC boundary. No such module exists
in the current evidence.
