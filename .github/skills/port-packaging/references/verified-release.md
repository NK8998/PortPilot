# Verified GitHub Release

## Candidate gate

- Source commit is immutable and available.
- Full ARM64 Release build and tests passed.
- Native Windows ARM64 runtime fixture passed.
- Staging tree was assembled from an allowlist and scanned strictly.
- ZIP was re-expanded, manifested, and scanned again.
- SHA-256 and dependency/license inventory were generated from the final bytes.

## Publication gate

Publish from a protected tag/manual workflow, never from a pull request. Grant only
`contents: write`. Use a fixed package name when a latest-download alias is required, while also
recording the immutable version URL.

After publication, download the release assets over HTTPS, verify `SHA256SUMS.txt`, expand into a
fresh directory, repeat the PE scan, and run the native ARM64 smoke against those downloaded
bytes. Only then set `release.json` to `published`.

For OpenCppCoverage, retain GPL-3.0 license material and make the corresponding port source
available in the release repository.

## What a purity scan cannot prove

A package can be fully architecture-pure, fully manifested, and correctly checksummed and still
be unrunnable. Two defects from the OpenCppCoverage ARM64 release passed every static check:

1. **A foreign image inside a vendor redistributable.**
   `VC\Redist\MSVC\14.44.35112\arm64\Microsoft.VC143.CRT\vcruntime140_1.dll` is machine `0x8664`.
   Copying that directory by glob puts an x64 DLL into an ARM64 package. Filter redistributables
   by PE machine, assert that the required runtime DLLs such as `vcruntime140.dll` and
   `msvcp140.dll` survived the filter, and write a `crt-manifest.json` recording both the staged
   and the rejected files so the omission is auditable instead of silent. Dropping a
   redistributable is only safe because the packaged end-to-end run proves nothing imports it.

2. **A required directory that compression discarded.**
   `OpenCppCoverage.cpp::GetPluginsExportFolder` enumerates `Plugins\Exporter` at startup, so a
   package without that directory dies with
   `directory_iterator: The system cannot find the path specified`. A ZIP archive cannot store an
   empty directory, so the directory needs a placeholder file to survive. Every package before
   `e74bc2f7`, including a previously green x64 one, was unrunnable for this reason.

Neither defect is visible to a PE scan, a file manifest, or a checksum, because all three describe
bytes that are present rather than behaviour that is missing. Give the packaged artifact its own
end-to-end gate, separate from the build-output one, and treat the build-output run as
insufficient evidence for the package.

A packaging script may delegate that gate to its caller, but only if it surfaces the expanded
path; a script that re-expands, scans, and discards the location leaves no way to run the gate.

## The scanner is a gate, so it is also a suspect

A fail-closed purity scanner can be wrong in the safe direction and still block every correct
release. `winport-scan` rejected the verified native ARM64 package at `arm64-81376ba`: it reported
eight `VIOLATION` entries for `concrt140.dll`, `msvcp140*.dll` and `vcruntime140*.dll` with
`PE data directory points to malformed data`. All eight are genuine Arm64X images.

Cause: the CHPE code-map validator required each `[rva, rva + length)` range to sit inside a single
section's `SizeOfRawData`. An Arm64X x64 range does not. In `vcruntime140.dll`, `map[2]`
(`type=2 rva=0x021000 len=0x001480`) starts in the tail of `.text` and ends inside the `.hexpthk`
thunk section at `0x022000`. Two properties of real images make the naive check fail:

- A code range may span **adjacent sections**.
- A section's mapped extent is `max(VirtualSize, SizeOfRawData)` rounded up to `SectionAlignment`
  (optional-header offset 32, same place for PE32 and PE32+). `.text` ends raw at `0x21E00` while
  `.hexpthk` begins at `0x22000`; without the rounding the range looks discontiguous.

Relaxing this must not open the gate. Coverage still has to start inside a real section and remain
contiguous to the end of the range, so a range running past the last section is still rejected.
Both directions belong in the test suite, and the positive case must be shown to fail against the
previous implementation — otherwise it is not a regression test, only a passing one.

Two lessons generalise beyond this bug:

1. **Validate the validator against real binaries before trusting a rejection.** The correct
   response to a purity failure on an artifact you believe is good is to reproduce the finding
   with an independent parser, not to assume the artifact is bad. Here `System.Reflection.
   PortableExecutable.PEReader` gave the right answer immediately while two hand-rolled PowerShell
   probes gave wrong ones — one used CHPE offset `0x98` instead of `0xC8`, another read
   `IMAGE_SECTION_HEADER` fields shifted by one field. Prefer a real PE parser over byte math.
2. **A gate written so that it cannot fail is worse than no gate.** While reconstructing the old
   behaviour for the regression test, comparing the helper's `long?` result with `< 0` compiled
   cleanly and was always false, so the check silently accepted everything. Assert that a gate
   rejects a known-bad input, not merely that it accepts a known-good one.
## A passing runtime test needs a failing one beside it

Executing the shipped binary on the target architecture and watching it succeed is necessary but
not sufficient. A green run on ARM64 hardware cannot distinguish a genuine ARM64 package from an
x64 package that ran there under emulation, nor from a fat binary. The positive result only becomes
evidence when it is paired with a negative control: download the same asset onto a foreign-architecture
runner and require that the very same executable *refuses to start*.

Run both from one workflow so they cannot drift apart, and make each direction fail loudly:

- positive, on the target: checksum, PE scan, then execute and assert the produced output is correct
- negative, on the foreign host: same checksum, confirm the image's machine is the target's, then
  attempt to start it and require the start to fail

Measured on the published ARM64 package across three runner families in one run: `windows-11-arm`
executed it with `CoverageExitCode=0` and a correct report, while `windows-2022` and `windows-latest`
both reported `Started=False` and refused it.

### Assert on the set of rejection codes, not one of them

Windows has two distinct refusals for an image whose machine type the host cannot execute:

| Code | Name | Message |
|---|---|---|
| 193 | `ERROR_BAD_EXE_FORMAT` | not a valid Win32 application |
| 216 | `ERROR_EXE_MACHINE_TYPE_MISMATCH` | not a valid application for this OS platform |

Which one surfaces depends on the OS version. A control hard-coded to 193 fails on current Windows,
which returns 216 — that is how this control first failed here, against a package that was behaving
exactly as intended. Accept either, and keep rejecting everything else: a 2 (file not found) or 5
(access denied) means the architecture was never exercised, so it must not be counted as a pass.
The check that the process did *not* start stays absolute and separate from the code check.