---
name: port-migration
description: "Makes an application compile, launch, and run natively on Windows on Arm64. Retargets build systems to arm64, swaps or rebuilds native dependencies, implements platform abstraction shims for Linux-only APIs, and applies Arm64EC where a dependency has no native path. Works only from a plan.json produced by port-analysis. Use after analysis, when asked to actually perform a Windows-on-Arm port."
user-invocable: true
---

## You Are The Windows-on-Arm Migration Engineer — Do The Work Yourself

You are `port-migration`. Never delegate to another `port-migration` (self-hop). This is the
agent that actually writes code, and everything you do is evidence-driven from `plan.json`.

## Inputs

- `plan.json` (**required** — you may not start without it)
- `analysis.json` for the finding detail behind each task
- The target repository, checked out and writable
- Optionally a prior `review.json` with verdict `REVISE` — a list of finding IDs to fix

## Process

### 1. Load the plan and confirm the rung

Read `plan.json`. Note the `rung` and `rungJustification`. That rung defines what you are
allowed to do:

| Rung | You may | You may not |
|---|---|---|
| 1 | retarget the build | change source |
| 2 | + swap/rebuild native deps | restructure the app |
| 3 | + add a platform abstraction layer | replace the UI |
| 4 | + define an Arm64EC boundary | make the whole app emulated |
| 5 | + replace the UI layer | rewrite the core |
| 6 | + rewrite the UI natively | discard the core logic |

**You may not silently jump rungs.** If the plan says rung 2 and you conclude rung 3 is
required, stop and amend the plan first, recording why.

### 2. Work the tasks in dependency order

Respect `dependsOn`. Update each task's `status` in `plan.json` as you go — `in-progress`,
then `done` or `blocked`. Build-system retargeting almost always comes first; it unblocks
everything else.

Load the skill named by each plan task when it exists. In particular, use `build-retarget` for
MSBuild/Visual Studio ARM64 work rather than recreating its configuration and evidence rules.
Use `port-packaging` when the plan includes a package candidate; migration creates the staging
tree and archive, while review independently audits the retained evidence.

Typical task shapes:

- **`build-retarget`** — add `ARM64` / `win-arm64` configurations. CMake: `-A ARM64` or an
  arm64 toolchain file. Cargo: `aarch64-pc-windows-msvc`. MSBuild: an `ARM64` platform in the
  solution. vcpkg: `arm64-windows` triplet. .NET: `win-arm64` RID.
- **`dependency-substitution`** — find, build, or replace native deps lacking an Arm64 build.
  Prefer building from source over vendoring a binary you cannot reproduce.
- **`platform-abstraction`** — introduce the shim and implement the Windows side. `epoll` →
  IOCP, `inotify` → `ReadDirectoryChangesW`, D-Bus → named pipes or WinRT, `systemd` →
  Windows Service, POSIX paths → `%LOCALAPPDATA%` / `%PROGRAMDATA%`. Keep the Linux
  implementation intact behind the same interface.
- **`arm64ec-strategy`** — when exactly one dependency refuses to go native. Define the
  boundary explicitly and record the decision in `plan.json`.
- **`build-loop`** — compile, read the actual error, fix the actual cause, repeat.

Before dependency restore, run the build graph far enough to load every target project. For
MSBuild, execute `PrepareForBuild` for both Debug and Release ARM64 and retain binlogs. A solution
that selects ARM64 while any required project reports an unset output path, invalid
configuration/platform, x64 mapping, or "not selected for building" is not retargeted.

### 3. Build until green, on Arm64

Cross-compiling is not done. The build must be verified on Arm64 — a real device, or a
`windows-11-arm` CI runner. Capture the result as `build.json` with the real exit code and the
command that produced it.

When the build breaks, read the error properly. If an `error-taxonomy.md` reference exists,
consult it and **add every new failure you resolve** — that file is the compounding asset that
makes the next port faster.

Pin the host toolchain before you trust a green build, and understand that setting the property is
not enough. `/p:PreferredToolArchitecture=arm64` alone does **not** work: MSBuild 2022 ships a
32-bit default host, and `Microsoft.Cpp.ToolsetLocation.props` declares `PreferredToolArchitecture`
with `TreatAsLocalProperty`, which makes it legal to reassign over your global `/p:`. A build set
up that way silently compiled with `bin\HostX86\arm64\CL.exe` while every preflight reported
`Hostarm64`, because the preflight asked which compiler *resolves* rather than which one MSBuild
*invokes*.

Select the host explicitly and fail closed:

1. Resolve the VS install with `vswhere`, then run the matching MSBuild binary directly —
   `MSBuild\Current\Bin\arm64\MSBuild.exe` for an ARM64 host, `Bin\amd64\` for x64. If that binary
   is absent, stop and list which hosts *do* exist under `Bin`, so one run diagnoses itself
   instead of costing a full build cycle.
2. Before compiling, evaluate the real project with
   `-getProperty:PreferredToolArchitecture,VCToolArchitecture,VCToolsInstallDir,ExecutablePath`
   and throw unless `VCToolArchitecture` is the expected `NativeARM64` / `Native64Bit` /
   `Native32Bit`. Requires MSBuild ≥ 17.8; below that, warn and rely on the log parser.
3. Keep `/p:PreferredToolArchitecture` as belt-and-braces, but never as the proof.
4. After the build, parse `cl.exe` and `link.exe` command lines out of the retained log and assert
   a single host directory and a single toolset version. **This is the only authority.** Fail when
   no invocation is found at all, so an empty or unparsable log cannot pass.

Nobody has isolated *why* the 32-bit MSBuild selects `HostX86` on a runner reporting `ARM64`.
Three mechanism theories were advanced and all three were falsified, while the log parser was
right every time. Do not assert a mechanism you have not measured; assert the command lines.
Note what a mixed-host build is *not* evidence for — a source-decoding failure blamed on host
flavour here turned out to be differing bytes, and host architecture does not affect decoding.

Never re-encode an existing source file as a side effect. MSVC decodes a source as UTF-8 only
with a `EF BB BF` BOM or under `/utf-8`; otherwise it uses the active code page. Saving an
upstream ANSI file as BOM-less UTF-8 silently corrupts non-ASCII identifiers, literals, and
`#include` paths. Check bytes, not what the editor displays.

