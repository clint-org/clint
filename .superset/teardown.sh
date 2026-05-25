#!/usr/bin/env bash
set -euo pipefail

ISOLATED=0
PROJECT_ID=""
if [[ -f .superset/.ports ]]; then
  source .superset/.ports
fi

if [[ "$ISOLATED" == "1" && -n "$PROJECT_ID" ]]; then
  echo "Stopping isolated Supabase stack ($PROJECT_ID)..."
  supabase stop --project-id "$PROJECT_ID"
else
  echo "Shared stack mode - skipping supabase stop (main clint-v2 stays running)"
fi

rm -f .superset/.ports
