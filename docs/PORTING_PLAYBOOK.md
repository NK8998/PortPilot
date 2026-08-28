# The Porting Playbook — amd64 → Windows ARM64

A lean, gated, eight-stage process. Each stage has an **entry condition**, a
**goal**, an **exit gate**, and a **required artifact**. You may not advance
without the artifact.

> **Why gates?** Ports fail in a predictable way: someone tries to fix a NEON
> kernel before the linker works, discovers a dependency has no ARM64 build,
> pivots to the build system, and three days later nothing compiles and nobody
> knows what changed. Gates make that impossible.

---

## Stage map

```
S0 Baseline ──▶ S1 Recon ──▶ S2 Dependencies ──▶ S3 Strategy
                                                     │
                                                     ▼
S7 Package ◀── S6 Verify ◀── S5 Migration ◀── S4 Build Bring-up
   & Harvest
```

**S0–S3 is analysis. S4–S5 is the port. S6–S7 is proof and delivery.**
Roughly: expect 40% of effort in S2+S4, 40% in S5, 20% everywhere else.
Dependencies and build systems, not code, are what actually kill ARM64 ports.

---

## S0 — Intake & Baseline

**Entry:** a repo path or GitHub URL.
**Goal:** build and test the application *completely unchanged* on x64.

Do not skip this because it seems obvious. Without a baseline you cannot tell an
ARM64 regression from a pre-existing bug, and you will waste days.

### Steps

1. Record identity: repo URL, commit SHA, license, upstream activity.
2. Build **x64 Release and Debug**. Record the exact commands.
3. Run the test suite. Record **pass/fail counts and the names of already-failing
   tests** — these are not your problem later.
4. Capture a **feature inventory**: what does this app actually do? 10–30 bullet
   points, user-observable. This becomes the S6 parity matrix.
5. Capture a rough **performance baseline** on the workloads that matter.

### Exit gate

- [ ] x64 build is reproducible from a clean clone with documented commands
- [ ] Test baseline recorded (including known failures)
- [ ] Feature inventory written
- [ ] `artifacts/s0-baseline/` populated; `PORT_STATE.json` created

**Artifact:** `artifacts/s0-baseline/baseline.md`

---

## S1 — Architecture Recon

**Entry:** S0 green.
**Goal:** produce a complete inventory of every place the code assumes x86-64.

You are not fixing anything in this stage. You are building a map.

### What to hunt for

| Category | Search for |
|---|---|
| SIMD intrinsics | `_mm_`, `_mm256_`, `_mm512_`, `__m128`, `__m256i`, `xmmintrin.h`, `immintrin.h`, `emmintrin.h` |
| Inline / external asm | `__asm`, `asm volatile`, `.asm`, `.s`, `.S`, `masm`, `nasm`, `yasm` |
| Arch macros | `_M_X64`, `_M_AMD64`, `__x86_64__`, `__i386__`, `_M_IX86`, `WIN64` |
| CPU feature checks | `__cpuid`, `__cpuidex`, `cpuid`, `xgetbv`, `IsProcessorFeaturePresent` |
| x86-only intrinsics | `_BitScan*`, `__popcnt`, `_rot*`, `__rdtsc`, `_umul128`, `_mul128` |
| Atomics / ordering | `volatile`, `_Interlocked*`, `MemoryBarrier`, `_ReadWriteBarrier`, hand-rolled spinlocks, lock-free queues |
| Hardcoded arch strings | `"x64"`, `"amd64"`, `"x86_64"`, `"win32"`, `Program Files (x86)`, `SysWOW64`, `WOW6432Node` |
| Prebuilt binaries | `*.dll`, `*.lib`, `*.so`, `*.a`, `*.exe` committed to the repo or fetched by the build |
| Build-system arch | `Platform`, `-A x64`, `--target`, `triplet`, `RuntimeIdentifier`, `GOARCH`, `arch=` |
| Runtime codegen | JIT, `VirtualAlloc` + `PAGE_EXECUTE`, trampolines, hooking, detours, FFI closures |
| Alignment / layout | `#pragma pack`, `__unaligned`, type punning, `reinterpret_cast` over byte buffers, `long double` |

### Steps

