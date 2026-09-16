---
name: arm64-qemu-verification
description: >-
  Boot Windows ARM64 WinPE under QEMU TCG on an x64 Windows/WSL host and run a
  cross-compiled ARM64 application for the S4 launch gate. Use when no physical
  ARM64 machine is available, qemu-system-aarch64 reaches a UEFI shell instead
  of Windows Setup, highmem=off reports 32-bit addressing errors, or attaching
  a vvfat share during firmware boot causes a synchronous exception. This is
  functional smoke evidence only, not S6 performance or power evidence.
---

# QEMU ARM64 Launch Verification

Use QEMU's full-system ARM64 emulation to close the **S4 functional launch
gate** when real ARM64 hardware is unavailable. The guest runs Windows ARM64;
the x64 host runs QEMU TCG.

This does **not** prove native-hardware performance, power, thermals, or timing.
Those remain S6 work on a real ARM64 machine.

## Preconditions

- x64 Windows host with WSL interoperability
- QEMU Windows x64 build containing:
  - `qemu-system-aarch64.exe`
  - `qemu-img.exe`
  - `share/edk2-aarch64-code.fd`
  - `share/edk2-arm-vars.fd`
- Windows ARM64 ISO from Microsoft, verified against Microsoft's published
  SHA-256
- ARM64 PE already gated as `AA64`

Never use an unverified ISO or treat a QEMU timing result as performance
evidence.

## Procedure

### 1. Configure and verify

```bash
export QEMU_ARM64_ISO=/mnt/c/path/to/windows-arm64.iso
export QEMU_ARM64_ISO_SHA256=<publisher-sha256>
./scripts/qemu.sh check
```

The accelerator list must contain `tcg`. On an x64 host this is CPU emulation,
not hardware virtualization.

### 2. Stage the application

```bash
./scripts/qemu.sh prepare build-arm64/app.exe --version
```

This creates an 80 GiB sparse QCOW2 disk, resets the UEFI variables, and stages
`app.exe` plus `qemu-smoke.cmd` in a host directory.

### 3. Boot WinPE

Start QEMU and leave it running:

```bash
./scripts/qemu.sh boot
```

From another shell:

```bash
./scripts/qemu.sh boot-key
```

`boot-key` resets the guest and injects Enter through the short "press any key
to boot from CD/DVD" window. Wait until Windows Setup appears.

### 4. Hot-plug the application

Only after Windows Setup is visible:

```bash
./scripts/qemu.sh attach
```

Do **not** attach the vvfat share during firmware boot. EDK2 can crash with a
black screen and `Synchronous Exception` while enumerating it.

### 5. Run the smoke test

In Windows Setup, press `Shift+F10`, then run:

```bat
for %d in (C D E F G H) do @if exist %d:\qemu-smoke.cmd call %d:\qemu-smoke.cmd
```

Required evidence:

```text
PROCESSOR_ARCHITECTURE=ARM64
<application reaches its known-good point>
APP_EXIT_CODE=0
```

For a CLI, version/help output is sufficient for S4. GUI applications must
reach their main window or first known-good log line.

### 6. Capture and stop

```bash
./scripts/qemu.sh capture runs/<run-id>/qemu-smoke.ppm
./scripts/qemu.sh stop
```

Copy the exact console output into the current run's retained evidence.

## What this proves

- Windows ARM64 booted successfully as the guest OS.
- The `AA64` application loaded and executed under Windows ARM64.
- The application reached the stated S4 known-good point.

## What this does not prove

- Native ARM64 hardware performance, power, battery, thermals, or timing
- Hardware/device integration parity
- Weak-memory reliability under real ARM64 silicon
- S6's native-versus-emulated performance comparison

Use `arm64-remote-verification` and real ARM64 hardware for those claims.

## Verification

- [ ] ISO checksum matches the publisher value
- [ ] QEMU reports the `tcg` accelerator
- [ ] Windows Setup reaches ARM64 WinPE
- [ ] Guest reports `PROCESSOR_ARCHITECTURE=ARM64`
- [ ] Application reaches a known-good point
- [ ] Application exits successfully, or remains responsive for a GUI smoke test
- [ ] Raw output and screenshot are stored in the current run directory

## Failure modes

| Symptom | Cause | Fix |
|---|---|---|
| `Addressing limited to 32 bits, but memory exceeds it` | `highmem=off` with more than the low-memory address space | Remove `highmem=off`; current QEMU/EDK2 boots Windows ARM64 with high memory |
| UEFI shell instead of Windows Setup | The ISO's keypress window was missed | Run `./scripts/qemu.sh boot-key` |
| Black screen with `Synchronous Exception` | vvfat USB attached while EDK2 was enumerating boot devices | Boot without it; run `./scripts/qemu.sh attach` only after Windows Setup appears |
| No QEMU window | QEMU exited before GTK opened | Read the QEMU stderr; check RAM, firmware, and drive arguments |
| App drive absent in WinPE | USB was not hot-plugged or assigned a different letter | Run `attach`, then use the drive-letter search command above |
| Smoke passes but S6 is still blocked | QEMU proves functional execution, not real-hardware characteristics | Run S6 on physical/cloud ARM64 hardware |

## References

- `scripts/qemu.sh`
- `.github/skills/arm64-build-environment/SKILL.md`
- `.github/skills/build-retarget/SKILL.md`
- `.github/skills/arm64-remote-verification/SKILL.md`
- <https://www.microsoft.com/software-download/windows11arm64>
- <https://www.qemu.org/docs/master/system/target-arm.html>
