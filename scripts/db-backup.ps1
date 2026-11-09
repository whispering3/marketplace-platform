param(
  [string]$OutDir = "backups"
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/postgres-url.ps1")

if (!(Test-Path ".env")) {
  throw ".env not found"
}

$databaseUrl = (Select-String -Path ".env" -Pattern '^DATABASE_URL=').Line -replace '^DATABASE_URL=', '' -replace '"', ''
if (!$databaseUrl) {
  throw "DATABASE_URL not found in .env"
}
$databaseUrl = ConvertTo-PostgresToolUrl $databaseUrl

if (!(Get-Command pg_dump -ErrorAction SilentlyContinue)) {
  throw "pg_dump not found in PATH"
}

if (!(Test-Path $OutDir)) {
  New-Item -ItemType Directory -Path $OutDir | Out-Null
}

$timestamp = Get-Date -Format "yyyyMMdd-HHmmss-fff"
$backupPath = Join-Path $OutDir "market-$timestamp.dump"
$partialPath = "$backupPath.partial"

pg_dump $databaseUrl --format=custom --no-owner --no-acl --file=$partialPath
if ($LASTEXITCODE -ne 0) { throw "pg_dump failed. Incomplete output retained at $partialPath" }
if (!(Test-Path -LiteralPath $partialPath) -or (Get-Item -LiteralPath $partialPath).Length -eq 0) {
  throw "pg_dump did not produce a nonempty backup"
}
Move-Item -LiteralPath $partialPath -Destination $backupPath

Write-Output "Backup created: $backupPath"
