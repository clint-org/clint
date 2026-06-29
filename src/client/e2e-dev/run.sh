#!/bin/bash
# Run the dev-targeted Playwright regression suite against deployed dev.clintapp.com.
#
# Wraps Playwright in `infisical run` so the only required secret
# (SUPABASE_DEV_DB_POOLER_URL) is injected from Infisical (env dev, path /supabase).
# No service-role key or JWT secret is needed. Runs HEADED -- headless never
# clears the Cloudflare challenge.
#
# Usage:
#   ./e2e-dev/run.sh                       # full suite
#   ./e2e-dev/run.sh e2e-dev/tests/smoke.spec.ts
#   ./e2e-dev/run.sh --grep @firewall
#   PWDEV_TAGS=@external ./e2e-dev/run.sh   # include external-service specs
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CLIENT_DIR="$(dirname "$SCRIPT_DIR")"
cd "$CLIENT_DIR"

INFISICAL_PROJECT_ID="${INFISICAL_PROJECT_ID:-7c227e8b-b355-46cb-8912-701104e2415b}"

if ! command -v infisical >/dev/null 2>&1; then
  echo "infisical CLI not found. Install it or export SUPABASE_DEV_DB_POOLER_URL yourself." >&2
  exit 1
fi

exec infisical run \
  --projectId "$INFISICAL_PROJECT_ID" \
  --env dev \
  --path /supabase \
  -- npx playwright test --config=playwright.dev.config.ts "$@"
