# whisper.cpp Static Finding Dispositions

## Scope

These dispositions apply to ggml-org/whisper.cpp revision
`1fe009caeda75f69bc864d6370b10674e45a92bd` and the PortPilot target defined in
`manifests/whisper-cpp/portpilot.yml`. They do not claim that architecture-
specific code is portable on every target. They record whether each scanner
finding affects this native Windows Arm64 build.

Runtime evidence is public
[GitHub Actions run 32714080799](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32714080799).
That run built with `ClangCL` and `ARM64`, passed CTest and deterministic JFK
transcription, verified `whisper-cli.exe` and `whisper.dll` as PE `0xAA64`, and
passed source-integrity checks.

## Dispositions

| ID | Location | Status | Rationale and evidence |
|---|---|---|---|
| `PP-WHISPER-CPP-001` | `CMakeLists.txt:30` | resolved | PortPilot patch `0001-limit-javascript-package-generation-to-emscripten.patch` confines JavaScript package generation to Emscripten. The target run passed post-command source integrity. |
| `PP-WHISPER-CPP-002` | `ggml-cpu/amx/mmq.cpp:264` | not-applicable | The AMX implementation is enclosed by `__AMX_INT8__ && __AVX512VNNI__`; neither macro is selected for Arm64. |
| `PP-WHISPER-CPP-003` | `arch/loongarch/quants.c:28` | not-applicable | CMake adds this source only for `GGML_SYSTEM_ARCH=loongarch64`; the implementation is also guarded by `__loongarch_sx`. |
| `PP-WHISPER-CPP-004` | `arch/x86/cpu-feats.cpp:3` | not-applicable | The file is part of the x86 backend feature detector and its implementation is enclosed by an x86/AMD64 preprocessor guard. |
| `PP-WHISPER-CPP-005` | `arch/x86/quants.c:26` | not-applicable | CMake adds this file only in the `GGML_SYSTEM_ARCH=x86` branch, and the reported macro uses x86 intrinsics. |
| `PP-WHISPER-CPP-006` | `arch/x86/repack.cpp:30` | not-applicable | CMake adds this file only for x86; the reported macro is inside AVX/F16C feature guards. |
| `PP-WHISPER-CPP-007` | `ggml-cpu/arch-fallback.h:84` | not-applicable | The reported x86 selector follows a distinct Arm/Arm64 branch in the same architecture dispatch chain. |
| `PP-WHISPER-CPP-008` | `ggml-cpu/CMakeLists.txt:106` | resolved | The target-only configure command selects `-T ClangCL`, satisfying ggml's explicit Arm compiler requirement. |
| `PP-WHISPER-CPP-009` | `ggml-cpu/ggml-cpu-impl.h:41` | not-applicable | The cast macro is consumed by AVX-512 code paths; under ClangCL/MSVC it reduces to its input. The native target compiled this header successfully. |
| `PP-WHISPER-CPP-010` | `ggml-cpu/ggml-cpu.c:462` | not-applicable | `_mm_pause()` is defined only in the x86/AMD64 lock branch; the non-x86 branch uses `UNUSED`. |
| `PP-WHISPER-CPP-011` | `ggml-cpu/ggml-cpu.c:461` | not-applicable | The reported architecture guard intentionally selects the x86 lock implementation and has an explicit non-x86 alternative. |
| `PP-WHISPER-CPP-012` | `llamafile/sgemm.cpp:76` | not-applicable | `GGML_LLAMAFILE` defaults off, so CMake does not add this source. Its x86 operations are additionally feature-guarded. |
| `PP-WHISPER-CPP-013` | `ggml-cpu/simd-mappings.h:58` | not-applicable | The reported conversion macro is inside the `__F16C__` branch; the same header selects Arm NEON first on this target. |
| `PP-WHISPER-CPP-014` | `ggml-cpu/simd-mappings.h:74` | not-applicable | The inline assembly is inside the `__POWER9_VECTOR__` branch and is excluded on Arm64. |
| `PP-WHISPER-CPP-015` | `ggml-cpu/vec.cpp:149` | not-applicable | The reported type is under `__AVX512BF16__`; Arm and scalar alternatives remain available. |
| `PP-WHISPER-CPP-016` | `ggml-cpu/vec.h:93` | not-applicable | The intrinsic loop is under `__AVX2__` and falls back to the portable scalar loop. |
| `PP-WHISPER-CPP-017` | `ggml-et/et-kernels/src/crt.S:1` | not-applicable | `GGML_ET` defaults off. If enabled, this file is explicitly cross-compiled as a RISC-V device kernel rather than host Arm64 code. |
| `PP-WHISPER-CPP-018` | `ggml-et/et-kernels/src/memops.c:32` | not-applicable | The optional ET backend defaults off and its device kernels use the scoped RISC-V toolchain. |
| `PP-WHISPER-CPP-019` | `ggml-et/et-kernels/src/rwkv_wkv7_f32.c:101` | not-applicable | The optional ET backend defaults off and its device kernels use the scoped RISC-V toolchain. |
| `PP-WHISPER-CPP-020` | `ggml/src/ggml-quants.c:5447` | not-applicable | The reported load is under `__AVX2__`; the following branch implements the Arm NEON path. |
| `PP-WHISPER-CPP-021` | `ggml-vulkan/ggml-vulkan.cpp:78` | not-applicable | Vulkan defaults off, and the reported pause macro is in the x86 branch; the same dispatch defines an Arm yield path. |
| `PP-WHISPER-CPP-022` | `ggml-vulkan/ggml-vulkan.cpp:76` | not-applicable | The guard intentionally selects the x86 yield implementation and is followed by an Arm/Arm64 alternative. |
| `PP-WHISPER-CPP-023` | `ggml/src/ggml.c:77` | not-applicable | The cast macro supports AVX-512 conversion code; the reported use is feature-guarded and the Arm64 target compiled successfully. |
| `PP-WHISPER-CPP-024` | `.github/workflows/build-windows.yml:1` | resolved | PortPilot's reusable workflow supplies the missing x64 baseline and native Windows Arm64 producer without modifying the pinned application source. |
| `PP-WHISPER-CPP-025` | `.github/workflows/release.yml:1` | resolved | The reusable workflow produced retained native Arm64 application evidence in the public proof run. whisper.cpp has no package contract, so no release consumer is claimed. |

No finding is silently cleared by the successful build. Each terminal status has
an explicit rationale and concrete source, manifest, patch, or runtime evidence.
