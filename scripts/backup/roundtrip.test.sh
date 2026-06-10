#!/usr/bin/env bash
# Roundtrip CAPTURE verification for make-bundle.sh. This app's public schema
# depends on Supabase's extensions/auth environment (pg_net, pg_trgm, auth.uid),
# so a full restore is only possible against a real Supabase target (the
# quarterly manual drill). Here we verify the bundle is well-formed and CAPTURED
# all data with correct row counts.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"' EXIT
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"

# Count data rows for schema.table, handling BOTH dump styles: pg_dump COPY
# blocks (auth_storage.sql) and supabase db dump INSERT...VALUES tuples
# (data.sql). Tolerant of pg_dump identifier quoting.
table_rows() { # $1=file $2=schema $3=table
  awk -v s="$2" -v t="$3" '
    { line=$0; gsub(/"/,"",line) }
    line ~ ("^COPY " s "\\." t " ") && line ~ /FROM stdin;/ { mode="copy"; next }
    mode=="copy" && $0=="\\." { mode=""; next }
    mode=="copy" { c++; next }
    line ~ ("^INSERT INTO " s "\\." t " ") {
      mode="insert"
      if (line ~ /\);[ \t]*$/) { c++; mode="" }   # single-line insert
      next
    }
    mode=="insert" {
      if (line ~ /^[ \t]*\(/) c++
      if (line ~ /;[ \t]*$/) mode=""
    }
    END { print c+0 }
  ' "$1"
}

age-keygen -o "$work/key.txt" 2>"$work/pub.txt"
PUB="$(grep -o 'age1[0-9a-z]*' "$work/pub.txt" | head -1)"

"$here/make-bundle.sh" --db-url "$LOCAL_DB_URL" --env local --tier daily \
  --recipient "$PUB" --outdir "$work" >/dev/null

bundle="$(ls "$work"/clint-local-daily-*.tar.zst.age | head -1)"
manifest="${bundle%.tar.zst.age}.manifest.json"
[ -f "$bundle" ] && [ -f "$manifest" ] || { echo "FAIL: bundle/manifest missing"; exit 1; }

sha_now="$(shasum -a 256 "$bundle" 2>/dev/null | awk '{print $1}' || sha256sum "$bundle" | awk '{print $1}')"
[ "$sha_now" = "$(jq -r .sha256 "$manifest")" ] || { echo "FAIL: sha256 mismatch"; exit 1; }
echo "ok: bundle sha256 matches manifest"

age -d -i "$work/key.txt" -o "$work/bundle.tar.zst" "$bundle"
zstd -d "$work/bundle.tar.zst" -o "$work/bundle.tar"
mkdir -p "$work/unpacked" && tar -xf "$work/bundle.tar" -C "$work/unpacked"
for f in roles.sql schema.sql data.sql auth_storage.sql manifest.json; do
  [ -s "$work/unpacked/$f" ] || { echo "FAIL: $f missing or empty"; exit 1; }
done
echo "ok: all five artifacts present and non-empty"

# Schema captured: a core public table's DDL is present.
grep -Eq 'CREATE TABLE (IF NOT EXISTS )?("?public"?\.)?"?marker_types"?' "$work/unpacked/schema.sql" \
  || { echo "FAIL: schema.sql missing CREATE TABLE for marker_types"; exit 1; }
echo "ok: schema.sql contains core public DDL (marker_types)"

# Public data captured: marker_types row count in data.sql equals live.
live_mt="$(psql "$LOCAL_DB_URL" -tAc "select count(*) from public.marker_types;")"
[ "$live_mt" -gt 0 ] || { echo "FAIL: live marker_types empty; cannot validate"; exit 1; }
dump_mt="$(table_rows "$work/unpacked/data.sql" public marker_types)"
[ "$dump_mt" = "$live_mt" ] || { echo "FAIL: data.sql marker_types rows=$dump_mt live=$live_mt"; exit 1; }
echo "ok: data.sql captured public.marker_types ($live_mt rows)"

# Auth/storage capture integrity vs live and manifest.
for pair in auth:users auth:identities storage:buckets storage:objects; do
  s="${pair%%:*}"; t="${pair##*:}"; tbl="$s.$t"
  grep -q "COPY ${tbl} " "$work/unpacked/auth_storage.sql" \
    || { echo "FAIL: $tbl not in auth_storage.sql"; exit 1; }
  live="$(psql "$LOCAL_DB_URL" -tAc "select count(*) from ${tbl};")"
  dumped="$(table_rows "$work/unpacked/auth_storage.sql" "$s" "$t")"
  [ "$live" = "$dumped" ] || { echo "FAIL: $tbl mismatch live=$live dumped=$dumped"; exit 1; }
  [ "$(jq -r --arg t "$tbl" '.auth_storage_row_counts[$t]' "$manifest")" = "$live" ] \
    || { echo "FAIL: $tbl manifest count mismatch"; exit 1; }
  echo "ok: $tbl captured ($live rows; manifest+dump agree)"
done

echo "ALL PASS"
