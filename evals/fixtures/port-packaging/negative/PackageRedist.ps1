Get-ChildItem "$VsRoot\VC\Redist\MSVC\14.44.35112\arm64\Microsoft.VC143.CRT\*.dll" |
    Where-Object { (Get-PeMachine $_.FullName) -eq "ARM64" } |
    Copy-Item -Destination $Stage
New-Item -ItemType Directory -Force "$Stage\Binaries\Plugins\Exporter" | Out-Null
Set-Content -Path "$Stage\Binaries\Plugins\Exporter\README.txt" -Value "Required by GetPluginsExportFolder."
Compress-Archive -Path "$Stage\Binaries", "$Stage\licenses" -DestinationPath $Zip
Expand-Archive -Path $Zip -DestinationPath $Expanded -Force
Get-ChildItem $Expanded -Recurse -File | ForEach-Object { Get-PeMachine $_.FullName }
& "$Expanded\Binaries\OpenCppCoverage.exe" --help
