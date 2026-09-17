# JPEGView Windows ARM64 dependency matrix

## Scope

- Source commit: `efd55a1a0b922bd7274c1d44717dac4104bb0fa3`
- Baseline package: 12 x64 PE files
- Target: classic native Windows ARM64
- Acquisition: pinned git submodules plus Visual Studio/Windows SDK components

The x64 import inventory was captured with MSVC `dumpbin /dependents`.
`JPEGView.exe` directly imports Windows system DLLs and delay-loads
`WICLoader.dll`, `jxl_dec.dll`, `jxl_threads.dll`, `heif.dll`, `avif.dll`,
`lcms2.dll`, and `libraw.dll`. PNG, zlib, WebP, and TurboJPEG are static link
inputs. The package also stages transitive codec DLLs.

## Matrix

| Dependency | Pinned version | Role | Status | ARM64 evidence | Action | License/source |
|---|---|---|---|---|---|---|
| Windows SDK system libraries | SDK 10.0.28000.0 | import libraries and OS DLLs | `native-ok` | Installed SDK has ARM64 compiler/library targeting; runtime modules are supplied by Windows ARM64. | Use ARM64 SDK library paths. | Microsoft Windows SDK |
| MSVC CRT compatibility libraries | MSVC 14.51 | link input/runtime | `native-ok` | `amd64_arm64` compiler environment resolves the ARM64 MSVC toolchain. | Link the ARM64 variants; do not stage x64 redistributables. | Microsoft toolchain |
| ATL | latest MSVC component | headers and static `atls.lib` | `native-ok` | Microsoft publishes `Microsoft.VisualStudio.Component.VC.ATL.ARM64`; local installation currently contains only x86/x64 ATL libraries. | Install the optional ARM64 ATL component from an elevated Windows process before S4. | Microsoft Visual Studio component |
| WTL | `Release_10.0-3-g804aaad` | header-only GUI framework | `portable` | Source/header submodule; architecture behavior is delegated to Win32/ATL types and APIs. | Reuse headers with ARM64 ATL. | `deps/WTL-sf` |
| WICLoader | in-tree | shipped delay-load DLL/import lib | `rebuild` | C++/Win32 source builds from `WICLoader.vcxproj`; no assembly or x86 intrinsics found. | Add ARM64 project configuration and rebuild. | JPEGView GPL-2.0 source |
| libjpeg-turbo | `2.1.91` | static TurboJPEG link input | `rebuild` | Pinned CMake explicitly classifies `aarch64`/`arm64` and has NEON support. | Configure CMake for ARM64 and retain library tests. | `LICENSE.md` |
| libwebp | `v1.3.2` | static WebP link inputs | `rebuild` | Pinned source includes ARM NEON DSP implementations and CMake CPU selection. | Build static `libwebp.lib` and `libwebpdemux.lib` for ARM64. | `COPYING` |
| libpng + APNG patch | `v1.6.40` | static PNG link input | `rebuild` | Portable C implementation; APNG patch changes format handling rather than architecture. | Add/use ARM64 MSBuild or CMake output. | `LICENSE` |
| zlib | `v1.3` | static compression link input | `rebuild` | Portable C source with Windows ARM64-capable build systems. | Build ARM64 static library alongside libpng. | `LICENSE` |
| Little CMS | `lcms2.15` | shipped DLL/import lib | `rebuild` | Core C implementation is portable; x86 fast-float plugin is not required by JPEGView. | Build only `lcms2_DLL` for ARM64. | `COPYING` |
| libjxl | `v0.9-snapshot-534-g5d20fbe1` | shipped JPEG XL DLLs/import libs | `rebuild` | CMake exposes NEON handling; bundled Highway provides target dispatch and Brotli is portable. | Configure ARM64 and build `jxl_dec`/`jxl_threads`, then scan transitive DLLs. | `LICENSE` |
| Brotli | libjxl-pinned | transitive shipped DLLs | `rebuild` | Portable C/C++ source in the pinned libjxl submodule. | Build as part of libjxl ARM64 configuration. | libjxl third-party source |
| Highway | libjxl-pinned | SIMD implementation dependency | `rebuild` | Pinned source supports ARM/NEON target dispatch. | Build as part of libjxl and verify no x64 object is retained. | libjxl third-party source |
| dav1d | `1.3.0` | AV1 decoder DLL/import lib | `rebuild` | Meson explicitly supports `aarch64` and selects `armasm64` on Windows; x86 NASM is not required for ARM64. | Configure Meson for ARM64 and build/install target payload. | `COPYING` |
| libde265 | `v1.0.12` | transitive HEVC decoder DLL | `rebuild` | Source includes an ARM implementation and generic C++ paths. | Configure CMake for ARM64 and build `de265`. | `COPYING` |
| libheif | `v1.16.2` | shipped HEIF DLL/import lib | `rebuild` | Portable C++ wrapper over rebuildable dav1d/libde265 target libraries. | Configure against ARM64 codec outputs and build `heif`. | `COPYING` |
| libavif | `v1.0.1` | shipped AVIF DLL/import lib | `rebuild` | Portable C library; selected codec dependency dav1d has an ARM64 path. | Configure against ARM64 dav1d and build shared library/import lib. | `LICENSE` |
| LibRaw | `0.21.1` | shipped RAW DLL/import lib | `rebuild` | Source NMake/C++ implementation has no mandatory x86 binary payload. | Build with ARM64 MSVC and preserve JPEGView feature definitions. | `LICENSE.LGPL`, `LICENSE.CDDL` |
| QOI | commit `0d8d079` | source/header image decoder | `portable` | Single-source portable codec; no shipped native module. | Compile into JPEGView ARM64. | `LICENSE` |
| CMake, NMake, MSBuild, Meson, Ninja, Python, NASM | host versions recorded in S0 | build tools | `host-tool` | Execute out of process and are never copied into the package. NASM is needed only for x86 dependency builds; dav1d ARM64 uses `armasm64`. | Keep host architecture independent from target payload verification. | Tool distributions |

## Package architecture obligations

The final pure ARM64 package must contain ARM64 versions of:

1. `JPEGView.exe`
2. `WICLoader.dll`
3. `avif.dll`
4. `dav1d.dll`
5. `heif.dll`
6. `libde265.dll`
7. `jxl_dec.dll`
8. `jxl_threads.dll`
9. `brotlicommon.dll`
10. `brotlidec.dll`
11. `lcms2.dll`
12. `libraw.dll`

Static `.lib` inputs must also be generated by the ARM64 compiler. Directory
names such as `lib64` are not evidence and will not be reused for ARM64.

## Environment prerequisite

The ARM64 compiler is installed and verified:

```text
MSVC 19.51.36257 for ARM64
Hostx64\arm64\cl.exe
```

The local Visual Studio instance does not currently contain
`atlmfc\lib\arm64\atls.lib`. Microsoft lists
`Microsoft.VisualStudio.Component.VC.ATL.ARM64` as the supported optional
component. Two unattended installation attempts exited `5007`; installer logs
state that quiet/passive operations must start elevated. This is an S4
environment action, not a dependency blocker.

## Gate

S2 is complete with zero `unknown`, `emulate`, or `blocker` entries. Every
in-process target payload is source-rebuildable or supplied natively by the
Windows/MSVC toolchain. Proceed to `arm64-strategy-selection`.
