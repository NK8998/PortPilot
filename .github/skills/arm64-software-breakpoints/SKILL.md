---
name: arm64-software-breakpoints
description: Port software-breakpoint instrumentation to Windows ARM64 by fixing trap encoding, program-counter resume semantics, context handling, and instruction-cache synchronization. Use only for debuggers, profilers, coverage tools, hot-patchers, or other tools that patch live instructions or manipulate process state.
---

# ARM64 Software Breakpoints (S5 specialist)

## When this applies

Use this skill only when the product overwrites executable memory with a trap
instruction and later restores the original bytes: debuggers, profilers,
coverage tools, hot-patchers, detour frameworks, or injected instrumentation.
For ordinary SIMD, atomics, assembly, JIT, or platform-string migration, use
`arm64-correctness` instead.

## The three ARM64 changes

Software breakpoints are not a one-constant port. Three independent facts change
from x86/x64, and missing any one produces a build that compiles but crashes or
silently misbehaves on ARM64.

### 1. Trap instruction width and encoding

x86/x64 `INT3` is one byte: `0xCC`. Windows ARM64 uses a fixed-width 4-byte
`BRK` instruction on a 4-byte-aligned instruction boundary. Any save buffer,
restore buffer, offset calculation, patch-size constant, or "advance by 1"
assumption must become target-architecture-specific.

Do not patch an arbitrary byte offset in an ARM64 instruction stream. Align to
the real instruction address, save all bytes that will be overwritten, and
restore exactly those bytes before resuming.

### 2. Saved program-counter landing point

x86/x64 exception handling usually sees `Eip`/`Rip` point past the one-byte
`INT3`, so resume logic rewinds by one. On Windows ARM64, the saved `Pc` for a
`BRK` has been observed to land four bytes past the trap (`BRK` at `X` produced
`CONTEXT.Pc == X + 4`). A no-op ARM64 resume path will skip the just-restored
instruction on every hit.

Do not infer this from another operating system, debugger API, or architecture.
Immediately after catching the exception and before adjustment, read the thread
context (`GetThreadContext` or the API actually used), log the saved PC and the
known trap address, and use that evidence to choose the rewind rule.

### 3. Instruction-cache coherency

ARM64 instruction and data caches are not coherent. After writing trap bytes or
restoring original instruction bytes, call `FlushInstructionCache` before the
target resumes. Flush the address range that will execute in the target process;
if bytes were staged locally and written remotely, flushing the local staging
buffer is the wrong address.

This omission is often invisible on x86/x64 and intermittent on ARM64 because
stale instructions may execute only under particular timing.

## Required abstraction

Centralize architecture-dependent breakpoint mechanics instead of scattering
`_M_ARM64` conditionals through generic debugger code: breakpoint bytes, trap
width, alignment, context flags, PC getter/setter, rewind rule, single-step
behavior, cache-flush range, process handle, and PE machine acceptance.

Remember that `_M_ARM64` is also defined for ARM64EC. Classic ARM64-only code
needs `#if defined(_M_ARM64) && !defined(_M_ARM64EC)`; ARM64-family code uses
`#if defined(_M_ARM64) || defined(_M_ARM64EC)`. Never delete the x64 branch.

## How to find affected sites

Search for:

- `0xCC`, `INT3`, one-byte breakpoint constants, or arrays of length 1
- `Rip -= 1`, `--Rip`, `Eip -= 1`, `Pc` special cases, or literal instruction
  widths in resume code
- `WriteProcessMemory`, `VirtualProtect`, injected code, and missing
  `FlushInstructionCache`
- PE parsers that accept only I386/AMD64 or route unknown machines through x64

The seed rules and background reference from `arm64-correctness` are useful:
`arm64-correctness/patterns/rules.json` and
`arm64-correctness/references/debugger-porting.md`.

## Verification

- [ ] Unit tests prove save/restore byte counts for x64 and ARM64.
- [ ] A native ARM64 fixture starts a target process, patches a known instruction,
      catches the trap, restores bytes, and resumes at the intended instruction.
- [ ] The fixture records the unadjusted saved PC and verifies the adjustment.
- [ ] Tests prove `FlushInstructionCache` is called for the executed address range
      after both patching and restoration.
- [ ] Coverage/profiling tests assert known-line hits or expected non-empty output;
      launching a target without validating instrumentation is not evidence.
- [ ] Exit codes and pass/fail counts are parsed; `continue-on-error` is allowed
      only when a final aggregate gate fails on any failure.

## Exit

Return to `arm64-correctness` after the breakpoint path has native ARM64 runtime
evidence. Any skipped project, disabled test, or unimplemented ARM64 branch must
be recorded and checked by `port-completeness`.
