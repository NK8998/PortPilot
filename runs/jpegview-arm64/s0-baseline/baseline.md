# JPEGView x64 baseline

## Identity

- Source: `https://github.com/sylikc/jpegview`
- Commit: `efd55a1a0b922bd7274c1d44717dac4104bb0fa3`
- Product version: `1.3.46`
- License: GPL-2.0
- Target requested: native Windows ARM64
- Authoritative source: clean `work/jpegview` checkout with pinned submodules
- Disposable Windows build tree: `C:\Users\Public\jpegview-arm64-build`

## Build system

- Visual Studio solution: `src/JPEGView.sln`
- Product projects: `JPEGView.vcxproj`, `WICLoader.vcxproj`
- Installer project: WiX `JPEGView.Setup.wixproj`
- Native dependencies are built from pinned submodules by batch, CMake, NMake,
  Meson, Ninja, and MSBuild.
- Upstream configurations define Win32 and x64 only.

## Host toolchain

- Visual Studio Enterprise 2026 18.9.3
- MSBuild 18.9.1
- MSVC v142 compiler 19.29.30159
- Windows SDK 10.0.28000.0
- CMake supplied by Visual Studio
- Windows Python 3.12.10
- NASM 3.02

The upstream `vs-init.bat` only searches Visual Studio under
`Program Files (x86)`. VS 2026 is installed under `Program Files`, so the
unchanged build was driven by temporary host scripts outside both repositories.
The source remained unchanged. The installed v142 toolset lacks ATL, so its
compiler/STL were combined with the installed current ATL headers and
`atls.lib`; this preserves the project's required legacy `<hash_map>` support.

## x64 baseline result

The pinned native dependencies were rebuilt for x64, followed by:

```text
msbuild.exe /target:JPEGView /property:Platform=x64 /property:configuration=Release src\JPEGView.sln
```

Result:

```text
Build succeeded.
0 Warning(s)
0 Error(s)
```

There is no JPEGView product unit-test project. Dependency test targets are not
part of the upstream product build.

## Architecture gate

`python3 scripts/verify_arch.py <release-directory> --expect x64 --recurse`
inspected 12 shipped PE files. All reported machine `0x8664`:

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

`JPEGView.exe` SHA-256:
`98a985cb94e6c12f1f50e2808eb47c8559d7cd7d8b7ee474d0bc4664f97a145ed`.

## Runtime baseline

Five Windows x64 launches were timed from process creation until a nonzero main
window handle appeared:

| Run | Time | Window | Responsive |
|---:|---:|---|---|
| 1 | 953 ms | `JPEGView` | yes |
| 2 | 5022 ms | `JPEGView` | yes |
| 3 | 1862 ms | `JPEGView` | yes |
| 4 | 1442 ms | `JPEGView` | yes |
| 5 | 1490 ms | `JPEGView` | yes |

The process was stopped by exact PID after each successful observation.

## User-visible parity scope

1. Open JPEG, GIF, BMP, PNG, TIFF, PSD, WebP, JPEG XL, HEIF, AVIF, RAW, and
   Windows Imaging Component formats.
2. Navigate forward and backward through a directory.
3. Zoom, pan, rotate, and fit images to the window or screen.
4. Apply sharpness, color balance, contrast, and local-density adjustments.
5. Crop, perspective-correct, and save edited images.
6. Display EXIF and image metadata.
7. Run slideshow/movie mode.
8. Copy images to and from the clipboard.
9. Print an image.
10. Set an image as desktop wallpaper.
11. Use localized menus and configuration files.
12. Register and use file associations.

## Baseline limitations

- The repository has no product unit-test suite, so later parity must use
  format fixtures and GUI/runtime smoke checks.
- Startup timing is diagnostic only; the five-run spread shows host noise and
  is not a performance claim.
