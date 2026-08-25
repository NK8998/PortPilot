---
name: arm64-port-orchestrator
description: Routes an amd64/x64 to native Windows ARM64 port through the gated S0-S7 workflow and keeps PORT_STATE.json honest. Use when starting or resuming a port, choosing the next skill, evaluating a gate, or recovering from a failed stage.
---

# ARM64 Port Orchestrator

You own the workflow, not the specialist work. Decide where the port is, enforce
the gate for that stage, and route to the named skill that can produce the next
artifact. Do not skip ahead because the next step looks easy: a native ARM64
port is complete only when the final package is proved native, runnable, and
covered by future automation.

## First action in every session

1. Read `artifacts/PORT_STATE.json`.
2. If it does not exist, create it from `templates/PORT_STATE.schema.json` if
   present, set `current_stage` to `S0`, and route to `arm64-readiness`.
3. Report three facts before proposing work: current stage, last completed
   artifact, and open blockers.
4. Check whether any blocker has `severity: "project"`. If so, surface it before
   doing work. A dependency you cannot rebuild for ARM64 is a project decision,
   not a coding problem.

## Validate the claimed stage

Do not trust state without evidence. If a claimed stage lacks the previous gate's
artifact, demote `current_stage` to the earliest stage whose gate is still red
and say exactly which artifact was missing.

| Claimed stage | Previous gate artifact that must exist |
|---|---|
| S1 | `artifacts/s0-baseline/baseline.md` |
| S2 | `artifacts/s1-recon/arch-surface.md` |
| S3 | `artifacts/s2-deps/dependency-matrix.md` |
| S4 | `docs/adr/*-arm64-strategy.md` or equivalent recorded ADR |
| S5 | `artifacts/s4-bringup/build-notes.md` |
| S6 | `artifacts/s5-migration/migration-log.md` |
| S7 | `artifacts/s6-parity/parity-report.md` |

A stage is complete when the artifact exists and the exit gate is satisfied, not
when an agent claims it is likely to work.

## Routing table

| Stage | Goal | Route to |
|---|---|---|
| S0 | Intake, exact commit, x64 baseline, pre-existing failures | `arm64-readiness` |
| S1 | Architecture-surface inventory and risk classification | `arm64-readiness` |
| S2 | Dependency audit with zero `unknown` entries | `native-dependency-analysis` |
| S3 | Native, ARM64EC, ARM64X, replace, or retain decision | `arm64-strategy-selection` |
| S4 | Build target and environment bring-up | `build-retarget`, `arm64-build-environment` |
| S5 | Correctness migration and platform-specific fixes | `arm64-correctness`, `arm64-software-breakpoints` |
| S6 | Completeness, artifact architecture, remote runtime proof | `port-completeness`, `arm64-artifact-verification`, `arm64-remote-verification` |
| S7 | Packaging and future CI coverage | `port-packaging`, `arm64-ci-integration` |
| Any | Failure that is not explained by the current stage evidence | `arm64-failure-diagnosis` |

Use every catalogue skill by name when its condition applies. In S4, configure
the build target and prepare the toolchain as separate concerns. In S6, inspect
actual binaries before accepting parity or packaging evidence.

## Stage flow and feedback loops

The normal flow is S0 -> S1 -> S2 -> S3 -> S4 -> S5 -> S6 -> S7, but failed
evidence routes backward:

- `REVISE` returns to the skill that produced the defective implementation. The
  strategy is still right; execution needs work. Example: an ARM64 build links
  but still stages an x64 DLL, so route to `native-dependency-analysis` or
  `build-retarget` with the exact finding.
- `FAIL` returns to the earlier analysis that chose the wrong path. Example: S5
  discovers a closed-source in-process x64 dependency, so demote to S2 and then
  redo S3.
- A platform-only failure routes through `arm64-failure-diagnosis` before you
  choose whether it is a code defect, build configuration mistake, toolchain gap,
  account restriction, or infrastructure flake.

Keep round history in state. Do not loop forever: after repeated `REVISE` or
`FAIL` outcomes, stop with an honest blocked or exhausted status and preserve the
evidence.

## Planning gate

Do not create a plan-shaped placeholder. A plan may become ready only after:

- `arm64-readiness` has pinned the commit, recorded x64 baseline evidence, and
  inventoried build systems, architecture-specific code, runtime codegen, checked
  binaries, and CI coverage.
- `native-dependency-analysis` has classified every native dependency and every
  shipped binary as ARM64-ready, rebuildable, replaceable, bridge-required, or
  blocker. `unknown` is not allowed.
- Every required unresolved fact has a blocker, owner, and next evidence step.

If blockers remain unresolved, report `assessment-incomplete`; do not proceed to
S3 or draft a migration plan that assumes they will disappear.

## Rules you enforce

1. Native is the default. Adopt ARM64EC or emulation only for a named blocker.
2. Bring-up is not migration. In S4, `// TODO(arm64): <what and why>` stubs are
   allowed; real SIMD, assembly, and runtime-behaviour ports belong in S5.
3. Never regress x64. Preserve existing branches and tests; do not delete the
   x86 path to make ARM64 compile.
4. Guard classic ARM64 specifically with `#if defined(_M_ARM64) && !defined(_M_ARM64EC)`;
   `_M_ARM64` is also defined for ARM64EC.
5. Evidence flows through artifacts, not chat. Missing artifact means missing
   stage.
6. Record failed, blocked, deferred, and unverified behavior visibly.
7. Never vendor a prebuilt x64 binary into an ARM64 package to make linking pass.

## State updates

After any meaningful work, update `PORT_STATE.json` with:

- `current_stage`
- each touched `stages` entry and artifact path
- `blockers` with severity, owner, evidence, and options considered
- `decisions` with rationale and linked artifact
- `next_actions`, two to five concrete steps for the next agent

Append history rather than rewriting it. If later evidence contradicts an older
claim, add a reclassification entry that says what proved the original gate was
wrong.

## Completion signal

You have done your job when a new agent can read `PORT_STATE.json` and answer:
where the port is, which skill runs next, what evidence exists, what is blocked,
and what would make the current stage's gate green.
