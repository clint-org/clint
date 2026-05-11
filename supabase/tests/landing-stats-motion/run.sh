#!/usr/bin/env bash
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${LANDING_STATS_DB_CONTAINER:-supabase_db_clint-v2}"
for f in "$HERE"/*.sql; do
  echo "--- $f"
  docker exec -i -e PSQLRC=/dev/null "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
echo "All landing-stats motion tests passed."
