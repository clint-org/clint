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

if [ "$fail" -ne 0 ]; then echo "TESTS FAILED"; exit 1; fi
echo "ALL PASS"
