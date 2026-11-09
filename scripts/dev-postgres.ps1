param(
  [ValidateSet("start", "stop", "status")]
  [string]$Action = "start"
)

$ErrorActionPreference = "Stop"

$Root = Resolve-Path (Join-Path $PSScriptRoot "..")
$DataDir = Join-Path $Root ".local-postgres\data"
$LogFile = Join-Path $Root ".local-postgres\postgres.log"
$PgCtl = "C:\Program Files\PostgreSQL\18\bin\pg_ctl.exe"
$PgReady = "C:\Program Files\PostgreSQL\18\bin\pg_isready.exe"

if (!(Test-Path $PgCtl)) {
  throw "PostgreSQL 18 pg_ctl.exe not found at $PgCtl"
}

if (!(Test-Path $DataDir)) {
  throw "Local database cluster not found at $DataDir"
}

switch ($Action) {
  "start" {
    & $PgReady -h 127.0.0.1 -p 55432 -U olympus | Out-Null
    if ($LASTEXITCODE -eq 0) {
      Write-Host "Local PostgreSQL is already running on 127.0.0.1:55432"
      exit 0
    }

    & $PgCtl -D $DataDir -l $LogFile -o '"-p" "55432" "-h" "127.0.0.1"' start
  }
  "stop" {
    & $PgCtl -D $DataDir stop
  }
  "status" {
    & $PgReady -h 127.0.0.1 -p 55432 -U olympus
    exit $LASTEXITCODE
  }
}
