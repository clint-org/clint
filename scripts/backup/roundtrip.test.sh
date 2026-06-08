#!/usr/bin/env bash
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"
LOCAL_DB_URL="postgresql://postgres:postgres@127.0.0.1:54322/postgres"
ADMIN_URL="$LOCAL_DB_URL"
trap 'rm -rf "$work"; psql "$ADMIN_URL" -c "drop database if exists backup_roundtrip;" >/dev/null 2>&1 || true' EXIT

# Throwaway recipient keypair.
age-keygen -o "$work/key.txt" 2>"$work/pub.txt"
PUB="$(grep -o 'age1[0-9a-z]*' "$work/pub.txt" | head -1)"

# Produce the encrypted bundle.
"$here/make-bundle.sh" \
  --db-url "$LOCAL_DB_URL" --env local --tier daily \
  --recipient "$PUB" --outdir "$work" >/dev/null

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
for f in roles.sql schema.sql data.sql auth_storage.sql; do
  [ -f "$work/unpacked/$f" ] || { echo "FAIL: $f missing"; exit 1; }
done

# Restore the public schema + data into a scratch DB and assert a seeded table.
psql "$ADMIN_URL" -c "drop database if exists backup_roundtrip;" >/dev/null
psql "$ADMIN_URL" -c "create database backup_roundtrip;" >/dev/null
SCRATCH="postgresql://postgres:postgres@127.0.0.1:54322/backup_roundtrip"
psql "$SCRATCH" -v ON_ERROR_STOP=1 -f "$work/unpacked/schema.sql" >/dev/null
psql "$SCRATCH" -v ON_ERROR_STOP=1 -f "$work/unpacked/data.sql"   >/dev/null
count="$(psql "$SCRATCH" -tAc "select count(*) from public.marker_types;")"
[ "$count" -gt 0 ] || { echo "FAIL: marker_types empty after restore ($count)"; exit 1; }
echo "ok: public restore (marker_types rows: $count)"

# Auth/storage capture integrity: each identity/storage table must be present in
# the data dump, and the captured rows must equal the live source counts AND the
# counts recorded in the manifest.
for tbl in auth.users auth.identities storage.buckets storage.objects; do
  grep -q "COPY ${tbl} " "$work/unpacked/auth_storage.sql" \
    || { echo "FAIL: $tbl not in auth_storage.sql"; exit 1; }
  live="$(psql "$LOCAL_DB_URL" -tAc "select count(*) from ${tbl};")"
  dumped="$(awk -v t="COPY ${tbl} " 'index($0,t)==1 {f=1; next} f && $0=="\\." {f=0} f {c++} END{print c+0}' "$work/unpacked/auth_storage.sql")"
  [ "$live" = "$dumped" ] || { echo "FAIL: $tbl count mismatch live=$live dumped=$dumped"; exit 1; }
  man="$(jq -r --arg t "$tbl" '.auth_storage_row_counts[$t]' "$manifest")"
  [ "$man" = "$live" ] || { echo "FAIL: $tbl manifest count $man != live $live"; exit 1; }
  echo "ok: $tbl captured ($live rows; manifest+dump agree)"
done

echo "ALL PASS"
