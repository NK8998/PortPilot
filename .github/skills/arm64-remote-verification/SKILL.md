---
name: arm64-remote-verification
description: Proves a Windows ARM64 build runs natively on real ARM64 hardware using the PortPilot Azure VM helper. Use for S6 runtime, no-emulation, and parity evidence when local x64 hardware cannot execute ARM64 binaries.
---

# ARM64 remote verification

Use this skill when a Windows ARM64 build must be executed on real hardware.
Cross-compiling on an x64 dev box is fine. QEMU TCG can provide a limited S4
functional launch check, but real ARM64 hardware is required for S6
non-emulation, performance, power, device, timing, and weak-memory evidence.

Use `arm64-artifact-verification` for static PE checks,
`arm64-ci-integration` for hosted `windows-11-arm` automation, and
`arm64-failure-diagnosis` when target-only failures appear.

## Helper script

The helper now lives at:

```bash
/home/t-neilkainga/hackathon/.consolidated/scripts/vm.sh
```

For examples below:

```bash
VM=/home/t-neilkainga/hackathon/.consolidated/scripts/vm.sh
```

If hardware is unavailable and only the S4 startup gate is open, use
`arm64-qemu-verification`. Do not use QEMU results for S6 non-emulation,
performance, power, device, timing, or weak-memory claims.

Implemented subcommands:

| Command | Purpose |
|---|---|
| `keygen [path]` | Create/reuse an Ed25519 key and print a VM-side RDP install script. |
| `init <vm-name>` | Discover Azure VM settings and write `scripts/vm.env`. |
| `bootstrap` | Enable Windows OpenSSH Server through Azure Run Command. |
| `connect` | Open an SSH master connection; password auth is cached for 8 hours. |
| `install-key` | Install the public key through the Azure agent and print `vm.env` updates. |
| `check` | Confirm connectivity and print host architecture evidence. |
| `run '<powershell>'` | Run PowerShell on the VM over SSH or Azure Run Command. |
| `push <local> <remote>` | Copy a file or directory to the VM; requires SSH. |
| `pull <remote> <local>` | Copy a file or directory back; requires SSH. |
| `verify <remote-path>` | Verify PE machine type for an executable or directory tree. |
| `smoke <remote-exe> [args]` | Launch an executable and prove whether it is emulated. |
| `setup` | Install Git, CMake, and VS Build Tools with ARM64/ARM64EC support. |
| `shell` | Open an interactive SSH session. |
| `disconnect` | Close the cached SSH master connection. |

## Authentication rules

Azure **Windows** VMs use username/password, not a `.pem` key. Azure's "SSH
keys" resource is Linux-only and cannot be attached to a Windows image.

Never store a password in `vm.env`. If a stage may run unattended, set up key
auth first or the password prompt will hang the run:

```bash
$VM init <vm-name>
$VM bootstrap
$VM install-key
# set VM_AUTH="key" and VM_KEY="..." in scripts/vm.env as printed
$VM check
```

Password auth is acceptable only for an interactive session: `connect` prompts
once and reuses the master connection for 8 hours.

## Procedure

### 1. Prove the VM is ARM64

```bash
$VM check
```

Trust nothing until this reports `PROCESSOR_ARCHITECTURE=ARM64`. If it reports
`AMD64` or anything else, stop and record a blocker; evidence from that host is
invalid for a native ARM64 port.

### 2. Prepare or stage artifacts

Install the toolchain only if you will build on the VM:

```bash
$VM setup
$VM run 'Get-Command cl, cmake, git'
```

For cross-built artifacts, stage the output instead:

```bash
$VM run 'New-Item -ItemType Directory -Force -Path C:\port\dist | Out-Null'
$VM push ./build-arm64/Release 'C:\port\dist'
```

`push` and `pull` require SSH; Azure Run Command cannot transfer files. If SSH
is unavailable, fetch artifacts from a project-controlled URL using `run`.

### 3. Verify PE architecture

```bash
$VM verify 'C:\port\dist'
```

`verify` walks `.exe` and `.dll` recursively for a directory target. It uses
`dumpbin` when available; otherwise it directly parses the PE COFF machine field.
The gate fails anything that is not `AA64`. This catches green builds that
silently emitted x64 because an ARM64 platform mapping was missing.

### 4. Prove native execution, not emulation

```bash
$VM smoke 'C:\port\dist\app.exe' --help
```

`smoke` launches the process and calls `IsWow64Process2` on it:

- `ProcessMachine == 0` means the process is running **NATIVE**.
- Any nonzero `ProcessMachine` means the process is being **EMULATED**.

This is the actual proof of non-emulation. A process that merely starts on
Windows on Arm may still be x64 under emulation.

### 5. Run the S6 workload

Run tests, representative workloads, module checks, and parity measurements on
the VM:

```bash
$VM run 'ctest --test-dir C:\port\build -C Release --output-on-failure'
$VM run 'Get-Process app | % { $_.Modules } | Select ModuleName,FileName'
$VM run 'Measure-Command { C:\port\dist\app.exe --bench }'
```

For weak-memory or concurrency-sensitive code, repeat the target test and keep
raw output under the S6 artifact directory, such as `artifacts/s6-parity/`.

## Required evidence

- `check` output showing `PROCESSOR_ARCHITECTURE=ARM64`.
- `verify` output showing every shipped `.exe` and `.dll` is `AA64`.
- `smoke` output showing `ProcessMachine == 0`.
- Test or workload output produced on the VM.
- Exact explanation for any skipped command or infrastructure limitation.

## Failure modes

| Symptom | Cause | Response |
|---|---|---|
| `vm.env not found` | VM settings not initialized | Run `init <vm-name>`. |
| `Connection refused` | OpenSSH Server absent/stopped | Run `bootstrap`, then confirm port 22. |
| `push`/`pull` fails | SSH unavailable | Use SSH or fetch artifacts with `run`. |
| Password prompt hangs | Unattended run lacks key auth | Run `install-key`; set `VM_AUTH=key`. |
| `Permission denied (publickey)` | Key not installed or wrong `VM_KEY` | Re-run `install-key` or use interactive password auth. |
| `check` says `AMD64` | Wrong VM size/host | Stop; use ARM64 VM or `windows-11-arm` CI. |
| `verify` rejects `8664` | x64 binary leaked in | Fix build mapping or packaging inputs. |
| `smoke` has nonzero `ProcessMachine` | Emulated process | You launched the wrong artifact. |

## Handoff

After S6 passes, feed the verified directory or package to `port-packaging`. If
VM access is unavailable, use `arm64-ci-integration` as the authoritative path.
