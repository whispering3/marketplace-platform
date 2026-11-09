param(
  [Parameter(Mandatory=$true)]
  [string]$BackupPath,
  [Parameter(Mandatory=$true)]
  [string]$TargetDatabaseUrl
)

$ErrorActionPreference = "Stop"
. (Join-Path $PSScriptRoot "lib/postgres-url.ps1")
$restoreUrl = ConvertTo-PostgresToolUrl $TargetDatabaseUrl

if (!(Test-Path $BackupPath)) {
  throw "Backup file not found: $BackupPath"
}

if (!(Get-Command pg_restore -ErrorAction SilentlyContinue)) {
  throw "pg_restore not found in PATH"
}

pg_restore --list $BackupPath | Out-Null
if ($LASTEXITCODE -ne 0) { throw "Invalid or unreadable backup archive" }
Write-Output "Restoring backup into target database..."
pg_restore --single-transaction --exit-on-error --clean --if-exists --no-owner --no-acl --dbname=$restoreUrl $BackupPath
if ($LASTEXITCODE -ne 0) { throw "Restore failed and was rolled back" }
Write-Output "Restore completed."
