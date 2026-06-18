#!/usr/bin/env bash
# WS3 Phase E: IaC drift check. Runs `tofu plan -detailed-exitcode` in each root via
# Infisical-injected creds (/iac supplies the Cloudflare/B2/Supabase tokens AND
# TF_TOKEN_clintapp_scalr_io for the Scalr backend). Exit codes:
#   0 = all roots in sync; 2 = drift in >=1 root; 1 = check error in >=1 root (no drift).
# Locally, if /iac has no Scalr token yet, your `tofu login` credential is used instead.
set -uo pipefail

ROOTS=(shared dev prod)
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"   # infra/tofu
PROJECT_ID="7c227e8b-b355-46cb-8912-701104e2415b"
IRUN=(infisical run --projectId "$PROJECT_ID" --env=shared --path=/iac --silent --)

run_plan() {  # $1 = root; $2 = log path; returns tofu exit code
  # -lock=false: a drift plan is read-only (never writes state), so it needs no lock.
  # This keeps the Scalr CI token least-privilege (read-only, no workspaces:lock) and
  # ensures the drift check can never block a real apply by holding a state lock.
  ( cd "$HERE/$1" \
    && "${IRUN[@]}" tofu init -input=false >/dev/null 2>&1 \
    && "${IRUN[@]}" tofu plan -detailed-exitcode -input=false -lock=false -no-color >"$2" 2>&1 )
  return $?
}

drift=0; errored=0
declare -a drift_roots=() errored_roots=()
for root in "${ROOTS[@]}"; do
  log="$(mktemp)"
  run_plan "$root" "$log"; code=$?
  if [ "$code" = "1" ]; then sleep 5; run_plan "$root" "$log"; code=$?; fi  # retry transient
  case "$code" in
    0) echo "OK    $root: in sync" ;;
    2) echo "DRIFT $root: plan shows changes"; sed 's/^/    /' "$log" | tail -40; drift=1; drift_roots+=("$root") ;;
    *) echo "ERROR $root: tofu failed (exit $code)"; sed 's/^/    /' "$log" | tail -20; errored=1; errored_roots+=("$root") ;;
  esac
  rm -f "$log"
done

if [ "$drift" = "1" ]; then echo "::error::IaC drift detected in: ${drift_roots[*]}"; exit 2; fi
if [ "$errored" = "1" ]; then echo "::error::IaC drift check errored in: ${errored_roots[*]}"; exit 1; fi
echo "All roots in sync."; exit 0
