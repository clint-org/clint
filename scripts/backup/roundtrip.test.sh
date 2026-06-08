#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
trap 'rm -rf "$work"; psql "$ADMIN_URL" -c "drop database if exists backup_roundtrip;" >/dev/null 2>&1 || true' EXIT

LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ADMIN_URL="$LOCAL_DB_URL"

# Throwaway recipient keypair.
age-keygen -o "$work/key.txt" 2>"$work/pub.txt"
PUB="$(grep -o 'age1[0-9a-z]*' "$work/pub.txt" | head -1)"

# Produce the encrypted bundle.
"$here/make-bundle.sh" \
  --db-url "$LOCAL_DB_URL" \
  --env local \
  --tier daily \
  --recipient "$PUB" \
  --outdir "$work"

bundle="$(ls "$work"/clint-local-daily-*.tar.zst.age | head -1)"
manifest="${bundle%.tar.zst.age}.manifest.json"
[ -f "$bundle" ]   || { echo "FAIL: no bundle produced"; exit 1; }
[ -f "$manifest" ] || { echo "FAIL: no manifest produced"; exit 1; }

# Manifest sanity: sha256 in manifest matches the bundle on disk.
sha_now="$(shasum -a 256 "$bundle" 2>/dev/null | awk '{print $1}' || sha256sum "$bundle" | awk '{print $1}')"
sha_manifest="$(jq -r .sha256 "$manifest")"
[ "$sha_now" = "$sha_manifest" ] || { echo "FAIL: manifest sha256 mismatch"; exit 1; }

# Decrypt + unpack.
age -d -i "$work/key.txt" -o "$work/bundle.tar.zst" "$bundle"
zstd -d "$work/bundle.tar.zst" -o "$work/bundle.tar"
mkdir -p "$work/unpacked" && tar -xf "$work/bundle.tar" -C "$work/unpacked"
[ -f "$work/unpacked/roles.sql" ]  || { echo "FAIL: roles.sql missing";  exit 1; }
[ -f "$work/unpacked/schema.sql" ] || { echo "FAIL: schema.sql missing"; exit 1; }
[ -f "$work/unpacked/data.sql" ]   || { echo "FAIL: data.sql missing";   exit 1; }

# Restore schema+data into a scratch DB and assert a known table restored.
psql "$ADMIN_URL" -c "drop database if exists backup_roundtrip;" >/dev/null
psql "$ADMIN_URL" -c "create database backup_roundtrip;" >/dev/null
SCRATCH="postgresql://postgres:postgres@127.0.0.1:54322/backup_roundtrip"
psql "$SCRATCH" -v ON_ERROR_STOP=1 -f "$work/unpacked/schema.sql" >/dev/null
psql "$SCRATCH" -v ON_ERROR_STOP=1 -f "$work/unpacked/data.sql"   >/dev/null

# marker_types is seeded by seed.sql, so a healthy restore has rows.
count="$(psql "$SCRATCH" -tAc "select count(*) from public.marker_types;")"
[ "$count" -gt 0 ] || { echo "FAIL: marker_types empty after restore ($count)"; exit 1; }

echo "ALL PASS (marker_types rows: $count)"
