#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${SUPERSET_WORKSPACE_NAME:?SUPERSET_WORKSPACE_NAME must be set}"

# 5 fixed slots (0-4), offset by 100 each. Hash workspace name to pick one.
HASH=$(printf '%s' "$WORKSPACE" | cksum | awk '{print $1}')
SLOT=$((HASH % 5))
OFFSET=$((SLOT * 100))

API_PORT=$((54321 + OFFSET))
DB_PORT=$((54322 + OFFSET))
SHADOW_PORT=$((54320 + OFFSET))
POOLER_PORT=$((54329 + OFFSET))
STUDIO_PORT=$((54323 + OFFSET))
INBUCKET_PORT=$((54324 + OFFSET))
ANALYTICS_PORT=$((54327 + OFFSET))
INSPECTOR_PORT=$((8083 + OFFSET))
DEV_PORT=$((8000 + OFFSET))
PROJECT_ID="clint-slot-${SLOT}"

# Persist for run.sh
cat > .superset/.ports <<EOF
DEV_PORT=$DEV_PORT
EOF

echo "Workspace '$WORKSPACE' -> slot $SLOT"
echo "  API:    $API_PORT"
echo "  DB:     $DB_PORT"
echo "  Studio: $STUDIO_PORT"
echo "  Dev:    $DEV_PORT"

# Restore tracked files to branch baseline before patching
git checkout -- supabase/config.toml src/client/src/environments/environment.local.ts

# Patch supabase/config.toml
sed -i '' \
  -e 's/^project_id = "clint-v2"/project_id = "'"$PROJECT_ID"'"/' \
  -e 's/^port = 54321/port = '"$API_PORT"'/' \
  -e 's/^port = 54322/port = '"$DB_PORT"'/' \
  -e 's/shadow_port = 54320/shadow_port = '"$SHADOW_PORT"'/' \
  -e 's/^port = 54329/port = '"$POOLER_PORT"'/' \
  -e 's/^port = 54323/port = '"$STUDIO_PORT"'/' \
  -e 's/^port = 54324/port = '"$INBUCKET_PORT"'/' \
  -e 's/^port = 54327/port = '"$ANALYTICS_PORT"'/' \
  -e 's/inspector_port = 8083/inspector_port = '"$INSPECTOR_PORT"'/' \
  -e 's|http://localhost:8000|http://localhost:'"$DEV_PORT"'|g' \
  -e 's|http://localhost:54321|http://localhost:'"$API_PORT"'|g' \
  supabase/config.toml

# Patch Angular local environment
sed -i '' \
  "s|http://127.0.0.1:54321|http://127.0.0.1:$API_PORT|" \
  src/client/src/environments/environment.local.ts

# Install frontend dependencies
(cd src/client && npm install)

# Start this slot's Supabase stack
supabase start