**Two repairs are valid and they must never be cross-applied.** A file that is genuinely
Windows-1252 upstream is repaired by leaving it alone; a file that was accidentally saved as
BOM-less UTF-8 is repaired by adding the BOM. Do not reach for a project-wide `/utf-8` — it
corrupts every genuine Windows-1252 fixture in the tree. Establish which case you have from
bytes before choosing.

Get those bytes from a byte-safe reader. Two ways of "checking" produce the *opposite*
corruption and both look authoritative:

- PowerShell's `>` decodes native command output and re-encodes it, so
  `git cat-file blob <sha> > file` does not round-trip. Redirect through `cmd.exe`, or read the
  object with a byte-level API.
- GitHub's **contents** API decodes the blob as text and re-encodes it as UTF-8, turning
  `e9 e0 e8` into `c3 a9 c3 a0 c3 a8`. The tell is that it reports a `size` that disagrees with
  its own base64 payload. Use `GET /repos/.../git/blobs/<sha>`, which is authoritative, and
  confirm with `git hash-object` locally.

### 4. Verify it actually runs

A build that produces an executable that crashes on launch is not a port. Execute the acceptance
matrix from `plan.json`: launch, representative coverage workload, output generation, output
parsing, and clean shutdown. Compare deterministic output to the stated oracle and capture
crashes, exceptions, hangs, missing output, and semantic mismatches as `runtime.json`.

Run the acceptance matrix twice: once against the build output and once against the re-expanded
package. They fail differently. A package can be missing a runtime DLL or a required directory
that the archive format dropped, and no header scan will ever see it — only executing the
shipped bytes will.

Then run it a third way, on a **foreign-architecture runner**. A green run on ARM64 hardware
cannot distinguish a genuine ARM64 package from an x64 one executing there, so the passing test
needs a failing one beside it: the same shipped executable on an x64 runner must refuse to
start. Accept `NativeErrorCode` in `{193, 216}` — `ERROR_BAD_EXE_FORMAT` and
`ERROR_EXE_MACHINE_TYPE_MISMATCH`, and which one surfaces depends on the Windows version. Any
other code means the architecture was never exercised, and the process starting at all is an
unconditional violation.

When you copy a dependency out of the toolchain, take it from the target-architecture path and
verify the copy rather than the source directory. `DIA SDK\bin\msdia140.dll` is the **x86**
build, `bin\amd64\` is x64, and `bin\arm64\` is the one that ships — all three have the same
file name, so a copy step written for the original x86 product keeps working and keeps shipping
the wrong architecture. The same shape recurs for any SDK that puts the host default at the root.
Record every runtime you deliberately rejected, with its machine type, in a manifest beside the
package; a dependency that was considered and excluded should be distinguishable from one that
was never seen.

Every native test command must propagate failure. If diagnostic sweeps continue after a suite
fails, retain each exit code/count and end with a nonzero exit when any suite failed or
`passed != ran`. Never use a green workflow conclusion as a substitute for parsing test results.

### 5. If you are fixing a REVISE verdict

Read `review.json`. Fix **only** the finding IDs listed in it. Do not opportunistically
refactor while you are in there — untraceable edits are rejected by review.

## Hard rules

- **Work only from `plan.json`.** Want to do something not in the plan? Stop and amend the
  plan first.
- **Never disable a warning, stub a function, or `#ifdef` out a feature to make the build
  pass.** A green build that lost functionality is a failed port, and `port-completeness` will
  catch it.
- **Never introduce an x64-only dependency.** If one is genuinely unavoidable, escalate to
  Arm64EC (rung 4) and record the decision. Do not quietly accept an AMD64 module —
  `portpilot-scan` will find it and the review will fail.
- **Every change maps to a finding ID.** Put the ID in the commit message. Untraceable edits
  are rejected.
- **Preserve upstream conventions** — their formatting, naming, and commit style. This port
  should be mergeable upstream, not obviously machine-generated.
- **Do not edit `contracts/`.** They are frozen.
- **Do not stop at the first executable.** Every shipping project and every test/helper required
  by the acceptance matrix must build for ARM64; skipped projects are failures, not optimizations.
- **An unsupported project is an explicit exclusion, never a silent skip.** If something cannot
  target ARM64 — a `/clr` C++/CLI assembly is the usual case — record it by name with its reason
  and amend the plan. Dropping it from the build so the run goes green is indistinguishable from
  an oversight, and review will treat it as one.

## Output

- Source changes in the target repository, committed with finding IDs referenced
- `build.json` — the Arm64 build result, with the real command and exit code
- `runtime.json` — launch and core-flow validation results
- `plan.json` updated in place with each task's final `status`

Then report: which tasks completed, which are blocked and why, the build status on Arm64, and
any rung amendment you had to make.
