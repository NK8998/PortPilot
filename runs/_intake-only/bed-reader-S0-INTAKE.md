# bed-reader - S0 intake findings

**Status:** screened, not started.
**Repository:** https://github.com/fastlmm/bed-reader
**Verdict:** good Windows ARM64 porting candidate.

## Evidence

- Active Rust/Python project using Maturin and PyO3.
- CI and PyPI publish Windows wheels only as `win_amd64`.
- CI already builds and tests macOS and Linux on AArch64, reducing source-level
  architecture risk.
- Static GitHub searches found no explicit x86 SIMD, `std::arch`, target-feature,
  or runtime CPU-detection code in the Rust source.
- NumPy 2.5.2 publishes `win_arm64` wheels for CPython 3.12-3.15, so the required
  Python dependency has a native path.

## Expected work

Add Windows ARM64 to the Maturin build matrix, validate all Rust dependencies
for `aarch64-pc-windows-msvc`, run the Python and Rust suites on native hardware,
inspect the generated `.pyd` PE header for `AA64`, and publish `win_arm64`
wheels. Python 3.10 and 3.11 may need reduced coverage because current NumPy
Windows ARM64 wheels begin at CPython 3.12.
