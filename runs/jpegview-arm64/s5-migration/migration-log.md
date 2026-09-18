# JPEGView ARM64 correctness migration

## Status

Production-code migration is complete and the source has zero
`TODO(arm64)` markers in shipping paths. S5 remains in progress because the
required weak-memory concurrency stress has not run on real ARM64 hardware.
QEMU TCG is sufficient for the functional checks below, but not for that gate.

## Workstream 1: thread synchronization

Source commit: `12d526e` (`fix: synchronize worker thread state`)

- Replaced `volatile bool` request completion/deletion flags with
  `std::atomic<bool>`.
- Published completed request data with release stores and consumed it with
  acquire loads.
- Replaced the worker termination flag with an acquire/release atomic.
- Replaced the image request ID's casted `InterlockedIncrement` storage with a
  relaxed `std::atomic<int>` counter.
- Retained the request-fanout `volatile LONG` counter because every access is
  performed through Windows `InterlockedDecrement`.
- Removed `CDirectoryWatcher::m_bTerminate`, which was written but never read;
  directory-watcher termination is already controlled by its event.

Both ARM64 and x64 Release builds completed with zero errors. Logs are retained
as `arm64-atomics-build.log` and `x64-atomics-build.log`.

## Workstream 2: portable processing and topology

Source commit: `43ba5f7` (`fix: route ARM64 through generic processing`)

- ARM64 high-quality resizing now compiles only the complete
  architecture-neutral implementation.
- X86 MMX/SSE and x64 SSE/AVX2 implementations and dispatch remain unchanged.
- ARM64 clamps configured `CPUType=MMX`, `SSE`, or `AVX2` to `CPU_Generic`, so
  stale x86 configuration cannot select an impossible instruction set.
- Removed the S4 null-return SIMD stubs from ARM64 shipping code.
- ARM64 physical-core counting now enumerates
  `RelationProcessorCore` records through dynamically resolved
  `GetLogicalProcessorInformationEx`.
- Kept a logical-processor fallback only for environments where that Windows API
  cannot be resolved.

Both ARM64 and x64 Release builds completed with zero errors. Logs are retained
as `arm64-generic-build.log` and `x64-generic-build.log`.

## Architecture and functional checks

- `rg -n 'TODO\(arm64\)' src/JPEGView` returns zero matches.
- All 12 rebuilt ARM64 package PE files report `0xAA64`.
- The matched 12-file x64 package reports `0x8664`.
- Final ARM64 `JPEGView.exe` SHA-256:
  `06e46e3cf9b2cc4edcb25ea3ad24897bdfcdc4846ac778c287655329436a993b`.

For the WinPE functional test, `JPEGView.ini` deliberately contained:

```text
CPUType=AVX2
```

Windows ARM64 WinPE reported `PROCESSOR_ARCHITECTURE=ARM64`, and JPEGView
successfully decoded and displayed libjpeg-turbo's `testorig.jpg`. This proves
that stale forced-x86 configuration is safely routed to the generic ARM64 path
and that the generic high-quality image path remains functional. The screenshot
is `forced-avx-generic-smoke.png`.

## Remaining S5 gate

No product unit-test suite exists. The atomic changes still require repeated
image-load, read-ahead, processing-pool, and shutdown stress on real ARM64
hardware under load. Do not mark S5 passed or claim weak-memory reliability
from QEMU TCG evidence.
