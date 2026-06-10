#!/usr/bin/env bash
# Dump roles + public schema/data + auth/storage identity data for one database,
# bundle + compress + encrypt, and write a manifest. Artifacts are kept clean so
# they restore onto a Supabase target (new project or self-hosted); see the spec.
set -euo pipefail

db_url="" env="" tier="" recipient="" outdir=""
while [ $# -gt 0 ]; do
  case "$1" in
    --db-url)    db_url="$2"; shift 2 ;;
    --env)       env="$2"; shift 2 ;;
    --tier)      tier="$2"; shift 2 ;;
    --recipient) recipient="$2"; shift 2 ;;
    --outdir)    outdir="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
: "${db_url:?--db-url required}" "${env:?--env required}" "${tier:?--tier required}"
: "${recipient:?--recipient required}" "${outdir:?--outdir required}"
mkdir -p "$outdir"

ts="$(date -u +%Y%m%dT%H%M%SZ)"
stage="$(mktemp -d)"
trap 'rm -rf "$stage"' EXIT

# Tables from the platform-managed schemas whose DATA we capture. These restore
# onto a Supabase target where the auth/storage schemas already exist.
auth_storage_tables=(auth.users auth.identities storage.buckets storage.objects)

echo "[make-bundle] dumping roles / public schema+data / auth+storage data for env=$env ..." >&2
supabase db dump --db-url "$db_url" --role-only           -f "$stage/roles.sql"
supabase db dump --db-url "$db_url"                       -f "$stage/schema.sql"
supabase db dump --db-url "$db_url" --data-only -s public -f "$stage/data.sql"

pg_dump_args=(--data-only --no-owner --no-privileges)
for t in "${auth_storage_tables[@]}"; do pg_dump_args+=(--table="$t"); done
pg_dump "$db_url" "${pg_dump_args[@]}" -f "$stage/auth_storage.sql"

# Live source row counts for the captured auth/storage tables (point-in-time).
counts_json="$(
  for t in "${auth_storage_tables[@]}"; do
    printf '%s\t%s\n' "$t" "$(psql "$db_url" -tAc "select count(*) from ${t};")"
  done | jq -R -s 'split("\n") | map(select(length>0) | split("\t") | {(.[0]): (.[1]|tonumber)}) | add'
)"

sha() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' || sha256sum "$1" | awk '{print $1}'; }
jq -n --arg env "$env" --arg tier "$tier" --arg ts "$ts" \
   --arg cli "$(supabase --version 2>/dev/null | head -1)" --argjson counts "$counts_json" \
   '{env:$env, tier:$tier, timestamp:$ts, supabase_cli:$cli,
     files:["roles.sql","schema.sql","data.sql","auth_storage.sql"],
     auth_storage_row_counts:$counts}' > "$stage/manifest.json"

base="clint-$env-$tier-$ts"
tar -C "$stage" -cf "$stage/$base.tar" roles.sql schema.sql data.sql auth_storage.sql manifest.json
zstd -q -19 "$stage/$base.tar" -o "$stage/$base.tar.zst"
age -r "$recipient" -o "$outdir/$base.tar.zst.age" "$stage/$base.tar.zst"

# Final manifest sits next to the encrypted bundle and records its checksum.
enc_sha="$(sha "$outdir/$base.tar.zst.age")"
enc_size="$(wc -c < "$outdir/$base.tar.zst.age" | tr -d ' ')"
jq --arg sha "$enc_sha" --arg size "$enc_size" --arg artifact "$base.tar.zst.age" \
   '. + {artifact: $artifact, sha256: $sha, bytes: ($size|tonumber)}' \
   "$stage/manifest.json" > "$outdir/$base.manifest.json"

echo "[make-bundle] wrote $outdir/$base.tar.zst.age ($enc_size bytes)" >&2
echo "$outdir/$base.tar.zst.age"
