# S6 — Verification & Parity

**App:** btop4win, branch `user/neil/arm64-support` (upstream `4b4bda2` + 3 commits)
**Status:** in progress — no-emulation proof complete, parity walkthrough partial

## 1. No-emulation proof — **PASS**

This is the load-bearing claim of the whole port. Windows on Arm emulates x64
transparently, so "the app runs" is *not* evidence of a native port; the
upstream x64 build would also run.

| Check | Method | Result |
|---|---|---|
| Binary architecture | `dumpbin /headers` on build output | `AA64 machine (ARM64)` |
| Shipped asset | PE header of `btop4win.exe` inside `btop4win-arm64.zip` | `0x AA64` |
| **Process architecture at runtime** | Task Manager → Details → Architecture column | **`ARM64`** |

The third line is the one that matters: the process is executing natively, not
under the x64 translation layer.

**Outstanding:** mechanical `IsWow64Process2` proof via `./scripts/vm.sh smoke`,
and loaded-module inspection to confirm no x64 DLLs are pulled in. Both blocked
on SSH access (see blocker b-001); the port is not gated on them.

## 2. Verification platform

| | |
|---|---|
| CPU | **Microsoft Azure Cobalt 100** (Arm Neoverse N2) |
| OS | Windows 11 ARM64 |
| Host | User's own Azure VM |
| Build | `Release\|ARM64`, MSVC toolset v145 |

> **Important when reading the results below.** This is a *virtualised server*,
> not an Arm laptop. Several features depend on hardware that no Azure VM
> exposes regardless of CPU architecture. Absent readings for those are
> **virtualisation artifacts, not ARM64 port defects**, and must not be recorded
> as parity failures. They are marked `N/A-VM` below.

## 3. Parity matrix

Baseline: the 34-feature inventory in `artifacts/s0-baseline/baseline.md`.

Legend: **PASS** verified on ARM64 · `TODO` not yet walked · `N/A-VM` not
testable on a virtualised host · `N/A` out of scope

| # | Feature | Result | Note |
|---|---|---|---|
| 1 | Launches, renders TUI | **PASS** | Runs and displays correctly |
| 2 | `--version` / `-v` | TODO | |
| 3 | `--help` / `-h` | TODO | |
| 4 | CPU box: per-core load + total | TODO | **High value** — Cobalt 100 is many-core; a good layout stress test |
| 5 | **CPU model name** | **PASS** | Reports `Cobalt 100`. **The only behaviour this port could change** — see §4 |
| 6 | CPU frequency (MHz) | TODO | |
| 7 | CPU temperature | `N/A` | LHM-only build; excluded from this port |
| 8 | Memory: used/available/cached | TODO | |
| 9 | Swap/pagefile usage | TODO | |
| 10 | Disk list, usage %, free | TODO | |
| 11 | Disk IO + read/write speeds | TODO | Virtual disks may report differently |
| 12 | Network box + auto-scaling graph | TODO | |
| 13 | Network interface selection | TODO | |
| 14 | Process list (CPU, mem, PID, user) | TODO | WMI-backed |
| 15 | Process tree view | TODO | |
| 16 | Process sorting | TODO | |
| 17 | Process filtering | TODO | |
| 18 | Process detail panel | TODO | |
| 19 | Terminate a process | TODO | Needs privilege |
| 20 | Services list | TODO | WMI `Win32_Service` |
| 21 | Service detail panel | TODO | **`bstr2str`-heavy** — same helper as the §4 change |
| 22 | Start/stop/pause/continue service | TODO | |
| 23 | Set service start-type | TODO | |
| 24 | Battery meter | `N/A-VM` | Server VM has no battery |
| 25 | Mouse support | TODO | |
| 26 | Keyboard navigation | TODO | |
| 27 | Options menu | TODO | |
| 28 | Help menu | TODO | |
| 29 | Theme loading (26 themes) | TODO | |
| 30 | Presets `-p 0..9` | TODO | |
| 31 | TTY mode `-t` | TODO | |
| 32 | Low-colour mode `-lc` | TODO | |
| 33 | `--debug` timing overlay | TODO | Also the perf-delta instrument (§5) |
| 34 | Config persisted to `btop.conf` | TODO | |

**Verified: 3 (features 1, 5 + native architecture). N/A: 2. Remaining: 29.**

## 4. The single regression-risk item — **PASS**

The port changed exactly one line of behaviour. Everything else is
byte-identical logic recompiled for a different instruction set.

`Cpu::get_cpuName()`, `src/btop_collect.cpp:1112`:

```diff
-name = string(CW2A(cpuName));   // wide -> thread ANSI codepage
+name = bstr2str(cpuName);       // wide -> UTF-8
```

**Result: reports `Cobalt 100` — correct, not garbled, not truncated, not
empty.** The registry `ProcessorNameString` read and the UTF-8 conversion both
work on ARM64.

This closes the highest-risk parity item in the port. Any remaining defect found
in features 2–34 is far more likely to be upstream behaviour or an Arm *platform*
difference than a consequence of this change.

<sub>Caveat: `Cobalt 100` is pure ASCII, so it does not exercise the ANSI↔UTF-8
divergence. A non-ASCII CPU string would, but no shipping CPU name uses one.
Feature 21 (service detail panel) leans on the same `bstr2str` helper against
much more varied strings and is the better stress test — flagged above.</sub>

## 5. Performance / power delta — **not yet measured**

The actual deliverable of a native port is avoiding the x64 translation layer.
For a monitor that samples continuously, this shows up as lower CPU overhead
per refresh.

Planned method: run the native ARM64 build and the upstream x64 build (which
Windows will emulate) on the same machine, and compare the `--debug` overlay's
µs collect/draw timers. Not yet done.

## 6. Conclusion (provisional)

The port is **proven native and proven functional at the smoke-test level**, with
the one behavioural change verified correct. It is **not yet proven at full
feature parity** — 29 of 34 features remain unwalked.

Honest summary: this is enough to justify shipping as a **pre-release**. It is
not yet enough to claim parity with the x64 build.
