$testExe = Join-Path $PSScriptRoot 'CoverageTests.exe'
& $testExe --gtest_output=json:results.json
if ($LASTEXITCODE -ne 0) {
    throw "tests failed"
}
$ran = (Get-Content 'results.json' | ConvertFrom-Json).tests
if ($ran -eq 0) {
    throw "the runner exited clean without executing anything"
}
