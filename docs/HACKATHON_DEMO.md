# PortPilot Hackathon Demo

## One-line story

PortPilot turns a pinned CMake repository and one manifest into an auditable x64
baseline, native Windows Arm64 build, runtime proof, package proof when
applicable, and honest readiness report.

## Five-to-seven-minute run of show

| Time | Screen | Narration |
|---|---|---|
| 0:00-0:40 | `README.md` | Windows Arm ports fail in different places: dependencies, compiler assumptions, tests, packaging, or CI. A successful compile alone is not proof. |
| 0:40-1:20 | `manifests/whisper-cpp/portpilot.yml` | The application-specific input is declarative: pinned source, tools, baseline, Arm64 target, tests, runtime oracle, and expected PE files. |
| 1:20-2:05 | [architecture](PORTPILOT_ARCHITECTURE.md) | Four reusable layers analyze, plan, execute, and report. The CI handoff separates x64 baseline, native producer, and clean consumer. |
| 2:05-2:45 | Run `scripts\demo.ps1` | Contracts and tests prove the engine, schemas, command safety, retry behavior, and trust gates. |
| 2:45-3:45 | [PocketSphinx run 32714075611](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611) | Show the Arm64 producer and clean consumer. The executable and Python extension are `0xAA64`; nine baseline failures remain nine; clean install recognizes “go forward ten meters.” |
| 3:45-4:50 | [whisper.cpp run 32714080799](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799) | The identical workflow builds with ClangCL, passes CTest, transcribes JFK, and verifies the CLI and DLL as `0xAA64`. No whisper-specific workflow exists. |
| 4:50-5:40 | [before and after](HACKATHON_EVIDENCE.md) | Contrast the two applications and highlight reused skills. Different ports produced shared improvements: compiler-restriction and source-mutation scanning. |
| 5:40-6:20 | [finding dispositions](WHISPER_CPP_FINDING_DISPOSITIONS.md) | PortPilot stays honest: passing runtime gates do not erase static findings. Each finding needs rationale and evidence; accepted risks become conditional readiness. |
| 6:20-6:40 | `README.md` | Close: one manifest, two real applications, native proof, reusable automation, and an audit trail. |

## Presenter commands

From the repository root:

```powershell
pwsh -File scripts\demo.ps1
```

To open the two public proof runs after local validation:

```powershell
pwsh -File scripts\demo.ps1 -SkipTests -OpenProofs
```

## Tabs to prepare

1. `manifests/whisper-cpp/portpilot.yml`
2. [PortPilot architecture](PORTPILOT_ARCHITECTURE.md)
3. [PocketSphinx proof run](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611)
4. [whisper.cpp proof run](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799)
5. [Before-and-after evidence](HACKATHON_EVIDENCE.md)
6. [Static finding dispositions](WHISPER_CPP_FINDING_DISPOSITIONS.md)

## Demo success checks

- State that the host laptop does not need to be Arm64; native proof runs on
  GitHub's `windows-11-arm` runner.
- Show job conclusions, not only the workflow's green summary.
- Show at least one PE `0xAA64` record and one deterministic runtime result.
- Explain why PocketSphinx has a clean consumer and whisper.cpp does not.
- Do not call the raw report `ready` while task dispositions remain unapplied.
- Finish within seven minutes.

The offline and recording fallback is in
[Hackathon Recording and Offline Fallback](HACKATHON_FALLBACK.md).
