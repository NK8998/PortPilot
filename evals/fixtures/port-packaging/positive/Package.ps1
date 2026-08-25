Compress-Archive -Path "$BuildDir\*" -DestinationPath OpenCppCoverage-win-arm64.zip
Copy-Item "$Tools\protoc.exe" "$Stage\protoc.exe"
