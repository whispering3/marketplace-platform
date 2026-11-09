$ErrorActionPreference = "Stop"

$projectRoot = (Resolve-Path (Join-Path $PSScriptRoot "..")).Path
$artifactDir = Join-Path $projectRoot ".local-test"
$runtimeFile = Join-Path $artifactDir "runtime.env"
if (!(Test-Path -LiteralPath $runtimeFile)) {
  throw "Missing .local-test/runtime.env. Run npm run local:test:setup first."
}

$existing = Get-NetTCPConnection -LocalPort 3000 -State Listen -ErrorAction SilentlyContinue
if ($existing) {
  throw "Port 3000 is already in use by process $($existing.OwningProcess)."
}

Get-Content -LiteralPath $runtimeFile | ForEach-Object {
  if ($_ -match '^([^=]+)=(.*)$') {
    $name = $matches[1]
    $value = $matches[2] | ConvertFrom-Json
    [Environment]::SetEnvironmentVariable($name, [string]$value, "Process")
  }
}

$stdoutPath = Join-Path $artifactDir "server.stdout.log"
$stderrPath = Join-Path $artifactDir "server.stderr.log"
$build = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "build") `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -Wait `
  -PassThru
if ($build.ExitCode -ne 0) {
  throw "Production build failed with code $($build.ExitCode)."
}
$server = Start-Process `
  -FilePath "npm.cmd" `
  -ArgumentList @("run", "start", "--", "--hostname", "127.0.0.1", "--port", "3000") `
  -WorkingDirectory $projectRoot `
  -WindowStyle Hidden `
  -RedirectStandardOutput $stdoutPath `
  -RedirectStandardError $stderrPath `
  -PassThru

$server.Id | Set-Content -LiteralPath (Join-Path $artifactDir "server.pid")
$deadline = (Get-Date).AddSeconds(60)
$response = $null
do {
  Start-Sleep -Milliseconds 500
  try {
    $response = Invoke-WebRequest -UseBasicParsing -Uri "http://127.0.0.1:3000/api/health" -TimeoutSec 3
  } catch {
    $response = $null
  }
} while (!$response -and (Get-Date) -lt $deadline -and !$server.HasExited)

if ($server.HasExited) {
  Get-Content -LiteralPath $stderrPath -Tail 80
  throw "Local server exited with code $($server.ExitCode)."
}
if (!$response) {
  Get-Content -LiteralPath $stderrPath -Tail 80
  throw "Local server did not become ready within 60 seconds."
}

[pscustomobject]@{
  Url = "http://localhost:3000"
  HealthStatus = $response.StatusCode
  ProcessId = $server.Id
  Database = "market_demo_localhost"
} | Format-List
