#!/usr/bin/env bash
set -euo pipefail

DEV_PORT=8000
if [[ -f .superset/.ports ]]; then
  source .superset/.ports
fi

cd src/client
npx ng serve --port "$DEV_PORT"
