$testExe = Join-Path $PSScriptRoot 'CoverageTests.exe'
& $testExe
if ($LASTEXITCODE -ne 0) {
    throw "tests failed"
}
