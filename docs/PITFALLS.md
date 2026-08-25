# PITFALLS.md — What actually breaks, and how it shows up

Organised by **symptom**, because that is how you meet them. Severity:
🔴 silent wrongness · 🟠 crash · 🟡 build failure · 🔵 behavioural.

---

## 🔴 Memory ordering — the one that will get you

**Symptom:** works fine on x64; on ARM64 it fails once every few thousand runs,
usually under load, usually in a different place each time. Adding a `printf`
makes it go away.

**Cause:** x64 is effectively TSO (strongly ordered). ARM64 is **weakly
ordered** — the CPU may reorder loads and stores. Code that was accidentally
correct on x64 is genuinely racy on ARM64.

**Where it hides:**
- `volatile` used for thread communication. On MSVC, `/volatile:ms` gives
  acquire/release semantics **on x86/x64 only**; on ARM64 the default is
  `/volatile:iso`, which gives you nothing.
- Double-checked locking without atomics
- Hand-rolled spinlocks, ring buffers, lock-free queues, "publish a pointer then
  set a ready flag" patterns
- A struct written by one thread, then a `bool ready = true` seen by another

**Fix:**
```c
// Wrong on ARM64 — no ordering guarantee
volatile bool ready; volatile Payload* p;

// Right
std::atomic<Payload*> p;
p.store(payload, std::memory_order_release);      // publisher
auto* q = p.load(std::memory_order_acquire);      // consumer
```
- MSVC: prefer `_InterlockedExchange_rel` / `_InterlockedCompareExchange_acq`
  variants, or `std::atomic`. Bare `_Interlocked*` is seq_cst on ARM64 (correct
  but slower than needed).
- Full fence: `std::atomic_thread_fence(std::memory_order_seq_cst)` / `DMB ISH`.

**Verify:** run concurrency tests hundreds of times on real ARM64 hardware.
A single green run proves nothing.

📖 <https://learn.microsoft.com/en-us/cpp/build/common-visual-cpp-arm-migration-issues>

---

## 🟡 `_M_ARM64` is defined on ARM64EC

**Symptom:** your "classic ARM64" code path compiles into an ARM64EC build and
does the wrong thing, or hand-written ARM64 asm appears in an EC translation unit.

**Fix:** check `_M_ARM64EC` **first**.
```c
#if defined(_M_ARM64EC)
  /* ARM64EC only */
#elif defined(_M_ARM64)
  /* classic ARM64 only */
#endif

#if defined(_M_ARM64) || defined(_M_ARM64EC) || defined(__aarch64__)
  /* ARM64 family — the correct guard for NEON code */
#endif
```

---

## 🟡 No inline assembly on MSVC ARM64

**Symptom:** `error C4235: nonstandard extension used: '__asm' keyword not
supported on this architecture`.

**Cause:** MSVC supports inline `__asm` on x86 only (and not even on x64).
There is no ARM64 inline asm at all.

**Fix, in order of preference:**
1. Replace with an intrinsic (`<arm_neon.h>`, MSVC ARM64 intrinsics)
2. Replace with portable C — often the original asm was a micro-optimisation
   that the modern compiler matches
3. Move to a separate `.asm` file assembled with `armasm64` and wire it into the
   build

📖 <https://learn.microsoft.com/en-us/cpp/intrinsics/arm64-intrinsics>

---

## 🟡 SSE/AVX intrinsics do not exist

**Symptom:** `immintrin.h`/`emmintrin.h` not found; `__m128i` undefined;
thousands of errors in one file.

**Fix ladder (cheapest first):**
1. **Keep the scalar fallback.** Most codebases have `#ifdef USE_SSE` with a
   plain-C path. Compile that on ARM64, measure, and move on. Frequently this is
   the whole answer.
