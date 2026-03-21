#!/bin/bash
# PreToolUse hook: run prettier on staged files before git commit
INPUT=$(cat)
COMMAND=$(echo "$INPUT" | node -e "const d=require('fs').readFileSync(0,'utf8');try{console.log(JSON.parse(d).tool_input.command||'')}catch{}")

# Only intercept git commit commands
if echo "$COMMAND" | grep -qE '^\s*git\s+commit'; then
  cd "$CLAUDE_PROJECT_DIR/src/client" || exit 0

  # Get staged .ts, .html, .css, .json files within src/client
  STAGED=$(cd "$CLAUDE_PROJECT_DIR" && git diff --cached --name-only --diff-filter=ACM | grep -E '^src/client/.*\.(ts|html|css|json)$' | sed 's|^src/client/||')

  if [ -n "$STAGED" ]; then
    echo "$STAGED" | xargs npx prettier --write 2>&1
    # Re-stage the formatted files
    echo "$STAGED" | sed "s|^|src/client/|" | while read -r f; do
      git -C "$CLAUDE_PROJECT_DIR" add "$f"
    done
    echo "Prettier: formatted and re-staged files"
  fi
fi

exit 0
