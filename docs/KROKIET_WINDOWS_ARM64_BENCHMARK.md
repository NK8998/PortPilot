# Krokiet Windows Arm64 Port and Benchmark Guide

**Target:** [qarmin/czkawka](https://github.com/qarmin/czkawka), Krokiet frontend
**Reference release:** `12.0.2`
**Last verified:** September 16, 2026

This guide produces a native Windows Arm64 build of Krokiet and compares it with
the equivalent x64 build running under Windows emulation on the **same Windows
Arm device**. It covers architecture proof, deterministic scan workloads, GUI
startup, ETW profiling, energy use, result analysis, and evidence retention.

The headline comparison is:

> Native Arm64 versus emulated x64, on the same device, using the same source,
> features, dataset, settings, and power policy.

QEMU is useful for the S4 functional launch gate, but it must not be used for
performance, power, battery, thermal, device, or native-execution claims.

## 1. Expected outputs

Retain the following under a run directory such as
`runs/krokiet-arm64/evidence/`:

```text
environment/
  systeminfo.txt
  device.json
  power-policy.txt
  battery-before.html
source/
  revision.txt
  submodules.txt
  source-status.txt
architecture/
  arm64.json
  x64.json
  runtime-arm64.png
  runtime-x64.png
corpus/
  corpus-config.json
  corpus-manifest.csv
performance/
  raw-runs.csv
  summary.csv
  arm64.etl
  x64.etl
power/
  srum-before.xml
  srum-after.xml
  meter-arm64.csv
  meter-x64.csv
report.md
```

Do not report a result unless its raw output is retained. A missing or unrun
gate is `not-run`, never `pass`.

## 2. Test hardware and software

### Required

- A physical Windows 11 Arm64 device
- AC power for performance tests
- A healthy battery for energy tests
- At least 40 GB free on the internal SSD
- Visual Studio 2022 Build Tools:
  - Desktop C++ workload
  - MSVC Arm64 build tools
  - MSVC x64 build tools
  - Current Windows 11 SDK
- Git
- Rust through `rustup`
- Python 3 for corpus generation
- Windows Performance Toolkit from the Windows ADK:
  - Windows Performance Recorder (`wpr.exe`)
  - Windows Performance Analyzer (`wpa.exe`)

### Recommended

- A USB-C power meter that logs timestamped voltage, current, watts, and Wh to
  CSV
- A lux meter, or a display calibration tool, to set the panel to 150 nits
- An external thermometer to record ambient temperature

Do not use Task Manager's instantaneous CPU or "power usage" label as the
primary benchmark. It is useful for observation, not controlled measurement.

### References

- [Windows performance profiling tools](https://learn.microsoft.com/windows/apps/develop/performance/profiling-tools)
- [Windows Performance Recorder](https://learn.microsoft.com/windows-hardware/test/wpt/windows-performance-recorder)
- [Windows Performance Analyzer](https://learn.microsoft.com/windows-hardware/test/wpt/windows-performance-analyzer)
- [Energy Efficiency assessment](https://learn.microsoft.com/windows-hardware/test/assessments/energy-efficiency)
- [`powercfg` command-line options](https://learn.microsoft.com/windows-hardware/design/device-experiences/powercfg-command-line-options)
- [Battery-life device setup](https://learn.microsoft.com/windows-hardware/test/assessments/device-under-test-setup-for-battery-life)

## 3. Reproducibility rules

1. Build x64 and Arm64 from the same immutable Git revision.
2. Use the same Rust version, Cargo lock file, optimization settings, renderer
   features, and optional codecs.
3. Run both builds on the same Arm device.
4. Keep the dataset on the same internal SSD and do not modify it between runs.
5. Use the same Windows build, firmware, drivers, power mode, brightness,
   refresh rate, network state, and ambient conditions.
6. Alternate the execution order so thermal drift does not favor one build.
7. Separate cold-cache, warm-cache, performance, and battery tests.
8. Retain failed attempts; never rewrite a failed run into a pass.
9. Verify the PE machine field before interpreting any runtime result.
10. Pair the native Arm64 result with the x64-emulated control.

## 4. Capture the environment

Open PowerShell and create the evidence directory:

```powershell
$Evidence = "$PWD\runs\krokiet-arm64\evidence"
New-Item -ItemType Directory -Force `
  "$Evidence\environment", "$Evidence\source", "$Evidence\architecture", `
  "$Evidence\corpus", "$Evidence\performance", "$Evidence\power" | Out-Null

systeminfo | Out-File "$Evidence\environment\systeminfo.txt"
powercfg /getactivescheme | Out-File "$Evidence\environment\power-policy.txt"
powercfg /batteryreport /output "$Evidence\environment\battery-before.html"

[pscustomobject]@{
  ComputerSystem = Get-CimInstance Win32_ComputerSystem
  Processor      = Get-CimInstance Win32_Processor
  OperatingSystem = Get-CimInstance Win32_OperatingSystem
} | ConvertTo-Json -Depth 4 |
    Set-Content "$Evidence\environment\device.json"
```

Also record:

- Device manufacturer and model
- Snapdragon/Arm SoC
- RAM and SSD
- BIOS/UEFI and device firmware versions
- GPU and storage driver versions
- Windows edition, version, build, and update revision
- Display resolution, refresh rate, HDR state, and brightness
- Ambient temperature
- Whether the test used AC, battery, or a logging power meter

## 5. Pin the Krokiet source

Use a clean directory:

```powershell
git clone https://github.com/qarmin/czkawka.git
Set-Location czkawka
git checkout --detach 12.0.2
git submodule update --init --recursive

git rev-parse HEAD | Set-Content "$Evidence\source\revision.txt"
git submodule status --recursive |
  Set-Content "$Evidence\source\submodules.txt"
git status --short --branch |
  Set-Content "$Evidence\source\source-status.txt"
```

For a newer release, replace `12.0.2` only after auditing its dependencies and
recording the new immutable commit SHA. Do not benchmark a moving branch name.

Krokiet is GPL-3.0-only because of its Slint licensing. Preserve all required
license notices when distributing builds.

## 6. Build matched x64 and Arm64 binaries

Upstream currently builds Windows Krokiet with Rust `1.94.1`. Install that
toolchain and both Windows targets:

```powershell
rustup toolchain install 1.94.1
rustup default 1.94.1
rustup target add aarch64-pc-windows-msvc
rustup target add x86_64-pc-windows-msvc

rustc -Vv | Set-Content "$Evidence\environment\rustc.txt"
cargo -V | Set-Content "$Evidence\environment\cargo.txt"
```

Use the same renderer set for both architectures. This guide uses Krokiet's
FemtoVG/OpenGL renderer with the software fallback:

```powershell
$Features = "winit_femtovg,winit_software"

cargo build --release --locked `
  --target x86_64-pc-windows-msvc `
  -p krokiet --bin krokiet `
  --no-default-features --features $Features

cargo build --release --locked `
  --target x86_64-pc-windows-msvc `
  -p czkawka_cli --bin czkawka_cli

cargo build --release --locked `
  --target aarch64-pc-windows-msvc `
  -p krokiet --bin krokiet `
  --no-default-features --features $Features

cargo build --release --locked `
  --target aarch64-pc-windows-msvc `
  -p czkawka_cli --bin czkawka_cli
```

Stage the artifacts:

```powershell
New-Item -ItemType Directory -Force `
  "$PWD\dist\x64", "$PWD\dist\arm64" | Out-Null

Copy-Item target\x86_64-pc-windows-msvc\release\krokiet.exe dist\x64\
Copy-Item target\x86_64-pc-windows-msvc\release\czkawka_cli.exe dist\x64\
Copy-Item target\aarch64-pc-windows-msvc\release\krokiet.exe dist\arm64\
Copy-Item target\aarch64-pc-windows-msvc\release\czkawka_cli.exe dist\arm64\
```

Do not enable `heif`, `libraw`, or `libavif` in only one architecture. Those
features introduce native dependencies and must have an explicit Arm64
dependency disposition before they enter the comparison. Similar-video testing
also requires the same Arm64-capable `ffmpeg.exe` package for both runs.

## 7. Prove the binary architectures

From the PortPilot repository:

```powershell
$ArmFiles = Get-ChildItem .\dist\arm64\*.exe
$X64Files = Get-ChildItem .\dist\x64\*.exe

& C:\path\to\PortPilot\scripts\Test-PeArchitecture.ps1 `
  -Path $ArmFiles.FullName -ExpectedMachine ARM64 `
  -OutputPath "$Evidence\architecture\arm64.json"

& C:\path\to\PortPilot\scripts\Test-PeArchitecture.ps1 `
  -Path $X64Files.FullName -ExpectedMachine AMD64 `
  -OutputPath "$Evidence\architecture\x64.json"
```

Expected PE values:

| Build | Machine |
|---|---|
| Native Arm64 | `0xAA64` |
| x64 control | `0x8664` |

Launch both Krokiet builds and capture Task Manager's **Architecture** column:

- Arm64 build: `ARM64`
- x64 build: `x64`, running through Windows emulation

The static PE check and runtime process check prove different things. Retain
both.

## 8. Generate a synthetic corpus

Do not benchmark against personal files, confidential content, a cloud-synced
directory, or a directory modified by another process. Install Pillow, then use
the following script to create a disposable corpus containing small files,
large files, exact duplicates, and generated PNG image variants:

```powershell
python -m pip install pillow
```

Save as `make-krokiet-corpus.py`:

```python
import argparse
import csv
import hashlib
import json
import random
import shutil
from pathlib import Path
from PIL import Image, ImageEnhance


def deterministic_bytes(seed: int, length: int) -> bytes:
    output = bytearray()
    counter = 0
    while len(output) < length:
        output.extend(hashlib.sha256(f"{seed}:{counter}".encode()).digest())
        counter += 1
    return bytes(output[:length])


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as stream:
        for block in iter(lambda: stream.read(8 * 1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


parser = argparse.ArgumentParser()
parser.add_argument("root", type=Path)
parser.add_argument("--seed", type=int, default=20260916)
parser.add_argument("--small-unique", type=int, default=15000)
parser.add_argument("--large-unique", type=int, default=48)
parser.add_argument("--large-mib", type=int, default=128)
args = parser.parse_args()

root = args.root.resolve()
if root.exists() and any(root.iterdir()):
    raise SystemExit(f"refusing to overwrite non-empty directory: {root}")

small = root / "small"
large = root / "large"
images = root / "images"
for directory in (small, large, images):
    directory.mkdir(parents=True, exist_ok=True)

rng = random.Random(args.seed)

# Metadata-heavy tree: one unique file and one independent duplicate copy.
for index in range(args.small_unique):
    group = small / f"{index % 256:03d}"
    group.mkdir(exist_ok=True)
    source = group / f"unique-{index:06d}.bin"
    source.write_bytes(deterministic_bytes(args.seed + index, rng.randint(1024, 65536)))
    if index % 3 == 0:
        shutil.copyfile(source, group / f"duplicate-{index:06d}.bin")

# Throughput-heavy tree: 6 GiB unique + 2 GiB duplicate data by default.
for index in range(args.large_unique):
    source = large / f"unique-{index:04d}.bin"
    chunk = deterministic_bytes(args.seed + 100000 + index, 1024 * 1024)
    with source.open("wb") as stream:
        for _ in range(args.large_mib):
            stream.write(chunk)
    if index % 3 == 0:
        shutil.copyfile(source, large / f"duplicate-{index:04d}.bin")

# Generated PNG originals and slightly changed variants.
for index in range(500):
    width, height = 512, 384
    image = Image.new("RGB", (width, height))
    pixels = image.load()
    for y in range(height):
        for x in range(width):
            pixels[x, y] = (
                (x + index) % 256,
                (y * 3 + index) % 256,
                (x + y + index * 7) % 256,
            )
    source = images / f"image-{index:04d}.png"
    image.save(source, optimize=False)
    if index % 4 == 0:
        shutil.copyfile(source, images / f"image-copy-{index:04d}.png")
    ImageEnhance.Brightness(image).enhance(1.04).save(
        images / f"image-bright-{index:04d}.png",
        optimize=False,
    )

manifest = []
for path in sorted(p for p in root.rglob("*") if p.is_file()):
    manifest.append({
        "path": str(path.relative_to(root)),
        "size": path.stat().st_size,
        "sha256": sha256(path),
    })

with (root / "corpus-manifest.csv").open("w", newline="", encoding="utf-8") as stream:
    writer = csv.DictWriter(stream, fieldnames=("path", "size", "sha256"))
    writer.writeheader()
    writer.writerows(manifest)

(root / "corpus-config.json").write_text(json.dumps({
    "seed": args.seed,
    "small_unique": args.small_unique,
    "large_unique": args.large_unique,
    "large_mib": args.large_mib,
    "files": len(manifest),
    "bytes": sum(item["size"] for item in manifest),
}, indent=2), encoding="utf-8")
```

Generate the corpus once:

```powershell
python .\make-krokiet-corpus.py C:\krokiet-bench\corpus
Copy-Item C:\krokiet-bench\corpus\corpus-* "$Evidence\corpus\"
```

The default corpus is roughly 8 GiB plus the small-file and image sets. Increase
it only if every measured run is too short to reach steady-state CPU and power.

## 9. Define the workloads

Use `czkawka_cli.exe` for deterministic engine measurements. Krokiet and the CLI
share `czkawka_core`, while CLI execution avoids mouse-position and reaction-time
noise.

### Duplicate hash scan

```powershell
.\dist\arm64\czkawka_cli.exe dup `
  -d C:\krokiet-bench\corpus `
  -s HASH -t BLAKE3 -H -N -M -W
```

Flags:

- `-H`: disable Krokiet's persistent hash cache
- `-N`: suppress result printing
- `-M`: suppress messages
- `-W`: return zero when duplicates are found

The x64 command must differ only in executable path:

```powershell
.\dist\x64\czkawka_cli.exe dup `
  -d C:\krokiet-bench\corpus `
  -s HASH -t BLAKE3 -H -N -M -W
```

### Metadata traversal

```powershell
.\dist\arm64\czkawka_cli.exe big `
  -d C:\krokiet-bench\corpus -n 100 -N -M -W
```

### Similar-image scan

```powershell
.\dist\arm64\czkawka_cli.exe image `
  -d C:\krokiet-bench\corpus\images `
  --max-difference 5 --hash-size 16 --hash-alg Gradient `
  -H -N -M -W
```

Run the exact equivalent with `dist\x64\czkawka_cli.exe`.

### Cached scan

Run duplicate scanning without `-H` twice. The first run populates Krokiet's
cache; the second measures the warm application-cache path. Use a dedicated
Windows user or set the same Krokiet configuration/cache location for both
architectures. Delete or preserve cache files symmetrically.

### GUI startup and rendering

Run:

```powershell
$env:SLINT_BACKEND = "winit-femtovg"
$env:SLINT_DEBUG_PERFORMANCE = "refresh_lazy,console"
.\dist\arm64\krokiet.exe
```

Repeat with the x64 executable. Confirm the logged renderer is the same. Capture:

- Process creation to first responsive main window
- CPU time during startup
- Peak working set
- GPU utilization
- Idle CPU and watts for 15 minutes
- Window resize and scroll responsiveness

Do not compare one architecture using FemtoVG with another using software,
Skia, Vulkan, or WGPU.

## 10. Performance run protocol

### Stabilize the device

1. Finish Windows Update, Store updates, OEM firmware, and driver updates.
2. Reboot.
3. Wait five minutes without interacting with the device.
4. Use the same power mode for every run.
5. Connect AC power for performance tests.
6. Fix refresh rate and disable adaptive refresh.
7. Close browsers, sync clients, IDEs, terminals not used by the benchmark, and
   other foreground applications.
8. Keep Windows Defender and normal security features in the same state for
   both builds.
9. Confirm no indexing, update, backup, or antivirus scan starts during a run.
10. Record ambient temperature and allow the chassis to return near idle
    temperature between sustained tests.

### Run count and ordering

- Perform two unmeasured warmups for each workload.
- Perform at least five measured runs per architecture.
- Prefer ten runs when each run is shorter than two minutes.
- Alternate architectures in balanced blocks:

```text
Arm64, x64, x64, Arm64
x64, Arm64, Arm64, x64
```

This ABBA/BAAB pattern reduces bias from temperature, battery state, and
background activity.

### Cold versus warm

Do not call a repeated scan "cold" merely because Krokiet's own cache is
disabled. Windows still caches file data.

- **Cold OS-cache run:** reboot, wait five minutes, then run one measurement.
- **Warm OS-cache run:** repeat without rebooting.
- **Cold Krokiet-cache run:** remove or isolate Krokiet's cache before the run.
- **Warm Krokiet-cache run:** retain the cache produced by an identical first
  scan.

Report each category separately. Do not average cold and warm runs together.

## 11. Timing harness

Save as `Invoke-KrokietBenchmark.ps1`:

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Label,
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [Parameter(Mandatory)][string]$OutputCsv,
    [int]$Iterations = 5,
    [int]$CooldownSeconds = 30
)

$ErrorActionPreference = "Stop"
$rows = @()

for ($iteration = 1; $iteration -le $Iterations; $iteration++) {
    $start = Get-Date
    $stopwatch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process `
        -FilePath $Executable `
        -ArgumentList $ArgumentList `
        -PassThru `
        -Wait `
        -NoNewWindow
    $stopwatch.Stop()
    $process.Refresh()

    $rows += [pscustomobject]@{
        TimestampUtc     = $start.ToUniversalTime().ToString("o")
        Label            = $Label
        Iteration        = $iteration
        ElapsedSeconds   = [Math]::Round($stopwatch.Elapsed.TotalSeconds, 6)
        ExitCode         = $process.ExitCode
        CpuSeconds       = [Math]::Round($process.TotalProcessorTime.TotalSeconds, 6)
        PeakWorkingSetMB = [Math]::Round($process.PeakWorkingSet64 / 1MB, 2)
        Machine          = $env:COMPUTERNAME
        PowerScheme      = (powercfg /getactivescheme) -join " "
    }

    if ($process.ExitCode -ne 0) {
        throw "$Label iteration $iteration exited $($process.ExitCode)"
    }
    Start-Sleep -Seconds $CooldownSeconds
}

$parent = Split-Path -Parent $OutputCsv
if ($parent) {
    New-Item -ItemType Directory -Force $parent | Out-Null
}
$rows | Export-Csv -Path $OutputCsv -NoTypeInformation -Append
```

Example:

```powershell
$DuplicateArgs = @(
  "dup",
  "-d", "C:\krokiet-bench\corpus",
  "-s", "HASH",
  "-t", "BLAKE3",
  "-H", "-N", "-M", "-W"
)

.\Invoke-KrokietBenchmark.ps1 `
  -Label arm64-duplicate-cold-app-cache `
  -Executable .\dist\arm64\czkawka_cli.exe `
  -ArgumentList $DuplicateArgs `
  -OutputCsv "$Evidence\performance\raw-runs.csv"

.\Invoke-KrokietBenchmark.ps1 `
  -Label x64-duplicate-cold-app-cache `
  -Executable .\dist\x64\czkawka_cli.exe `
  -ArgumentList $DuplicateArgs `
  -OutputCsv "$Evidence\performance\raw-runs.csv"
```

For strict ABBA ordering, invoke the script with `Iterations 1` in the required
sequence rather than running all Arm64 iterations first.

## 12. ETW profiling with WPR and WPA

Timing tells you **whether** Arm64 is faster. ETW helps explain **why**.

List the available profiles:

```powershell
wpr -profiles
```

Capture one clean workload per trace:

```powershell
wpr -cancel
wpr -start GeneralProfile -filemode

.\dist\arm64\czkawka_cli.exe dup `
  -d C:\krokiet-bench\corpus `
  -s HASH -t BLAKE3 -H -N -M -W

wpr -stop "$Evidence\performance\arm64.etl"
```

Repeat with x64:

```powershell
wpr -cancel
wpr -start GeneralProfile -filemode

.\dist\x64\czkawka_cli.exe dup `
  -d C:\krokiet-bench\corpus `
  -s HASH -t BLAKE3 -H -N -M -W

wpr -stop "$Evidence\performance\x64.etl"
```

Open each trace in WPA and inspect:

- CPU Usage (Sampled), grouped by process, thread, stack, and module
- CPU Usage (Precise), including context switches and wait reasons
- Disk Usage and File I/O
- Process lifetime
- Working Set and commit
- DPC/ISR activity if system noise is suspected
- GPU utilization for Krokiet GUI traces

Look for:

- Time in Windows x64-emulation modules
- Higher CPU time despite similar elapsed time
- Different thread scaling
- Hashing, image decoding, allocator, or filesystem hot paths
- Storage saturation hiding CPU improvements
- Renderer mismatch or software fallback

Do not collect every WPR profile at once. Excessive tracing changes the workload
and produces traces too noisy to interpret.

## 13. Power and battery protocol

Performance and power tests are separate experiments.

### Device controls

For each battery run:

1. Charge to 100%, disconnect AC, and allow post-charge activity to settle.
2. Start the measured interval near 95%.
3. Set display luminance to 150 nits.
4. Disable adaptive brightness, content-adaptive brightness, HDR, and dynamic
   refresh.
5. Use a fixed refresh rate and fixed power mode.
6. Set keyboard backlight, audio volume, Wi-Fi, Bluetooth, and location services
   identically.
7. Disable screen timeout and sleep for the duration of the workload.
8. Keep the display on the same static benchmark window.
9. Record ambient temperature.
10. Run long enough to measure at least a 10 percentage-point battery drop;
    20 points is preferred.

Do not disable security, thermal management, or OEM power controls unless the
goal is explicitly to benchmark that altered configuration.

### Workload loop

Save as `Invoke-KrokietPowerLoop.ps1`:

```powershell
[CmdletBinding()]
param(
    [Parameter(Mandatory)][string]$Executable,
    [Parameter(Mandatory)][string[]]$ArgumentList,
    [int]$Minutes = 30,
    [string]$Log = ".\power-loop.csv"
)

$ErrorActionPreference = "Stop"
$deadline = (Get-Date).AddMinutes($Minutes)
$rows = @()
$iteration = 0

while ((Get-Date) -lt $deadline) {
    $iteration++
    $watch = [Diagnostics.Stopwatch]::StartNew()
    $process = Start-Process `
        -FilePath $Executable `
        -ArgumentList $ArgumentList `
        -PassThru -Wait -NoNewWindow
    $watch.Stop()

    $battery = Get-CimInstance Win32_Battery -ErrorAction SilentlyContinue
    $rows += [pscustomobject]@{
        TimestampUtc       = (Get-Date).ToUniversalTime().ToString("o")
        Iteration          = $iteration
        ElapsedSeconds     = [Math]::Round($watch.Elapsed.TotalSeconds, 3)
        ExitCode           = $process.ExitCode
        EstimatedChargePct = $battery.EstimatedChargeRemaining
    }

    if ($process.ExitCode -ne 0) {
        throw "workload exited $($process.ExitCode)"
    }
}

$rows | Export-Csv $Log -NoTypeInformation
```

Run the same duration and command for x64 and Arm64 on separate charge cycles.
Alternate which architecture is tested first across repeated cycles.

### SRUM snapshots

Windows System Resource Usage Monitor data is secondary evidence:

```powershell
powercfg /srumutil /output "$Evidence\power\srum-before.xml" /xml

# Run the fixed-duration workload.

powercfg /srumutil /output "$Evidence\power\srum-after.xml" /xml
```

SRUM and battery percentage are useful checks, but neither is a precision
instrument. `powercfg /energy` diagnoses system energy-efficiency problems and
should be run while idle; it is not an application energy benchmark.

### Logging USB-C meter

For the strongest independent result:

1. Fully charge the device.
2. Allow charging power to settle.
3. Record a 15-minute idle baseline with the same display and network state.
4. Record the Arm64 workload.
5. Return the device to the same starting state.
6. Record the x64 workload.
7. Repeat at least three times per architecture.

Calculate:

```text
Net workload Wh = measured workload Wh - idle baseline Wh for equal duration
Average watts   = net workload Wh / elapsed hours
Energy per scan = net workload Wh / completed scans
Joules per scan = energy per scan Wh * 3600
```

A whole-device meter includes panel, SSD, memory, radio, conversion losses, and
charging behavior. That is desirable for user-experience claims, but it also
means every device setting must remain fixed.

## 14. Statistics and acceptance rules

Report:

- All individual runs
- Median
- Arithmetic mean
- Standard deviation
- Minimum and maximum
- 95th percentile where at least ten observations exist
- Coefficient of variation: `standard deviation / mean`

Use median elapsed time as the primary performance statistic.

Recommended acceptance rules:

- At least five valid observations per architecture and workload
- Coefficient of variation below 5%; investigate or run longer otherwise
- No failed or missing iterations
- Identical dataset manifest
- Identical source revision and feature set
- Matching renderer for GUI comparisons
- Arm64 PE machine `0xAA64`
- Runtime Arm64 process shown as `ARM64`
- x64 control shown as `x64` on the same Arm device

Calculate:

```text
Speedup (%) =
  (x64 median seconds - Arm64 median seconds) / x64 median seconds * 100

Energy reduction (%) =
  (x64 Wh per scan - Arm64 Wh per scan) / x64 Wh per scan * 100
```

Do not claim a meaningful win when the difference is smaller than the observed
run-to-run variation.

## 15. Feature and Windows-experience checks

Performance alone does not establish a high-quality Windows port. Test both
architectures against the same feature inventory:

| Area | Checks |
|---|---|
| Launch | First run, repeat run, paths containing spaces, non-ASCII user name |
| Display | Scaling at 100/150/200%, light/dark theme, resize, multiple monitors |
| Filesystem | Long paths, Unicode, removable drive, network path, permission errors |
| Tools | Duplicate files, big files, empty files/folders, similar images |
| Actions | Open file, open parent, move, rename, delete, Recycle Bin |
| Reliability | Cancel scan, repeated scan, sleep/resume, low disk space |
| Packaging | Icon, Start Menu, uninstall, no x64 DLLs in Arm64 package |
| Offline | Launch and complete core scans with networking disabled |
| Accessibility | Keyboard navigation, focus, labels, high contrast, text scaling |

Every row in the final feature matrix receives `pass`, `fail`, `degraded`, or
`not-run`, plus retained evidence. Do not silently remove a feature from the
Arm64 build.

## 16. Suggested report

Copy `templates/evidence-report.md` and add a performance table:

```markdown
| Workload | x64 emulated median | Arm64 median | Speedup | x64 Wh/scan | Arm64 Wh/scan | Energy reduction |
|---|---:|---:|---:|---:|---:|---:|
| Duplicate hash, cold OS cache | | | | | | |
| Duplicate hash, warm OS cache | | | | | | |
| Similar images | | | | | | |
| GUI startup | | | | | | |
| GUI idle, 15 min | | | | | | |
```

The sponsor-facing conclusion should be measurable:

> On `<device and SoC>`, native Krokiet Arm64 completed `<workload>` `<X>%`
> faster and used `<Y>%` less energy per completed scan than the identical x64
> build under emulation. Both builds used commit `<SHA>`, renderer `<renderer>`,
> dataset manifest `<SHA>`, and Windows build `<build>`.

If the result is neutral or negative, report it honestly and use WPA traces to
identify the bottleneck. A benchmark that disproves the expected improvement is
still valid evidence.

## 17. PortPilot workflow

Use the PortPilot skills in order:

1. `arm64-readiness` — establish the x64 baseline and inventory architecture
   assumptions.
2. `native-dependency-analysis` — classify Slint, renderer, optional codecs, and
   packaging dependencies.
3. `arm64-strategy-selection` — record classic Arm64 versus Arm64EC.
4. `arm64-build-environment` and `build-retarget` — add and verify the target.
5. `arm64-artifact-verification` — inspect every packaged PE image.
6. `arm64-qemu-verification` — optional S4 launch check only.
7. `arm64-correctness` — resolve target-only failures without regressing x64.
8. `port-completeness` and `arm64-remote-verification` — feature, test,
   non-emulation, performance, and power evidence on real hardware.
9. `port-packaging` and `arm64-ci-integration` — package and continuously test
   the port.

The final pull request upstream should include the Arm64 build configuration,
CI coverage, package changes, retained test results, architecture proof, and an
honest statement of any unmeasured or degraded feature.
