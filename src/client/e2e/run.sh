#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
PROJECT_DIR="$(dirname "$(dirname "$CLIENT_DIR")")"

cd "$PROJECT_DIR"

if ! supabase status > /dev/null 2>&1; then
  echo "Starting Supabase..."
  supabase start
fi

echo "Resetting database..."
supabase db reset

KEYS=$(supabase status 2>&1)
ANON_KEY=$(echo "$KEYS" | grep "Publishable" | awk '{print $NF}')
SERVICE_KEY=$(echo "$KEYS" | grep "Secret" | awk '{print $NF}')

if [ -z "$ANON_KEY" ] || [ -z "$SERVICE_KEY" ]; then
  echo "Failed to get Supabase keys"
  exit 1
fi

cd "$CLIENT_DIR"

export SUPABASE_URL=http://127.0.0.1:54321
export SUPABASE_ANON_KEY="$ANON_KEY"
export SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY"

npx playwright test "$@"
