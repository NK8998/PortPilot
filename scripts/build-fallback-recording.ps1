[CmdletBinding()]
param(
    [Parameter(Mandatory)]
    [string]$OutputDirectory
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if (-not ("OfficeAutomation.MessageFilter" -as [type])) {
    Add-Type -TypeDefinition @"
using System;
using System.Runtime.InteropServices;

namespace OfficeAutomation
{
    [ComImport]
    [Guid("00000016-0000-0000-C000-000000000046")]
    [InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
    interface IOleMessageFilter
    {
        [PreserveSig]
        int HandleInComingCall(int callType, IntPtr taskCaller, int tickCount, IntPtr interfaceInfo);

        [PreserveSig]
        int RetryRejectedCall(IntPtr taskCallee, int tickCount, int rejectType);

        [PreserveSig]
        int MessagePending(IntPtr taskCallee, int tickCount, int pendingType);
    }

    public sealed class MessageFilter : IOleMessageFilter
    {
        [DllImport("Ole32.dll")]
        private static extern int CoRegisterMessageFilter(
            IOleMessageFilter newFilter,
            out IOleMessageFilter oldFilter);

        public static void Register()
        {
            IOleMessageFilter oldFilter;
            CoRegisterMessageFilter(new MessageFilter(), out oldFilter);
        }

        public static void Revoke()
        {
            IOleMessageFilter oldFilter;
            CoRegisterMessageFilter(null, out oldFilter);
        }

        int IOleMessageFilter.HandleInComingCall(
            int callType,
            IntPtr taskCaller,
            int tickCount,
            IntPtr interfaceInfo)
        {
            return 0;
        }

        int IOleMessageFilter.RetryRejectedCall(
            IntPtr taskCallee,
            int tickCount,
            int rejectType)
        {
            return rejectType == 2 ? 250 : -1;
        }

        int IOleMessageFilter.MessagePending(
            IntPtr taskCallee,
            int tickCount,
            int pendingType)
        {
            return 2;
        }
    }
}
"@
}

[OfficeAutomation.MessageFilter]::Register()

$root = Split-Path -Parent $PSScriptRoot
$output = [IO.Path]::GetFullPath($OutputDirectory)
$audioDirectory = Join-Path $output "audio"
$presentationPath = Join-Path $output "PortPilot-Hackathon-Fallback.pptx"
$videoPath = Join-Path $output "PortPilot-Hackathon-Fallback.mp4"
$manifestPath = Join-Path $output "recording-manifest.json"

$slides = @(
    @{
        Title = "PortPilot"
        Subtitle = "Evidence-backed Windows Arm64 porting"
        Body = @(
            "The problem: a successful compile is not a port.",
            "Dependencies, compiler assumptions, tests, packaging, and CI all matter.",
            "PortPilot turns one pinned repository and one manifest into auditable proof."
        )
        Narration = @"
PortPilot is an evidence-backed workflow for porting CMake applications to Windows Arm64.
The problem is larger than getting one compiler invocation to succeed. A trustworthy port
must identify architecture-specific dependencies, preserve an x64 baseline, run on native
Arm64 hardware, verify the machine type of every native output, exercise real application
behavior, and prove that a package can be installed independently. It must also report what
is still unresolved instead of turning a green build into an unsupported readiness claim.
PortPilot coordinates those gates from one immutable source revision and one declarative
manifest, producing durable JSON evidence that another engineer can audit and reproduce.
"@
    },
    @{
        Title = "One application contract"
        Subtitle = "Repository plus portpilot.yml"
        Body = @(
            "Pinned origin and 40-character revision",
            "Toolchain, x64 baseline, Arm64 target, tests, and runtime oracle",
            "Expected PE files and optional package contract"
        )
        Narration = @"
The only application-specific control plane is portpilot dot y m l. The manifest pins the
repository origin and full commit, names required tools and probes, defines separate x64 and
Arm64 command variants, declares test parity policy, and describes deterministic runtime
scenarios. It also lists every executable, library, or Python extension whose PE header must
be checked. A project with a distributable wheel adds a package contract and clean-install
commands. PocketSphinx and whisper dot C P P use different manifests and focused patches,
but there is no application-specific branch in the workflow or execution engine. This keeps
new ports declarative and makes review boundaries visible.
"@
    },
    @{
        Title = "Reusable architecture"
        Subtitle = "Analyze, plan, execute, prove"
        Body = @(
            "Analysis skills inventory dependencies and compatibility risks",
            "A resumable task graph records remediation and evidence",
            "Policy-constrained adapters build, test, audit, and report"
        )
        Narration = @"
PortPilot has four reusable layers. Analysis profiles the repository, inventories native
dependencies, scans architecture-sensitive code, and selects native Arm64 or Arm64 E C.
Planning groups findings into a dependency-aware task graph with allowed paths and acceptance
checks. Execution runs argument-array commands without a shell, probes the toolchain, applies
declared patches, downloads checksum-pinned resources, builds both phases, evaluates C Test
parity, runs feature scenarios, and audits P E files and wheels. Reporting combines those
records into explicit gates. The GitHub workflow then separates the x64 baseline producer,
native Windows Arm64 producer, and, when applicable, an independent package consumer.
"@
    },
    @{
        Title = "Trust is a feature"
        Subtitle = "No success-shaped shortcuts"
        Body = @(
            "Clean source identity and post-command mutation checks",
            "Immutable workflow SHA and cross-job manifest binding",
            "Hashed CI dependencies and evidence-backed finding dispositions"
        )
        Narration = @"
The reliability model is deliberately strict. PortPilot verifies the checkout origin,
revision, directory name, and clean state before execution, then checks source integrity
again after build and test commands. Paths are containment-checked, path executables are
allow-listed, and stale summaries, test logs, and package artifacts are removed before a
retry. Downloaded cross-job state must match the trusted manifest and immutable project
identity. Python dependencies used by Linux metadata, Windows x64, and Windows Arm64 jobs
are exact and S H A two fifty six verified. Most importantly, passing tests do not clear
static findings. Each terminal disposition requires a rationale and concrete evidence.
"@
    },
    @{
        Title = "Proof one: PocketSphinx"
        Subtitle = "Native CLI, native wheel, independent consumer"
        Body = @(
            "Run 32714075611 passed every job",
            "pocketsphinx.exe and _pocketsphinx.pyd are PE 0xAA64",
            "Zero unexpected CTest failures; recognition says go forward ten meters"
        )
        Narration = @"
PocketSphinx is the package-producing reference. Hardened run three two seven one four zero
seven five six one one starts from pinned upstream commit five one one one two six b. The x64
baseline records nine known Windows C Test failures. The native Arm64 producer has exactly
the same nine failures and zero unexpected regressions. PortPilot verifies pocketsphinx dot
exe as machine type zero x A A six four, builds a C P Python three twelve win Arm64 wheel,
opens the wheel, and verifies its native Python extension as the same machine type. A fresh
Arm64 consumer downloads the artifact, installs it without producer state, passes forty
three Python tests, and recognizes the phrase go forward ten meters.
"@
    },
    @{
        Title = "Proof two: whisper.cpp"
        Subtitle = "The same workflow, a different application"
        Body = @(
            "Run 32714080799 passed x64 and native Arm64 producers",
            "ClangCL satisfies ggml's Arm compiler requirement",
            "whisper-cli.exe and whisper.dll are PE 0xAA64; JFK scenario passes"
        )
        Narration = @"
Whisper dot C P P proves reuse. The original target exposed three issues that generic
automation needed to understand: the full test suite required a second checksum-pinned
model, native CMake configuration rewrote tracked JavaScript metadata, and g g m l explicitly
rejects M S V C for Arm. The manifest now supplies both models, a focused patch confines
JavaScript generation to Emscripten, and only the Arm64 variant selects Visual Studio
Clang C L. Hardened run three two seven one four zero eight zero seven nine nine passes the
x64 baseline, native configure and build, C Test with zero failures, and deterministic J F K
transcription. The C L I and D L L both verify as zero x A A six four.
"@
    },
    @{
        Title = "Reusable learning, honest readiness"
        Subtitle = "Twenty-five findings reviewed, none silently erased"
        Body = @(
            "Compiler restrictions and source-tree generation became shared scanner rules",
            "Architecture guards and optional backends receive explicit dispositions",
            "Accepted risks produce conditional readiness, not ready"
        )
        Narration = @"
The second port improved the product rather than creating whisper-only code. Compiler
restrictions involving Arm now become high-severity toolchain findings. Multiline CMake
configure-file operations that write into the source tree become reproducibility findings.
The corrected scanner also preserves C and C plus plus preprocessor guards. Its latest
whisper scan reports twenty-five items. The review ledger records five resolved findings
and twenty not-applicable findings, covering x86 feature branches, LoongArch code, optional
RISC V device kernels, Vulkan defaults, the Clang compiler requirement, source mutation,
and missing upstream Arm jobs. Raw C I reports stay not ready until those dispositions and
linked tasks are deliberately applied. That is an audit feature, not a demo failure.
"@
    },
    @{
        Title = "From pilot to repeatable product"
        Subtitle = "One manifest, two real ports, durable evidence"
        Body = @(
            "Start locally with portpilot run and review the generated task graph",
            "Pin the reusable workflow by commit for native execution",
            "Inspect baseline, target, architecture, package, and report records"
        )
        Narration = @"
A new user starts from one of the reference manifests, pins their own CMake repository, and
runs PortPilot locally to generate inventory, findings, an architecture decision, and a
resumable plan. Native execution calls the reusable workflow at a reviewed commit. The
result is not a screenshot or a runner label. It is a stable artifact layout containing
baseline and target summaries, P E architecture records, runtime output, package evidence
when relevant, and a readiness report that preserves remaining risk. PortPilot has now
proved that model on PocketSphinx and whisper dot C P P with the same engine and workflow.
The outcome is a hackathon-ready foundation for repeatable, reviewable Windows Arm64 ports.
"@
    }
)

function Add-TextBox {
    param(
        $Slide,
        [string]$Text,
        [float]$Left,
        [float]$Top,
        [float]$Width,
        [float]$Height,
        [float]$Size,
        [int]$Color,
        [bool]$Bold = $false
    )
    $shape = $Slide.Shapes.AddTextbox(1, $Left, $Top, $Width, $Height)
    $range = $shape.TextFrame.TextRange
    $range.Text = $Text
    $range.Font.Name = "Aptos"
    $range.Font.Size = $Size
    $range.Font.Color.RGB = $Color
    $range.Font.Bold = [int]$Bold * -1
    return $shape
}

New-Item -ItemType Directory -Force $output, $audioDirectory | Out-Null
Remove-Item -LiteralPath $presentationPath, $videoPath, $manifestPath -Force -ErrorAction SilentlyContinue

$powerPoint = $null
$presentation = $null
$voice = New-Object -ComObject SAPI.SpVoice
$voice.Rate = 2
$player = New-Object -ComObject WMPlayer.OCX
$durations = @()
$audioPaths = @()

for ($index = 0; $index -lt $slides.Count; $index++) {
    $item = $slides[$index]
    $audioPath = Join-Path $audioDirectory ("slide-{0:D2}.wav" -f ($index + 1))
    $stream = New-Object -ComObject SAPI.SpFileStream
    $stream.Open($audioPath, 3, $false)
    $voice.AudioOutputStream = $stream
    [void]$voice.Speak($item.Narration.Trim())
    $stream.Close()
    $voice.AudioOutputStream = $null

    $media = $player.newMedia($audioPath)
    Start-Sleep -Milliseconds 200
    $durations += [math]::Ceiling([double]$media.duration) + 2
    $audioPaths += $audioPath
}

try {
    $powerPoint = New-Object -ComObject PowerPoint.Application
    $powerPoint.Visible = -1
    $powerPoint.DisplayAlerts = 1
    $presentation = $powerPoint.Presentations.Add()
    Start-Sleep -Seconds 5

    for ($index = 0; $index -lt $slides.Count; $index++) {
        $item = $slides[$index]
        $audioPath = $audioPaths[$index]
        $duration = $durations[$index]

        $slide = $presentation.Slides.Add($index + 1, 12)
        Start-Sleep -Milliseconds 300

        [void](Add-TextBox $slide $item.Title 55 48 850 70 34 0x17233C $true)
        [void](Add-TextBox $slide $item.Subtitle 58 115 840 45 19 0xA65A00 $false)
        $bodyText = ($item.Body | ForEach-Object { [char]0x2022 + "  " + $_ }) -join "`r`n`r`n"
        [void](Add-TextBox $slide $bodyText 75 190 820 245 22 0x222222 $false)
        [void](Add-TextBox $slide ("PortPilot | {0}/8" -f ($index + 1)) 730 495 175 24 12 0x666666 $false)

        $audioShape = $slide.Shapes.AddMediaObject2($audioPath, 0, -1, -20, -20, 1, 1)
        $audioShape.AnimationSettings.PlaySettings.PlayOnEntry = -1
        $audioShape.AnimationSettings.PlaySettings.HideWhileNotPlaying = -1
        $slide.SlideShowTransition.AdvanceOnTime = -1
        $slide.SlideShowTransition.AdvanceTime = $duration
    }

    $presentation.SaveAs($presentationPath, 24)
    $presentation.CreateVideo($videoPath, -1, 5, 1080, 30, 85)

    $deadline = (Get-Date).AddMinutes(20)
    $lastLength = -1L
    $stableChecks = 0
    do {
        Start-Sleep -Seconds 5
        try {
            $status = [int]$presentation.CreateVideoStatus
        }
        catch {
            $status = 0
        }
        if ($status -eq 4) {
            throw "PowerPoint video export failed."
        }
        if (Test-Path -LiteralPath $videoPath) {
            $currentLength = (Get-Item -LiteralPath $videoPath).Length
            if ($currentLength -gt 0 -and $currentLength -eq $lastLength) {
                $stableChecks++
            }
            else {
                $stableChecks = 0
                $lastLength = $currentLength
            }
        }
        if ((Get-Date) -gt $deadline) {
            throw "PowerPoint video export timed out."
        }
    } while ($status -ne 3 -and $stableChecks -lt 3)

    if (-not (Test-Path -LiteralPath $videoPath)) {
        throw "PowerPoint video export did not create an output file."
    }
}
finally {
    if ($null -ne $presentation) {
        try {
            $presentation.Close()
        }
        catch {
            Write-Warning "PowerPoint presentation cleanup was deferred: $($_.Exception.Message)"
        }
        finally {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($presentation)
        }
    }
    if ($null -ne $powerPoint) {
        try {
            $powerPoint.Quit()
        }
        catch {
            Write-Warning "PowerPoint application cleanup was deferred: $($_.Exception.Message)"
        }
        finally {
            [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($powerPoint)
        }
    }
    [GC]::Collect()
    [GC]::WaitForPendingFinalizers()
}

$video = Get-Item -LiteralPath $videoPath
$videoMedia = $player.newMedia($videoPath)
Start-Sleep -Seconds 1
$durationSeconds = [math]::Round([double]$videoMedia.duration, 1)
$hash = (Get-FileHash -LiteralPath $videoPath -Algorithm SHA256).Hash.ToLowerInvariant()
$commit = (& git -C $root rev-parse HEAD).Trim()

[ordered]@{
    generatedAt = [DateTime]::UtcNow.ToString("o")
    sourceCommit = $commit
    proofRuns = @(32714075611, 32714080799)
    slides = $slides.Count
    durationSeconds = $durationSeconds
    sizeBytes = $video.Length
    sha256 = $hash
    video = $video.Name
    presentation = [IO.Path]::GetFileName($presentationPath)
} | ConvertTo-Json | Set-Content -LiteralPath $manifestPath -Encoding utf8

Remove-Item -LiteralPath $audioDirectory -Recurse -Force
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($player)
[void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($voice)
[GC]::Collect()
[GC]::WaitForPendingFinalizers()
[OfficeAutomation.MessageFilter]::Revoke()
Get-Content -LiteralPath $manifestPath
