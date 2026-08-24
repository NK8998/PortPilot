# PortPilot Reliability and Review

## Finding disposition gate

Static findings remain open after a successful build. A remediation task cannot
transition to `done` until every linked finding has one of these terminal
statuses:

- `resolved`
- `not-applicable`
- `accepted`
- `wont-fix`

Every terminal disposition requires a rationale and at least one evidence
reference. Accepted and wont-fix findings remain visible as risks and produce a
`conditionally-ready` verdict. Resolved and not-applicable findings do not.

Example:

```powershell
portpilot finding `
  --run-directory runs\whisper-cpp-ci `
  --id PP-WHISPER-CPP-008 `
  --set-status not-applicable `
  --rationale "The x86 pause branch is excluded; AArch64 uses yield." `
  --evidence "ggml/src/ggml-cpu/ggml-cpu.c:520-532" `
  --evidence "target-summary.json"
```

To revise a terminal disposition, first return it to `in-progress`. Every
finding update invalidates the previous report.

## Scanner precision

The CMake source-tree generation rule supports multiline `configure_file`
calls. CMake comments are excluded from both multiline and line-oriented rules.
Negative fixtures cover commented compiler restrictions and binary-tree output.
Architecture-specific findings still require review rather than unsafe
automatic suppression.

## Recovery

Command timeouts persist a `timeout` result with exit code `124`. Re-execution
replaces the result and capture files, so stale timeout evidence cannot survive
a successful retry. Phase summaries and reports are invalidated before failed
re-execution attempts.

## CI supply-chain boundary

`requirements-ci.lock` pins the Python 3.12 Linux x64 metadata and Windows x64
and Arm64 CI dependency set with SHA-256 hashes. Every reusable-workflow job installs it with
`--require-hashes`, then installs PortPilot with dependency and build isolation
disabled. PocketSphinx wheel production names the pinned local checkout
explicitly and uses the already verified build dependencies. Clean installation
uses `--no-deps`; test tooling comes from the same lock.

Application source revisions, downloaded resources, patches, PE outputs, wheel
contents, run state, and cross-job manifest identity retain their existing
verification gates.

## Review result

The H7 security review identified mutable Python package resolution in CI.
Hashed dependency installation and explicit local PocketSphinx wheel input close
that issue. The whisper.cpp static review records all 20 findings in
[whisper.cpp static finding dispositions](WHISPER_CPP_FINDING_DISPOSITIONS.md).

The hardened workflow passed end to end for both reference applications:

- [PocketSphinx run 32714075611](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611):
  x64 baseline, native Arm64 producer, audited wheel, and independent clean
  install all passed.
- [whisper.cpp run 32714080799](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799):
  x64 baseline and native Arm64 producer passed; the package consumer was
  correctly skipped because the manifest has no package contract.
