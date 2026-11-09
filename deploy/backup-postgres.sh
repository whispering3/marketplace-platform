#!/usr/bin/env bash
set -euo pipefail
umask 077
# Configure PGHOST, PGPORT, PGDATABASE, PGUSER and PGPASSFILE outside this script.
: "${PGDATABASE:?Configure PGDATABASE}"
: "${PGPASSFILE:?Configure PGPASSFILE}"
backup_dir=/var/backups/market
install -d -m 700 "$backup_dir"
stamp=$(date -u +%Y%m%dT%H%M%S)-$$
partial="$backup_dir/market-$stamp.dump.partial"
final="$backup_dir/market-$stamp.dump"
pg_dump --format=custom --file="$partial"
pg_restore --list "$partial" >/dev/null
mv -- "$partial" "$final"
printf 'PostgreSQL backup created: %s\n' "$final"