1. Identify languages, build system(s), and the toolchain in use.
2. Run the greps above across the tree. Record **file:line + a one-line note**.
3. Classify each hit: `trivial` / `mechanical` / `needs-thought` / `blocker`.
4. Flag **runtime code generation** loudly — JIT, hooking, and FFI trampolines
   are the hardest category and often force an ARM64EC decision in S3.
5. Note the **UI framework** and whether it has an ARM64 story.

### Exit gate

- [ ] Every category above searched, hits recorded with classification
- [ ] Runtime-codegen and prebuilt-binary findings explicitly called out
- [ ] `PORT_STATE.json.arch_surface` populated

**Artifact:** `artifacts/s1-recon/arch-surface.md`

---

## S2 — Dependency Audit

**Entry:** S1 green.
**Goal:** every dependency has a known ARM64 status. **This is where ports die.**

A dependency with no ARM64 build is a *project* problem, not a coding problem.
Finding it in S2 costs an hour. Finding it in S5 costs a week.

### Classification (every dep gets exactly one)

| Status | Meaning | Action |
|---|---|---|
| `native-ok` | Ships / builds ARM64 today | Nothing |
| `rebuild` | Source available, just needs an ARM64 build | Add to build matrix |
| `upgrade` | Newer version added ARM64 support | Bump version |
| `replace` | No ARM64 path; a viable alternative exists | Plan the swap |
| `emulate` | x64-only, must stay x64 → forces **ARM64EC** | Feeds S3 |
| `blocker` | No ARM64, no alternative, cannot emulate | **Escalate to a human now** |

### Steps

1. Enumerate **transitively** — direct deps lie. Use the ecosystem's own tool
   (`vcpkg list`, `dotnet list package --include-transitive`, `npm ls`,
   `cargo tree`, `pip freeze`, `go list -m all`).
2. For each: does an ARM64/`win-arm64`/`aarch64` artifact exist? Check the
   registry, the release page, and the CI matrix — not the README.
3. **Inspect what's actually on disk.** `dumpbin /headers <file>.dll | findstr machine`
   tells you the truth about vendored binaries. Anything reporting `8664` is x64.
4. Pay special attention to **native add-ons behind managed packages** —
   `node-gyp` modules, Python wheels with C extensions, NuGet packages with
   `runtimes/win-x64/native/`. These are the usual silent blockers.
5. Record every `emulate` and `blocker` in `PORT_STATE.json.blockers`.

### Exit gate

- [ ] Zero dependencies with status `unknown`
- [ ] Every `blocker` escalated with a written impact statement
- [ ] `emulate` list finalised (this is the input to the S3 decision)

**Artifact:** `artifacts/s2-deps/dependency-matrix.md`

---

## S3 — Strategy Decision

**Entry:** S2 green.
**Goal:** choose the target ABI and commit to it in writing.

Full criteria: **[`DECISION_MATRIX.md`](DECISION_MATRIX.md)**. Short version:

- **Classic ARM64** — default. Choose it unless something forces otherwise.
  Best performance, best power, simplest toolchain.
- **ARM64EC** — choose when an x64-only dependency or plugin ecosystem must load
  into your process, or when you need to port incrementally, module by module.
- **ARM64X** — choose when you ship a DLL that *both* native ARM64 and
  ARM64EC/x64 processes must load (plugins, shell extensions, middleware).

### Steps

1. Apply the decision matrix against the S2 `emulate` list.
2. Decide **per-binary**, not per-project. A common outcome: main executable
   ARM64EC, self-contained helper tools classic ARM64.
3. Write the ADR: context → options considered → decision → consequences.
   One page. `docs/adr/NNNN-arm64-strategy.md`.
4. Sketch the target build matrix (configurations × platforms × artifacts).

### Exit gate

- [ ] ADR committed, naming the ABI for every shipped binary
- [ ] `PORT_STATE.json.strategy` set
- [ ] Build matrix agreed

**Artifact:** `docs/adr/NNNN-arm64-strategy.md`

---

## S4 — Build Bring-up

**Entry:** S3 green.
**Goal:** **compile and link** an ARM64 binary. Correctness is explicitly *not*
a goal of this stage.

