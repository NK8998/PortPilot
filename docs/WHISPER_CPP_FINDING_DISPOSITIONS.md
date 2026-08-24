# whisper.cpp Static Finding Dispositions

## Scope

These dispositions apply to ggml-org/whisper.cpp revision
`1fe009caeda75f69bc864d6370b10674e45a92bd` and the PortPilot target defined in
`manifests/whisper-cpp/portpilot.yml`. They do not claim that architecture-
specific code is portable on every target. They record whether each scanner
finding affects this native Windows Arm64 build.

Runtime evidence is public
[GitHub Actions run 32389275726](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/actions/runs/32389275726).
That run built with `ClangCL` and `ARM64`, passed CTest and deterministic JFK
transcription, verified `whisper-cli.exe` and `whisper.dll` as PE `0xAA64`, and
passed source-integrity checks.

## Dispositions

| ID | Location | Status | Rationale and evidence |
|---|---|---|---|
| `PP-WHISPER-CPP-001` | `CMakeLists.txt:30` | resolved | PortPilot patch `0001-limit-javascript-package-generation-to-emscripten.patch` confines JavaScript package generation to Emscripten. The target run passed post-command source integrity. |
| `PP-WHISPER-CPP-002` | `ggml-cpu/amx/mmq.cpp:264` | not-applicable | The AMX implementation is enclosed by `__AMX_INT8__ && __AVX512VNNI__`; neither macro is selected for Arm64. |
| `PP-WHISPER-CPP-003` | `arch/loongarch/quants.c:28` | not-applicable | CMake adds this source only for `GGML_SYSTEM_ARCH=loongarch64`; the implementation is also guarded by `__loongarch_sx`. |
| `PP-WHISPER-CPP-004` | `arch/x86/quants.c:30` | not-applicable | CMake adds the file only in the `GGML_SYSTEM_ARCH=x86` branch, and its intrinsic block is guarded by x86 feature macros. |
| `PP-WHISPER-CPP-005` | `arch/x86/repack.cpp:39` | not-applicable | CMake adds the file only for x86; the reported intrinsic is under `__AVX__` and `__AVX512F__` guards. |
| `PP-WHISPER-CPP-006` | `ggml-cpu/CMakeLists.txt:106` | resolved | The target-only configure command selects `-T ClangCL`, satisfying ggml's explicit Arm compiler requirement. |
| `PP-WHISPER-CPP-007` | `ggml-cpu/ggml-cpu-impl.h:518` | not-applicable | The reported vector type is inside `#if defined(__loongarch_sx)`. |
| `PP-WHISPER-CPP-008` | `ggml-cpu/ggml-cpu.c:525` | not-applicable | `_mm_pause()` is in the `__x86_64__` branch. The Arm64 branch uses the AArch64 `yield` instruction. |
| `PP-WHISPER-CPP-009` | `llamafile/sgemm.cpp:88` | not-applicable | `GGML_LLAMAFILE` defaults off, so CMake does not add this source. Its x86 operations are additionally feature-guarded. |
| `PP-WHISPER-CPP-010` | `ggml-cpu/simd-mappings.h:466` | not-applicable | The reported AVX-512 macro is in the `__AVX512F__` branch; the same header has a separate Arm NEON mapping. |
| `PP-WHISPER-CPP-011` | `ggml-cpu/simd-mappings.h:74` | not-applicable | The inline assembly is inside the `__POWER9_VECTOR__` branch and is excluded on Arm64. |
| `PP-WHISPER-CPP-012` | `ggml-cpu/vec.cpp:149` | not-applicable | The reported type is under `__AVX512BF16__`; Arm and scalar alternatives remain available. |
| `PP-WHISPER-CPP-013` | `ggml-cpu/vec.h:93` | not-applicable | The intrinsic loop is under `__AVX2__` and falls back to the portable scalar loop. |
| `PP-WHISPER-CPP-014` | `ggml-et/et-kernels/src/crt.S:1` | not-applicable | `GGML_ET` defaults off. If enabled, this file is explicitly cross-compiled as a RISC-V device kernel rather than host Arm64 code. |
| `PP-WHISPER-CPP-015` | `ggml-et/et-kernels/src/memops.c:32` | not-applicable | The optional ET backend defaults off and its device kernels use the scoped RISC-V toolchain. |
| `PP-WHISPER-CPP-016` | `ggml-et/et-kernels/src/rwkv_wkv7_f32.c:101` | not-applicable | The optional ET backend defaults off and its device kernels use the scoped RISC-V toolchain. |
| `PP-WHISPER-CPP-017` | `ggml/src/ggml-quants.c:5447` | not-applicable | The reported load is under `__AVX2__`; the following branch implements the Arm NEON path. |
| `PP-WHISPER-CPP-018` | `ggml/src/ggml.c:499` | not-applicable | The reported store is under `__AVX512BF16__` and the function retains its scalar fallback. |
| `PP-WHISPER-CPP-019` | `.github/workflows/build-windows.yml:1` | resolved | PortPilot's reusable workflow supplies the missing x64 baseline and native Windows Arm64 producer without modifying the pinned application source. |
| `PP-WHISPER-CPP-020` | `.github/workflows/release.yml:1` | resolved | The reusable workflow produced retained native Arm64 application evidence in the public proof run. whisper.cpp has no package contract, so no release consumer is claimed. |

No finding is silently cleared by the successful build. Each terminal status has
an explicit rationale and concrete source, manifest, patch, or runtime evidence.
