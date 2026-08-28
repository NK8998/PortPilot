# REFERENCES.md — Curated link library

Every link here was HTTP-checked when this file was written. Links marked
🔒 return `403` to automated fetchers (bot protection) but work in a browser.

---

## 1. Start here (Microsoft, authoritative)

| Link | Why |
|---|---|
| [Windows on Arm documentation](https://learn.microsoft.com/en-us/windows/arm/overview) | The hub. Read this first. |
| [Add Arm support to your Windows app](https://learn.microsoft.com/en-us/windows/arm/add-arm-support) | The official step-by-step port guide, per ecosystem |
| [Common Visual C++ ARM migration issues](https://learn.microsoft.com/en-us/cpp/build/common-visual-cpp-arm-migration-issues) | **The single highest-value page for C++ ports.** Read it fully. |
| [ARM64 ABI conventions](https://learn.microsoft.com/en-us/cpp/build/arm64-windows-abi-conventions) | Calling convention, register usage, `x18` reservation, stack alignment |
| [x86/x64 emulation on Arm](https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation) | What emulation does and costs; your S6 control group |

## 2. ARM64EC and ARM64X

| Link | Why |
|---|---|
| [ARM64EC overview](https://learn.microsoft.com/en-us/windows/arm/arm64ec) | What it is, when to choose it |
| [Get started with ARM64EC](https://learn.microsoft.com/en-us/windows/arm/arm64ec-build) | `/arm64EC`, MSBuild and CMake setup |
| [ARM64EC ABI & interop](https://learn.microsoft.com/en-us/windows/arm/arm64ec-abi) | Thunks, entry/exit shims — read before hand-writing EC asm |
| [ARM64X PE files](https://learn.microsoft.com/en-us/windows/arm/arm64x-pe) | The dual-view binary format |
| [Build ARM64X binaries](https://learn.microsoft.com/en-us/windows/arm/arm64x-build) | Practical linker setup |

## 3. Code migration: intrinsics, SIMD, assembly

| Link | Why |
|---|---|
| [ARM64 intrinsics (MSVC)](https://learn.microsoft.com/en-us/cpp/intrinsics/arm64-intrinsics) | MSVC's ARM64 intrinsic surface — `_CountLeadingZeros`, `_Interlocked*_acq/rel`, etc. |
| [Arm Neon Intrinsics Reference](https://developer.arm.com/architectures/instruction-sets/intrinsics/) 🔒 | Searchable canonical NEON intrinsic database |
| [SIMDe](https://github.com/simd-everywhere/simde) | Portable shims: compile SSE/AVX source largely unchanged on NEON. Best first attempt for large SIMD surfaces. |
| [sse2neon](https://github.com/DLTcollab/sse2neon) | Focused SSE→NEON header. Lighter than SIMDe, narrower coverage. |
| [Arm Learning Path: intrinsics & code migration](https://learn.arm.com/learning-paths/cross-platform/intrinsics/) | Hands-on tutorial for SSE→NEON thinking |
| [Arm Learning Paths: laptops & desktops](https://learn.arm.com/learning-paths/laptops-and-desktops/) | Windows-on-Arm specific learning paths incl. CI |

**Rule of thumb for SIMD:** scalar fallback → SIMDe/sse2neon → hand-written NEON.
Only escalate when a measurement says you must. Note there is **no 256-bit NEON**;
every AVX register becomes two 128-bit ops.

## 4. Prior art — agentic ARM64 porting

| Link | Why |
|---|---|
| [qualcomm/extension-wos-porter](https://github.com/qualcomm/extension-wos-porter) | **Closest analogue to this project.** An agentic Windows-on-Arm porting extension with a real skills library and Copilot/Claude porting workflows. |
| [WoS Porter skills directory](https://github.com/qualcomm/extension-wos-porter/tree/main/skills) | Production `SKILL.md` examples: `arm64-baseline-porting`, `sse-avx-to-neon`, `asm-x64-to-arm64`, `intrinsics-x64-to-arm64`, `arm64-inlineasm-to-intrinsics`, `jit-arm64ec-virtualalloc-fix-skill` |
| [WoS Porter x64→ARM64 Copilot workflow](https://github.com/qualcomm/extension-wos-porter/blob/main/.github/workflows/wos-port-copilot-x64-arm64.yml) | A working end-to-end agentic porting GitHub Actions workflow |
| [Ampere Porting Advisor](https://github.com/AmpereComputing/ampere-porting-advisor) | Static scanner that flags x86-isms and porting blockers. Linux-oriented but the detection rules transfer — useful in **S1**. |
| [Arm AppReady for Windows on Arm](https://developer.arm.com/laptops-and-desktops/windows-app-ready) 🔒 | Arm's own porting/optimisation program and checklists |
| [Rewriting Bun in Rust](https://bun.com/blog/bun-in-rust) | The inspiration cited in the project proposal: specialised implementation agents + adversarial reviewers + persistent task loops + objective test gates |
| [A Technical Guide to Porting Software to ARM64](https://www.janeasystems.com/blog/porting-software-arm64) | Good practitioner-level narrative walkthrough |

## 5. Build systems & toolchain

| Link | Why |
|---|---|
| [VS Build Tools component IDs](https://learn.microsoft.com/en-us/visualstudio/install/workload-component-id-vs-build-tools) | Find the exact ARM64/ARM64EC build-tools component to install |
| [`/MACHINE` linker option](https://learn.microsoft.com/en-us/cpp/build/reference/machine-specify-target-platform) | Forcing the target machine |
| [`dumpbin` options](https://learn.microsoft.com/en-us/cpp/build/reference/dumpbin-options) | **Your ground truth** for "what architecture is this binary really?" |
| [vcpkg triplets](https://learn.microsoft.com/en-us/vcpkg/users/triplets) | `arm64-windows`, `arm64-windows-static`; also how to author a custom triplet |
| [microsoft/vcpkg](https://github.com/microsoft/vcpkg) | Check per-port ARM64 status in the registry itself |
| [CMakeSettings reference](https://learn.microsoft.com/en-us/cpp/build/cmakesettings-reference) | ARM64 configurations in VS-driven CMake |

Key invocations:

```bat
:: MSVC / CMake
cmake -G "Visual Studio 17 2022" -A ARM64 -B build-arm64
cmake --build build-arm64 --config Release

:: vcpkg
vcpkg install <port> --triplet arm64-windows

:: verify what you actually built  (AA64 = ARM64, 8664 = x64)
dumpbin /headers build-arm64\Release\app.exe | findstr machine
```

## 6. Per-ecosystem ARM64 support

| Stack | Target / flag | Reference |
|---|---|---|
| .NET | RID `win-arm64` | [RID catalog](https://learn.microsoft.com/en-us/dotnet/core/rid-catalog) · [ReadyToRun](https://learn.microsoft.com/en-us/dotnet/core/deploying/ready-to-run) |
| Rust | `aarch64-pc-windows-msvc` (Tier 1) | [Platform support](https://doc.rust-lang.org/rustc/platform-support.html) |
| Go | `GOOS=windows GOARCH=arm64` | [Install from source / env](https://go.dev/doc/install/source) |
| Node.js | Official win-arm64 builds | [Downloads](https://nodejs.org/en/download) — watch **native addons** (`node-gyp`), they are the real work |
| Python | Native ARM64 Windows builds | [Using Python on Windows](https://docs.python.org/3/using/windows.html) — watch **C-extension wheels** |
| Electron | `--arch=arm64` | [Windows on Arm](https://www.electronjs.org/docs/latest/tutorial/windows-arm) |
| Qt | ARM64 MSVC builds | [Qt for Windows](https://doc.qt.io/qt-6/windows.html) |
| Windows App SDK | ARM64 supported | [Windows App SDK](https://learn.microsoft.com/en-us/windows/apps/windows-app-sdk/) |
| Kernel drivers | Native ARM64 **only** | [Building ARM64 drivers](https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/building-arm64-drivers) |

> For managed/interpreted stacks the runtime is rarely the problem — **native
> add-ons are**. A pure-Python or pure-C# app usually "just works"; the moment a
> C extension, `node-gyp` module, or `runtimes/win-x64/native/` NuGet payload
> appears, you are doing a C/C++ port after all.

## 7. Runtime & platform APIs

| Link | Why |
|---|---|
| [`IsWow64Process2`](https://learn.microsoft.com/en-us/windows/win32/api/wow64apiset/nf-wow64apiset-iswow64process2) | Detect emulation: process arch vs native machine arch |
| [File system redirector](https://learn.microsoft.com/en-us/windows/win32/winprog64/file-system-redirector) | `System32` / `SysWOW64` / `SysArm32` behaviour |
| [Coreinfo (Sysinternals)](https://learn.microsoft.com/en-us/sysinternals/downloads/coreinfo) | Inspect CPU features on the ARM64 test machine |

Useful checks:

```powershell
# Is this process native or emulated? (.NET)
[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
[System.Runtime.InteropServices.RuntimeInformation]::OSArchitecture

# What modules is my process loading, and are any of them x64?
Get-Process app | Select-Object -ExpandProperty Modules |
  Select-Object ModuleName, FileName
```

Also: Task Manager → Details → right-click column headers → add **Architecture**.
This is the fastest "am I actually native?" check and makes a good S6 screenshot.

## 8. CI on ARM64

| Link | Why |
|---|---|
| [GitHub-hosted runners reference](https://docs.github.com/en/actions/reference/runners/github-hosted-runners) | `windows-11-arm` availability, labels, limits |
| [Windows 11 ARM64 runner image contents](https://github.com/actions/runner-images/blob/main/images/windows/Windows11-Arm64-Readme.md) | Exactly which toolchains/SDKs are preinstalled — check before installing anything |
| [ARM64 runners GA announcement](https://github.blog/changelog/2025-08-07-arm64-hosted-runners-for-public-repositories-are-now-generally-available/) | Availability for public repos |

Template: [`templates/ci/windows-arm64.yml`](../templates/ci/windows-arm64.yml).

> Cross-compiling ARM64 on an x64 runner is fine for **building**, but you cannot
> **run** ARM64 tests there. Build anywhere; test on `windows-11-arm`.

## 9. Copilot agent customisation

| Link | Why |
|---|---|
| [About agent skills](https://docs.github.com/en/copilot/concepts/agents/about-agent-skills) | Concepts and `SKILL.md` format |
| [Adding agent skills for Copilot CLI](https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills) | Discovery paths: `.github/skills/` and `~/.copilot/skills/` |

---

## Link maintenance

Re-verify periodically:

```bash
grep -oP 'https?://[^\s)>"]+' docs/*.md .github/skills/*/SKILL.md *.md \
  | cut -d: -f2- | sort -u \
  | while read -r u; do
      printf '%s  %s\n' "$(curl -s -o /dev/null -w '%{http_code}' -L --max-time 20 -A 'Mozilla/5.0' "$u")" "$u"
    done
```

`403` from `developer.arm.com` is expected (bot protection), not a dead link.
