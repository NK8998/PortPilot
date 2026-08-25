$testExe = Join-Path $PSScriptRoot 'CoverageTests.exe'
& $testExe --gtest_output=json:results.json
$summary = Get-Content 'results.json' | ConvertFrom-Json
$ran = $summary.tests
$passed = $ran - $summary.failures
if ($LASTEXITCODE -ne 0) { throw "tests failed" }
if ($ran -eq 0 -or $ran -ne $passed) {
    throw "expected a nonzero run with no failures"
}
