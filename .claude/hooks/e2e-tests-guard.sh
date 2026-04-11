#!/bin/bash
# Stop hook guard: only run e2e tests if code was touched this session.
# Clears the marker after running so subsequent conversation-only Stops
# don't re-trigger the suite.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
MARKER="$PROJECT_DIR/.claude/.e2e-dirty"

if [ ! -s "$MARKER" ]; then
  exit 0
fi

: > "$MARKER"
exec "$PROJECT_DIR/.claude/hooks/run-e2e-tests.sh"
