$compiler = Get-Command "$env:VCToolsInstallDir\bin\Hostx64\arm64\cl.exe" -ErrorAction SilentlyContinue
$crt = Test-Path -LiteralPath "$env:VCToolsInstallDir\lib\arm64\libcpmt.lib" -PathType Leaf
if (-not $compiler -or -not $crt) { throw "ARM64 compiler and CRT are required." }
