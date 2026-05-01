#!/bin/bash
# PostToolUse hook (Edit|Write): when the edited file is a source-of-truth
# input for the runbook auto-gen blocks, run `npm run docs:arch` so the
# generated tables / diagrams stay in sync with the live state.
#
# Inputs that trigger a regen:
#   - supabase/migrations/*.sql
#   - src/client/src/app/app.routes.ts
#   - src/client/package.json
#
# Quietly no-ops if Supabase is not running (the script will fail with a
# clear message; we treat that as "not the right time to regen").

set -uo pipefail

INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{const j=JSON.parse(d);console.log((j.tool_input&&j.tool_input.file_path)||(j.tool_response&&j.tool_response.filePath)||'')}catch{}")

[ -z "$FILE" ] && exit 0

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
REL="${FILE#"$PROJECT_DIR"/}"

case "$REL" in
  supabase/migrations/*.sql|src/client/src/app/app.routes.ts|src/client/package.json)
    ;;
  *)
    exit 0
    ;;
esac

# Bail quietly if Supabase isn't running — the regen needs the live DB.
if ! supabase status >/dev/null 2>&1; then
  exit 0
fi

cd "$PROJECT_DIR/src/client" || exit 0
# Send output to stderr; PostToolUse hooks don't echo stdout to the user.
# settings.json enforces the wall-clock timeout for this command.
npm run --silent docs:arch 1>&2 || {
  echo "regen-architecture-docs: docs:arch failed; run \`npm run docs:arch\` manually to inspect" 1>&2
}

exit 0
