$Files = @("OpenCppCoverage.exe", "OpenCppCoverage.dll", "LICENSE")
foreach ($File in $Files) { Copy-Item "$BuildDir\$File" "$Stage\$File" }
Compress-Archive -Path "$Stage\OpenCppCoverage.exe", "$Stage\OpenCppCoverage.dll", "$Stage\LICENSE" -DestinationPath OpenCppCoverage-win-arm64.zip
Get-FileHash OpenCppCoverage-win-arm64.zip -Algorithm SHA256
