#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
assert_eq() {
  if [ "$1" != "$2" ]; then echo "FAIL: $3: expected [$2] got [$1]"; fail=1; else echo "ok: $3"; fi
}
run() { "$here/tiers.sh" "$1" | paste -sd, -; }

assert_eq "$(run 2026-06-07)" "daily,weekly"          "Sunday -> daily+weekly"
assert_eq "$(run 2026-06-01)" "daily,monthly"         "1st (Mon) -> daily+monthly"
assert_eq "$(run 2026-03-01)" "daily,weekly,monthly"  "Sunday+1st -> all three"
assert_eq "$(run 2026-06-09)" "daily"                 "weekday -> daily only"

# Negative path: invalid date exits non-zero and prints no tiers.
if out="$("$here/tiers.sh" not-a-date 2>/dev/null)"; then
  echo "FAIL: invalid date should exit non-zero (got [$out])"; fail=1
else
  echo "ok: invalid date exits non-zero"
fi

if [ "$fail" -ne 0 ]; then echo "TESTS FAILED"; exit 1; fi
echo "ALL PASS"
