#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
assert_contains() {
  if printf '%s' "$1" | grep -qF -- "$2"; then echo "ok: $3"; else echo "FAIL: $3 (missing: $2)"; fail=1; fi
}

tmp="$(mktemp)"; echo hi > "$tmp"
out="$(
  DRY_RUN=1 \
  R2_BACKUP_BUCKET=r2buck R2_S3_ENDPOINT=https://r2.example \
  R2_BACKUP_ACCESS_KEY_ID=ak R2_BACKUP_SECRET_ACCESS_KEY=sk \
  B2_BACKUP_BUCKET=b2buck B2_S3_ENDPOINT=https://b2.example \
  B2_BACKUP_KEY_ID=bk B2_BACKUP_APP_KEY=bs \
  "$here/upload.sh" --file "$tmp" --key clint/prod/daily/x.tar.zst.age
)"

assert_contains "$out" "s3://r2buck/clint/prod/daily/x.tar.zst.age" "uploads to R2 key"
assert_contains "$out" "--endpoint-url https://r2.example"          "uses R2 endpoint"
assert_contains "$out" "s3://b2buck/clint/prod/daily/x.tar.zst.age" "uploads to B2 key"
assert_contains "$out" "--endpoint-url https://b2.example"          "uses B2 endpoint"

rm -f "$tmp"
if [ "$fail" -ne 0 ]; then echo "TESTS FAILED"; exit 1; fi
echo "ALL PASS"
