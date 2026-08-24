# Hackathon Evidence: Before and After

## Latest reproducible proofs

| Application | Pinned revision | Hardened workflow proof |
|---|---|---|
| PocketSphinx 5.1.1 | `511126b492dcb267cf30d49d631946d7b61a9530` | [run 32714075611](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714075611) |
| whisper.cpp | `1fe009caeda75f69bc864d6370b10674e45a92bd` | [run 32714080799](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799) |

Both runs used commit `2999abf` of the same reusable workflow with hashed
Python dependencies.

## PocketSphinx

| Before PortPilot | After PortPilot |
|---|---|
| No maintained Windows Arm64 build/release path for the pinned revision | Native `windows-11-arm` producer passes |
| MSVC portability gaps in test helpers | Focused, reviewable portability patch |
| No native Arm64 wheel proof | `pocketsphinx-5.1.1-cp312-cp312-win_arm64.whl` |
| Architecture inferred from runner name | `pocketsphinx.exe` and `_pocketsphinx.pyd` independently verify as PE `0xAA64` |
| Windows baseline includes nine known failures | Arm64 has the same nine failures and **zero unexpected failures** |
| No independent installation proof | Fresh Arm64 consumer passes wheel install, 43 Python tests, and recognition |

Deterministic result:

```text
go forward ten meters
```

## whisper.cpp

| Before PortPilot | After PortPilot |
|---|---|
| No native Windows Arm64 job in the pinned upstream workflows | Same reusable producer passes on `windows-11-arm` |
| ggml rejects MSVC for its Arm backend | Target manifest selects Visual Studio `ClangCL` |
| Native configuration rewrites tracked JavaScript package metadata | Focused patch confines generation to Emscripten |
| Initial test resources were incomplete | Tiny and base English models are checksum-pinned |
| Initial transcript oracle referenced unrelated audio | JFK scenario uses deterministic normalized assertions |
| Architecture-specific source produced noisy static findings | All 25 findings have explicit source- and execution-backed dispositions |
| Native output architecture was unproven | `whisper-cli.exe` and `whisper.dll` verify as PE `0xAA64` |

Target result:

- CTest: passed, zero failures.
- JFK transcription scenario: passed.
- Source integrity: passed after configuration, build, tests, and runtime.
- Package consumer: intentionally not applicable because this manifest has no
  package contract.

## Reuse proof

| Reusable component | PocketSphinx | whisper.cpp |
|---|---:|---:|
| Manifest contract and schemas | yes | yes |
| Repository profiler and dependency inventory | yes | yes |
| Compatibility scanner and architecture selector | yes | yes |
| CMake/process adapters | yes | yes |
| x64 versus Arm64 parity policy | yes | yes |
| PE architecture verifier | yes | yes |
| Source-integrity gate | yes | yes |
| Reusable workflow and artifact layout | yes | yes |
| Native wheel audit and clean consumer | yes | not applicable |

The second application required no workflow fork. Its discoveries improved the
shared scanner and execution rules instead of creating whisper-only engine code.

## Honest readiness boundary

The raw CI artifacts deliberately retain open task state, so their test gate is
`passed` while the overall report is `not-ready`. Runtime success is not allowed
to auto-resolve static findings. The reviewed dispositions are recorded in
[whisper.cpp static finding dispositions](WHISPER_CPP_FINDING_DISPOSITIONS.md)
and can be applied through the guarded `portpilot finding` command.
