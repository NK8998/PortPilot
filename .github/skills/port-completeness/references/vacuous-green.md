# When the rule against vacuous green is itself vacuous

`CMP-0004` exists to catch a test step that cannot distinguish a passing suite from a suite that
never ran. In the lacy ARM64 port, a workflow containing exactly that defect passed through the
rule untouched, in a run that went green on all seven jobs.

The rule was not missing. `SKILL.md` step 5 stated it in prose, `CMP-0004` was named
`vacuous-test-success`, and `scanVacuousTestSuccess` was fully implemented. The rule was
unenforceable, which looks identical to compliance from the outside — the same failure mode the
rule was written to catch, one level up.

## What the defect looked like

Two steps in the ported workflow ran a filtered test selection:

```yaml
- name: detects powershell
  run: cargo test --release -- --ignored is_powershell_true
```

Both reported `running 0 tests ... all filtered out` inside a green job. No test of that name
exists in the source; the steps came from the port's own patch. `cargo` exits `0` when a name
filter matches nothing, so a filter that selects nothing is indistinguishable from a suite that
passed — unless something reads the executed count.

## The two blind spots, both measured

The detector returned zero findings on the real workflow. Two independent causes, each sufficient
on its own:

**1. The runner vocabulary was MSVC/.NET-shaped.**

```js
/vstest|gtest|dotnet\s+test|[A-Za-z0-9_.]*[Tt]ests?\.exe|--gtest_output/u
```

This does not match `cargo test`. The function returned `[]` on its first line, before examining
anything. Measured `false` against a file that provably contains `cargo test`. The same gap made
it blind to `ctest`, `pytest`, `go test`, `npm test`, and `swift test` — that is most of the
ecosystem, silently.

**2. It only recognised explicitly gated shells.**

```js
/\$LASTEXITCODE\s*-(?:ne|eq)\s*0|\bExitCode\s*-(?:ne|eq)\s*0/iu
```

A GitHub Actions `run:` step is graded on the step's own exit status. There is no exit-code
comparison anywhere in the text, so `findIndex` returned `-1` and the detector bailed — including
for the C++ projects it was actually written for, whenever they gated implicitly. The rule could
only fire on a project that both used an MSVC-family runner *and* wrote out a PowerShell exit-code
check by hand.

## What changed

The runner vocabulary now spans the common ecosystems, an implicit CI-step gate counts as a gate,
and a filtered invocation is treated as vacuous on its own, because a filter that matches nothing
exits zero whether or not the exit code is checked.

Verification was done against the real `check.yml` from the port, not against fixtures written
alongside the fix: the previous implementation reported `0` findings, the current one flags the
filtered step. Fixtures that a rule's own author writes will tend to describe the rule rather than
the world, so a rule repaired after a miss should be re-run against the artifact that defeated it.

## The rule immediately found the same defect here

Re-running the repaired detector against this repository's own `.github/workflows/winport.yml`
returned a finding on the first attempt: `npm test --prefix contracts` and
`dotnet test src/tools/winport-scan.Tests` were both graded on exit status alone. The repo that
publishes the rule was violating it. Both steps now parse the runner's reported count — `# tests`
from the node TAP output, `Passed: <n>` from the .NET runner — and fail when it is zero or absent,
and the detector returns zero findings against the workflow.

The first version of the repaired detector also anchored that finding on the wrong line: it
reported the first exit-code comparison anywhere in the file, which was a purity-gate assertion
three steps below the actual test step. A finding that points at unrelated code gets dismissed,
so the detector now anchors only on lines that invoke tests, and accepts an explicit gate only
when it follows such a line closely enough to plausibly be gating it.

## The generalisable part

- **A rule that nothing can trigger is indistinguishable from a rule that passes.** Detector
  coverage needs its own evidence; "we have a rule for that" is a claim about intent, not effect.
- **Detection vocabularies inherit the stack they were born in.** Every hardcoded tool name is a
  silent assumption about the projects the rule will meet. The failure is not a wrong answer, it
  is an empty one, and empty reads as clean.
- **Prefer the invariant to the idiom.** "Tests executed a nonzero count" holds across every
  runner; "`$LASTEXITCODE -ne 0` appears in the file" holds only where someone wrote that line.
- **A zero exit code means the process finished, not that work happened.** `cargo` exits zero on an
  empty filter, and it is not unusual — the same is true of a filter that matches nothing in
  `pytest -k`, `go test -run`, and `--gtest_filter`.
- **Recall against fixtures is not recall against reality.** These evals held at 100% recall and 0%
  false positives for the entire period in which this defect was invisible.
