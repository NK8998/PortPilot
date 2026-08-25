#!/usr/bin/env python3
"""Reconcile recorded evidence hashes against the bytes actually on disk.

`contracts/validate.js` answers "do the recorded hashes match?" with yes or no.
When the answer is no, that alone cannot distinguish two very different things:

  * the evidence was edited after it was hashed  (fatal - evidence is worthless)
  * git rewrote line endings at commit time      (recoverable - content intact)

This tool tells them apart. For every mismatch it searches for a line-ending
transformation that reproduces the recorded SHA-256 exactly. If one is found,
the file's content is proven byte-identical to what was hashed, and only its
end-of-line bytes changed. If none is found, the mismatch is reported as
unexplained and the tool exits non-zero.

Usage:
    scripts/verify-evidence-hashes.py runs/<run-dir>/ [--max-search N]

Exit codes:
    0  every recorded hash either matches, or is explained by EOL normalisation
    1  at least one mismatch is unexplained
    2  bad usage / nothing to check
"""

import argparse
import hashlib
import itertools
import json
import math
import os
import sys

ARTIFACT_FILES = (
    "handoff.json", "run.json", "build.json", "analysis.json",
    "plan.json", "review.json", "runtime.json", "purity.json",
)
BOM = b"\xef\xbb\xbf"


def collect_records(run_dir):
    """Find every {path, sha256, size} triple recorded anywhere in the artifacts."""
    records = {}

    def walk(node, source):
        if isinstance(node, dict):
            if {"path", "sha256", "size"} <= node.keys():
                key = (node["path"], node["sha256"], node["size"])
                records.setdefault(key, source)
            for value in node.values():
                walk(value, source)
        elif isinstance(node, list):
            for value in node:
                walk(value, source)

    for name in ARTIFACT_FILES:
        path = os.path.join(run_dir, name)
        if not os.path.exists(path):
            continue
        try:
            with open(path, encoding="utf-8") as handle:
                walk(json.load(handle), name)
        except (json.JSONDecodeError, UnicodeDecodeError) as exc:
            print(f"  WARN  {name} is not readable JSON: {exc}")
    return records


def uniform_variants(raw):
    """Whole-file transformations, cheapest and most likely first."""
    as_lf = raw.replace(b"\r\n", b"\n")
    as_crlf = as_lf.replace(b"\n", b"\r\n")
    for label, body in (("LF->CRLF", as_crlf), ("CRLF->LF", as_lf)):
        yield label, body
        yield f"{label} +BOM", BOM + body


TOO_LARGE = object()


def describe(chosen, endings):
    """Summarise which endings were CRLF without printing hundreds of indices."""
    crlf = len(chosen)
    if crlf * 2 <= endings:
        listed = sorted(chosen)
        shown = ", ".join(str(i) for i in listed[:8])
        more = f", +{len(listed) - 8} more" if len(listed) > 8 else ""
        return f"mixed EOL, {crlf}/{endings} endings CRLF at line(s) {shown}{more}"
    lf = sorted(set(range(endings)) - set(chosen))
    shown = ", ".join(str(i) for i in lf[:8])
    more = f", +{len(lf) - 8} more" if len(lf) > 8 else ""
    return f"mixed EOL, {crlf}/{endings} endings CRLF; bare LF at line(s) {shown}{more}"


def build(segments, chosen):
    out = bytearray()
    for index, segment in enumerate(segments[:-1]):
        out += segment
        out += b"\r\n" if index in chosen else b"\n"
    out += segments[-1]
    return bytes(out)


def mixed_variants(raw, deficit, max_search):
    """Windows CI logs interleave output from tools that disagree about line
    endings, so the original often had *mixed* terminators. Recovering that
    means choosing which `deficit` of the LF endings were really CRLF.

    Any SHA-256 hit is conclusive, so a heuristic that only tries *likely*
    layouts is sound: it can never produce a false positive, it can only fail
    to find one. That lets us cheaply attempt cases whose exhaustive space is
    astronomically large, by exploiting the fact that odd-EOL lines in real
    logs cluster together (one tool writing a contiguous block of output).

    Yields TOO_LARGE when the space was truncated, so the caller can report
    "unproven" rather than implying tampering. Never materialise the
    combination list to measure it: C(4093, 3) is 1.1e10."""
    if deficit <= 0:
        return
    segments = raw.split(b"\n")
    endings = len(segments) - 1
    if endings <= 0 or deficit > endings:
        return

    everything = set(range(endings))

    if math.comb(endings, deficit) <= max_search:
        for combo in itertools.combinations(range(endings), deficit):
            chosen = set(combo)
            yield describe(chosen, endings), build(segments, chosen)
        return

    # Exhaustive search is out of reach. Try the clustered layouts instead:
    # a contiguous block of `gap` odd endings sliding across the file.
    gap = endings - deficit
    if 0 < gap <= 8:
        for start in range(endings - gap + 1):
            chosen = everything - set(range(start, start + gap))
            yield describe(chosen, endings), build(segments, chosen)
    if 0 < deficit <= 8:
        for start in range(endings - deficit + 1):
            chosen = set(range(start, start + deficit))
            yield describe(chosen, endings), build(segments, chosen)
    yield TOO_LARGE, None


