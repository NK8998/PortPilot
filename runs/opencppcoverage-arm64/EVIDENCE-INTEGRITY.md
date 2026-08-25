# Evidence integrity note — recorded hashes vs. committed bytes

**Status:** understood, proven, and fixed forward. No evidence was altered.
**Scope:** the recorded SHA-256 values in this run's contract artifacts.

## Symptom

`node contracts/validate.js runs/opencppcoverage-arm64/` reports `INVALID`, with
66 size and SHA-256 mismatches across `artifacts[]`, `evidence[]` and
`priorEvidence[]`.

A hash mismatch on retained evidence is exactly the signal that should stop a
release, so it was treated as a potential integrity failure until proven
otherwise.

## What was actually wrong

The logs were produced on Windows and hashed there, with **mixed** line endings —
most lines CRLF, a few bare LF. Git normalised every ending to LF **at commit
time**, so the committed bytes are not the bytes that were hashed.

This is not recoverable from history. The original bytes never entered the object
store:

```
$ git cat-file blob 0771a72dc0c88579c081ed0e3382ce68bb2b836b | wc -c
753                      # recorded: 797
$ git cat-file blob 0771a72dc0c88579c081ed0e3382ce68bb2b836b | grep -c $'\r'
0                        # no CR byte survives anywhere in history
```

## Proof that the content is intact

"Probably just line endings" is an assumption, not a finding. It was verified
instead, with [`scripts/verify-evidence-hashes.py`](../../scripts/verify-evidence-hashes.py),
which searches for a line-ending layout that reproduces each recorded SHA-256
**exactly**. A SHA-256 match is conclusive: it means the reconstructed bytes are
the bytes that were hashed.

```
$ python3 scripts/verify-evidence-hashes.py runs/opencppcoverage-arm64/

runs/opencppcoverage-arm64/: 28 recorded hashes
  intact                        : 4
  content proven intact (EOL)   : 24
  unproven (search truncated)   : 0
  unexplained                   : 0
  missing                       : 0
```

**All 28 recorded hashes are accounted for, and none is unexplained.** Every
mismatching file was reconstructed byte-for-byte from the committed bytes by
changing only end-of-line encoding. No log content differs by so much as one
byte from what was originally hashed.

The recovered layouts are self-consistent and physically plausible — each CI log
is CRLF throughout except for a short run of bare-LF lines at the very end,
where a different tool appended its summary:

| File | Recovered layout |
|---|---|
| `x64-compat-run-32357865925-job-96390868985.log` | 4090/4093 CRLF; bare LF at lines 4040–4042 |
| `x86-compat-run-32357865925-job-96390869040.log` | 4080/4083 CRLF; bare LF at lines 4029–4031 |
| `winport-independent-verification-run-32361171722.log` | 330/332 CRLF; bare LF at lines 302–303 |
| `build-Debug-ARM64-run-32347208182-diagnostics.log` | 12/13 CRLF; bare LF at line 12 |
| 20 others | uniform CRLF → LF |

## Why the hashes were not simply "corrected"

Recomputing the hashes to match the current bytes would turn the gate green
while destroying the only thing it exists to detect. Silently rewriting a hash
that does not match is precisely the behaviour tamper-evidence is designed to
catch. The recorded values are left exactly as they were, and the discrepancy is
explained here and machine-checkable at any time.

## Fix forward

The repository root `.gitattributes` now pins the whole evidence tree:

```
runs/** binary
```

Evidence committed from here on keeps the bytes that were hashed, so a fresh
checkout revalidates cleanly. This defect cannot recur.

CI does not blanket-ignore the mismatch either. `portpilot-gates.yml` treats a
`validate.js` failure in this run as tolerable **only** when
`verify-evidence-hashes.py` proves every mismatch is end-of-line encoding and
reports zero unexplained. Genuinely altered evidence still fails the build.

## What the port's claims rest on

None of this touches the architecture evidence, which is intact and independent:

- all 8 contract artifacts validate against their schemas
- `evidence/arm64-81376ba/pe-ARM64-Release.json` — 36 PE images, all `0xAA64`,
  zero x64
- `evidence/arm64-81376ba/package-ARM64.log` — the packaging gate rejecting the
  x64 `vcruntime140_1.dll` (machine `0x8664`) that Microsoft ships in an `arm64`
  redist directory
- `evidence/arm64-81376ba/build-toolchain-*-ARM64.json` — `HostArm64` only
- `evidence/native-arm64-run-32357865925-*.log` — unmodified `windows-11-arm64`
  runner log, with its matched x64 negative control alongside it

## Lesson

> Hashing evidence is not enough. If the transport between hashing and storage
> can rewrite bytes, the hash proves nothing. Pin the bytes (`.gitattributes
> binary`) in the same change that starts hashing them.
>
> And when a hash does mismatch, prove *why* before believing any explanation —
> "it's probably line endings" and "someone edited the evidence" look identical
> until you reconstruct the bytes.

Filed as a prevention rule for `build-retarget` and `port-packaging`: any
workflow that records a checksum for a file it also commits must assert the file
is byte-identical after a clean re-checkout.
