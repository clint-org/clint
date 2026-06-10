#!/usr/bin/env bash
# Verify the newest encrypted backup bundle in one object store (R2 or B2).
# Proves the bundle is FRESH and well-formed: checksum matches its manifest, it
# decrypts, all five artifacts are present, core public DDL is captured, and the
# auth/storage dump row counts match the manifest. This is capture integrity, not
# a live restore (a generic runner lacks the Supabase environment; see the
# quarterly drill in docs/runbook/13-backup-and-restore.md).
#
# AWS credentials are read from the standard AWS_ACCESS_KEY_ID /
# AWS_SECRET_ACCESS_KEY env vars (set them to the provider's static secrets).
# Other inputs come from env so the same script drives both providers without
# dynamic secret indexing:
#   PROVIDER   label for logs (e.g. R2, B2)
#   ENDPOINT   S3 endpoint URL
#   BUCKET     bucket name
#   AGE_KEY    age private key contents (identity)
#   PREFIX     object prefix to scan       (default clint/prod/daily/)
#   MAX_AGE_H  freshness ceiling in hours   (default 26)
set -euo pipefail

: "${PROVIDER:?PROVIDER required}" "${ENDPOINT:?ENDPOINT required}" "${BUCKET:?BUCKET required}"
: "${AGE_KEY:?AGE_KEY required}" "${AWS_ACCESS_KEY_ID:?AWS_ACCESS_KEY_ID required}"
: "${AWS_SECRET_ACCESS_KEY:?AWS_SECRET_ACCESS_KEY required}"
prefix="${PREFIX:-clint/prod/daily/}"
max_age_h="${MAX_AGE_H:-26}"

work="$(mktemp -d)"
trap 'rm -f "$work/key.txt"; rm -rf "$work"' EXIT
cd "$work"

echo "[$PROVIDER] scanning s3://$BUCKET/$prefix"
# Newest is by LastModified, but ONLY among bundles: the .manifest.json sibling
# is uploaded after the bundle, so an unfiltered sort would return the manifest.
newest="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
  --prefix "$prefix" --endpoint-url "$ENDPOINT" \
  --query "sort_by(Contents[?ends_with(Key, \`.tar.zst.age\`)], &LastModified)[-1].Key" \
  --output text)"
echo "[$PROVIDER] newest bundle: $newest"
[ "$newest" != "None" ] && [ -n "$newest" ] || { echo "[$PROVIDER] FAIL: no bundles under $prefix"; exit 1; }

lm="$(aws s3api head-object --bucket "$BUCKET" --key "$newest" --endpoint-url "$ENDPOINT" --query LastModified --output text)"
age_h=$(( ( $(date -u +%s) - $(date -u -d "$lm" +%s) ) / 3600 ))
echo "[$PROVIDER] backup age: ${age_h}h"
[ "$age_h" -le "$max_age_h" ] || { echo "[$PROVIDER] FAIL: stale backup (${age_h}h > ${max_age_h}h)"; exit 1; }

aws s3 cp "s3://$BUCKET/$newest"                              ./bundle.tar.zst.age  --endpoint-url "$ENDPOINT" --only-show-errors
aws s3 cp "s3://$BUCKET/${newest%.tar.zst.age}.manifest.json" ./remote.manifest.json --endpoint-url "$ENDPOINT" --only-show-errors

printf '%s' "$AGE_KEY" > key.txt
want="$(jq -r .sha256 remote.manifest.json)"
got="$(sha256sum bundle.tar.zst.age | awk '{print $1}')"
[ "$want" = "$got" ] || { echo "[$PROVIDER] FAIL: bundle sha256 $got != manifest $want"; exit 1; }
echo "[$PROVIDER] ok: bundle sha256 matches manifest"

age -d -i key.txt -o bundle.tar.zst bundle.tar.zst.age
rm -f key.txt
zstd -d bundle.tar.zst -o bundle.tar
mkdir unpacked && tar -xf bundle.tar -C unpacked

for f in roles.sql schema.sql data.sql auth_storage.sql manifest.json; do
  [ -s "unpacked/$f" ] || { echo "[$PROVIDER] FAIL: $f missing or empty"; exit 1; }
done
echo "[$PROVIDER] ok: all five artifacts present and non-empty"

grep -Eq 'CREATE TABLE (IF NOT EXISTS )?("?public"?\.)?"?marker_types"?' unpacked/schema.sql \
  || { echo "[$PROVIDER] FAIL: schema.sql missing core public DDL"; exit 1; }
echo "[$PROVIDER] ok: schema.sql contains core public DDL (marker_types)"

for tbl in auth.users auth.identities storage.buckets storage.objects; do
  grep -q "COPY ${tbl} " unpacked/auth_storage.sql \
    || { echo "[$PROVIDER] FAIL: $tbl not captured in auth_storage.sql"; exit 1; }
  dumped="$(awk -v t="COPY ${tbl} " 'index($0,t)==1 {f=1; next} f && $0=="\\." {f=0} f {c++} END{print c+0}' unpacked/auth_storage.sql)"
  recorded="$(jq -r --arg t "$tbl" '.auth_storage_row_counts[$t]' unpacked/manifest.json)"
  [ "$dumped" = "$recorded" ] || { echo "[$PROVIDER] FAIL: $tbl dump rows $dumped != manifest $recorded"; exit 1; }
  echo "[$PROVIDER] ok: $tbl captured ($dumped rows, matches manifest)"
done

echo "[$PROVIDER] ALL PASS"
