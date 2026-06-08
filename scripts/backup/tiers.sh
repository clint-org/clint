#!/usr/bin/env bash
# Print the GFS tier prefixes (one per line) for a UTC date (YYYY-MM-DD).
set -euo pipefail
d="${1:?usage: tiers.sh YYYY-MM-DD}"

# Support both GNU date (Linux/CI) and BSD date (macOS).
dow() { date -u -d "$1" +%u 2>/dev/null || date -u -j -f "%Y-%m-%d" "$1" +%u; }
dom() { date -u -d "$1" +%d 2>/dev/null || date -u -j -f "%Y-%m-%d" "$1" +%d; }

echo "daily"
[ "$(dow "$d")" = "7" ]  && echo "weekly"  || true
[ "$(dom "$d")" = "01" ] && echo "monthly" || true
