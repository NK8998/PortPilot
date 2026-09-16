# S4 — Build Bring-up Notes

**App:** [`jarun/nnn`](https://github.com/jarun/nnn) v5.3 (upstream `80fdbd01`)
**Branch:** `user/neil/arm64-windows-port` (in the `work/nnn` clone)
**Strategy:** classic ARM64, single binary (see [ADR 0001](../../docs/adr/0001-arm64-strategy.md))
**Status: ✅ compile + link gate met.** ⚠️ *launch-on-hardware gate outstanding — no ARM64 machine provisioned.*

---

## 1. What made this port unusual

nnn is not an x64 Windows app being moved to ARM64 Windows. **It has no native
Windows build at all** — it is a POSIX terminal file manager (Linux, macOS, BSD,
Haiku). So the x86-64 assumption to remove was not SIMD or inline assembly;
S1 found **zero** intrinsics, **zero** `__asm`, **zero** `_M_X64` branches.

The actual architecture-specific surface was **the operating system**: 54 distinct
POSIX symbols across ~360 call sites. The port is therefore a *portability layer*
plus a cross toolchain, and ARM64 falls out of the toolchain choice.

This is why the S3 ADR chose **classic ARM64** rather than ARM64EC: there is no
x64 Windows binary to stay compatible with, and no x64-only dependency to
accommodate — the S2 `emulate` list was empty.

## 2. Result

| Configuration | Result | Machine | Size |
|---|---|---|---|
| `aarch64-w64-mingw32` (this port) | ✅ builds & links | **`IMAGE_FILE_MACHINE_ARM64 (0xAA64)`** / `coff-arm64` | 1,161,728 B |
| Linux x86-64, default flags | ✅ **still** builds, zero warnings | ELF x86-64 | 171,392 B |
| Linux x86-64, scoped flags | ✅ **still** builds, zero warnings | ELF x86-64 | 162,304 B — **byte-identical to the S2 baseline** |

Reproduce with `work/nnn/build-arm64.sh`. The full source change is captured as
[`0001-nnn-arm64-windows-port.patch`](source/0001-nnn-arm64-windows-port.patch)
(the `work/` tree is gitignored, being a separate upstream repo).

### Architecture gate

```
$ llvm-readobj --file-headers nnn.exe | grep -i machine
  Machine: IMAGE_FILE_MACHINE_ARM64 (0xAA64)

$ llvm-objdump -a nnn.exe
nnn.exe:	file format coff-arm64
```

### No-emulation / no-vendored-x64 evidence

Imports are Windows system DLLs only — every one is present on a stock
Windows 10+ install, and none is an x64 payload:

```
KERNEL32.dll, USER32.dll,
api-ms-win-crt-{convert,environment,filesystem,heap,locale,math,private,
                runtime,stdio,string,time,utility}-l1-1-0.dll
```

ncurses, PCRE2 and winpthreads are **statically linked** (`-static`), so the
result is a single self-contained `nnn.exe` with no sidecar DLLs. An earlier
dynamic link pulled in `libwinpthread-1.dll`; that was removed deliberately
rather than shipped alongside.

## 3. Toolchain

| Component | Version | Notes |
|---|---|---|
| llvm-mingw | `20260616`, LLVM 22.1.8 | target `aarch64-w64-windows-gnu`; SHA256 `534b92e0…4deda`, 82,188,288 B — matched the published checksum |
| ncurses | 6.5 | `--enable-widec --enable-term-driver`; Windows console driver (`port_win32con`) confirmed active |
| PCRE2 | 10.47 | static, `PCRE2_CODE_UNIT_WIDTH=8` |

MSVC was **not** used. nnn is C11 written against POSIX; mingw-w64 supplies a
large part of that surface natively (`open`/`read`/`write`, `opendir` family
absent but `_findfirst` present, `S_IS*` macros, `PATH_MAX`), whereas MSVC would
have required shimming a great deal more. The ADR records this.

> **Cross-compiling trap, cost ~10 min:** under WSL2, `./configure --host=aarch64-w64-mingw32`
> **hangs with no error output**. binfmt_misc hands the generated `conftest.exe`
> to Windows, which cannot execute ARM64 on an x64 host, so configure waits
> forever. Always pass `--build=x86_64-pc-linux-gnu`. Diagnose with
> `ps -eo pid,etime,comm | grep conftest`.

> ncurses `make install` **exits 2** while installing cross-built `tic`/`infocmp`,
> which cannot run on the host. This is benign — the library and headers install
> correctly. Do not "fix" it.

> ncurses' Windows build **folds tinfo into `libncursesw`**. Linking `-ltinfo`
> (as the POSIX Makefile does) fails.

## 4. The portability layer

`src/win/win_compat.{c,h}` — 1,406 + 406 lines, compiles with zero warnings.

| Area | POSIX API | Win32 implementation |
|---|---|---|
| Metadata | `stat`/`lstat`/`fstatat` | `CreateFileW` + `GetFileInformationByHandle` |
| Directories | `opendir`/`readdir`/`closedir` | `FindFirstFileExW`, populating `d_type` |
| Free space | `statvfs` | `GetDiskFreeSpaceExW` |
| Paths | `realpath`/`readlink` | `GetFinalPathNameByHandleW` |
| Processes | `fork`+`execvp`+`waitpid` | `CreateProcessW` (see §5) |
| Signals | `sigaction` | `SetConsoleCtrlHandler` |
| Change notify | inotify / kqueue | `ReadDirectoryChangesW` (overlapped) |
| Text | `wcwidth`, `wcswidth` | own Unicode-range implementation |
| GNU extras | `memmem`, `getline`, `strsep`, `strcasestr`, `ffs` | portable C |
| Misc | `link`, `fchmod`, `localtime_r`, `pipe` | `CreateHardLinkW`, `SetFileInformationByHandle`, `localtime_s`, `_pipe` |

All UTF-8 ↔ UTF-16 conversion happens at the boundary, so nnn stays a UTF-8
program and Unicode filenames work.

### Three `#ifdef` ordering rules that the design depends on

1. **`win_compat.h` must be included *last*, after `nnn.h`.** It does
   `#define stat win_stat`; included early, that would corrupt every mingw
   system header declaring `int stat(...)`. Only the `WIN_NM` feature macro is
   defined early, in the platform chain at the top of the file.
2. **`#define sigaction(s,a,o) win_sigaction(...)` is function-like**, so
   `struct sigaction {` and the compound literal
   `(struct sigaction){.sa_handler = SIG_IGN}` are never expanded. This is what
   makes that macro safe.
3. **`#define stat win_stat` is object-like** and deliberately covers both the
   struct tag and the function name at once — mingw itself uses exactly this
   trick (`#define stat _stat64`).

## 5. The one genuinely structural change: no `fork()`

Everything else was a symbol substitution. The process model was not.

nnn forks, adjusts the child's fds, then `execvp`s — five sites. Windows has no
`fork()` and it cannot be emulated, so the redirection must be decided *before*
the process exists. Two helpers replace it:

- `win_spawn_argv(argv, nowait, notrace, nostdin, tty)` → `spawn()`.
  Maps `F_NOWAIT` to `DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP` and
  `F_NOTRACE`/`F_NOSTDIN` to `NUL` redirection. `F_TTY` needs nothing: the child
  inherits our console, which already *is* the terminal.
- `win_spawn_capture(argv, out_fd)` → `get_output()`, `buffer_command_output()`,
  `preview_pane()`. Duplicates `out_fd` as an inheritable handle into
  `STARTF_USESTDHANDLES`, then waits.

Both build their command line through a shared `build_cmdline()` that applies
the **`CommandLineToArgvW` quoting rules** — backslash-before-quote handling
included. Getting this wrong is a silent argument-corruption bug for any path
containing a space or a quote, which on Windows is most of them.

One behavioural difference is recorded rather than hidden: POSIX pipes are set
`O_NONBLOCK` and read *while* the child runs. Windows anonymous pipes have no
`O_NONBLOCK`, so `get_output()` closes the write end before reading (safe — the
child has already exited), and `win_pipe()` uses a 64 KB buffer to match Linux's
default pipe capacity.

## 6. Debt inventory — S5's work queue

Four `TODO(arm64)` markers. **None is in a core file-manager path**; all four are
in features the S4 scope decision deferred.

| # | Site | What | Why deferred |
|---|---|---|---|
| 1 | `nnn.c:66` | `WIN_NM` defined but unconsumed — 8 notification extension points have no `WIN_NM` arm, so auto-refresh-on-change is compiled out | Backend (`win_init_nm`/`win_watch_dir`/`win_is_update_needed`/`win_stop_watch`/`win_close_nm`) is already written and mirrors the `HAIKU_NM` API one-for-one; only the arms are missing. Correctness work = S5. |
| 2 | `nnn.c:6703` | Plugin control channel | Needs a Windows named pipe + reader thread, *not* a FIFO — the POSIX version relies on `fork()` to hold the write end open. Plugins are out of v1 scope. |
| 3 | `nnn.c:8194` | Preview pane runs the previewer to completion before reading | Will stall on previews >64 KB. Needs a reader thread. Previews are out of v1 scope. |
| 4 | `win_compat.c:1155` | `fchmod` maps only the user-write bit | Full POSIX mode → ACL translation is a parity task. |

Two compiler warnings remain, and both are **honest signals of exactly this
debt**, not noise: `handle_event` unused (item 1) and `readpipe` unused (item 2).
They are deliberately not suppressed — they will disappear when S5 wires those
paths.

## 7. Verification checklist

- [x] ARM64 build succeeds from clean
- [x] x64 build still succeeds — **byte-identical** to the S2 baseline, zero warnings
- [x] `AA64` reported for every shipped binary (there is exactly one)
- [x] **App launches in Windows ARM64 and reaches a known-good point** — `nnn.exe -V` prints `5.3`, exit code 0
- [x] Every stub carries a `TODO(arm64):` marker, all four inventoried above and in `PORT_STATE.json`
- [x] No prebuilt x64 binary vendored to satisfy the linker (imports verified)

## 8. QEMU Windows ARM64 launch evidence

The S4 launch gate was executed on September 16, 2026 in Windows 11 25H2 Arm64
V2 WinPE under QEMU 11.1.0 TCG. The ISO was downloaded from Microsoft and
matched Microsoft's published SHA-256:

```text
638AA2C88E94385B00F4F178D071E3DF0B7D9E335577A83BD533B7F2EB65ADF0
```

The application drive was hot-plugged only after Windows Setup appeared. The
WinPE command prompt produced:

```text
PROCESSOR_ARCHITECTURE=ARM64
PROCESSOR_IDENTIFIER=ARMv8 (64-bit) Family 8 Model 51 Revision 0, QEMU
5.3
NNN_EXIT_CODE=0
```

Screenshot: [`qemu-smoke.png`](qemu-smoke.png).

This closes the S4 functional launch gate. It does **not** replace real ARM64
hardware for S6 non-emulation, performance, power, device, timing, or
weak-memory evidence.

### Failure modes discovered

- `highmem=off` with 8 GiB fails before the window opens:
  `Addressing limited to 32 bits, but memory exceeds it`. Current QEMU boots
  this guest with high memory enabled.
- Missing the ISO keypress window drops into the UEFI shell. Reset through the
  QEMU monitor and inject Enter during boot.
- Attaching QEMU's vvfat share during UEFI enumeration triggers a black-screen
  `Synchronous Exception`. Boot Windows Setup first, then hot-plug the share.
