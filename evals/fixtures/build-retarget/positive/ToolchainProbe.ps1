$toolset = Join-Path $env:VCToolsInstallDir ""
if (Test-Path "$toolset\lib\arm64") { "ARM64 installed" }
