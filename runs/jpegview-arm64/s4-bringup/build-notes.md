# JPEGView ARM64 build bring-up

## Result

S4 passed on September 18, 2026. JPEGView and its eleven private runtime DLLs
build as classic Windows ARM64, the matched x64 package still builds, and the
ARM64 GUI reached its file-open window in Windows ARM64 WinPE under QEMU TCG.

This is functional launch evidence only. It is not native-hardware,
performance, power, timing, device-integration, or weak-memory evidence.

## Source

- Upstream repository: `https://github.com/sylikc/jpegview`
- Pinned upstream commit: `efd55a1a0b922bd7274c1d44717dac4104bb0fa3`
- Port branch: `NK8998/jpegview`, `user/neil/arm64-support`
- Build retarget commit: `7fde9ee`
- Reproducible dependency build commit: `622db16`

## Toolchain

- Visual Studio Enterprise 2026 18.9.3
- MSBuild 18.9.1
- MSVC v142 compiler 19.29.30159
- Cross compiler host/target: `HostX64\arm64`
- Windows SDK 10.0.22621.0
- ARM64 ATL from the installed current MSVC 14.51.36231 component
- CMake supplied by Visual Studio
- Windows Python 3.12, Meson, and Ninja

The v142 compiler fails against Windows SDK 10.0.28000.0 in `winnt.h`, so the
ARM64 projects and all CMake dependency builds deliberately pin 10.0.22621.0.
The product still uses v142 because its legacy `<hash_map>` dependency is not
compatible with the current compiler.

## Reproducible build

The committed source-side driver discovers Visual Studio and ARM64 ATL rather
than relying on the temporary machine-specific paths used during investigation:

```bat
extras\scripts\build-arm64.bat all
```

The retained verification run executed the two phases separately:

```bat
extras\scripts\build-arm64.bat dependencies
extras\scripts\build-arm64.bat app
```

Both commands exited 0. Full logs are retained as `dependency-build.log` and
`app-build.log`.

The driver builds:

- libwebp and libwebpdemux with NMake `ARCH=ARM64`
- libjpeg-turbo/TurboJPEG with `WITH_SIMD=OFF`
- zlib and libpng/APNG with the static MSVC runtime
- libjxl, Brotli common/decoder, and Highway-linked components
- Little CMS
- LibRaw
- dav1d with Meson AArch64 and `enable_asm=false`
- libavif against native dav1d
- libde265 with `DISABLE_SSE=ON`
- libheif against native dav1d and libde265

The disabled x86-only assembly/SIMD paths are correctness-first S4 fallbacks,
not claims of completed ARM64 optimization.

## Product retarget

- Added ARM64 solution/project mappings for `JPEGView` and `WICLoader`.
- Added architecture-distinct `bin\ARM64`, `obj\ARM64`, `libarm64`, and
  `binarm64` paths.
- Restricted CPUID, XGETBV, SSE, AVX, and inline x86 assembly to x86/x64.
- Excluded `ApplyFilterAVX.cpp` on ARM64.
- Added an ARM64 common-controls manifest identity.
- Updated post-build staging to copy the native ARM64 dependency DLLs.
- Preserved all Win32 and x64 configurations and optimized implementations.

## Architecture evidence

`scripts/verify_arch.py` inspected the staged release package:

```text
python3 scripts/verify_arch.py \
  /mnt/c/Users/Public/jpegview-arm64-build/src/JPEGView/bin/ARM64/Release \
  --expect arm64 --recurse
```

All 12 shipped PE files report machine `0xAA64`:

- `JPEGView.exe`
- `WICLoader.dll`
- `avif.dll`
- `brotlicommon.dll`
- `brotlidec.dll`
- `dav1d.dll`
- `heif.dll`
- `jxl_dec.dll`
- `jxl_threads.dll`
- `lcms2.dll`
- `libde265.dll`
- `libraw.dll`

`scripts/Get-PortpilotArchitecture.ps1` classified `JPEGView.exe` as `Arm64`,
not ARM64EC or ARM64X. Its SHA-256 is
`29ab675971f0c48b22c4de15e92062016395d1dd5b69e18dc0dd85f7038a9139`.

The matched x64 negative control contains the same 12 PE files, and every one
reports `0x8664`. See `arm64-architecture.txt`,
`jpegview-architecture.json`, `arm64-sha256.txt`, and
`x64-negative-control.txt`.

## Functional launch gate

- Microsoft Windows 11 25H2 English ARM64 ISO SHA-256:
  `638aa2c88e94385b00f4f178d071e3df0b7d9e335577a83bd533b7f2eb65adf0`
- QEMU 11.1.0 with TCG
- WinPE build: 10.0.26100.8037
- Guest environment: Windows ARM64
- Hot-plugged package volume: `C:` / `QEMU_VFAT`

Launching `C:\qemu-smoke.cmd` loaded `JPEGView.exe` and all private DLLs. The
application reached its file-open window and remained responsive. The retained
capture is `qemu-winpe-launch.png`.

## Deferred S5 work

The S4 build intentionally retains three exact debt markers:

```text
src/JPEGView/Helpers.cpp:254
src/JPEGView/Helpers.cpp:294
src/JPEGView/BasicProcessing.cpp:2165
```

S5 must replace or correctly route around the temporary ARM64 image-filter
stubs, improve ARM64 CPU/topology handling, and repair cross-thread `volatile`
communication before parity is claimed.

## Remaining authority gap

No accessible real Windows ARM64 VM or physical machine is currently available.
QEMU closes only the S4 launch gate. S6 requires a GitHub-hosted
`windows-11-arm` runner or a newly initialized real ARM64 VM.
