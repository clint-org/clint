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
    // markers-help is the event-glyph reference: it renders the event types and
    // their glyphs. Flag it on the legacy marker_* schema (kept during the
    // transition), the unified event_types schema, and the merged event
    // authoring form (which owns the glyph + significance defaults shown here).
    patterns: [
      /marker_types?/i,
      /\bmarker\.model/i,
      /marker_categories/i,
      /event_types?/i,
      /event_type_categories/i,
      /event-form\.component/,
      /marker-form\.component/,
    ],
    helpPage: "src/client/src/app/features/help/markers-help.component.ts",
  },
  {
    patterns: [
      /phase-colors/,
      /phase-bar/,
      /PHASE_COLORS/,
      /PHASE_DESCRIPTORS/,
      // Migrations that touch ct.gov phase derivation / source-of-truth logic
      // may shift how the phase fields behave; review the help page prose.
      /_materialize_trial_from_snapshot/,
      /_derive_phase_type/,
      /trial_phase_ctgov_truth/,
      /trial_phase_source_columns/,
    ],
    helpPage: "src/client/src/app/features/help/phases-help.component.ts",
  },
  {
    patterns: [
      /indications?/i,
      /mechanisms?_of_action/i,
      /routes?_of_administration/i,
      /indication\.service/,
      /mechanism-of-action\.service/,
      /route-of-administration\.service/,
      // The Taxonomies screen also administers event types + categories, which
      // taxonomies-help now documents; flag it on those schema changes too.
      /event_types?/i,
      /event_type_categories/i,
    ],
    helpPage: "src/client/src/app/features/help/taxonomies-help.component.ts",
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
