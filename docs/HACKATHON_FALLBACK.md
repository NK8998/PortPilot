# Hackathon Recording and Offline Fallback

## Published fallback

The narrated fallback is published in
[PortPilot Hackathon Demo 2026](https://github.com/Kalunge/portpilot-pocketsphinx-arm64-validation/releases/tag/hackathon-demo-2026).

| Record | Value |
|---|---|
| Video | `PortPilot-Hackathon-Fallback.mp4` |
| Duration | 6 minutes 11 seconds |
| Resolution | 1080p |
| Slides | 8 |
| Generator commit | `3be17abfcea24a703bdc0cde2899b85ecad7a39f` |
| Video SHA-256 | `5d4e87cdb7a51ef4a7b7f570b0083145fb4e5353d889f9e25530b082090df0a7` |

The release also contains the editable PowerPoint deck and
`recording-manifest.json`. Regenerate it with:

```powershell
powershell.exe -Sta -NoProfile -ExecutionPolicy Bypass `
  -File scripts\build-fallback-recording.ps1 `
  -OutputDirectory C:\path\to\recording-output
```

## Recording storyboard

Record the same six-minute sequence as
[the live demo](HACKATHON_DEMO.md) at 1080p:

1. Title and one-line problem statement.
2. whisper.cpp manifest.
3. rendered architecture diagram.
4. `scripts\demo.ps1` passing locally.
5. PocketSphinx producer, PE evidence, clean consumer, and recognition output.
6. whisper.cpp producer, PE evidence, CTest, and JFK scenario.
7. before-and-after matrix.
8. finding-disposition honesty boundary.
9. closing statement.

Use a terminal font of at least 18 px, hide notifications and credentials, and
keep the browser zoom at 125-150%. Do not show access tokens, environment
secrets, or private repository pages.

## Capture checklist

- Duration: 5-7 minutes.
- Resolution: 1920x1080.
- Audio: narration is intelligible and normalized.
- Both proof URLs and run IDs are visible.
- PocketSphinx `0xAA64`, wheel, clean install, and recognition are visible.
- whisper.cpp `0xAA64`, CTest, and transcription are visible.
- The `not-ready` versus passed-tests distinction is stated.
- Replay the final file from beginning to end before submission.

## Offline fallback

If GitHub is unavailable during judging, use these repository-local pages:

1. [Architecture](PORTPILOT_ARCHITECTURE.md)
2. [Before-and-after evidence](HACKATHON_EVIDENCE.md)
3. [PocketSphinx proof](POCKETSPHINX_DEMO.md)
4. [whisper.cpp proof](WHISPER_CPP_ARM64_PROOF.md)
5. [Finding dispositions](WHISPER_CPP_FINDING_DISPOSITIONS.md)

The compact latest-run evidence used to verify the demo is retained outside the
Git repository in the session evidence bundle. Large binaries and model files
remain GitHub Actions artifacts and are not committed.

## Failure recovery during the live demo

| Failure | Recovery |
|---|---|
| Unit tests are slow | Re-run `scripts\demo.ps1 -SkipTests` and show the latest committed test result in the evidence page |
| GitHub page is slow | Use the offline evidence tables and proof documents |
| Artifact download expires | Show the run job steps and committed PE/runtime summaries |
| Presenter machine is not Arm64 | Explain that native execution is intentionally delegated to `windows-11-arm` |
| A report says `not-ready` | Show the passed tests gate, then explain the explicit disposition requirement |

The published release keeps large media outside Git history while providing a
durable public download, editable source deck, duration, source commit, and
content hash.
