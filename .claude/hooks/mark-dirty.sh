#!/bin/bash
# PostToolUse hook (Edit|Write): if the edited file is runbook-relevant,
# mark the session dirty so Stop-hook guards know to run. Exits silently
# otherwise. docs/ is intentionally excluded so the runbook review itself
# does not re-trigger the loop.

set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log((j.tool_input&&j.tool_input.file_path)||(j.tool_response&&j.tool_response.filePath)||'')}catch{}")

[ -z "$FILE" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$PROJECT_DIR"/}"

case "$REL" in
  src/client/src/*|supabase/migrations/*|supabase/seed.sql)
    mkdir -p "$PROJECT_DIR/.claude"
    echo "$REL" >> "$PROJECT_DIR/.claude/.runbook-dirty"
    echo "$REL" >> "$PROJECT_DIR/.claude/.e2e-dirty"
    ;;
esac

exit 0
