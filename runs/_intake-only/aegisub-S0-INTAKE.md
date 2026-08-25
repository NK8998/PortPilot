# Aegisub — S0 Intake Findings (pre-port research)

**Status:** rejected during S0 screening. **No port has started.** No code changed,
no build attempted.
**Researched:** 2026-08-17
**Verdict:** ❌ **Do not proceed: a native Windows ARM64 build already exists.**

## 0. Existing Windows ARM64 port

WorksOnWoA lists the application under the misspelled name **Aegiusb** as
compatible, native, and Qualcomm-validated from version 9317. Its listing links
to `driver1998/Aegisub`, whose `windows-arm64` branch published
`aegisub-portable-9317-windows-arm64.zip` on 2024-02-16.

The active TypesettingTools tree may be newer, but porting it would be an update
of an existing port rather than first-time Windows ARM64 enablement. That makes
it unsuitable for this workbench's current target-selection goal.

> **Read this before doing any Aegisub recon.** It answers the two questions that
> cost the most time to rediscover: *which repo* and *does arm64 support already
> exist*. Both have non-obvious answers.

---

## 1. Use the right repo — this is the biggest trap

`Aegisub/Aegisub` (the obvious one, and the one that comes up first) is **dormant**.

| Repo | `master` HEAD | Stars | Build system | Verdict |
|---|---|---|---|---|
| `Aegisub/Aegisub` | **2019-10-06** (`6f54695`) | — | autotools + old `.sln` | ❌ **do not use** |
| **`TypesettingTools/Aegisub`** | pushed **2026-08-15** | 1,915 | **meson** | ✅ **use this** |
| `arch1t3cht/Aegisub` | pushed 2026-07-27 | 991 | meson | active fork, secondary |
| `wangqr/Aegisub` | 2024-03-10 | 805 | — | stale |

The official repo's API `pushed_at` reads 2025 which makes it *look* alive, but
that is activity on non-default branches — `master` itself has not moved since
2019. It predates Apple Silicon entirely (`packages/osx_bundle/Contents/Info.plist`
declares `x86_64` only) and its solution offers only `Win32`/`x64`.

Porting that tree would mean fighting a decade-old build system to ship something
nobody uses.

> A clone of the **wrong** (2019) tree was made during research at `work/aegisub`
> and has been **deleted**. Re-clone from `TypesettingTools/Aegisub`.

---

## 2. arm64 support already exists — on macOS

`TypesettingTools/Aegisub` `.github/workflows/ci.yml` contains:

```yaml
- { name: macOS arm64 Debug,   os: macos-15, buildtype: debugoptimized, ... }
- { name: macOS arm64 Release, os: macos-15, buildtype: release, ... }
```

This is worth more than any static analysis. It **proves**:

1. The C++ compiles **and runs** on ARM64 today.
2. The entire dependency tree builds for arm64 — FFmpeg, ffms2, boost, ICU,
   libass, fftw, freetype2, fribidi, hunspell, **LuaJIT**.

**Consequence: skip the usual "hunt for x86 assumptions" work.** It is already
answered. Confirmed independently by grepping the source tree:

| Construct | Files |
|---|---|
| `_M_X64` / `_M_AMD64` / `__x86_64__` / `_M_IX86` / `__i386` | **0** |
| `__cpuid` / `cpuid` | **0** |
| SSE/AVX intrinsics (`_mm_`, `__m128`, `__m256`, `immintrin`) | **0** |
| Inline assembly (`__asm`, `asm volatile`, `.asm`) | **0** |
| `SSE2` / `MMX` / `AVX` mentions | **1** (see AviSynth below) |

Scale: ~92,000 LOC of C/C++ in `src/` + `libaegisub/` (≈6.6× btop4win).

---

## 3. What does NOT transfer from macOS arm64

**macOS arm64 ≠ Windows ARM64.** Different ABI, different toolchain, different
platform libraries. The real work lives here.

### 3a. LuaJIT — the crux ⚠️

