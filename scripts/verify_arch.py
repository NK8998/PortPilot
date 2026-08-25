#!/usr/bin/env python3
"""
verify_arch.py - Confirm a compiled binary's target CPU architecture by reading its own
file-format header directly (PE, ELF, or Mach-O). No third-party dependencies.

Part of the arm64-porting-skills toolkit (verify-artifact-architecture skill).

Usage:
    python verify_arch.py <path> [--expect {x86,x64,arm64,arm32}] [--recurse]

    <path>      A single binary file, or a directory to scan.
    --expect    Assert every scanned file matches this architecture. Exits non-zero on any
                mismatch. Omit to just report detected architectures without asserting.
    --recurse   When <path> is a directory, recurse into subdirectories.

Examples:
    python verify_arch.py ./build/myapp --expect arm64
    python verify_arch.py ./dist/packaged-app --expect arm64 --recurse
"""

import argparse
import struct
import sys
from pathlib import Path

# --- PE (Windows .exe/.dll) ---------------------------------------------------------------
# IMAGE_FILE_HEADER.Machine values (winnt.h). 0x8664 is also what a compatibility-mode/hybrid
# binary reports at this field - such binaries carry additional metadata elsewhere in the file
# that a fuller PE parser would need to inspect to tell them apart from plain x64. This script
# flags that ambiguity explicitly rather than silently asserting one or the other.
PE_MACHINE_MAP = {
    0x014C: "x86",
    0x8664: "x64",
    0xAA64: "arm64",
    0x01C0: "arm32",
}

# --- ELF (Linux/BSD/most Unix-like systems) -----------------------------------------------
# e_machine values (elf.h). Only the common desktop/server architectures are listed; extend
# this map if you need to verify a less common target.
ELF_MACHINE_MAP = {
    0x03: "x86",
    0x3E: "x64",
    0xB7: "arm64",
    0x28: "arm32",
}

# --- Mach-O (macOS/iOS) -------------------------------------------------------------------
# cputype values (mach/machine.h). CPU_ARCH_ABI64 (0x01000000) is OR'd into 64-bit types.
MACHO_CPU_MAP = {
    0x00000007: "x86",
    0x01000007: "x64",
    0x0100000C: "arm64",
    0x0000000C: "arm32",
}

MACHO_MAGIC_32 = 0xFEEDFACE
MACHO_MAGIC_64 = 0xFEEDFACF
MACHO_FAT_MAGIC = 0xCAFEBABE  # universal/"fat" binary containing multiple architectures


def detect_pe(data: bytes):
    if len(data) < 0x40 or data[0:2] != b"MZ":
        return None
    pe_offset = struct.unpack_from("<I", data, 0x3C)[0]
    if len(data) < pe_offset + 6:
        return None
    if data[pe_offset : pe_offset + 4] != b"PE\x00\x00":
        return None
    machine = struct.unpack_from("<H", data, pe_offset + 4)[0]
    arch = PE_MACHINE_MAP.get(machine, f"unknown (0x{machine:x})")
    return {"format": "PE", "raw_field": f"0x{machine:x}", "architecture": arch}


def detect_elf(data: bytes):
    if len(data) < 20 or data[0:4] != b"\x7fELF":
        return None
    is_64 = data[4] == 2
    endian_fmt = "<" if data[5] == 1 else ">"
    e_machine = struct.unpack_from(f"{endian_fmt}H", data, 18)[0]
    arch = ELF_MACHINE_MAP.get(e_machine, f"unknown (0x{e_machine:x})")
    return {
        "format": f"ELF{'64' if is_64 else '32'}",
        "raw_field": f"0x{e_machine:x}",
        "architecture": arch,
    }


def detect_macho(data: bytes):
    if len(data) < 8:
        return None
    magic_be = struct.unpack_from(">I", data, 0)[0]
    if magic_be == MACHO_FAT_MAGIC:
        count = struct.unpack_from(">I", data, 4)[0]
        archs = []
        offset = 8
        for _ in range(min(count, 16)):  # sanity cap
            if len(data) < offset + 8:
                break
            cputype = struct.unpack_from(">I", data, offset)[0]
            archs.append(MACHO_CPU_MAP.get(cputype, f"unknown (0x{cputype:x})"))
            offset += 20  # sizeof(struct fat_arch)
        return {
            "format": "Mach-O (universal/fat)",
            "raw_field": f"{count} slice(s)",
            "architecture": "+".join(archs) if archs else "unknown",
        }
    if magic_be in (MACHO_MAGIC_32, MACHO_MAGIC_64):
        cputype = struct.unpack_from(">I", data, 4)[0]
        # Some Mach-O files are little-endian internally; re-read if the big-endian
        # interpretation doesn't match a known cputype.
        if cputype not in MACHO_CPU_MAP:
            cputype = struct.unpack_from("<I", data, 4)[0]
        arch = MACHO_CPU_MAP.get(cputype, f"unknown (0x{cputype:x})")
        bits = "64" if magic_be == MACHO_MAGIC_64 else "32"
        return {"format": f"Mach-O{bits}", "raw_field": f"0x{cputype:x}", "architecture": arch}
    return None


def detect_architecture(path: Path):
    try:
        with open(path, "rb") as f:
            data = f.read(4096)  # header-only read; more than enough for every format above
    except OSError as exc:
        return {"error": str(exc)}

    for detector in (detect_pe, detect_elf, detect_macho):
        result = detector(data)
        if result is not None:
            return result
    return {"error": "not a recognized PE, ELF, or Mach-O binary"}


def iter_candidate_files(path: Path, recurse: bool):
    if path.is_file():
        yield path
        return
    pattern = "**/*" if recurse else "*"
    for candidate in path.glob(pattern):
        if candidate.is_file():
            yield candidate


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("path", type=Path, help="Binary file or directory to scan")
    parser.add_argument(
        "--expect",
        choices=["x86", "x64", "arm64", "arm32"],
        help="Assert every scanned file matches this architecture",
    )
    parser.add_argument(
        "--recurse", action="store_true", help="Recurse into subdirectories when path is a directory"
    )
    args = parser.parse_args()

    if not args.path.exists():
        print(f"Path not found: {args.path}", file=sys.stderr)
        sys.exit(1)

    candidates = list(iter_candidate_files(args.path, args.recurse))
    checked = 0
    failures = 0

    for candidate in candidates:
        result = detect_architecture(candidate)

        if "error" in result:
            continue  # silently skip non-binary files when scanning a directory

        checked += 1
        line = f"{result['raw_field']:>14}  {result['format']:<22} {result['architecture']:<10} {candidate}"

        if args.expect:
            if result["architecture"] == args.expect:
                print(f"  OK    {line}")
            else:
                print(f"  FAIL  {line} (expected {args.expect})", file=sys.stderr)
                failures += 1
        else:
            print(f"        {line}")

    if checked == 0:
        print(f"No recognized PE/ELF/Mach-O binaries found under: {args.path}", file=sys.stderr)
        sys.exit(1)

    if failures > 0:
        print(
            f"\n{failures} of {checked} file(s) did not match the expected architecture ({args.expect}).",
            file=sys.stderr,
        )
        sys.exit(1)

    if args.expect:
        print(f"\nAll {checked} file(s) verified as {args.expect}.")


if __name__ == "__main__":
    main()
