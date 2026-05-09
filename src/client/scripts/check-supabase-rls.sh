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
#   - Otherwise, run advisors and print findings. Local exit is gated to
#     ERROR-level only so devs see warns without being blocked. CI uses the
#     same command with --fail-on error explicit (see .github/workflows/ci.yml).
#
# Mode:
#   - SOFT (default): always exits 0 unless an ERROR-level lint exists.
#   - HARD (CHECK_SUPABASE_RLS_HARD=1): pass --fail-on warn instead, blocks
#     on any new warning. Flip on once the legacy sweep is done.

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

FAIL_ON="error"
if [ "${CHECK_SUPABASE_RLS_HARD:-0}" = "1" ]; then
  FAIL_ON="warn"
fi

cd "$ROOT"
exec supabase db advisors --local --type all --level warn --fail-on "$FAIL_ON"
