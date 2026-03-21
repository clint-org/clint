#!/bin/bash
# PostToolUse hook: lint the specific file that was just edited/written
INPUT=$(cat)
FILE=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{console.log(JSON.parse(d).tool_input.file_path||'')}catch{}")

# Only lint TypeScript files in src/client
if [[ "$FILE" == *.ts && "$FILE" == *src/client* ]]; then
  RELATIVE=$(echo "$FILE" | sed "s|.*src/client/||")
  cd "$CLAUDE_PROJECT_DIR/src/client" || exit 0
  npx ng lint --lint-file-patterns="$RELATIVE" 2>&1 | tail -20
fi

exit 0
