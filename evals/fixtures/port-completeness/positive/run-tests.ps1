$testExe = Join-Path $PSScriptRoot 'CoverageTests.exe'
& $testExe --gtest_filter=-CppCliTests.*
if ($LASTEXITCODE -ne 0) {
    throw "tests failed"
}
