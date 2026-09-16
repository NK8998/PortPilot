# SKILLS.md — index and routing table

Skills live in `.github/skills/<name>/SKILL.md` and are auto-discovered by
Copilot CLI. Load the skill for the stage you are in; if a skill exists for the
task, **its rules override your general instincts**.

Start at [`arm64-port-orchestrator`](.github/skills/arm64-port-orchestrator/SKILL.md)
if you do not know which stage you are in.

---

## Routing table

| Stage | Skill | Use it when | Rules? |
|---|---|---|:--:|
| any | [`arm64-port-orchestrator`](.github/skills/arm64-port-orchestrator/SKILL.md) | You are starting or resuming a port and need to know the current stage and what runs next | — |
| **S0/S1** | [`arm64-readiness`](.github/skills/arm64-readiness/SKILL.md) | Establishing the x64 baseline and finding every x86-64 assumption, before any build is attempted | ✅ |
| **S2** | [`native-dependency-analysis`](.github/skills/native-dependency-analysis/SKILL.md) | Classifying every third-party dependency's ARM64 readiness — nothing may be left `unknown` | ✅ |
| **S3** | [`arm64-strategy-selection`](.github/skills/arm64-strategy-selection/SKILL.md) | Choosing classic ARM64 vs ARM64EC vs ARM64X, and writing the ADR | — |
| **S4** | [`arm64-build-environment`](.github/skills/arm64-build-environment/SKILL.md) | Getting a working toolchain, and deciding whether local verification is even possible | — |
| **S4** | [`build-retarget`](.github/skills/build-retarget/SKILL.md) | Making the project compile and link for ARM64 for the first time | ✅ |
| **S4** | [`arm64-qemu-verification`](.github/skills/arm64-qemu-verification/SKILL.md) | Running a functional launch smoke test in Windows ARM64 WinPE when real hardware is unavailable | — |
| **S5** | [`arm64-correctness`](.github/skills/arm64-correctness/SKILL.md) | Burning down `TODO(arm64)` markers: atomics, SIMD, asm, JIT, strings | ✅ |
| **S5** | [`arm64-software-breakpoints`](.github/skills/arm64-software-breakpoints/SKILL.md) | The app patches instructions or manipulates process state — debuggers, profilers, coverage tools, hot-patchers | — |
| **S6** | [`port-completeness`](.github/skills/port-completeness/SKILL.md) | Builds and tests are green, and you must prove nothing was silently dropped | ✅ |
| **S6** | [`arm64-artifact-verification`](.github/skills/arm64-artifact-verification/SKILL.md) | Proving the produced bytes really are ARM64 — a green build is not proof | — |
| **S6** | [`arm64-remote-verification`](.github/skills/arm64-remote-verification/SKILL.md) | Proving the app runs **native, not emulated**, on real ARM64 hardware | — |
| **S7** | [`port-packaging`](.github/skills/port-packaging/SKILL.md) | Packaging and releasing a verified ARM64 build, with a matched x64 negative control | ✅ |
| **S7** | [`arm64-ci-integration`](.github/skills/arm64-ci-integration/SKILL.md) | Wiring up `windows-11-arm` CI so the port stays ported | — |
| any | [`arm64-failure-diagnosis`](.github/skills/arm64-failure-diagnosis/SKILL.md) | Something fails **only** on ARM64, or you are debugging through a CI-only feedback loop | — |

## The "Rules?" column

A ✅ means the skill ships `patterns/rules.json` — machine-readable detection
rules with stable IDs (`RDY-0002`, `BLD-0007`, …) that an agent or scanner
consumes before reasoning about context.

Those rules are **scored**. `evals/run-evals.js` runs each rule set against
positive and negative fixtures and enforces **≥80% recall** and **≤20%
false-positive rate**. A skill may not ship detection rules without a golden
evaluation proving they work — the harness fails the run if it tries.

The negative fixtures matter as much as the positive ones: they are what stops a
rule set from flagging everything and calling it recall.

```bash
node evals/run-evals.js       # score every rule-bearing skill
node contracts/validate.js    # validate agent output against the schemas
```

Prose-only skills have nothing mechanical to score and are reported as
`INFO prose-only` rather than failed.

## Adding or changing a skill

1. Frontmatter is the routing signal. It must be exactly:
   ```yaml
   ---
   name: <exact directory name>
   description: <what it does, plus an explicit "Use ... when ..." clause>
   ---
   ```
   An agent picks the skill from the description alone. The harness enforces the
   routing clause.
2. If you add detection rules, add fixtures and a golden file in the same change.
   Include a **negative** fixture that must produce zero findings.
3. Prove a new rule can fail. A rule only ever run against passing input has been
   observed, not tested — mutate a known-good fixture until it goes red.
4. Harvest rules from failures. Every `REVISE` / `FAIL` / `BLOCKED` verdict owes a
   reusable prevention rule; that is how the catalogue gets better between ports.
