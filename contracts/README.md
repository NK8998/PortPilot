# PortPilot Contracts

The integration layer. Every skill reads and writes these shapes, which is what lets people
work in parallel on separate skill folders and still merge cleanly.

> **These schemas are frozen.** Changing a field after Day 1 requires team-wide consensus and a
> PR that touches every affected skill in the same commit. Adding an optional field is cheap;
> changing or removing a required one is not.

## Files

| Schema | Emitted by | Consumed by |
|---|---|---|
| `finding.schema.json` | every analysis + review skill | `port-planning`, `port-review` |
| `analysis.schema.json` | `port-analysis` (fused) | `port-planning`, orchestrator |
| `plan.schema.json` | `port-analysis` via `port-planning` | `port-migration` |
| `build.schema.json` | `port-migration` | `port-review`, orchestrator |
| `runtime.schema.json` | `port-migration` | `port-review`, orchestrator |
| `review.schema.json` | `port-review` | orchestrator, `port-migration` (on REVISE) |
| `handoff.schema.json` | orchestrator / sibling session | orchestrator, evidence intake |
| `release.schema.json` | `port-packaging` | orchestrator, release workflow |
| `candidates.schema.json` | `repo-discovery` | humans, target lock — *not built yet* |

`build.schema.json` and `runtime.schema.json` exist because of a gap the first real run
exposed: they were the only artifacts in the pipeline with no contract, so `validate.js`
SKIPped them — which meant the two artifacts carrying *all* the measured evidence were the
only two nobody checked. They enforce two rules specifically:

- **A cross-compiled binary is never evidence that anything ran.** Every build step must
  declare `mode` as `executed`, `cross-compiled-not-executed`, or `skipped`, and
  `arm64Execution` is a required disclosure — if nothing ran on Arm64 hardware, the artifact
  has to say so and say why. Silence is not an option the shape allows.
- **The original platforms are part of the contract.** `regressionChecks` is where you prove
  Linux and macOS still build and lint. A port that greens Windows by breaking Linux is a
  failed port, and it is invisible if you only ever lint the host triple.
- **A workflow success is not a test pass.** Passed runs require an exact
  `requiredTestSuites`/`testSuites` match, nonzero test counts, retained suite logs, coherent
  compiler/linker/LIB/INCLUDE identities, and every planned acceptance scenario with matching
  observed output.
- **Review prose is not a gate.** A `PASS` must include measured project-graph, scenario, and
  test-failure-propagation gates in addition to build, runtime, purity, and plan evidence.

## How artifacts flow

```
port-analysis ──analysis.json──▶ port-migration ──build.json──▶ port-review
     ▲             plan.json           ▲          runtime.json      │
     │                                 └────── REVISE ──────────────┤
     └───────────────── FAIL ─────────────────────────────────────  ┘
```

Artifacts flow forward, never sideways. `port-migration` reads `plan.json` — not the analysis
agent's chat output. If an artifact is missing, that stage did not happen.

Cross-session work enters through `handoff.json`, never by reconstructing artifacts from chat.
Its `pending` state records missing evidence honestly. `accepted` requires immutable source,
hashed changes, and measured evidence. Supplied evidence is validated even while pending and is
bound to its source commit, byte size, SHA-256, runner, and hosted workflow URL when applicable.
`release.json` similarly separates `candidate`, `ready`,
and `published`; all hard gates must pass before the latter two states are valid.

The two feedback edges are different on purpose. `REVISE` means the strategy was right and
execution needs work, so it returns to migration. `FAIL` means the migration **rung** was
wrong, so it returns to analysis for a replan.


## The three axes people confuse

These are **independent**. Collapsing them is the single most common way this goes wrong.

### `severity` — how badly it hurts the Windows port

`blocker` > `high` > `medium` > `low` > `info`

Answers: *"How much does this stop the app being a good Windows app?"*

### `arm64Impact` — what it costs specifically on Arm64

| Value | Meaning |
|---|---|
| `none` | Portable as written. Recompiles cleanly for Arm64. |
| `rebuild-required` | Source is fine; an artifact/dependency must be rebuilt for `arm64-windows`. |
| `source-change-required` | Source must change — intrinsics, inline asm, arch `#ifdef`s. |
| `blocker` | Cannot go native Arm64 as written. Escalates to `arm64ec-strategy`. |

Worked examples of why the axes must stay separate:

- A GTK4 dependency is `severity: blocker` for Windows, but `arm64Impact: none` — once you
  solve the UI problem, Arm adds nothing.
- A vendored `libfoo.x64.dll` may be `severity: low` on Windows (it works!) but
  `arm64Impact: blocker` — it is the reason the app can never be arm64-pure.
- `#include <immintrin.h>` is `severity: info` on Windows-x64 and
  `arm64Impact: source-change-required`.

### `confidence` — how sure the skill is

`high` | `medium` | `low`

`low`-confidence findings are surfaced to humans but **never auto-acted on** by
`port-migration`. If you cannot justify a Windows alternative, drop `windowsAlternative`
and mark confidence `low` with the reason in `explanation`.

## The evidence rule

Every finding carries `file`, `line`, and `evidence` — the **literal matched text**, not a
paraphrase. A finding you cannot cite is a finding you delete. Negative-control fixtures in
`evals/` exist specifically to punish skills that invent findings.

## Finding ID prefixes

Reserved so IDs stay globally unique across skills:

| Prefix | Skill family |
|---|---|
| `LNX` | `linux-dependency-analysis` |
| `ARM` | `arm64-readiness`, `arm64-correctness` |
| `BLD` | `build-system-analysis`, `build-retarget` |
| `DEP` | `native-dependency-analysis` |
| `UIF` | `ui-framework-analysis` |
| `PUR` | `arm64-purity` |
| `PRF` | `woa-performance` |
| `PKG` | `port-packaging` |
| `SEC` | `security-review` |

## Validating

`validate.js` is a **harness**, not an agent: it decides pass/fail in code, so no agent can
talk its way past a gate.

```powershell
npm install --prefix contracts       # once

node contracts/validate.js runs/example-2026-08-14          # a whole run directory
node contracts/validate.js runs/demo/plan.json              # one artifact
node contracts/validate.js some.json plan.schema.json       # force a schema
```

Exit code `0` = valid, `1` = invalid, `2` = usage error. The orchestrator calls this before
letting a run advance a stage, and CI calls it on every PR.

Whole-directory validation also enforces facts JSON Schema cannot express alone:

- `run.json` cannot be `passed` without build/runtime/purity artifacts and a PASS review.
- `release.json` ready/published paths must stay inside the run directory and exist.
- The recorded package size/SHA-256 and `SHA256SUMS.txt` entry must match the retained bytes.
- A published immutable URL must match the declared repository, tag, and package name.

Validate release readiness against the whole run directory, not `release.json` in isolation.

## A worked example

`runs/example-2026-08-14/` is a complete illustrative run showing all four artifacts and a
`REVISE` verdict routing back to migration. Read it alongside the agent prompts — it is the
fastest way to see what each agent must emit.
