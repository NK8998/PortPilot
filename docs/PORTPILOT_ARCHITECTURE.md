# PortPilot Architecture

## System view

```mermaid
flowchart LR
    M["portpilot.yml<br/>application contract"]
    S["Pinned clean<br/>source checkout"]

    subgraph A["Analysis skills"]
        P["Repository profiler"]
        D["Dependency inventory"]
        C["Compatibility scanner"]
        X["Architecture selector"]
    end

    O["Planner and resumable<br/>task state machine"]

    subgraph E["Policy-constrained execution"]
        T["Toolchain probes"]
        B["CMake build adapters"]
        V["CTest and runtime parity"]
        PE["PE and wheel audit"]
        I["Source integrity"]
    end

    subgraph CI["Reusable GitHub Actions trust boundary"]
        W["Immutable workflow SHA"]
        BX["x64 baseline producer"]
        AR["Native Arm64 producer"]
        CC["Independent clean-install consumer"]
        W --> BX --> AR --> CC
    end

    R["Evidence bundle<br/>JSON, logs, artifacts"]
    G["Readiness report<br/>ready / conditional / not-ready"]

    M --> A
    S --> A
    P --> O
    D --> X
    C --> O
    X --> O
    O --> E
    E --> BX
    I --> R
    V --> R
    PE --> R
    CC --> R
    R --> G
```

## Application-specific versus reusable

| Application-specific input | Reusable PortPilot behavior |
|---|---|
| Source repository and immutable revision | Clean checkout, origin, revision, and mutation checks |
| Toolchain dependencies and probes | Allow-listed process execution and captured environment evidence |
| Baseline and target build commands | Manifest template expansion and phase isolation |
| Test suites and approved baseline failures | No-new-failures parity policy |
| Deterministic runtime scenarios | Normalized output assertions |
| Expected PE files and optional package | PE `Machine` verification and native wheel audit |
| Reviewed static-finding dispositions | Task completion and readiness gates |

PocketSphinx and whisper.cpp use different manifests and patches but the same
analysis engine, execution adapters, workflow, evidence layout, and reporting
rules.

## Trust boundaries

1. The manifest is schema-validated before use.
2. Source identity is pinned by origin and full commit SHA.
3. Commands are argument arrays; PortPilot does not invoke a shell.
4. Paths are containment-checked and PATH executables are allow-listed.
5. Resources, patches, tracked changes, and generated outputs are verified.
6. Cross-job state must match the trusted workflow manifest and project
   identity.
7. CI Python dependencies are version-pinned and SHA-256 verified.
8. A successful build does not clear static findings; terminal dispositions
   require rationale and evidence.

## Durable output

```text
runs/<run-id>/
  project.json
  inventory.json
  dependencies.json
  findings.json
  architecture-decision.json
  task-graph.json
  tasks/
  results/
  evidence/
  report.json
```

The artifact layout is stable across local runs, baseline jobs, native
producers, and clean-install consumers.
