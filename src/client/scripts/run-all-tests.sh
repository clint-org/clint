#!/bin/bash
# Runs every test layer in sequence and prints a per-phase timing summary at
# the end. Used by .git/hooks/pre-push and as the local "is this branch safe
# to push" check. Assumes local Supabase is reachable (will start it if not).

set -e
set -o pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$(dirname "$CLIENT_DIR")")"

declare -a PHASE_NAMES
declare -a PHASE_TIMES

phase() {
  local name=$1; shift
  local start=$(date +%s)
  echo ""
  echo "=========================================="
  echo "  PHASE: $name"
  echo "=========================================="
  if "$@"; then
    local end=$(date +%s)
    local dur=$((end - start))
    PHASE_NAMES+=("$name")
    PHASE_TIMES+=("$dur")
    echo "[$name] OK in ${dur}s"
  else
    local rc=$?
    local end=$(date +%s)
    local dur=$((end - start))
    PHASE_NAMES+=("$name (FAIL)")
    PHASE_TIMES+=("$dur")
    print_summary
    exit $rc
  fi
}

print_summary() {
  echo ""
  echo "=========================================="
  echo "  TIMING SUMMARY"
  echo "=========================================="
  local total=0
  for i in "${!PHASE_NAMES[@]}"; do
    printf "  %-30s %4ds\n" "${PHASE_NAMES[$i]}" "${PHASE_TIMES[$i]}"
    total=$((total + PHASE_TIMES[i]))
  done
  printf "  %-30s %4ds\n" "TOTAL" "$total"
}

cd "$CLIENT_DIR"

phase "lint" npm run lint
phase "units (vitest)" npm run test:units
phase "units (playwright)" npm run test:unit
phase "worker" npm run test:worker
phase "build" npm run build

# Supabase setup for integration + e2e (one db reset shared across both)
cd "$PROJECT_DIR"
if ! supabase status > /dev/null 2>&1; then
  echo "Starting Supabase..."
  supabase start
fi

echo ""
echo "=========================================="
echo "  Resetting Supabase DB (shared by integration + e2e)"
echo "=========================================="
phase "db reset" supabase db reset

KEYS=$(supabase status 2>&1)
ANON_KEY=$(echo "$KEYS" | grep "Publishable" | sed 's/.*│ *\([^ ]*\) *│ *$/\1/')
SERVICE_KEY=$(echo "$KEYS" | grep "│ Secret " | grep -v "Key" | sed 's/.*│ *\([^ ]*\) *│ *$/\1/')
JWT_SECRET=$(supabase status -o env | grep JWT_SECRET | cut -d= -f2 | tr -d '"')
DB_URL=$(supabase status -o env | grep DB_URL | cut -d= -f2 | tr -d '"')

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ] || [ -z "$JWT_SECRET" ]; then
  echo "Failed to extract Supabase keys"
  exit 1
fi

export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"
export SUPABASE_JWT_SECRET="$JWT_SECRET"
export SUPABASE_DB_URL="$DB_URL"

cd "$CLIENT_DIR"

phase "integration" npm run test:integration
# Skip e2e/run.sh (it would reset the DB again); call playwright directly so
# we reuse the reset above. Playwright's webServer config will spin up
# `ng serve --port 4201` itself if not already running.
phase "e2e (playwright)" npx playwright test --reporter=list

print_summary
