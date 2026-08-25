# PortPilot

A reusable, **agent-driven** workflow that analyses, ports, tests and packages
open-source applications from **AMD64/x64 to native ARM64** on Windows — powered
by GitHub Copilot.

PortPilot is not a build script. It is a set of **skills**, **agents**,
**contracts** and **evidence gates** that let an agent take a repository that only
ships x64 and drive it to a proven-native ARM64 artifact — and prove it, rather
than assert it.

---

## Start here

| You want to… | Read |
|---|---|
| Understand how the whole thing works | [`AGENTS.md`](AGENTS.md) |
| Find the right skill for what you're doing | [`SKILLS.md`](SKILLS.md) |
| Understand the S0→S7 stages in depth | [`docs/PORTING_PLAYBOOK.md`](docs/PORTING_PLAYBOOK.md) |
| Pick ARM64 vs ARM64EC vs ARM64X | [`docs/DECISION_MATRIX.md`](docs/DECISION_MATRIX.md) |
| Debug something that breaks only on ARM64 | [`docs/PITFALLS.md`](docs/PITFALLS.md) |

```bash
node contracts/validate.js    # validate agent output against the schemas
node evals/run-evals.js       # score every rule-bearing skill against fixtures
./scripts/vm.sh check         # confirm the ARM64 VM is really ARM64
```

## Layout

```
AGENTS.md         the spine: prime directive, stages, evidence discipline
SKILLS.md         skill index + routing table
.github/skills/   14 skills, auto-discovered by Copilot CLI
agents/           portpilot orchestrator + analysis / migration / review
contracts/        JSON schemas every agent output must validate against
evals/            scores rule-bearing skills against positive+negative fixtures
manifests/        per-app declarative port descriptors (portpilot.yml)
scripts/          vm.sh (real ARM64 VM), architecture verifiers, toolchain gates
docs/             playbook, decision matrix, pitfalls, verified references
templates/        CI templates, evidence report scaffolds
runs/             retained evidence from real ports
```

## How the work flows

Two views of the same port. **Stages** say what must be true, in order.
**Agents** say who does it.

```
S0 baseline → S1 recon → S2 deps → S3 strategy → S4 build → S5 correctness
   → S6 verify → S7 package

   port-analysis ──▶ port-migration ──▶ port-review ──PASS──▶ report
        ▲                  ▲                 │
        │                  └─── REVISE ──────┤   (fixable at this rung)
        └────── FAIL ─────────────────────── ┘   (the rung was wrong)
                                    BLOCKED ──▶ halt, honestly
```

The reviewer is **read-only and adversarial by design**, and it can send work
back. Only `PASS` advances the run.

## The rule that holds it together

> **Keep evidence that is machine-checkable. Distrust evidence that is asserted.**

- A green **build** is not proof of architecture — verify the machine field of the
  bytes you produced.
- A green **test run** is not proof of coverage. A suite that passes because tests
  were filtered out on ARM64 is *vacuous green*; compare the test **count** to the
  x64 baseline.
- A gate you did not run is `not-run`, never `pass`.
- **A gate that cannot fail its author is not a gate.** Prove it can fail by
  mutating a known-good input.
- Positive results need a **negative control** — ship a matched x64 refusal proof
  beside every "runs native on ARM64" claim.
- Never trust a directory name: Microsoft's own `arm64` VC redist directory ships
  an **x64** `vcruntime140_1.dll`. Scan every file you package.

Proving *native* execution means `IsWow64Process2` reporting `ProcessMachine == 0`
— anything nonzero is emulation. `./scripts/vm.sh smoke` does exactly that on real
hardware; `windows-11-arm` CI runners are the authoritative path when you have no
hardware of your own.

## Evidence retained in this repo

`runs/` keeps only evidence that can be checked by a machine.

| Run | Status | Hardest proof |
|---|---|---|
| `runs/opencppcoverage-arm64/` | **Ported, packaged, released** | Real `windows-11-arm64` CI logs; `pe-ARM64-Release.json` shows **36 PE images, all `0xAA64`, zero x64**; the packaging gate **rejected** Microsoft's x64 `vcruntime140_1.dll`; host-toolchain proof shows `HostArm64` only; matched x64 negative control |
| `runs/btop4win-arm64/` | **Ported, released** (S6) | `dumpbin /headers` → `AA64 machine (ARM64)`; ARM64 release asset with embedded PE machine `0xAA64`. Runtime launch confirmed manually on an ARM64 VM — **not** automated, and recorded as such |
| `runs/nnn-arm64/` | Cross-compiled, **not run on hardware** | `llvm-readobj` reports `IMAGE_FILE_MACHINE_ARM64 (0xAA64)`, plus the full source patch and a proof the x86-64 build stays byte-identical. Transcribed in [build notes](runs/nnn-arm64/build-notes.md) — no captured log artifact, so it carries no contract artifacts and is **not** machine-validatable |
| `runs/_intake-only/` | **S0 research only — no port** | Intake findings for `aegisub` and `bed-reader`. Kept as research; no ARM64 artifact exists |

Runs are labelled by how far they actually got. `_intake-only` means exactly that.

## Provenance

This repository consolidates five independent hackathon approaches. Each
contributed the part it did best:

| From | What it contributed |
|---|---|
| `user/neil/one-shot-test` | The S0→S7 staged spine, the ARM64 domain docs (pitfalls, decision matrix, verified references), and `scripts/vm.sh` — real Azure Windows 11 ARM64 hardware in the loop |
| `lynn-winport` | The contract schemas, the **eval harness**, the four-agent pipeline with its two feedback edges, host-toolchain gates, packaging proof, and the strongest retained evidence |
| `tanga/arm64-porting-skills` | The language- and build-system-agnostic framing, the cross-platform `verify_arch.py`, and the specialist software-breakpoint and CI-only-debugging playbooks |
| `leengari` | The tamper-evident evidence hashing, the PE inspector with ARM64EC/ARM64X heuristics, the local-capability probe, and a reviewer with genuine veto power |
| `portpilot/pocketsphinx-arm64` | The declarative per-app `portpilot.yml` manifest, the `windows-11-arm` CI shape with clean-install validation, and the PE/wheel verifiers |

Deliberately **not** carried over: a deterministic Python orchestrator that
decided stage transitions centrally (it sidelines the agent, which is the point of
this project), generic release-hygiene prose with no ARM64 content,
placeholder-filled state templates presented as evidence, and narrative claims
with no retained logs behind them.

## Contributing

- All work goes on a `user/<name>/<topic>` branch and reaches `main` by pull
  request. Work consolidating several people's branches uses `consolidate/<topic>`
  instead, and credits each source with `Co-authored-by:`. Install the guard:
  `cp scripts/hooks/pre-push .git/hooks/pre-push && chmod +x .git/hooks/pre-push`
- Never commit credentials. `*cred*.txt`, `*.pem` and `*.env` are gitignored.
- Adding detection rules to a skill means adding fixtures and a golden evaluation
  in the same change — including a negative fixture. See [`SKILLS.md`](SKILLS.md).
