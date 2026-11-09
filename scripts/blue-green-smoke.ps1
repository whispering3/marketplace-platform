param(
  [string]$BaseUrl = "http://127.0.0.1:3000"
)

$ErrorActionPreference = "Stop"

$health = Invoke-RestMethod -Uri "$BaseUrl/api/health" -TimeoutSec 15
if (-not $health.ok) {
  throw "Health check failed for $BaseUrl"
}

$marketHomeResponse = Invoke-WebRequest -UseBasicParsing -Uri "$BaseUrl/" -TimeoutSec 15
if ($marketHomeResponse.StatusCode -ne 200) {
  throw "Home check failed for $BaseUrl"
}

Write-Output "OK $BaseUrl color=$($health.color) commit=$($health.commit)"