def explain(raw, recorded_sha, recorded_size, max_search):
    """Return (verdict, detail) where verdict is 'eol', 'unproven' or 'none'.

    A hit is cryptographically conclusive: SHA-256 agreement means the
    reconstruction is exactly the bytes that were hashed. A miss over a
    truncated search space is not conclusive, and is reported separately."""
    for label, body in uniform_variants(raw):
        if len(body) == recorded_size and hashlib.sha256(body).hexdigest() == recorded_sha:
            return "eol", label
    truncated = False
    for label, body in mixed_variants(raw, recorded_size - len(raw), max_search):
        if label is TOO_LARGE:
            truncated = True
            continue
        if hashlib.sha256(body).hexdigest() == recorded_sha:
            return "eol", label
    return ("unproven", "search space too large") if truncated else ("none", None)


def main():
    parser = argparse.ArgumentParser(description=__doc__,
                                     formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("run_dir")
    parser.add_argument("--max-search", type=int, default=200_000,
                        help="max mixed-EOL combinations to try per file (default: 200000)")
    args = parser.parse_args()

    run_dir = args.run_dir
    if not os.path.isdir(run_dir):
        print(f"not a directory: {run_dir}")
        return 2

    records = collect_records(run_dir)
    if not records:
        print(f"no recorded hashes found in {run_dir}")
        return 2

    cwd = os.getcwd()
    intact = eol = unproven = unexplained = missing = 0
    details = []

    os.chdir(run_dir)
    try:
        for (rel_path, recorded_sha, recorded_size), source in sorted(records.items()):
            name = os.path.basename(rel_path)
            if not os.path.exists(rel_path):
                missing += 1
                details.append(f"  MISSING      {name}  (referenced by {source})")
                continue
            with open(rel_path, "rb") as handle:
                raw = handle.read()
            if len(raw) == recorded_size and hashlib.sha256(raw).hexdigest() == recorded_sha:
                intact += 1
                continue
            verdict, detail = explain(raw, recorded_sha, recorded_size, args.max_search)
            if verdict == "eol":
                eol += 1
                details.append(f"  EOL-ONLY     {name}  ({detail})")
            elif verdict == "unproven":
                unproven += 1
                details.append(
                    f"  UNPROVEN     {name}  recorded={recorded_size} on-disk={len(raw)} "
                    f"delta={recorded_size - len(raw)} ({detail})")
            else:
                unexplained += 1
                details.append(
                    f"  UNEXPLAINED  {name}  recorded={recorded_size} on-disk={len(raw)} "
                    f"(referenced by {source})")
    finally:
        os.chdir(cwd)

    for line in details:
        print(line)

    total = len(records)
    print(f"\n{run_dir}: {total} recorded hashes")
    print(f"  intact                        : {intact}")
    print(f"  content proven intact (EOL)   : {eol}")
    print(f"  unproven (search truncated)   : {unproven}")
    print(f"  unexplained                   : {unexplained}")
    print(f"  missing                       : {missing}")

    if unexplained or missing:
        print("\nAt least one mismatch is NOT explained by line-ending normalisation.")
        print("Treat that evidence as untrustworthy until it is reproduced.")
        return 1

    if unproven:
        print("\nSome mismatches could not be searched exhaustively (the number of")
        print("possible line-ending layouts exceeds --max-search). They are consistent")
        print("with EOL normalisation by size, but that is NOT proof. Raise")
        print("--max-search to search harder.")

    if eol or unproven:
        print("\nNo evidence content was altered where a match was found: the bytes are")
        print("byte-identical modulo end-of-line encoding. Mark the tree binary in")
        print(".gitattributes so newly recorded hashes survive a round trip.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
