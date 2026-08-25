# AGENTS.md — PortPilot

A reusable, **agent-driven** workflow that analyses, ports, tests and packages
open-source applications from **AMD64/x64 to native ARM64** on Windows.

Read this file first. It is short on purpose. Detail lives in `docs/` and in the
skills under `.github/skills/`.

---

## 1. Prime directive

> **Get to a native ARM64 binary by removing x86 assumptions — not by rewriting the app.**

A port is a *subtractive* exercise. Most of the work is finding the handful of
places that assume x86-64 and neutralising them. If you find yourself
redesigning a subsystem, you have almost certainly taken a wrong turn — stop and
re-read [`docs/DECISION_MATRIX.md`](docs/DECISION_MATRIX.md).

## 2. Two views of the same work

PortPilot has a **stage view** (what must be true, in order) and an **agent view**
(who does the work). They are not competing models — the agents move the port
through the stages.

### 2a. Stages — S0 → S7

Full definition: [`docs/PORTING_PLAYBOOK.md`](docs/PORTING_PLAYBOOK.md).

| Stage | Name | Goal | Exit gate | Skill |
|---|---|---|---|---|
| **S0** | Intake & Baseline | Build + test the app *unchanged* on x64 | Reproducible x64 build, recorded test baseline | `arm64-readiness` |
| **S1** | Architecture Recon | Find every x86-64 assumption | Arch-surface inventory committed | `arm64-readiness` |
| **S2** | Dependency Audit | Classify every dependency's ARM64 readiness | No dependency left `unknown` | `native-dependency-analysis` |
| **S3** | Strategy Decision | Pick ARM64 / ARM64EC / ARM64X | One-page ADR committed | `arm64-strategy-selection` |
| **S4** | Build Bring-up | Make it **compile and link** for ARM64 | PE header reports `AA64`; app starts | `build-retarget`, `arm64-build-environment` |
| **S5** | Code Migration | Make it **correct** on ARM64 | Zero `TODO(arm64)` in shipping paths; unit tests green | `arm64-correctness`, `arm64-software-breakpoints` |
| **S6** | Verify & Parity | Prove parity with the x64 baseline | Parity matrix + "no emulation" proof + perf delta | `port-completeness`, `arm64-artifact-verification`, `arm64-remote-verification` |
| **S7** | Package, CI & Harvest | Ship it and bank the knowledge | ARM64 artifact, green ARM64 CI, new rules harvested | `port-packaging`, `arm64-ci-integration` |

`arm64-failure-diagnosis` applies at any stage, whenever something fails only on ARM64.

### 2b. Agents — analysis → migration → review

```
   port-analysis ──analysis.json──▶ port-migration ──build.json──▶ port-review
        ▲              plan.json          ▲          runtime.json       │
        │                                 │                             │
        │                                 └────── REVISE ───────────────┤
        │                                    (fixable at this rung)     │
        │                                                              │
        └───────────────── FAIL ───────────────────────────────────────┘
                     (the rung itself was wrong)
                                          PASS ─▶ report   BLOCKED ─▶ halt
```

`portpilot` is the orchestrator: it owns **the run**, not the thinking. It sets up
the run, passes artifacts, enforces gates and stops the loop. Definitions live in
[`agents/`](agents/).

The two feedback edges are **not** the same. `REVISE` means the problem is fixable
without changing strategy. `FAIL` means the strategy itself was wrong. `BLOCKED`
means a real external wall that no rung can route around — it is not a softer
`FAIL`, and it must never be laundered into a `PASS` by narrowing scope.

### Stage rules (non-negotiable)

1. **One stage at a time.** Do not start S5 work while S4's gate is red.
2. **Bring-up is not migration.** In S4 you may stub anything with
   `// TODO(arm64):`; you may *not* attempt real SIMD/asm ports. Mixing the two is
   the single most common way these ports stall.
3. **Never regress x64.** Every change keeps the existing x64 path compiling and
   passing. Guard with `#if defined(_M_ARM64) || defined(_M_ARM64EC)`, never by
   deleting the x86 branch.
