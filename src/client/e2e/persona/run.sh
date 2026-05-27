#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$(dirname "$SCRIPT_DIR")")"
AUTH_FILE="$SCRIPT_DIR/.auth-session.json"

cd "$CLIENT_DIR"

if [ ! -f "$AUTH_FILE" ]; then
  echo "No auth session found. Opening browser for login..."
  npx tsx "$SCRIPT_DIR/save-auth.ts"
fi

if [ ! -f "$AUTH_FILE" ]; then
  echo "Auth session still missing after login flow. Aborting."
  exit 1
fi

echo "Running persona tests..."
npx playwright test --config="$SCRIPT_DIR/playwright.persona.config.ts" "$@"
