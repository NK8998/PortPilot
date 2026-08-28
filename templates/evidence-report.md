# Port Evidence Report — <app> <version>

> S6 artifact. Copy to `artifacts/s6-parity/parity-report.md`.
> **Evidence, not opinions.** Every claim below needs a command output, a
> screenshot, or a log — not an assertion.

## Summary

| | |
|---|---|
| Application | <name> @ <commit> |
| Target ABI | ARM64 / ARM64EC / ARM64X (per ADR-NNNN) |
| Verdict | ✅ ready / ⚠️ ready with gaps / ❌ not ready |
| Test hardware | <device, SoC, RAM> |
| OS build | <winver output> |
| Date | <date> |

---

## 1. Feature parity

Source: the S0 feature inventory. **Every item needs a verdict** — "not tested"
is a finding, not an omission.

| # | Feature | x64 baseline | ARM64 | Notes / issue |
|---|---|---|---|---|
| 1 | | pass | pass | |
| 2 | | pass | degraded | <why, tracking issue> |
| 3 | | pass | fail | <why, tracking issue> |

**Totals:** N features · P pass · D degraded · F fail

---

## 2. Architecture proof — is it actually native?

### 2.1 Binary architecture

All shipped binaries must report `AA64` (`8664` = x64 = wrong).

```
> dumpbin /headers dist\app.exe | findstr machine
<paste output for EVERY shipped binary>
```

### 2.2 Process architecture at runtime

```
> [System.Runtime.InteropServices.RuntimeInformation]::ProcessArchitecture
<paste>
```

Task Manager → Details → **Architecture** column: `<ARM64 / x64>`
<attach screenshot — this is the most convincing single piece of evidence>

### 2.3 Loaded modules

No unexpected x64 modules in the process.

```
> Get-Process app | Select-Object -ExpandProperty Modules | Select ModuleName, FileName
<paste, or attach>
```

**x64 modules found:** <none> / <list — each must be justified by the ADR under ARM64EC>

---

## 3. Reliability

| | x64 baseline (S0) | ARM64 |
|---|---|---|
| Tests passed | | |
| Tests failed | | |
| Pre-existing failures | | |
| **New failures** | — | **<must be 0>** |

**Concurrency / stress:** `<N>` runs under load, `<N>` passed.
> ARM64 weak-memory bugs are probabilistic. A single green run is not evidence.
> Target ≥100 runs for anything touching lock-free code or shared state.

**Soak test:** `<duration>` — <result, memory growth, handle leaks>

---

## 4. Performance & power

Same workloads as the S0 baseline. The headline number is **native ARM64 vs
emulated x64 on the same ARM64 machine** — identical silicon, only the port
differs.

| Workload | Emulated x64 (ARM64 HW) | **Native ARM64** | Speedup | x64 on x64 HW |
|---|---|---|---|---|
| | | | | |

**Power / battery:** <measurement and method — often the strongest argument>

**Methodology:** <how measured, how many runs, warm/cold, what was controlled>

---

## 5. Known gaps

| Gap | Impact | Cause | Tracking | Plan |
|---|---|---|---|---|
| | | | | |

---

## 6. Sign-off

- [ ] Every S0 feature has a verdict
- [ ] All shipped binaries verified `AA64`
- [ ] No unexpected x64 modules loaded
- [ ] Zero new test failures vs baseline
- [ ] Concurrency tests run ≥100× under load
- [ ] Performance and power measured, methodology documented
- [ ] Gaps tracked with owners

**Reviewed by:** <name> · **Date:** <date>
