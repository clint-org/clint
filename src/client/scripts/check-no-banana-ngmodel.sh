#!/usr/bin/env bash
# Tracks two-way [(ngModel)] usage in src/. Bind one-way + (ngModelChange) to a
# signal instead.
#
# Why: a [(ngModel)] binding to a plain class property is invisible to Angular
# signal reactivity. Any computed() that reads that property will never
# re-evaluate when the user types, leaving Save / Submit buttons stuck at
# their initial value forever. We hit this bug four times in clint-v2
# super-admin and agency dialogs before adding this guard.
#
# Allowed pattern:
#   readonly fieldName = signal('');
#   <input [ngModel]="fieldName()" (ngModelChange)="fieldName.set($event)" />
#
# Mode:
#   - SOFT (default): prints a warning + count of legacy violations, exit 0.
#     Used while we incrementally migrate legacy form components.
#   - HARD (CHECK_NGMODEL_HARD=1): exits non-zero on any violation.
#     Flip to this once all legacy forms are converted.
#
# See memory entry: feedback_angular_computed_short_circuit.md.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
HITS=$(grep -rln '\[(ngModel)\]' "$ROOT/src" --include='*.ts' --include='*.html' || true)

if [ -z "$HITS" ]; then
  exit 0
fi

COUNT=$(echo "$HITS" | wc -l | tr -d ' ')

echo "WARN: Two-way [(ngModel)] should be replaced with [ngModel]+(ngModelChange) on a signal." >&2
echo "  Pattern: <input [ngModel]=\"x()\" (ngModelChange)=\"x.set(\$event)\" />" >&2
echo "  Reason:  plain props are invisible to computed() — see feedback_angular_computed_short_circuit.md" >&2
echo "  Files with legacy two-way bindings ($COUNT):" >&2
echo "$HITS" | sed 's/^/    /' >&2

if [ "${CHECK_NGMODEL_HARD:-0}" = "1" ]; then
  echo "" >&2
  echo "ERROR: hard mode active (CHECK_NGMODEL_HARD=1) — refusing to proceed." >&2
  exit 1
fi

exit 0