4. **One workstream per commit.** Intrinsics, build system, dependencies and
   packaging are separate commits. A commit touching all four is unreviewable.
5. **Evidence or it didn't happen.** A stage is complete when its artifact exists
   in the run directory, not when you believe it works.

## 3. Evidence discipline

This is the rule that separates a port from a claim.

> **Keep evidence that is machine-checkable. Distrust evidence that is asserted.**

- A **green build is not proof of architecture.** A successful exit code says
  nothing about the machine field of the artifact it produced. Verify the bytes:
  `scripts/verify_arch.py`, `scripts/Test-PeArchitecture.ps1`.
- A **green test run is not proof of coverage.** A suite that passes because tests
  were excluded, filtered or skipped on ARM64 is *vacuous green*. Compare the test
  **count** against the x64 baseline, not just the exit status. See
  `port-completeness`.
- A **gate you did not run is `not-run`, never `pass`.**
- **A gate that cannot fail its author is not a gate.** Prove a gate can fail by
  mutating a known-good input until it goes red.
- **Positive results need a negative control.** Ship a matched x64 refusal proof
  alongside every "it runs native on ARM64" claim.
- **Never trust a directory name.** Microsoft's own `arm64` VC redist directory
  ships an **x64** `vcruntime140_1.dll` (machine `0x8664`). Scan every file you
  package. This was caught by a real packaging gate, not in theory.

PE machine values: `0xAA64` = ARM64, `0x8664` = x64, `0x14c` = x86. Note that
`AA64` alone does **not** distinguish classic ARM64 from ARM64EC — use
`scripts/Get-PortpilotArchitecture.ps1` when that distinction matters.

## 4. Skills

Task-specific playbooks live in `.github/skills/<name>/SKILL.md` and are
auto-discovered by Copilot CLI. The index and routing table is
[`SKILLS.md`](SKILLS.md).

Load the skill for the stage you are in. Do not freelance: if a skill exists for
the task, its rules override your general instincts.

Some skills ship `patterns/rules.json` — machine-readable detection rules. Those
are scored by the eval harness (see §6). **A skill may not ship detection rules
without a golden evaluation proving they work.**

## 5. Verification hardware

You **cannot** execute ARM64 binaries on an x64 dev box. Cross-compiling there is
fine; every claim about *runtime* behaviour must come from real ARM64 hardware.
There are two authoritative paths:

**A GitHub-hosted `windows-11-arm` runner** — see `arm64-ci-integration` and
`.github/workflows/`. This is the default when you have no local hardware.

**A Windows 11 ARM64 VM** via `./scripts/vm.sh` — see `arm64-remote-verification`:

```bash
./scripts/vm.sh init <vm-name>           # one-time: discover settings from Azure
./scripts/vm.sh check                    # confirm PROCESSOR_ARCHITECTURE is ARM64
./scripts/vm.sh push <local> <remote>    # stage build output
./scripts/vm.sh verify 'C:\port\dist'    # every binary must be AA64
./scripts/vm.sh smoke  'C:\port\app.exe' # prove the process runs native, not emulated
```

`smoke` calls **`IsWow64Process2`**: `ProcessMachine == 0` means native; any
nonzero value means the process is being **emulated**. That is the actual proof of
non-emulation.

Azure **Windows** VMs authenticate with username/password, not a `.pem` key —
Azure's "SSH keys" resource is Linux-only and cannot be attached to a Windows
image. `vm.sh keygen` + `install-key` upgrade to key auth. If a stage might run
unattended, do that **first**, or a password prompt will hang the run. **Never
store a password in `vm.env`.**

## 6. Contracts and evals — the quality ratchet

- **`contracts/`** — JSON schemas that every agent's output must validate against
  (`analysis`, `plan`, `build`, `runtime`, `review`, `run`, `release`, `handoff`).
  This is what forces agents to emit structured, checkable output instead of prose.
  Validate with `node contracts/validate.js`.
- **`evals/`** — scores each rule-bearing skill against positive **and negative**
  fixtures, enforcing ≥80% recall and ≤20% false-positive rate. Run with
  `node evals/run-evals.js`.

