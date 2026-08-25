---
name: arm64-strategy-selection
description: Choose classic ARM64, ARM64EC, or ARM64X per shipped Windows binary and record the decision as an ADR. Use when S2 dependency evidence is complete and S3 must pick the ABI before build retargeting.
---

# ARM64 Strategy Selection (S3)

Choose the ABI **per shipped binary**, not per repository or solution. Default to
classic native ARM64 unless verified evidence proves that another ABI is needed.

This skill consumes `arm64-readiness` and `native-dependency-analysis` outputs.
It produces `docs/adr/NNNN-arm64-strategy.md`, then hands off to
`build-retarget` and `arm64-build-environment`.

## Inputs

- S1 architecture-surface inventory from `arm64-readiness`
- S2 dependency matrix from `native-dependency-analysis`, with no `unknown` entries
- Shipped executables, DLLs, plugins, tools, services, drivers, and packages
- Evidence for any `emulate`, `replace`, `rebuild`, or `blocker` dependency

Do not decide from directory names, processor variables, package labels, or
assumptions. A dependency is x64-only only after direct evidence proves it.

## Options

### Classic ARM64
A normal native ARM64 binary. This is the preferred answer for self-contained
apps, CLI tools, services, and runtimes/dependency graphs that already support
`win-arm64`. It is the simplest build and the best performance/power target.
A classic ARM64 process cannot load x64 DLLs.

### ARM64EC
Native ARM64 code using the x64-compatible ABI so it can coexist with emulated
x64 code in one process. This is an escape hatch for a named, verified x64-only
in-process dependency or an incremental module-by-module migration. It adds
build complexity and thunk/calling-convention overhead. Do not choose it "to be
safe."

### ARM64X
A PE containing both classic ARM64 and ARM64EC/x64 views. Use it only for a DLL
that must be loadable by both native ARM64 processes and x64/ARM64EC processes,
such as plugins, shell extensions, IMEs, injected DLLs, or middleware.

## Decision flow
Apply this in order for each shipped binary:

```text
1. Is this a DLL loaded by both native ARM64 and x64/ARM64EC hosts?
   yes -> ARM64X
   no  -> continue
2. Must a verified x64-only binary run inside this process, and can it not be
   rebuilt, upgraded, replaced, or moved out of process?
   yes -> ARM64EC
   no  -> continue
3. Is the codebase so large that a full native port cannot ship value soon, and
   is there a documented migration path back to classic ARM64?
   yes -> ARM64EC temporarily
   no  -> Classic ARM64
```

Use `docs/DECISION_MATRIX.md` as the detailed comparison table and decision
logic reference. Do not duplicate it into the ADR.

## Challenge every compatibility choice
Before accepting ARM64EC, record evidence for each blocked component:

1. The dependency is truly x64-only and must run **in process**.
2. There is no ARM64 build, source rebuild path, maintained alternative, or
   vendor-supported upgrade.
3. It cannot be isolated into an out-of-process helper with IPC so the main app
   remains classic ARM64.
4. The performance/power cost and future migration plan are explicit.

Assembly or intrinsic findings do **not** automatically justify ARM64EC. They are
S4/S5 remediation work unless they depend on an x64-only binary interface.

## Remediation plan
For every non-ready dependency, choose and document one path:

- **Upstream fix:** add native ARM64 support.
- **Track/request upstream:** link the issue or release plan if available.
- **Replace:** use an equivalent dependency with ARM64 support.
- **Bridge temporarily:** use ARM64EC only for the smallest x64-interoperating set.
- **Block:** kernel/driver/privileged components must become native ARM64.

Scope bridging as narrowly as possible. Do not make the whole application EC
because one plugin or SDK is blocked.

## Macro and toolchain consequences
- Classic ARM64: `-A ARM64`, `/MACHINE:ARM64`, vcpkg `arm64-windows`.
- ARM64EC: `/arm64EC`, MSBuild `ARM64EC` platform where supported.
- ARM64X: build and link the required ARM64 and EC views into one PE.

`_M_ARM64` is defined for ARM64EC too. Classic-only code must exclude EC:

```c
#if defined(_M_ARM64EC)
    /* ARM64EC only */
#elif defined(_M_ARM64)
    /* classic ARM64 only */
#endif

#if defined(_M_ARM64) || defined(_M_ARM64EC) || defined(__aarch64__)
    /* ARM64 family */
#endif
```

## ADR template
Create `docs/adr/NNNN-arm64-strategy.md`:

```markdown
# NNNN — ARM64 strategy for <app>

## Status
Accepted — <date>

## Context
<S1 architecture findings and S2 dependency evidence, especially `emulate` and
`blocker` entries.>

## Options considered
- Classic ARM64 — <why it works or does not>
- ARM64EC — <named blocker and cost/benefit, or why rejected>
- ARM64X — <only for DLLs loaded by both worlds, or why rejected>

## Decision
| Binary | ABI | Rationale | Evidence |
|---|---|---|---|
| app.exe | ARM64 | self-contained; no x64 in-process deps | <S2 row> |

## Consequences
<Build matrix, performance/power implications, bridge removal plan, and what
`build-retarget` must configure.>
```

Update `PORT_STATE.json` decisions with the ADR path and selected ABI map.

## Exit gate

- ADR exists at `docs/adr/NNNN-arm64-strategy.md`.
- Every shipped binary has exactly one chosen ABI.
- Every ARM64EC decision traces to a verified x64-only in-process dependency or
  documented incremental-port plan.
- Every ARM64X decision names the mixed-host loading requirement.
- Out-of-process isolation was considered for each x64-only dependency.
- Next skills are `build-retarget`, `arm64-build-environment`,
  `arm64-artifact-verification`, and `arm64-remote-verification`.

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| ARM64EC chosen "just in case" | No named x64 blocker | Choose classic ARM64 |
| Classic ARM64 path compiled in EC | `_M_ARM64` checked before `_M_ARM64EC` | Check `_M_ARM64EC` first |
| Plugin fails in one host type | Single-view DLL used for mixed hosts | Select ARM64X for that DLL |
| Driver planned for EC/emulation | Kernel code has no such mode | Native ARM64 only |
| Bridge becomes permanent | No remediation plan | Record owner, path, and removal condition |
