#!/usr/bin/env bash
# Thin wrapper around the Supabase CLI advisor. Replaces an earlier
# hand-rolled grep that approximated the same checks.
#
# Why use `supabase db advisors --local`:
#   - Same engine the Supabase dashboard uses (Splinter), so output is
#     authoritative and matches what we'd see at supabase.com/dashboard.
#   - Reports lint codes (auth_rls_initplan, function_search_path_mutable,
#     rls_enabled_no_policy, ...) with remediation links, not just heuristic
#     greps that go stale as policies are rewritten.
#   - Catches the auth.uid()-not-wrapped perf class verbatim. Note: two
#     dashboard CRITICAL classes (auth_users_exposed, security_definer_view)
#     only fire against `--linked`, because they depend on production role
#     ownership state. A scheduled --linked check is the only way to gate
#     those — see docs/supabase-guides/database-rls-policies.md.
#
# Behavior:
#   - If local Supabase is not running, skip silently. Devs without docker
#     up shouldn't fail their lint pass.
#   - Otherwise, run advisors and fail the lint pass on any WARN+ finding.
#     The legacy sweep (20260509120000..0300) cleared all warnings, so a new
#     warning means a regression and should block. CI runs the same command;
#     see .github/workflows/ci.yml.
#
# Escape hatch:
#   - CHECK_SUPABASE_RLS_RELAX=1 downgrades the gate to ERROR-level so a
#     dev can land an emergency fix while a follow-up fix for the warning is
#     drafted. Use sparingly; CI does not honor this flag.

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../../.." && pwd)"

if ! command -v supabase >/dev/null 2>&1; then
  echo "INFO: supabase CLI not installed; skipping advisor check." >&2
  exit 0
fi

# `supabase status` exits non-zero when local stack is not running.
if ! (cd "$ROOT" && supabase status >/dev/null 2>&1); then
  echo "INFO: local Supabase not running; skipping advisor check." \
       "Start it with 'supabase start' to enable." >&2
  exit 0
fi

FAIL_ON="warn"
if [ "${CHECK_SUPABASE_RLS_RELAX:-0}" = "1" ]; then
  FAIL_ON="error"
  echo "INFO: CHECK_SUPABASE_RLS_RELAX=1 set; gate downgraded to ERROR-level." >&2
fi

cd "$ROOT"
exec supabase db advisors --local --type all --level warn --fail-on "$FAIL_ON"
