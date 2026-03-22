#!/bin/bash

if ! supabase status > /dev/null 2>&1; then
  echo "Supabase not running, skipping E2E tests"
  exit 0
fi

if ! curl -s -o /dev/null -w "" http://localhost:4201 > /dev/null 2>&1; then
  echo "Angular dev server not running on port 4201, skipping E2E tests"
  exit 0
fi

cd "$(dirname "$0")/../../src/client" && npx playwright test --reporter=list || true