> **The stubbing rule.** If a file will not compile because of SIMD, assembly, or
> an x86-only intrinsic: `#if`-guard it out on ARM64, substitute the scalar
> reference implementation or a stub that throws, and leave
> `// TODO(arm64): <what and why>`. Move on immediately. Porting the kernel is
> S5's job. Every hour spent on a NEON kernel before the link succeeds is wasted,
> because you cannot test it yet.

### Steps

1. Add the ARM64 configuration to the build system.
   - MSBuild: add the `ARM64` platform to the solution and every `.vcxproj`
   - CMake: `cmake -G "Visual Studio 17 2022" -A ARM64`
   - vcpkg: `--triplet arm64-windows`
   - .NET: `RuntimeIdentifier=win-arm64`
   - Rust: `--target aarch64-pc-windows-msvc`
   - Go: `GOOS=windows GOARCH=arm64`
2. Install the ARM64 toolchain (VS "MSVC v143 – VS 2022 C++ ARM64/ARM64EC build
   tools" component). Cross-compiling from an x64 host is fine and usually faster.
3. Fix compile errors **in this priority order**: build-system → headers →
   arch macros → intrinsics/asm (stub these).
4. Fix link errors. Unresolved externals from stubbed-out asm are expected —
   provide stubs, don't delete call sites.
5. Verify the output really is ARM64, then get the app to *start*.

### Verification

```bat
dumpbin /headers app.exe | findstr machine
:: AA64 = ARM64 (or ARM64EC/ARM64X)   8664 = x64  → you built the wrong thing
```

At runtime, confirm you are not being emulated: Task Manager's **Architecture**
column, or `IsWow64Process2`, or `RuntimeInformation.ProcessArchitecture` in .NET.

### Exit gate

- [ ] ARM64 build succeeds from clean, x64 build **still** succeeds
- [ ] `dumpbin` reports `AA64`
- [ ] App launches and reaches a known-good point (even if features are stubbed)
- [ ] Every stub carries a `TODO(arm64):` marker and is listed in `PORT_STATE.json`

**Artifact:** `artifacts/s4-bringup/build-notes.md` + the `TODO(arm64)` inventory

---

## S5 — Code Migration

**Entry:** S4 green.
**Goal:** make it **correct**. Burn down the `TODO(arm64)` list.

Work **one workstream at a time**, in this order — it is ordered by
"silent wrongness" risk, not by difficulty:

1. **Memory ordering & atomics** *(highest risk, lowest visibility)*
   ARM64 is weakly ordered. Anything using `volatile` for thread communication,
   hand-rolled spinlocks, double-checked locking, or lock-free structures must be
   re-derived with explicit acquire/release semantics. **These bugs do not
   reproduce on x64 and often do not reproduce on the first 1000 runs on ARM64.**
2. **CPU feature detection** — `__cpuid` has no ARM64 equivalent. Use
   `IsProcessorFeaturePresent` (e.g. `PF_ARM_V81_ATOMIC_INSTRUCTIONS_AVAILABLE`)
   or compile-time `__ARM_FEATURE_*` macros.
3. **Scalar x86 intrinsics** — mechanical. `_BitScanForward` → `_CountTrailingZeros`,
   `__popcnt` → `_CountOneBits`, `_byteswap_*` → `_byteswap_*` (available) or
   `vrev*`. Do these in one commit; they are low-risk.
4. **SIMD kernels** — SSE/AVX → NEON. Options in increasing order of effort:
   keep the scalar fallback (often fine); use
   [SIMDe](https://github.com/simd-everywhere/simde) or
   [sse2neon](https://github.com/DLTcollab/sse2neon) as a shim; hand-write NEON.
   **Measure before hand-writing** — the scalar path is frequently good enough.
5. **Assembly** — MSVC has *no* inline asm on ARM64. Convert to intrinsics
   (preferred) or a separate `.asm` assembled by `armasm64`.
6. **Runtime codegen** — JIT/hooking/trampolines. Also handle W^X: ARM64 is
   stricter about writable+executable memory, and you must flush the instruction
   cache (`FlushInstructionCache`) after writing code. Missing icache flushes
   produce spectacular, non-deterministic crashes.
7. **Path / registry / platform strings** — `Program Files (Arm)`, `SysWOW64`
   vs `SysArm32`, `WOW6432Node`, arch strings in update-checkers and telemetry.

### Rules

- One workstream per commit. Never mix an intrinsics port with a build change.
- Keep the scalar reference implementation alive as the test oracle: assert
  `neon_impl(x) == scalar_impl(x)` over randomised input, including
  `len ∈ {0, 1, STRIDE-1, STRIDE, STRIDE+1}`.
- Guard every arch branch; never delete the x64 path.

### Exit gate

- [ ] Zero `TODO(arm64)` markers in shipping code paths
- [ ] Unit tests green on ARM64
- [ ] SIMD kernels differentially tested against the scalar oracle
- [ ] x64 still green

**Artifact:** `artifacts/s5-migration/migration-log.md`

---

## S6 — Verify & Parity

**Entry:** S5 green.
**Goal:** produce **evidence**, not opinions.

### Four evidence classes

1. **Feature parity** — walk the S0 feature inventory on ARM64 hardware. Every
   item gets pass / fail / degraded + a note. This is the parity matrix.
2. **Architecture proof** — prove nothing is being emulated:
   - Task Manager → Details → **Architecture** column shows `ARM64`
   - No x64 modules loaded: check the loaded-module list (Process Explorer /
     `Get-Process | Select-Object -ExpandProperty Modules`)
   - `dumpbin /headers` on every shipped binary reports `AA64`
3. **Reliability** — full test suite, plus stress/concurrency runs. Run
   concurrency tests **many** times; weak-memory bugs are probabilistic.
4. **Performance & power** — same workloads as the S0 baseline. Compare
   *native ARM64 vs emulated x64 on the same ARM64 machine* (that's the honest
   comparison and usually the compelling number), and note x64-on-x64 for context.

### Exit gate

- [ ] Parity matrix complete, every S0 feature accounted for
- [ ] "No emulation" proof captured (screenshots / module list / dumpbin output)
- [ ] Test suite result vs S0 baseline — no new failures
- [ ] Perf comparison recorded

**Artifact:** `artifacts/s6-parity/parity-report.md`
(template: [`templates/evidence-report.md`](../templates/evidence-report.md))

---

## S7 — Package, CI & Harvest

**Entry:** S6 green.
**Goal:** ship it, automate it, and bank the knowledge.

### Steps

1. **Package** for ARM64 — MSIX (`ProcessorArchitecture="arm64"`), WiX/MSI, or
   your existing installer with an ARM64 target added. Verify the installer does
   not hardcode `Program Files (x86)`.
2. **CI** — add an ARM64 job. GitHub-hosted `windows-11-arm` runners are
   generally available for public repos; see
   [`templates/ci/windows-arm64.yml`](../templates/ci/windows-arm64.yml).
   Build **both** x64 and ARM64 in the matrix so x64 can never silently regress.
3. **Release-readiness report** — artifacts, signing, parity evidence, known gaps.
4. **Harvest.** Extract at least one reusable skill into `.github/skills/`.
   Prioritise the things that *actually cost you time* and are not in any
   upstream doc. See [`SKILLS.md`](../SKILLS.md) for the format.
5. **Upstream it.** If the app is open source, send the ARM64 support back.

### Exit gate

- [ ] ARM64 package installs and runs on real ARM64 hardware
- [ ] CI matrix builds x64 + ARM64 and is green
- [ ] Release-readiness report written
- [ ] ≥1 new skill or recipe committed

**Artifact:** `artifacts/s7-release/release-readiness.md` + new skill(s)

---

## Anti-patterns

| Anti-pattern | Why it hurts | Instead |
|---|---|---|
| Porting SIMD before the build links | Cannot test, cannot validate, blocks everything | Stub in S4, port in S5 |
| Deleting the x86 code path | Breaks x64, doubles the review surface | `#if` guard, keep both |
| Discovering a dead dependency in S5 | Weeks of sunk work | Complete S2 honestly |
| "It builds, so it works" | Weak-memory bugs are silent and probabilistic | S6 evidence gates |
| Reaching for ARM64EC first | Leaves performance and battery on the table | Classic ARM64 by default |
| One giant "ARM64 support" commit | Unreviewable, unbisectable | One workstream per commit |
| Trusting a README's arch claims | READMEs lie; binaries don't | `dumpbin /headers` |
| Testing only on big aligned buffers | Misses SIMD tail/short-buffer crashes | Test `len` near stride boundaries |
