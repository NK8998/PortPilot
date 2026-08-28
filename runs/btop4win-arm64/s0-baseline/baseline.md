# S0 — Intake & Baseline

**App:** btop4win — Windows resource monitor (C++ port of btop++)
**Repo:** https://github.com/aristocratos/btop4win
**Commit:** `4b4bda273988e7eec41727a41f2cbc907d14eb0e` (2025-10-12)
**License:** Apache-2.0
**Version string:** `btop4win version: 1.0.5`
**Size:** 13,888 LOC (8 `.cpp`, 6 `.hpp`, 2 vendored headers)

## Toolchain (host)

Cross-compiling from an x64 Windows host; **this box cannot execute ARM64 binaries.**

| | |
|---|---|
| Visual Studio | 18 Enterprise (`C:\Program Files\Microsoft Visual Studio\18\Enterprise`) |
| MSBuild | `MSBuild\Current\Bin\MSBuild.exe` |
| Toolsets available | `v145`, `ClangCL` (**not** `v143`) |
| Platforms available | Win32, x64, **ARM64**, **ARM64EC** |
| MSVC versions | 14.16, 14.29, 14.44, 14.51, 14.52 |
| ARM64 cross-compiler | `VC\Tools\MSVC\<ver>\bin\Hostx64\arm64` ✅ |
| Windows SDK | 10.0.28000.0 |

### Deviation from upstream: platform toolset

The project pins `<PlatformToolset>v143</PlatformToolset>` (VS 2022). Only `v145`
is installed, so every build here passes `/p:PlatformToolset=v145`.
**The `.vcxproj` is not modified for this** — it is a command-line override, so
the repo still builds as upstream intends on a VS 2022 machine.

```
error MSB8020: The build tools for Visual Studio 2022 (Platform Toolset = 'v143')
cannot be found.
```

## Reproducible build commands

Run from `C:\portpilot\btop4win` (a Windows-local copy; building over a
`\\wsl.localhost` UNC path does not work — `cmd.exe` rejects UNC CWDs).

```bat
set MSB="C:\Program Files\Microsoft Visual Studio\18\Enterprise\MSBuild\Current\Bin\MSBuild.exe"
%MSB% btop4win.sln /p:Configuration=Release /p:Platform=x64 /p:PlatformToolset=v145 /m /v:minimal /nologo
%MSB% btop4win.sln /p:Configuration=Debug   /p:Platform=x64 /p:PlatformToolset=v145 /m /v:minimal /nologo
```

## Baseline results

| Configuration | Result | Output |
|---|---|---|
| `Release\|x64` | ✅ builds clean, 0 warnings shown at `/v:minimal` | `x64\Release\btop4win.exe` (3,083,776 bytes) |
| `Debug\|x64` | ✅ builds clean | `x64\Debug\btop4win.exe` |

Architecture confirmed:

```
> dumpbin /headers x64\Release\btop4win.exe | findstr machine
            8664 machine (x64)
```

Runtime smoke:

```
> x64\Release\btop4win.exe --version
btop4win version: 1.0.5
```

## Test baseline

**There is no automated test suite.** No `test/` directory, no CI workflows
(`.github/` contains only issue templates and `FUNDING.yml`).

> Consequence for S6: parity must be established by **manual feature walkthrough**
> against the inventory below, not by a test-suite diff. There are no
> pre-existing test failures to carry forward, because there are no tests.

## Feature inventory (S6 parity matrix seed)

User-observable behaviour, from the README plus the source. Each becomes a
pass/degraded/fail row in S6.

| # | Feature | Notes / where |
|---|---|---|
| 1 | Launches, renders TUI in Windows Terminal | ANSI escape sequences |
| 2 | `--version` / `-v` prints version | verified x64 |
| 3 | `--help` / `-h` prints usage | verified x64 |
| 4 | CPU box: per-core load graph + total | `Cpu::collect` |
| 5 | **CPU model name** from registry | `get_cpuName()` — **touched by this port** |
| 6 | CPU frequency (MHz) | `get_cpuHz()` |
| 7 | CPU temperature (needs LHM build) | LHM-only, out of scope |
| 8 | Memory box: used/available/cached | `Mem::collect` |
| 9 | Swap/pagefile usage | `Mem::collect` |
| 10 | Disk list, usage %, free space | `Mem::collect` disks |
| 11 | Disk IO activity + read/write speeds | `winioctl` |
| 12 | Network box, auto-scaling graph | `iphlpapi` |
| 13 | Network interface selection | `GetAdaptersAddresses` |
| 14 | Process list w/ CPU, mem, PID, user | `Proc::collect`, WMI |
| 15 | Process tree view | `Proc` tree mode |
| 16 | Process sorting (all columns) | |
| 17 | Process filtering | |
| 18 | Process detail panel for selection | |
| 19 | Terminate a process | needs privilege |
| 20 | Services list | WMI `Win32_Service` |
| 21 | Service detail panel | `bstr2str` heavy |
| 22 | Start/stop/pause/continue a service | |
| 23 | Set service start-type | |
| 24 | Battery meter | `PowrProf` |
| 25 | Mouse support (click + scroll) | |
| 26 | Keyboard nav (UP/DOWN selection) | |
| 27 | Options menu — edit every config key | `btop_menu.cpp` |
| 28 | Help menu | |
| 29 | Theme loading from `themes/` (26 themes) | `btop_theme.cpp` |
| 30 | Presets `-p 0..9` | |
| 31 | TTY mode `-t` / `+t` (16-colour) | |
| 32 | Low-colour mode `-lc` (256-colour) | |
| 33 | `--debug` timing overlay | µs collect/draw timers |
| 34 | Config persisted to `btop.conf` | auto-generated |

## Performance baseline

btop4win is an interactive TUI with no benchmark harness. The meaningful
S6 measurement is the `--debug` overlay, which reports **microsecond timers for
the collect and draw phases**. That is the number to compare native ARM64
against emulated x64 on the same ARM64 machine.

- Binary size, `Release|x64`: **3,083,776 bytes**

## Exit gate

- [x] x64 build reproducible from a clean clone with documented commands
- [x] Test baseline recorded — *no test suite exists*; S6 uses manual walkthrough
- [x] Feature inventory written (34 items)
- [x] `artifacts/s0-baseline/` populated; `PORT_STATE.json` created
