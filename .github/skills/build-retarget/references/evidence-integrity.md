# Evidence integrity: proving claims about bytes

A port audit constantly makes byte-level claims — "this file is BOM-less UTF-8", "these two
commits are identical", "this artifact is unmodified". Every one of those claims is only as
good as the channel it was measured through. Several common channels silently transcode, and a
transcoding channel cannot answer a question about bytes.

This reference exists because a WinPort audit reached a **confidently wrong conclusion** through
exactly this mistake, and was corrected by a peer session that used a byte-exact channel.

## The GitHub contents API transcodes

`GET /repos/{owner}/{repo}/contents/{path}` returns base64, which looks byte-exact and is not.
It re-encodes text content on the way out. Measured on `CodeCoverageRunnerTest.cpp` at
`e74bc2f7` in the OpenCppCoverage ARM64 port:

| Measurement | Value |
| --- | --- |
| `size` field returned by the endpoint | 19184 |
| Length of its own base64 payload after decoding | 19187 |
| True blob size from `/git/blobs` | 19184 |
| First non-ASCII bytes in the payload | `c3 a9 c3` |
| First non-ASCII bytes in the real file | `e9 e0 e8` |

Two failures at once. The endpoint's own two fields disagree by three bytes, and it rendered a
correct Windows-1252 file as the UTF-8 form. The audit compared that transcoded output at two
commits, saw identical bytes, and concluded the sources were unchanged. They were not: the file
had been repaired between the two commits, and the "identical bytes" were an artifact of the
transport. A wrong root cause was published on the strength of it.

## Use a byte-exact channel

Prefer, in order:

1. **Compare blob ids.** Git blob SHA-1 is computed over `blob <length>\0` followed by the raw
   bytes, so it cannot be affected by transcoding. Two paths with the same blob id are
   byte-identical; different ids are byte-different. This settles most questions with no file
   transfer at all.

   ```powershell
   $entry = (gh api "repos/$repo/git/trees/${commit}:$dir" | ConvertFrom-Json).tree |
       Where-Object { $_.path -eq $name }
   "$($entry.sha)  $($entry.size)"
   ```

2. **Fetch `/git/blobs/{sha}`,** which returns the real bytes.

3. **Verify what you received.** Recompute the object id from the payload and require it to
   match the id you asked for. This catches a bad decode on your side too.

   ```powershell
   $b = [Convert]::FromBase64String(($blob.content -replace '\s',''))
   $hdr = [Text.Encoding]::ASCII.GetBytes("blob $($b.Length)" + [char]0)
   $obj = $hdr + $b
   $calc = ([Security.Cryptography.SHA1]::Create().ComputeHash($obj) |
       ForEach-Object { $_.ToString('x2') }) -join ''
   if ($calc -ne $expectedSha) { throw "blob $expectedSha did not survive transport" }
   ```

## The same trap exists locally

In PowerShell, `>` and `Out-File` route through the console/output encoding and will re-encode
binary content:

```powershell
git cat-file blob <sha> > out.cpp            # WRONG: decodes and re-encodes
git cat-file blob <sha> | Set-Content -AsByteStream -LiteralPath out.cpp   # correct
[IO.File]::WriteAllBytes($path, $bytes)                                    # correct
```

`Get-Content` without `-AsByteStream` (or `-Encoding Byte` on Windows PowerShell) has the same
problem, and `Set-Content -Encoding utf8` writes a BOM on some hosts and not others.

## Rules

- A byte-level claim cites a byte-exact source. If the only evidence is a transcoding channel,
  the claim is `not-run`, not `pass`.
- Prefer identity comparison (blob id, SHA-256) over content comparison. It is cheaper and it
  cannot be fooled by rendering.
- When two fields of one response disagree — a declared size and an actual payload length —
  trust neither and re-measure through a different channel.
- A peer that contradicts your byte claim with blob ids is probably right. Re-measure before
  defending the conclusion.
- Record the channel in the evidence, not just the result: "blob id from `/git/trees`,
  recomputed from `/git/blobs`" is auditable; "verified the bytes" is not.
