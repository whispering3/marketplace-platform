function ConvertTo-PostgresToolUrl {
  param([Parameter(Mandatory=$true)][string]$ConnectionUrl)

  $uri = [UriBuilder]::new($ConnectionUrl)
  if ($uri.Scheme -notin @('postgres', 'postgresql')) { throw 'Expected a PostgreSQL connection URL' }
  # These options belong to Prisma, not libpq/pg_dump/pg_restore.
  $prismaOptions = @('schema', 'connection_limit', 'pool_timeout', 'pgbouncer', 'socket_timeout')
  $queryParts = @($uri.Query.TrimStart('?').Split('&') | Where-Object {
    $_ -and ([Uri]::UnescapeDataString(($_ -split '=', 2)[0]) -notin $prismaOptions)
  })
  $uri.Query = $queryParts -join '&'
  return $uri.Uri.AbsoluteUri
}
