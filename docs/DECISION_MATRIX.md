# Decision Matrix — ARM64 vs ARM64EC vs ARM64X

Used at **S3**. Decide **per shipped binary**, not per project.

---

## The three ABIs in one paragraph each

**Classic ARM64** — a normal native ARM64 binary. Fastest, most power-efficient,
simplest toolchain. An ARM64 process can only load ARM64 (and ARM64X) modules;
it **cannot** load x64 DLLs. This is the default and you should need a reason to
choose anything else.
→ <https://learn.microsoft.com/en-us/windows/arm/add-arm-support>

**ARM64EC** ("Emulation Compatible") — native ARM64 code that uses an
x64-compatible ABI, so it can live in the same process as emulated x64 code and
call back and forth. This is the incremental-porting escape hatch: port module
by module, keep the x64 plugin that you cannot rebuild. You pay a small
performance cost (x64-shaped calling convention + thunks) and get a more complex
build.
→ <https://learn.microsoft.com/en-us/windows/arm/arm64ec>
→ ABI details: <https://learn.microsoft.com/en-us/windows/arm/arm64ec-abi>

**ARM64X** — a single PE file containing *both* classic ARM64 and ARM64EC/x64
views. Solves exactly one problem: a DLL that must be loadable by both native
ARM64 processes and ARM64EC/x64 processes. Think plugins, shell extensions,
IMEs, middleware, injected DLLs.
→ <https://learn.microsoft.com/en-us/windows/arm/arm64x-pe>
→ Building: <https://learn.microsoft.com/en-us/windows/arm/arm64x-build>

---

## Decision flow

```
                 Do you ship a DLL that BOTH native ARM64 processes
                 AND x64/ARM64EC processes must load?
                 (plugin, shell ext, middleware, injected DLL)
                          │
                    yes ──┴── no
                     │         │
                     ▼         ▼
                 ARM64X    Must an x64-only binary run INSIDE your
                           process, and you cannot rebuild or replace it?
                           (S2 `emulate` list is non-empty)
                                    │
                              yes ──┴── no
                               │         │
                               ▼         ▼
                           ARM64EC    Is the codebase so large that a
                                      big-bang port is infeasible and you
                                      need to ship value incrementally?
                                           │
                                     yes ──┴── no
                                      │         │
                                      ▼         ▼
                                  ARM64EC   ✅ Classic ARM64
                                  (migrate to
                                   classic later)
```

---

## Comparison

| | Classic ARM64 | ARM64EC | ARM64X |
|---|---|---|---|
| Performance | Best | Good (thunk + x64-shaped ABI overhead) | Per-view, same as its view |
| Power efficiency | Best | Slightly lower | Per-view |
| Can load x64 DLLs in-process | ❌ | ✅ | n/a (it's a DLL) |
| Loadable by x64/EC processes | ❌ | ✅ | ✅ |
| Loadable by classic ARM64 processes | ✅ | ❌ | ✅ |
| Incremental, module-by-module port | ❌ | ✅ | ✅ |
| Build complexity | Low | Medium | High |
| Compiler switch | `-A ARM64` / `/MACHINE:ARM64` | `/arm64EC` | link ARM64 + EC objects |
| Predefined macros | `_M_ARM64` | `_M_ARM64` **and** `_M_ARM64EC` | both views |
| Typical use | Apps, CLI tools, services | Apps with an x64 plugin ecosystem | Plugins, shell ext, middleware |

> ⚠️ **The macro trap.** `_M_ARM64` is defined for **both** classic ARM64 and
> ARM64EC. Always test `_M_ARM64EC` first.
>
> ```c
> #if defined(_M_ARM64EC)
>     /* ARM64EC only */
> #elif defined(_M_ARM64)
>     /* classic ARM64 only */
> #endif
>
> /* "ARM64 family" (both) — the usual guard for NEON code */
> #if defined(_M_ARM64) || defined(_M_ARM64EC) || defined(__aarch64__)
> #endif
> ```

---

## What forces which choice

### Forces ARM64EC
- A closed-source x64 DLL/SDK with no ARM64 build and no alternative (S2 `emulate`)
- A third-party **plugin ecosystem** you do not control (audio VSTs, codecs,
  extensions) that will remain x64 for years
- A very large C/C++ codebase where you need to ship partial value early
- Deep x64 assembly you cannot afford to port yet

### Forces ARM64X
- You ship a DLL loaded by arbitrary host processes of unknown architecture
- Shell extensions, IMEs, browser plugins, injected/hooking DLLs, middleware SDKs

### Forces classic ARM64 (i.e. nothing blocks it)
- Self-contained applications, CLI tools, services
- Managed / interpreted stacks (.NET, Node, Python, Java, Go, Rust) where the
  runtime already supports `win-arm64`
- Anything where battery life and performance are user-visible selling points

### Forces "not an app port at all"
- **Kernel drivers must be native ARM64.** There is no emulation in kernel mode
  and no ARM64EC for drivers.
  → <https://learn.microsoft.com/en-us/windows-hardware/drivers/develop/building-arm64-drivers>

---

## Escape hatch: run the x64 build under emulation

Windows on ARM emulates x86 and x64 user-mode apps. This is a valid *interim*
answer and a useful *performance control* in S6 — but it is not the deliverable.
Emulation costs performance and battery, and emulated processes cannot load
native ARM64 modules.
→ <https://learn.microsoft.com/en-us/windows/arm/apps-on-arm-x86-emulation>

Use it to: (a) keep users unblocked while you port, (b) produce the
"native vs emulated on identical hardware" number for your S6 report.

---

## Recording the decision

Write an ADR at `docs/adr/NNNN-arm64-strategy.md`:

```markdown
# NNNN — ARM64 strategy for <app>

## Status
Accepted — <date>

## Context
<S2 findings: which deps are `emulate`/`blocker`, size of the arch surface from S1>

## Options considered
- Classic ARM64 — <why it does / doesn't work>
- ARM64EC — <cost/benefit>
- ARM64X — <only if shipping loadable DLLs>

## Decision
| Binary | ABI | Rationale |
|---|---|---|
| app.exe | ARM64EC | must host x64 `foo.dll` (no ARM64 build, vendor EOL) |
| tool.exe | ARM64 | self-contained, no x64 deps |

## Consequences
- <perf implications, build complexity, migration path to classic ARM64 later>
```
