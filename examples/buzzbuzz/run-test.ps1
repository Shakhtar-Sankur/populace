# Run the Buzz Buzz simulation from Windows PowerShell.
#
# Exists because the bash one-liner does not work here: PowerShell 5.1 has no
# `&&` statement separator and no `VAR=value command` prefix, so pasting the
# Unix form fails with "The token '&&' is not a valid statement separator".
#
#   .\run-test.ps1                    # 6 drivers, 5 minutes
#   .\run-test.ps1 -Agents 4 -Minutes 3
#   .\run-test.ps1 -Clean             # just remove any leftover accounts
#
# Run it from anywhere; it locates itself.

param(
  [int]$Agents  = 6,
  [int]$Minutes = 5,
  [switch]$Clean
)

$ErrorActionPreference = "Stop"
Set-Location $PSScriptRoot

# This machine's link is NAT64 and Node otherwise wastes 10s per connection
# trying IPv4 first. Harmless on a normal network.
$env:NODE_OPTIONS = "--dns-result-order=ipv6first"

# The isolated test project. Never a production host — populace.config.mjs
# lists the live ones in neverRunAgainst and refuses them before loading.
$env:BUZZBUZZ_TEST_URL = "https://jqepegeifmnfofeyebrz.supabase.co"
$env:BUZZBUZZ_TEST_KEY = "sb_publishable_ZkOhFsiQBrKMB5pc2Ub1Vw_V5oxsBE1"

$cli = Join-Path $PSScriptRoot "..\..\src\cli.mjs"

if ($Clean) {
  node $cli clean
  exit $LASTEXITCODE
}

Write-Host ""
Write-Host "  Checking the target before running..." -ForegroundColor Cyan
node $cli doctor
if ($LASTEXITCODE -ne 0) {
  Write-Host ""
  Write-Host "  doctor says not ready — stopping here rather than burning a run." -ForegroundColor Yellow
  exit 1
}

node $cli run --agents $Agents --minutes $Minutes
$code = $LASTEXITCODE

# A run exits non-zero when it FINDS something. That is the tool working, not
# the tool failing, so say so rather than leaving a bare red exit code.
Write-Host ""
if ($code -eq 0) {
  Write-Host "  Run finished with no failures." -ForegroundColor Green
} else {
  Write-Host "  Run finished and found problems — see the report above." -ForegroundColor Yellow
  Write-Host "  That is the expected outcome when there is something to find." -ForegroundColor DarkGray
}
exit $code
