#!/usr/bin/env bash
set -euo pipefail

WORKSPACE="${SUPERSET_WORKSPACE_NAME:-$(basename "$SUPERSET_WORKSPACE_PATH" 2>/dev/null || basename "$PWD")}"

# Ask whether to spin up an isolated Supabase stack or reuse the main one
echo ""
echo "Worktree: $WORKSPACE"
echo "Spin up a dedicated Supabase Docker env for this worktree?"
echo "  [y] Yes - isolated stack (uses extra ports + memory)"
echo "  [N] No  - reuse the main clint-v2 stack (default)"
read -r -p "Choice [y/N]: " CHOICE
CHOICE="${CHOICE:-n}"

if [[ "$CHOICE" =~ ^[Yy]$ ]]; then
  # Isolated mode: hash workspace name to a port-offset slot
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

  cat > .superset/.ports <<EOF
DEV_PORT=$DEV_PORT
ISOLATED=1
PROJECT_ID=$PROJECT_ID
EOF

  echo "Workspace '$WORKSPACE' -> slot $SLOT (isolated)"
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
else
  # Shared mode: use the main clint-v2 stack on default ports
  DEV_PORT=8000

  cat > .superset/.ports <<EOF
DEV_PORT=$DEV_PORT
ISOLATED=0
EOF

  echo "Using main clint-v2 Supabase stack (ports 54321/54322/54323)"
  echo "  Dev: $DEV_PORT"

  # Restore tracked files to branch baseline (no port patching needed)
  git checkout -- supabase/config.toml src/client/src/environments/environment.local.ts

  # Install frontend dependencies
  (cd src/client && npm install)

  # Ensure main stack is running
  supabase start
fi
