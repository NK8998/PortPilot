---
name: port-completeness
description: Prove that a green ARM64 port did not silently drop projects, tests, features, or verification gates compared with the x64 baseline. Use at S6 when builds/tests pass and the question is whether the same planned product actually ran.
---

# Port Completeness (S6)

## Purpose

A green build that lost functionality is a failed port. This skill asks whether
the thing that passed is the same thing that was planned in S0-S5.

The central failure is **vacuous green**: a test suite passes because tests were
excluded, filtered, skipped, or never selected. A green run proves nothing until
you show the test COUNT matches the x64 baseline, suite by suite. Lynn's
workstream found real passing logs containing `running 0 tests ... all filtered
out`; the job was green because the runner exited zero after doing no work.

Use `arm64-artifact-verification` for binary architecture proof and
`arm64-remote-verification` for target-machine runtime proof. This skill owns the
"did we silently drop anything?" gate.

## Inputs

- S0 feature inventory and x64 test baseline, including per-suite counts
- S1/S2/S3 plan, dependency decisions, and documented exclusions
- S4/S5 `TODO(arm64)` burn-down list and migration log
- Build configuration diff: solution/platform mappings, project references,
  `ExcludedFromBuild`, package manifests, and CI matrix changes
- Test commands, filters, logs, and CI workflow steps for x64 and ARM64

## Procedure

1. Read the x64 baseline counts before the ARM64 counts. Looking at the green
   port first invites rationalization.
2. Compare suite by suite, never only in aggregate. A total can stay constant
   while one suite disappears and another gains tests.
3. Run `patterns/rules.json` over build configuration, sources, and test scripts.
   Then read `references/silent-loss.md` and `references/vacuous-green.md`.
4. Build a parity matrix from the S0 feature inventory. Every feature gets a
   named `pass`, `fail`, or `degraded` verdict on ARM64. "Not tested" is a
   finding, not an omission.
5. For every exclusion, require the identifier excluded, the reason, and the
   decision record. If the reviewer discovers the exclusion from logs or diff
   rather than the plan, it was silent.
6. Assert that tests actually ran. Require a nonzero executed count and executed
   equal to passed for every suite. A missing count, empty log, skipped step, or
   name filter with zero matches is a failure.
7. Inspect the gate itself. A scan over an empty directory, a workflow step that
   short-circuits, or an assertion that accepts missing logs can produce a pass
   without measuring anything.
8. Report named deltas. "215 of 216" hides the dropped item; list the project,
   suite, test, or feature by name.

## Silent-loss mechanisms to check

### Build-system exclusions

Look for platform-specific removals:

```xml
<ExcludedFromBuild Condition="'$(Platform)'=='ARM64'">true</ExcludedFromBuild>
```

Also check missing ARM64 solution mappings, project references that no longer
build, package steps that copy fewer files, and custom scripts that only glob
x64 output. A justified exclusion is still a release-note item because it changes
what "all passed" means.

### Disabled or filtered tests

Find `DISABLED_`, `[Ignore]`, `Skip = "..."`, negative `--gtest_filter`,
`pytest -k`, `go test -run`, `cargo test` name filters, `ctest -R`, and CI
conditions that skip tests on ARM64. Name filters must assert they selected at
least one test; common runners can exit zero when the filter matches nothing.

### Architecture-guarded stubs

Search ARM64 branches for `return false`, `return S_OK`, `throw
NotImplementedException`, empty callbacks, or `TODO(arm64)` inside shipping code.
A stub behind `#if defined(_M_ARM64)` compiles, links, and passes every test that
misses that path while changing product behavior.

Keep the marker convention exactly: `// TODO(arm64): <what and why>`. S5's exit
gate requires zero such markers in shipping paths. Any remaining marker must be
non-shipping, documented, and excluded from release claims.

### Quiet feature disablement

Check feature flags, plugin loaders, optional native extensions, installers,
telemetry/version strings, updater channels, and runtime capability probes. A
feature may be disabled by data or packaging even when the source compiles.

### Vacuous verification gates

A gate that cannot fail is not a gate. Require item counts for architecture
scans, test suites, package audits, fixture lists, and coverage reports. Test the
gate against a known-bad input; a detector or CI step that has never failed has
not shown it can catch the bug it claims to catch.

## Parity matrix

Create `artifacts/s6-parity/parity-report.md` with one row per S0 feature:

```markdown
| # | Feature | x64 baseline | ARM64 | Evidence | Notes |
|---|---|---|---|---|---|
| 1 | Opens .foo files | pass | pass | test FooOpen/42 | |
| 2 | GPU preview | pass | degraded | manual run on VM | software fallback, ADR-0002 |
| 3 | Plugin host | pass | fail | load log | x64 plugins unsupported |
```

No row may say only "works". Link to the test log, manual evidence, or recorded
limitation that supports the verdict.

## Judgment rules

- A dropped test is a finding even when the drop is correct.
- Absent evidence is not clean evidence; missing logs fail the gate.
- Compare against the plan and S0 baseline, not only against the previous ARM64
  run.
- Re-enabling a test while weakening its assertions is still loss.
- Diagnostic `continue-on-error` is allowed only when a later aggregate step
  exits nonzero for any failure.
- Do not report percentages without the names behind the delta.

## Verification checklist

- [ ] Per-suite x64 and ARM64 executed/passed counts match or every delta is
      named and documented.
- [ ] No ARM64 solution/project/package exclusion is undocumented.
- [ ] No shipping `TODO(arm64)` markers or architecture-guarded stubs remain.
- [ ] Every S0 feature has an ARM64 verdict and evidence.
- [ ] Test filters prove they matched a nonzero test count.
- [ ] CI steps fail on missing, empty, or zero-count logs.
- [ ] Any deliberate limitation appears in the ADR, parity report, and release
      notes.

## Output

Emit `CMP-` findings using the repository finding envelope, plus an explicit
completeness statement: baseline counts, ARM64 counts, named exclusions with
recorded reasons, and every planned item missing from the port.
