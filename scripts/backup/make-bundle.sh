#!/usr/bin/env bash
# Dump roles+schema+data for one database, bundle+compress+encrypt, write manifest.
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

echo "[make-bundle] dumping roles/schema/data for env=$env ..."
supabase db dump --db-url "$db_url" --role-only            -f "$stage/roles.sql"
supabase db dump --db-url "$db_url"                        -f "$stage/schema.sql.raw"
# Dump only the public schema's data. The auth/storage/realtime tables are
# Supabase system tables that cannot be restored to a fresh DB without the full
# Supabase Auth service installed; they are omitted from the data file.
supabase db dump --db-url "$db_url" --data-only -s public  -f "$stage/data.sql"

# Wrap schema.sql with a Supabase runtime preamble so it is self-contained for
# restore on any Supabase Postgres cluster.
#
# The extensions/auth/storage/etc. schemas are pre-baked into the Supabase
# container image but absent from newly created databases on the same cluster.
# All CREATE SCHEMA / CREATE TABLE / CREATE FUNCTION statements use IF NOT EXISTS
# or OR REPLACE so they are idempotent on a full Supabase instance.
#
# The preamble stubs only the objects that pg_dump's schema output references
# from auth.*:
#   - auth.users (referenced by FK constraints)
#   - auth.uid() and auth.jwt() (referenced by RLS policies)
{
  cat <<'PREAMBLE'
-- Supabase system schema bootstrap (idempotent).
-- These schemas are pre-baked into the Supabase container image but absent from
-- newly created databases on the same cluster. All DDL uses IF NOT EXISTS / OR
-- REPLACE so the preamble is a no-op when restoring to a full Supabase instance.
CREATE SCHEMA IF NOT EXISTS extensions;
CREATE SCHEMA IF NOT EXISTS graphql;
CREATE SCHEMA IF NOT EXISTS vault;
CREATE SCHEMA IF NOT EXISTS auth;
CREATE SCHEMA IF NOT EXISTS storage;
CREATE SCHEMA IF NOT EXISTS realtime;

-- Minimal auth.users stub: satisfies FK references from public.* tables.
CREATE TABLE IF NOT EXISTS auth.users (id uuid PRIMARY KEY);

-- Minimal auth helper functions used by RLS policies.
CREATE OR REPLACE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.sub', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
  )::uuid
$f$;

CREATE OR REPLACE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim', true), ''),
    nullif(current_setting('request.jwt.claims', true), '')
  )::jsonb
$f$;

CREATE OR REPLACE FUNCTION auth.role() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.role', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'role')
  )::text
$f$;

CREATE OR REPLACE FUNCTION auth.email() RETURNS text LANGUAGE sql STABLE AS $f$
  SELECT coalesce(
    nullif(current_setting('request.jwt.claim.email', true), ''),
    (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'email')
  )::text
$f$;

-- Supabase logical replication publication. The schema dump carries
-- ALTER PUBLICATION ... which fails if the publication does not exist.
CREATE PUBLICATION supabase_realtime;
PREAMBLE
  cat "$stage/schema.sql.raw"
} > "$stage/schema.sql"
rm "$stage/schema.sql.raw"

# Manifest (sha256 filled in after the encrypted artifact exists).
sha() { shasum -a 256 "$1" 2>/dev/null | awk '{print $1}' || sha256sum "$1" | awk '{print $1}'; }
cat > "$stage/manifest.json" <<JSON
{
  "env": "$env",
  "tier": "$tier",
  "timestamp": "$ts",
  "supabase_cli": "$(supabase --version 2>/dev/null | head -1)",
  "files": ["roles.sql", "schema.sql", "data.sql"]
}
JSON

base="clint-$env-$tier-$ts"
tar -C "$stage" -cf "$stage/$base.tar" roles.sql schema.sql data.sql manifest.json
zstd -q -19 "$stage/$base.tar" -o "$stage/$base.tar.zst"
age -r "$recipient" -o "$outdir/$base.tar.zst.age" "$stage/$base.tar.zst"

# Final manifest sits next to the encrypted bundle and records its checksum.
enc_sha="$(sha "$outdir/$base.tar.zst.age")"
enc_size="$(wc -c < "$outdir/$base.tar.zst.age" | tr -d ' ')"
jq --arg sha "$enc_sha" --arg size "$enc_size" --arg artifact "$base.tar.zst.age" \
   '. + {artifact: $artifact, sha256: $sha, bytes: ($size|tonumber)}' \
   "$stage/manifest.json" > "$outdir/$base.manifest.json"

echo "[make-bundle] wrote $outdir/$base.tar.zst.age ($enc_size bytes)"
echo "$outdir/$base.tar.zst.age"
