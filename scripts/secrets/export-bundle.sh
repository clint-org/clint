#!/usr/bin/env bash
# Break-glass export: pull every Infisical secret (all envs, every folder),
# bundle, and age-encrypt to the backup PUBLIC key so only the offline private
# key can decrypt. Prints the encrypted bundle path as the last stdout line.
#
# Why a per-folder walk (not `infisical export` and not a flat recursive dump):
#   - `infisical export` is non-recursive (only reads the given --path).
#   - `infisical secrets --recursive --output json` flattens to secretKey +
#     secretValue with NO path, so the SAME key name in two folders collides and
#     one value is silently dropped. We genuinely have that: CLOUDFLARE_API_TOKEN
#     lives in /cloudflare (deploy token) AND /iac (tofu token).
# So we walk the folder tree per environment and write one JSON file per path,
# with the path encoded in the filename. This is complete, collision-free, and
# future-proof against nested folders.
#
# Requires: infisical CLI (authenticated via INFISICAL_TOKEN, a machine-identity
# access token), jq, age, zstd, tar.
set -euo pipefail

usage() { echo "usage: $0 --project-id <id> --recipient <age-pubkey> --outdir <dir>" >&2; exit 1; }
PROJECT_ID=""; RECIPIENT=""; OUTDIR="./_secrets"
while [ $# -gt 0 ]; do
  case "$1" in
    --project-id) PROJECT_ID="$2"; shift 2 ;;
    --recipient)  RECIPIENT="$2";  shift 2 ;;
    --outdir)     OUTDIR="$2";     shift 2 ;;
    *) usage ;;
  esac
done
[ -n "$PROJECT_ID" ] && [ -n "$RECIPIENT" ] || usage
: "${INFISICAL_TOKEN:?INFISICAL_TOKEN must be set (machine identity access token)}"

mkdir -p "$OUTDIR"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT

inf() { infisical "$@" --token "$INFISICAL_TOKEN" --projectId "$PROJECT_ID" --silent; }

# Write the secrets at exactly one path (non-recursive) to a path-named file,
# then recurse into that path's subfolders. Empty/null responses normalize to [].
walk() {
  local env="$1" path="$2" name file out
  if [ "$path" = "/" ]; then name="_root"; else name="${path#/}"; name="${name//\//__}"; fi
  file="$work/$env/$name.json"

  out="$(inf secrets --env "$env" --path "$path" --output json 2>/dev/null || true)"
  if [ -n "$out" ] && printf '%s' "$out" | jq -e 'type=="array"' >/dev/null 2>&1; then
    printf '%s' "$out" | jq '.' > "$file"
  else
    echo '[]' > "$file"
  fi

  local subs sub child
  subs="$(inf secrets folders get --env "$env" --path "$path" --output json 2>/dev/null \
    | jq -r 'if type=="array" then .[].folderName else empty end' 2>/dev/null || true)"
  for sub in $subs; do
    if [ "$path" = "/" ]; then child="/$sub"; else child="$path/$sub"; fi
    walk "$env" "$child"
  done
}

for env in shared dev prod; do
  mkdir -p "$work/$env"
  walk "$env" "/"
done

stamp="$(date -u +%Y%m%dT%H%M%SZ)"
bundle="$OUTDIR/secrets-$stamp.tar.zst.age"
tar -C "$work" -cf - . | zstd -q | age -r "$RECIPIENT" -o "$bundle"
echo "$bundle"