Aegisub bundles **LuaJIT** (see `build/luajit`, `build/luajit-buildvm`) for its
automation/scripting engine. This is a **JIT compiler**: it emits machine code at
runtime, so it must both generate ARM64 instructions *and* honour the Windows
ARM64 ABI. macOS arm64 working gives you **none** of that for free.

Researched status:
- Windows ARM64 **is** supported on the LuaJIT **2.1** branch.
- **Source-only — no prebuilt binaries**, and **vcpkg does not ship it**
  (microsoft/vcpkg#45504).
- ARM64EC is **not** supported (LuaJIT#1096) — relevant only if ARM64EC is ever
  considered; it would rule it out.
- `buildvm` must be built for the target architecture, which is the usual
  cross-compilation stumbling block.

**Treat this as the #1 S2 dependency risk. Resolve it in S2, not S5.**

### 3b. AviSynth — likely drop it

`src/avisynth.h` is the only file mentioning SSE2/MMX (`CPUF_MMX`, `CPUF_SSE2`
feature flags). It is the API header for **AviSynth**, an x86-only Windows
frameserver. There is no ARM64 AviSynth.

It is an **optional** video source. Expected S2 outcome: build without it and
record the feature delta. Do **not** try to port AviSynth.

### 3c. Other Windows-specific surface

Windows audio/text stacks (WASAPI/DirectSound, DirectWrite) are
architecture-neutral APIs, but are untested by the macOS CI and therefore
unproven here. Also unproven: the meson + MSVC/clang-cl cross-file for an ARM64
Windows target.

---

## 4. Why this initially looked like a good target

- **De-risked where it matters** — arm64 correctness of the app code is already
  proven by macOS CI, so the port is unlikely to stall on heisenbugs.
- **Substantive where it counts** — a genuinely interesting **S2 dependency
  audit** (LuaJIT, AviSynth) and a plausible **S5** (JIT/codegen), which the
  btop4win port never exercised at all.
- **Active upstream** — meson-based, pushed within days, so an ARM64 target is
  plausibly upstreamable.
- **Visible result** — a GUI application, which demos far better than a console tool.

---

## 5. Open questions for whoever starts this

1. **Artifact layout.** `artifacts/PORT_STATE.json` is **single-app** (`app` is
   one object) and `scripts/port.sh` hardcodes that path. btop4win currently
   occupies it at **S6 with 29 features unwalked**. The `artifacts/s0-baseline/`,
   `s1-recon/`, … directories are also singular and **would be overwritten**.
   Decide before writing any Aegisub artifact:
   - **(a)** namespace per app — `artifacts/btop4win/…`, `artifacts/aegisub/…`
     (cleanest; requires touching `port.sh` and the orchestrator skill's path table), or
   - **(b)** archive btop4win into `artifacts/btop4win/` and let Aegisub use the
     standard paths (least invasive; tooling keeps working).
2. **If updating the existing port**, confirm LuaJIT builds for Windows ARM64
   in S2 before authorising S4.
   If it cannot be built, the scripting engine — a core feature — is at risk.
3. **Toolchain:** meson + MSVC/clang-cl for ARM64. This host has VS 18 with ARM64
   VC tools; meson/ninja availability is **unverified**.

---

## 6. Method note — a cheap gate worth formalising

Three candidates were screened before this one, and two were rejected for
reasons a five-minute check would have caught:

| Target | Outcome |
|---|---|
| **mpv** | ❌ **already ported** — upstream CI builds `aarch64-pc-windows-msvc` and MSYS2 ships `mingw-w64-clang-aarch64-mpv` |
| **x64dbg** | ⚠️ maintainer declined ARM64 (issue #2934, *"no plans right now"*); it **is** the x86 layer, and its x64 plugin ecosystem makes it an ARM64EC problem |
| **Clink** | ❌ rejected — ARM64 builds are shipped (a `releases/latest` asset check **missed** this; that screening method is unreliable) |

Of 19 repos screened, **13 already had ARM64 builds**.

**Recommendation: add an "is this already ported?" check as the first S0 gate** —
inspect upstream CI *and* package repos, not just `releases/latest` assets, which
demonstrably produces false negatives.
