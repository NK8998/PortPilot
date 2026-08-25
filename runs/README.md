# Runs

One directory per real port run: `runs/<app>-<yyyy-mm-dd>/`.

This is the **evidence trail**. Every artifact an orchestrated run produces lands here, which
is what lets anyone reconstruct what the toolchain decided and why.

```
runs/<app>-<date>/
  run.json           orchestration state + stage history (owned by the orchestrator)
  handoff.json       immutable cross-session source/evidence provenance, when applicable
  candidates.json    from repo-discovery, if the target came from a search
  analysis.json      from port-analysis
  plan.json          from port-analysis; port-migration updates task status in place
  build.json         from port-migration - the real Arm64 build result
  runtime.json       from port-migration - does it actually launch and work
  purity.json        from winport-scan, run by the orchestrator
  review.json        from port-review - carries the PASS/REVISE/FAIL verdict
  release.json       candidate/readiness/publication evidence from port-packaging
  PORT-REPORT.md     the human-readable summary with before/after metrics
  transcripts/       raw agent session logs
```

## Validating a run

```powershell
node contracts/validate.js runs/<app>-<date>
```

## `example-2026-08-14/`

An illustrative run against a fictional GTK4 + Rust app. It is not a real port — it exists so
that anyone writing an agent or skill can see exactly what each artifact must contain, and how
a `REVISE` verdict routes back to migration rather than analysis.

It deliberately shows a **failing** run: the purity gate catches a vendored `libnum.x64.dll`
that survived the port, and review also catches a functional regression (recursive file
watching silently dropped). Both are the failure modes the toolchain exists to prevent, so the
example is more useful failing than passing.
