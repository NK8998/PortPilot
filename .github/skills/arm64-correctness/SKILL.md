---
name: arm64-correctness
description: Make an ARM64 Windows port correct after it compiles by migrating atomics, SIMD, assembly, runtime code generation, platform strings, and debugger-style machine assumptions. Use at S5 when burning down TODO(arm64) markers or investigating ARM64-only wrong results, crashes, or heisenbugs.
---

# ARM64 Correctness (S5)

## Goal

Make the ARM64 build actually correct, not merely compiling. S4 may create
`// TODO(arm64): <what and why>` stubs to get a linkable build; S5 removes them
from shipping paths and proves the ARM64 behavior still matches x64.

Use `arm64-software-breakpoints` instead for debuggers, profilers, coverage
engines, hot-patchers, or any code that overwrites executable instructions and
manipulates process context. This skill still owns the surrounding correctness
review.

## Non-negotiables

1. **Never regress x64.** Guard ARM64-family code with
   `#if defined(_M_ARM64) || defined(_M_ARM64EC)` and keep the x86/x64 branch.
2. **Classic ARM64 is not ARM64EC.** `_M_ARM64` is also defined on ARM64EC;
   classic-only code needs `#if defined(_M_ARM64) && !defined(_M_ARM64EC)`.
3. **Do not replace correctness with silence.** A stub, disabled feature, or
   excluded test belongs to `port-completeness`, not to a successful S5 exit.
4. **One workstream per commit.** Atomics, SIMD, assembly, JIT, and path-string
   cleanup are separate reviewable changes.

## Workstream 1 — memory ordering and atomics

Do this first. **ARM64 is weakly ordered; x64 is not.** Lock-free code or
`volatile`-based threading that "worked" on x64 breaks *intermittently* on ARM64.
This is the #1 source of heisenbugs in ports.

Find `volatile` used for inter-thread communication, double-checked locking,
hand-rolled spinlocks, ring buffers, lock-free queues, reference-count code, and
"write payload then set ready flag" publication patterns.

```c
// Broken on ARM64: volatile is not a synchronization primitive.
volatile bool ready;
volatile Payload *shared;

// Correct: publish with release, consume with acquire.
std::atomic<Payload *> shared;
shared.store(p, std::memory_order_release);
Payload *q = shared.load(std::memory_order_acquire);
```

Prefer `std::atomic` with the narrowest correct `memory_order`. Use a full
`std::atomic_thread_fence(std::memory_order_seq_cst)` only when the algorithm
needs it. Bare MSVC `_Interlocked*` operations are correct but often stronger
than necessary; use acquire/release variants only after the ordering is clear.
Run concurrency tests hundreds of times on real ARM64 under load.

## Workstream 2 — CPU feature detection and scalar intrinsics

`__cpuid`, `__cpuidex`, `xgetbv`, and x86 feature-bit tables do not port.
Use `IsProcessorFeaturePresent` for ARM64 runtime capabilities such as CRC32,
crypto, and ARMv8.1 atomics; use compile-time ARM macros only for codegen paths.

Mechanical scalar mappings are usually safe in one focused commit:

| x86 assumption | ARM64 / portable replacement |
|---|---|
| `_BitScanForward` | `_CountTrailingZeros` / `__builtin_ctz` |
| `_BitScanReverse` | `_CountLeadingZeros` / `__builtin_clz` |
| `__popcnt` | `_CountOneBits` / `__builtin_popcount` |
| `__rdtsc` | `QueryPerformanceCounter`; no cycle-counter equivalent |
## Workstream 3 — SIMD: SSE/AVX to NEON

Use the lowest-risk rung that meets the performance need:

1. Keep and measure the scalar fallback.
2. Use SIMDe for broad SSE/AVX compatibility when source churn must be low.
3. Use sse2neon for lighter SSE-focused ports.
4. Hand-write NEON only for measured hot paths.

Hard facts when hand-writing:

- **Every `__m256i`/AVX operation becomes TWO 128-bit NEON operations — NEON is
  128-bit, full stop.** There is no 256-bit or AVX-512 equivalent.
- There is no `_mm_movemask_epi8`; implement lane compression deliberately.
- Match lane signedness exactly. Wrong signedness compiles and changes results.
- `vaddvq_*` / `ADDV` is a full reduction; `FADDP` is pairwise.
- Use `vld1q_*` / `vst1q_*` for unaligned vector loads and stores.
- MSVC NEON is stricter than GCC/Clang: avoid brace-initialized vectors and do
  not include `<arm_acle.h>` in MSVC builds.

Every vector kernel needs a short-buffer guard before any fixed-stride load:

```c
if (len < STRIDE) return scalar_fallback(ptr, len, state);
```

Differential-test NEON against the scalar oracle at `len` values
`0, 1, STRIDE-1, STRIDE, STRIDE+1`, plus large buffers, with non-default seeds.

## Workstream 4 — assembly

**MSVC supports no inline `__asm` on ARM64.** Replace inline assembly with, in
order: intrinsics, portable C, or a separate `.asm`/`.s` file assembled by the
project's normal ARM64 assembler path.

Windows ARM64 assembly rules that commonly break ports:

- Integer args are `X0`-`X7`; FP args are `D0`-`D7`; return is `X0`/`D0`.
- Preserve `X19`-`X28`, `X29`, `X30`, and the low 64 bits of `V8`-`V15`.
- `X18` is reserved on Windows; never use it as scratch.
- SP is always 16-byte aligned; there is no red zone.
- Arithmetic does not set flags unless you use `ADDS`, `SUBS`, `CMP`, or `TST`.
- `B.cond` reaches only +/-1 MB; distant conditional branches need trampolines.

## Workstream 5 — runtime code generation, hooks, and trampolines

Runtime code generation must call `FlushInstructionCache` on ARM64 because the
instruction cache and data cache are not coherent. Flush the address range that
will actually execute after writing bytes and before resuming execution.

Allocate RW, write, then `VirtualProtect` to RX; do not rely on RWX. Trampolines
that encode x86 instructions must be rewritten for ARM64's fixed 4-byte
instruction encoding and branch ranges. ARM64EC generated-code memory requires
extra care so the loader knows which execution world owns the code.

## Workstream 6 — debugger, PE, context, paths, and strings

Run `patterns/rules.json` as a seed pass and inspect the complete control flow.
`references/debugger-porting.md` covers breakpoint bytes, program-counter
adjustment, context records, and PE handling; use `arm64-software-breakpoints`
for the narrow patch/resume mechanics.

Also check hardcoded architecture strings in update URLs, plugin search paths,
telemetry, crash reporting, and version output. Replace `Program Files (x86)`,
`SysWOW64`, and `WOW6432Node` assumptions with platform APIs and deliberate
registry flags.

## Verification gate

- [ ] `rg -n 'TODO\(arm64\)'` returns zero matches in shipping paths.
- [ ] x64 build and x64 tests still pass.
- [ ] ARM64 unit tests pass on real ARM64 hardware.
- [ ] Concurrency/stress tests ran hundreds of times under load.
- [ ] SIMD kernels passed differential tests against scalar oracles.
- [ ] Runtime code generation flushes instruction cache after code writes.
- [ ] Debugger/instrumentation paths have architecture-specific tests if present.
- [ ] No feature or test was silently dropped; hand off any drop to
      `port-completeness`.

Artifact: `artifacts/s5-migration/migration-log.md`.

## References

- `docs/PITFALLS.md` in the PortPilot playbook for symptom-indexed failures
- `patterns/rules.json` and `references/debugger-porting.md` in this skill
- `arm64-software-breakpoints`, `port-completeness`, `arm64-artifact-verification`,
  `arm64-remote-verification`, and `arm64-failure-diagnosis`