Negative fixtures matter as much as positive ones: they are what stops a skill
from "detecting" everything and calling it recall.

## 7. Hard-won facts you should not have to rediscover

- **`_M_ARM64` is defined on ARM64EC too.** For "classic ARM64 only" you need
  `#if defined(_M_ARM64) && !defined(_M_ARM64EC)`. Check `_M_ARM64EC` first.
- **ARM64 is weakly ordered; x64 is not.** Code that "worked" on x64 with
  `volatile` or sloppy lock-free logic breaks *intermittently* on ARM64. This is
  the #1 source of heisenbugs in ports. Use `std::atomic` with an explicit
  memory order.
- **MSVC does not support inline `__asm` on ARM64 at all.** Inline assembly must
  become intrinsics or a separate `.asm`/`.s` file.
- **NEON is 128-bit, full stop.** There is no 256-bit equivalent of AVX. Every
  `__m256i` becomes two 128-bit operations.
- **Runtime code generation must call `FlushInstructionCache`** on ARM64. The
  instruction and data caches are not coherent.
- **A dependency you cannot rebuild for ARM64 is a project-level blocker**, not a
  coding problem. Escalate it in S2, not in S5.
- **Emulated x64 code cannot load native ARM64 DLLs, and vice versa.** A process
  is one world or the other — unless you use ARM64EC.
- **The host toolchain flavour matters.** More than one of `bin\HostX86\*`,
  `bin\Hostx64\*`, `bin\HostArm64\*` in a single build is a latent failure even
  when the build succeeds, because the next run may resolve differently.

Longer catalogue: [`docs/PITFALLS.md`](docs/PITFALLS.md).

## 8. Conventions

- **Marker comment:** every deferred port is `// TODO(arm64): <what and why>`.
  S5's exit gate greps for this token; do not invent variants.
- **Evidence** goes in `runs/<app>-arm64/`, one subdirectory per stage
  (`s1-recon/`, `s6-parity/`, …).
- **Decisions:** any non-obvious choice gets a one-line rationale in the run
  state. Big ones get an ADR in `docs/adr/`.
- **Per-app manifests** live in `manifests/<app>/portpilot.yml` — the declarative
  descriptor of how to build, test and package that app for each architecture.
- **Never vendor a prebuilt x64 binary into the ARM64 build** to "make it link".
  That is how you ship a broken app.
- **Every non-`PASS` verdict carries a lesson**: a concrete observation plus a
  reusable prevention rule, phrased so it could become a `patterns/rules.json`
  entry. A failure without an actionable lesson is not a valid transition.

### Git

- **Never push to `main` or `master`.** All work goes on a
  `user/<name>/<topic>` branch and reaches `main` by pull request. A local
  `pre-push` hook enforces this; install it with
  `cp scripts/hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push`.
- **Integration branches are the one exception to the naming rule.** Work that
  consolidates several people's branches is not one person's topic, so it uses a
  `consolidate/<topic>` prefix and credits every source with `Co-authored-by:`
  trailers. The `user/<name>/<topic>` form still applies to everything else.
- **Never commit credentials.** Files matching `*cred*.txt`, `*.pem`, `*.env`
  and similar are gitignored. Before any `git add -A`, check `git status` for
  anything key- or credential-shaped. A secret pushed to a remote must be
  treated as compromised and rotated, not merely deleted.
- Verification output belongs in `runs/`, not in commit messages.

## 9. When you are stuck

1. Re-read the stage's exit gate — you are often trying to solve a later stage's
   problem.
2. Load `arm64-failure-diagnosis` and classify the failure before fixing it.
3. Check [`docs/PITFALLS.md`](docs/PITFALLS.md) for the symptom.
4. Check [`docs/REFERENCES.md`](docs/REFERENCES.md) — a curated, link-verified
   library covering MSVC, ARM64EC, NEON, CI and per-ecosystem notes.
5. If it is a dependency, it is an S2 blocker. Record it and move on; do not burn
   a session on it.
