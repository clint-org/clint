#!/bin/bash
# Stop hook: if .claude/.runbook-dirty has entries, block the stop with a
# review instruction so the main agent (with full context) updates the
# runbook. Otherwise exit silently — brainstorming and conversation-only
# turns no longer trigger a sub-LLM review.

set -uo pipefail

PROJECT_DIR="${CLAUDE_PROJECT_DIR:-$(pwd)}"
MARKER="$PROJECT_DIR/.claude/.runbook-dirty"

if [ ! -s "$MARKER" ]; then
  exit 0
fi

CHANGED=$(sort -u "$MARKER" | head -50)
: > "$MARKER"

CHANGED="$CHANGED" node -e '
const changed = process.env.CHANGED || "";
const reason = "Code was modified this session under runbook-relevant paths. Review what changed in the files below and update the matching docs/runbook/*.md files if there are meaningful feature, component, service, route, model, or schema changes worth documenting. Skip for formatting, typo fixes, or minor refactors.\n\nChanged files:\n" + changed;
process.stdout.write(JSON.stringify({ decision: "block", reason }));
'
