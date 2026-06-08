#!/usr/bin/env bash
# Print the GFS tier prefixes (one per line) for a UTC date (YYYY-MM-DD).
# Tiers: always "daily"; "weekly" on Sundays (ISO weekday 7); "monthly" on the 1st.
set -euo pipefail
d="${1:?usage: tiers.sh YYYY-MM-DD}"

# Parse once, supporting both GNU date (Linux/CI) and BSD date (macOS).
# %u = ISO weekday (Mon=1 .. Sun=7); %d = zero-padded day-of-month (01..31).
if parsed="$(date -u -d "$d" "+%u %d" 2>/dev/null)"; then :
elif parsed="$(date -u -j -f "%Y-%m-%d" "$d" "+%u %d" 2>/dev/null)"; then :
else
  echo "tiers.sh: invalid date: $d (expected YYYY-MM-DD)" >&2
  exit 1
fi
dow="${parsed% *}"
dom="${parsed#* }"

echo "daily"
[ "$dow" = "7" ]  && echo "weekly"  || true
[ "$dom" = "01" ] && echo "monthly" || true
