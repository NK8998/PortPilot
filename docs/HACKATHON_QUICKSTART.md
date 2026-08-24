# PortPilot Quickstart

## What a new user supplies

1. A public or accessible Git repository.
2. A full 40-character source revision.
3. A PortPilot manifest describing the toolchain, x64 baseline, Arm64 target,
   tests, runtime scenario, expected PE files, and optional package.

Start from either reference:

- `manifests/pocketsphinx/portpilot.yml` for a CMake project with a native
  Python wheel.
- `manifests/whisper-cpp/portpilot.yml` for a native executable and DLL.

## Local analysis

Use Python 3.12 and a clean checkout at the exact manifest revision:

```powershell
python -m pip install -e .

portpilot run `
  --manifest manifests\whisper-cpp\portpilot.yml `
  --repository C:\src\whisper.cpp `
  --runs-directory runs `
  --run-id whisper-review

portpilot status --run-directory runs\whisper-review
portpilot report --run-directory runs\whisper-review
```

This produces inventory, dependency, finding, architecture, task, and report
JSON without pretending that implementation is complete.

## Native cloud execution

Call the reusable workflow from a repository that can read PortPilot:

```yaml
jobs:
  windows-arm:
    uses: t-jekasiba_microsoft/PortPilot/.github/workflows/portpilot.yml@<commit>
    with:
      manifest_path: manifests/my-project/portpilot.yml
```

Pin `<commit>` to a reviewed PortPilot SHA. The workflow performs:

1. trusted manifest metadata;
2. x64 baseline;
3. native Windows Arm64 build and validation;
4. PE and optional wheel audit;
5. independent clean installation when a package contract exists.

## Review findings

Successful tests do not close findings. Record each reviewed disposition:

```powershell
portpilot finding `
  --run-directory runs\whisper-review `
  --id PP-WHISPER-CPP-010 `
  --set-status not-applicable `
  --rationale "The pause intrinsic is confined to the x86 lock branch." `
  --evidence "ggml/src/ggml-cpu/ggml-cpu.c:461-465" `
  --evidence "evidence/target-summary.json"
```

Linked tasks cannot complete until all findings have terminal, evidence-backed
dispositions. Accepted risks produce `conditionally-ready`, not `ready`.

## Read the result

Check these artifact records first:

- `run/evidence/baseline-summary.json`
- `run/evidence/target-summary.json`
- `run/evidence/architecture.json`
- `run/evidence/package/clean-install.json`, when applicable
- `run/report.json`

## Current boundaries

PortPilot currently targets CMake-based C/C++ projects, optional Python wheels,
GitHub Actions, and Windows x64/Arm64. GUI installers, arbitrary build systems,
automatic upstream pull requests, and production hosting are deferred.