2. **[SIMDe](https://github.com/simd-everywhere/simde)** — broad SSE/AVX/AVX-512
   emulation over NEON. Minimal source change.
3. **[sse2neon](https://github.com/DLTcollab/sse2neon)** — lighter, SSE-focused.
4. **Hand-write NEON** — only for measured hot paths.

**Traps when hand-writing:**
- **NEON is 128-bit only.** Every `__m256i` → two 128-bit ops. No AVX-512 analogue.
- **No `_mm_movemask_epi8`.** Use `vaddvq_u8` over a bit-weighted comparison
  mask, or `vshrn_n_u16` lane compression.
- **Match lane signedness.** `_mm_add_epi32` → `vaddq_s32` on `int32x4_t`, *not*
  `vaddq_u32`. Wrong signedness compiles cleanly and breaks comparisons/saturation.
- **`ADDV`/`vaddvq_*` is a full reduction; `FADDP` is pairwise.** Don't confuse them.
- **MSVC's NEON headers are stricter than GCC/Clang's.** Brace-init of vectors
  (`uint32x4_t v = {a,b,c,d}`) fails on MSVC — build from an array via
  `vld1q_u32`. `<arm_acle.h>` doesn't exist on MSVC. Validate on MSVC, not clang.

---

## 🟠 SIMD short-buffer / tail crash

**Symptom:** new NEON kernel segfaults, but only on small inputs or with a
non-default seed. Large aligned buffers are always fine.

**Cause:** the x86 original had a short-input guard that got dropped when only
the hot loop was ported. The unconditional `vld1q_u8(ptr)` reads out of bounds,
**and** `len -= STRIDE` on an unsigned `size_t` underflows to ~`SIZE_MAX`,
turning the next `while (len >= STRIDE)` into an unbounded walk off the heap.

**Fix:** guard the entry before any vector load.
```c
if (len < STRIDE) return scalar_fallback(ptr, len, state);
```
Watch for a *second* unconditional load in the "fold in the initial state" branch.

**Verify:** test every kernel at `len ∈ {0, 1, STRIDE-1, STRIDE, STRIDE+1}` with
a non-zero seed, differentially against the scalar oracle.

---

## 🟡 `__cpuid` has no ARM64 equivalent

**Symptom:** `__cpuid`/`__cpuidex`/`xgetbv` unresolved.

**Fix:**
- Runtime: `IsProcessorFeaturePresent(PF_ARM_V81_ATOMIC_INSTRUCTIONS_AVAILABLE)`,
  `PF_ARM_V8_CRYPTO_INSTRUCTIONS_AVAILABLE`, `PF_ARM_V8_CRC32_INSTRUCTIONS_AVAILABLE`
- Compile time: `__ARM_NEON` (always 1 on ARM64), `__ARM_FEATURE_CRC32`,
  `__ARM_FEATURE_CRYPTO`

---

## 🟠 Runtime code generation (JIT, hooks, trampolines)

**Symptom:** generated code crashes immediately or executes stale bytes;
`VirtualAlloc`/`VirtualProtect` behaves differently than on x64.

**Causes & fixes:**
- **Instruction cache is not coherent with data cache on ARM64.** After writing
  code bytes you **must** call `FlushInstructionCache`. Missing this produces
  non-deterministic, unreproducible crashes. This is the classic one.
- **W^X is enforced more strictly.** Allocate RW, write, then `VirtualProtect` to
  RX. Do not rely on RWX.
- **Under ARM64EC**, memory holding generated code needs the right allocation
  flags so the loader knows which world the code belongs to; getting this wrong
  silently mis-dispatches. See WoS Porter's
  [`jit-arm64ec-virtualalloc-fix-skill`](https://github.com/qualcomm/extension-wos-porter/tree/main/skills/jit-arm64ec-virtualalloc-fix-skill).
- Trampolines/detours encode x86 instruction bytes — these must be rewritten for
  ARM64's fixed 4-byte encoding, and branch range limits apply.

---

## 🔴 Branch range limits (hand-written asm)

`B.cond` reaches only **±1 MB**; `B`/`BL` reach **±128 MB**. x86 has no such
constraint. A conditional branch to a distant label needs a trampoline:

```asm
B.EQ  skip
B     far_target
skip:
```

---

## 🔵 Architecture strings and paths

**Symptom:** app looks for files in the wrong place; the updater downloads the
x64 build; telemetry reports the wrong platform.

**Check for:**
- Hardcoded `"x64"` / `"amd64"` / `"x86_64"` in update URLs, plugin paths,
  telemetry, crash reporting, and `--version` output
- `Program Files (x86)` assumptions. ARM64 Windows also has
  `Program Files (Arm)`. Use `SHGetKnownFolderPath` / `%ProgramFiles%`.
- `SysWOW64` (x86) vs `SysArm32` (ARM32) vs `System32` (native). Use
  `GetSystemDirectory` / `GetNativeSystemDirectory`.
- `WOW6432Node` registry redirection assumptions; use `KEY_WOW64_*` flags
  deliberately rather than hardcoding paths.

📖 <https://learn.microsoft.com/en-us/windows/win32/winprog64/file-system-redirector>

---

## 🔵 You think you're native but you're emulated

**Symptom:** the port "works" but performance is unchanged — because you are
running the x64 binary under emulation, or a native launcher spawned an x64 child.

**Prove it:**
```powershell
[System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture  # .NET
Get-Process app | Select-Object -ExpandProperty Modules | Select ModuleName, FileName
```
```bat
dumpbin /headers app.exe | findstr machine   :: AA64 = ARM64, 8664 = x64
```
Or Task Manager → Details → add the **Architecture** column.

Also remember: **an emulated x64 process cannot load native ARM64 DLLs**, and a
native ARM64 process cannot load x64 DLLs. If a plugin silently fails to load,
this is usually why. `IsWow64Process2` distinguishes process arch from native arch.

---

## 🟡 Dependency has no ARM64 build

**Symptom:** link fails with unresolved externals from a vendored `.lib`, or
`LoadLibrary` fails at runtime, or `dumpbin` on a vendored DLL says `8664`.

**This is an S2 failure, not an S5 problem.** Do not try to hack around it in
code. Classify it (`rebuild` / `upgrade` / `replace` / `emulate` / `blocker`),
record it in `PORT_STATE.json.blockers`, and escalate.

**Never** vendor a prebuilt x64 binary into the ARM64 build to make it link.

Watch especially for: `node-gyp` native addons, Python C-extension wheels, NuGet
packages containing only `runtimes/win-x64/native/`, and closed-source vendor SDKs.

---

## 🔵 Type and layout assumptions

| Assumption | Reality on ARM64 |
|---|---|
| `char` is signed | Implementation-defined — say `signed char`/`unsigned char` when it matters |
| `long double` is 80-bit | Typically 64-bit (same as `double`); precision-sensitive math changes results |
| Unaligned access is free | Allowed but slower; and it is *not* allowed for some instruction forms |
| `#pragma pack` layouts are portable | Packing + type punning is a common source of ARM64-only faults |
| Floating point is bit-identical | Denormal handling depends on FPCR; FMA contraction may differ. Use tolerances in tests, and be careful with `/fp:fast`. |

---

## 🟡 Build system silently builds x64 anyway

**Symptom:** everything succeeds, but the binary is x64.

**Causes:** MSBuild solution configuration missing an `ARM64` mapping for a
project (so it builds x64 and copies it); a `-A ARM64` flag dropped in a nested
CMake call; a vcpkg triplet not propagated to a subdependency; a custom build
step invoking a hardcoded x64 compiler path.

**Fix:** never trust the build log. `dumpbin /headers` **every shipped binary**
in CI and fail the job on `8664`.
