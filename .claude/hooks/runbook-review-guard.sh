#!/bin/bash
# Stop hook: if .claude/.runbook-dirty has entries, block the stop with a
# review instruction so the main agent (with full context) updates the
# runbook. Otherwise exit silently — brainstorming and conversation-only
# turns no longer trigger a sub-LLM review.
#
# Also surfaces in-app help pages that may need editorial updates when
# changed files match known help-page sources of truth (marker types,
# phase colors, role definitions). The mapping lives in the node block
# below — extend it when new help pages are added.

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

// path-pattern -> help page that may need editorial review.
// Triggers when ANY of the patterns match ANY changed file.
const helpRules = [
  {
    patterns: [/marker_types?/i, /\bmarker\.model/i, /marker_categories/i],
    helpPage: "src/client/src/app/features/help/markers-help.component.ts",
  },
  {
    patterns: [/phase-colors/, /phase-bar/, /PHASE_COLORS/, /PHASE_DESCRIPTORS/],
    helpPage: "src/client/src/app/features/help/phases-help.component.ts",
  },
  {
    patterns: [/space-members/, /space_members/, /space-role/, /space_role/],
    helpPage: "src/client/src/app/features/help/roles-help.component.ts",
  },
];

// path-pattern -> features matrix files that may need review.
const featuresRules = [
  {
    patterns: [/supabase\/migrations\//, /\.sql$/i],
    msg: "Migration changed. Review docs/runbook/features/*.md - add or update the capability row(s) for affected RPCs or tables.",
  },
  {
    patterns: [/src\/client\/src\/app\/app\.routes\.ts/],
    msg: "Routes changed. Review docs/runbook/features/*.md - update routes: arrays on the affected capability rows.",
  },
  {
    patterns: [/src\/client\/src\/app\/features\/[^/]+\//],
    msg: "Feature folder touched. Confirm the matching docs/runbook/features/<slug>.md exists and that its YAML capabilities block reflects the change.",
  },
];

const featuresFlags = [];
for (const rule of featuresRules) {
  if (rule.patterns.some((re) => re.test(changed))) {
    featuresFlags.push(rule.msg);
  }
}

const flaggedHelp = [];
for (const rule of helpRules) {
  if (rule.patterns.some((re) => re.test(changed))) {
    flaggedHelp.push(rule.helpPage);
  }
}

let reason = "Code was modified this session under runbook-relevant paths. Review what changed in the files below and update the matching docs/runbook/*.md files if there are meaningful feature, component, service, route, model, or schema changes worth documenting. Skip for formatting, typo fixes, or minor refactors.\n\nChanged files:\n" + changed;

if (flaggedHelp.length > 0) {
  reason += "\n\nHelp pages that may need editorial review (live-data parts auto-update; FAQ and prose do not):\n" + flaggedHelp.join("\n");
}

if (featuresFlags.length > 0) {
  reason += "\n\nFeatures matrix files that may need review:\n" + featuresFlags.join("\n");
}

process.stdout.write(JSON.stringify({ decision: "block", reason }));
'
