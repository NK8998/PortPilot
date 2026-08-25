---
name: arm64-failure-diagnosis
description: Diagnose build, test, or runtime failures that appear only on Windows ARM64 by classifying the failure before fixing it. Use when local ARM64 reproduction, CI, or the ARM64 VM surfaces a target-only failure, including CI-only feedback loops.
---

# ARM64 Failure Diagnosis

Use this when something passes on existing x64/AMD64 targets but fails on ARM64
or ARM64EC. The failure is useful signal. Do not guess from the symptom; collect
evidence, classify, fix, and re-run the same reproduction.

Start by checking `docs/PITFALLS.md` for the symptom catalogue. Reference it in
reports instead of copying its full contents into issues or ADRs.

## Inputs

- Exact failing command, test, job, or VM action
- Raw logs, stack trace, assertion, exception, compiler/linker error, or crash
  dump details
- S3 strategy ADR and S4 build evidence
- Whether `arm64-build-environment` says local native reproduction is possible

## The loop

### 1. Get the real evidence

Read the raw failing output, not a badge, dashboard summary, or paraphrase.
For CI, fetch the job log for the specific failing step. For a VM failure, keep
the exact command and console output. Two runs with the same test name can have
different root causes.

### 2. Reproduce as narrowly as possible

Prefer real target hardware through `arm64-remote-verification`. If local native
reproduction is impossible, use `arm64-ci-integration` and the CI-only section
below. Reduce to the smallest failing test, binary, feature, or build target that
still exercises the failure.

### 3. Classify before editing

| Class | Signature | Response |
|---|---|---|
| Ported-code defect | Project logic assumes x64 behavior: ordering, alignment, SIMD lane shape, path/registry layout, architecture string, generated code | Fix the logic and add a regression test |
| Build retarget defect | Wrong machine type, skipped project, x64 library, mixed toolset, missing platform mapping | Return to `build-retarget` |
| Dependency blocker | Vendored `.lib`/`.dll`/wheel/native addon is x64-only or unavailable | Return to `native-dependency-analysis` or S3 ADR |
| Environment/tooling gap | Missing SDK/compiler/runtime, permissions, unsupported local run | Return to `arm64-build-environment`; defer to CI/VM if needed |
| CI infrastructure flake | Intermittent, shared external state, race between matrix jobs, secret unavailable in fork | Fix workflow via `arm64-ci-integration` |
| Pre-existing defect | Would fail on x64 if that path/test were run there | Fix if in scope, but do not report as ARM64-specific |

State the class and the evidence for it before proposing a patch.

### 4. Explain why ARM64 exposes it

Before changing code, write the one-sentence mechanism: for example, "x64 TSO
hid a missing acquire/release pair," "the ARM64 solution platform skipped a test
project," or "the vendored library is PE machine 8664." If you cannot explain
why the old target passed and ARM64 failed, keep investigating.

### 5. Fix the root cause

Make the smallest change that addresses the mechanism. Keep x64 paths intact.
For S4 compile blockers, stubs must use `// TODO(arm64): <what and why>` and the
real SIMD/asm migration must wait for `arm64-correctness`.

### 6. Verify against the same reproduction

Re-run the exact failing case. If a different assertion appears after the first
fix, treat it as the next iteration, not proof that the first fix was wrong.
Add a regression test for the underlying property where the project has a test
harness.

## High-value ARM64 symptom checks

Use `docs/PITFALLS.md` for details, especially:

- Intermittent crashes under load: ARM64 weak memory ordering; replace volatile
  communication with atomics/acquire-release.
- `__asm` errors: MSVC has no inline assembly on ARM64.
- `immintrin.h`, `__m128i`, `__m256i`: x86 intrinsics; NEON is 128-bit and has
  no 256-bit AVX equivalent.
- Classic ARM64 branch running in ARM64EC: `_M_ARM64` is also defined on EC;
  use `#if defined(_M_ARM64) && !defined(_M_ARM64EC)` for classic-only code.
- Short-buffer SIMD crashes: dropped scalar/tail guard or unsigned underflow.
- JIT/hook/trampoline crashes: missing `FlushInstructionCache`, W^X, ARM64EC
  allocation mode, or x86 instruction bytes.
- Wrong files, updater, telemetry, registry, or system directory: hardcoded
  `x64`, `amd64`, `Program Files (x86)`, `SysWOW64`, or `WOW6432Node`.
- "Works" but performance unchanged: running x64 under emulation; verify process
  and module architecture.

## CI-only feedback loop

Use this mode when `arm64-build-environment` says you cannot access the target
interactively and every iteration requires a CI round-trip.

1. Treat CI as a slow debugger. Each push must answer multiple specific
   questions, not merely print "got here."
2. Write down the hypothesis and the exact value(s) that will confirm or refute
   it before adding instrumentation.
3. Bypass normal log filters temporarily: write directly to stderr, test output,
   or an always-captured diagnostic stream.
4. Batch probes in one run: relevant paths, architecture values, module machine
   types, failing inputs, pointer/alignment values, selected configuration, and
   environment details.
5. Temporarily narrow the test filter to the smallest reproducer, but mark the
   narrowing clearly so it is not mistaken for the final test scope.
6. Read the raw job log for the failing step. Step summaries often hide the one
   line that matters.
7. After evidence answers the question, remove all temporary instrumentation and
   restore the full test scope as a separate verified step.
8. Run the representative CI path once more after the real fix and cleanup.

Do not commit temporary logs or narrowed filters as final state. If a temporary
artifact filename is created for the investigation, ensure it is ignored or
removed before committing.

## Evidence quality

- Claims about bytes or encoding require byte-exact sources: blob IDs, raw blobs,
  or hash-verified files. Do not rely on transcoding APIs or PowerShell `>` for
  raw blob comparisons; see `build-retarget` references.
- Claims about architecture require direct artifact inspection via
  `arm64-artifact-verification`, not a successful build exit code.
- Claims about runtime require native ARM64 execution through
  `arm64-remote-verification` or `arm64-ci-integration`.
- Treat UI/cache state as stale until checked against the actual branch, commit,
  run, or artifact.

## Exit gate

- Failure class recorded with supporting evidence.
- Root cause explains why ARM64/ARM64EC exposed the problem.
- Fix is limited to that cause and preserves x64 behavior.
- Same failing case reran and produced fresh passing evidence, or the remaining
  blocker was reassigned to the correct skill/stage.
- Temporary CI-only instrumentation, filters, and artifacts are removed.
- Regression coverage was added or explicitly judged impractical.

## Common errors

| Symptom | Cause | Fix |
|---|---|---|
| Several CI runs are inconclusive | Diagnostics printed generic breadcrumbs | Batch discriminating values per run |
| Local pass, CI fail | Environments differ or local is not native ARM64 | Trust raw CI/VM evidence |
| Symptom disappears but another appears | First fix exposed a second issue | Repeat classification loop |
| Test filter left narrowed | Cleanup skipped after CI-only debug | Restore full scope and rerun |
| Build failure patched in source | Actually missing tool/SDK/mapping | Return to environment or retarget skill |
