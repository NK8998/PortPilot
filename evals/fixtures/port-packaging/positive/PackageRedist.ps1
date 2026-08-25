Copy-Item "$VsRoot\VC\Redist\MSVC\14.44.35112\arm64\Microsoft.VC143.CRT\*.dll" $Stage
New-Item -ItemType Directory -Force "$Stage\Binaries\Plugins\Exporter" | Out-Null
Compress-Archive -Path "$Stage\Binaries", "$Stage\licenses" -DestinationPath $Zip
Expand-Archive -Path $Zip -DestinationPath $Expanded -Force
Get-ChildItem $Expanded -Recurse -File | ForEach-Object { Get-PeMachine $_.FullName }
