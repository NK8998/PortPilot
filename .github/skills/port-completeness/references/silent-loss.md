# The mechanisms of silent loss

Every one of these makes a pipeline greener. None of them makes the port better. They are ordered
by how hard they are to notice.

## 1. Excluding a project from the new platform

```xml
<ExcludedFromBuild Condition="'$(Platform)'=='ARM64'">true</ExcludedFromBuild>
```

The build succeeds because the failing project is no longer part of it. Nothing in the log says a
project is missing; there is simply one fewer line of output, in a log nobody counts.

This is legitimate exactly when it is a decision: the identifier, the reason, and the record all
exist before the build is run. It is silent loss when the reviewer discovers it afterwards.

The worked example from this workstream is a `/clr` C++/CLI test project. One line reported 215
tests with the project excluded; the line that kept it reported 216. Both were green. Only the
count distinguished them, and only because someone compared suite by suite.

## 2. Disabling tests

`DISABLED_` prefixes, `[Ignore]`, `Skip = "..."`, and `--gtest_filter=-Suite.*` all remove tests
from the run while leaving them in the tree, so a file count and a `git diff` line count both look
untouched. The test runner reports success over a smaller population.

The signature is a passing run whose executed count fell. If nothing records the executed count,
there is no signature at all.

## 3. Stubbing behind an architecture guard

```cpp
#if defined(_M_ARM64)
    return false;  // TODO: ARM64 support
#else
    return PatchTarget(address);
#endif
```

This is the most expensive kind, because it compiles, links, ships, and passes any test that does
not exercise the path. The product is now architecture-dependent in behaviour while presenting as
fully ported. It survives review whenever review reads the diff for correctness rather than for
completeness.

## 4. Gates that cannot fail

A gate that accepts an empty collection, matches nothing, or short-circuits on a missing file
reports a pass it never measured. This is loss of *verification* rather than loss of function, and
it is worse, because it removes the mechanism that would have caught the other three.

Two directions, both real:

- Too permissive: a purity scan over an empty directory reports zero violations.
- Too strict: a fixture-list gate rejects a legitimately empty list and gets "fixed" by weakening
  the assertion instead of by allowing the empty case explicitly.

Test the gate against a known-bad input. A gate that has never failed has never been shown to
work, and in this workstream every wrong mechanism theory was eventually settled by a parser that
could fail its own author.

## 5. Vacuous success

```powershell
& $testExe
if ($LASTEXITCODE -ne 0) { throw "tests failed" }
```

Zero tests executed also exits zero. Assert the counts:

```powershell
if ($ran -eq 0 -or $ran -ne $passed) { throw "expected a nonzero run with no failures" }
```

The same reasoning applies to any evidence file: an empty log is not a clean log, and a step that
was skipped did not pass.

## What to demand instead

| Instead of | Require |
| --- | --- |
| "All tests pass" | Per-suite executed and passed counts, both architectures |
| "The project was excluded" | Identifier, reason, and where the decision is recorded |
| "The scan found nothing" | The number of items scanned, and a known-bad input that it rejects |
| "CI is green" | Which jobs ran, on what hardware, and what each one asserted |
