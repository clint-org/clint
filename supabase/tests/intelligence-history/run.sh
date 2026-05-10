#!/usr/bin/env bash
# Run every .sql file in this directory against local Supabase Postgres via docker exec.
# Tests skip cleanly with "no seed data; skipping" when the entity tables are
# empty -- see README.md for details on how to seed demo data first.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CONTAINER="${INTEL_DB_CONTAINER:-supabase_db_clint-v2}"
for f in "$HERE"/*.sql; do
  echo "--- $f"
  docker exec -i -e PSQLRC=/dev/null "$CONTAINER" \
    psql -U postgres -d postgres -v ON_ERROR_STOP=1 < "$f"
done
echo "All intelligence-history tests passed."
