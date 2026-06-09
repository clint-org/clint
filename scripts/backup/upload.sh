#!/usr/bin/env bash
# Upload one file to R2 and B2 under the same object key. DRY_RUN=1 echoes only.
set -euo pipefail

file="" key=""
while [ $# -gt 0 ]; do
  case "$1" in
    --file) file="$2"; shift 2 ;;
    --key)  key="$2"; shift 2 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
done
: "${file:?--file required}" "${key:?--key required}"

put() {
  local bucket="$1" endpoint="$2" akid="$3" secret="$4"
  local cmd="aws s3 cp $file s3://$bucket/$key --endpoint-url $endpoint --only-show-errors"
  if [ "${DRY_RUN:-0}" = "1" ]; then echo "$cmd"; return 0; fi
  AWS_ACCESS_KEY_ID="$akid" AWS_SECRET_ACCESS_KEY="$secret" \
    aws s3 cp "$file" "s3://$bucket/$key" --endpoint-url "$endpoint" --only-show-errors
  # Verify the object exists (head-object) before declaring success.
  AWS_ACCESS_KEY_ID="$akid" AWS_SECRET_ACCESS_KEY="$secret" \
    aws s3api head-object --bucket "$bucket" --key "$key" --endpoint-url "$endpoint" >/dev/null
}

echo "[upload] -> R2"
put "${R2_BACKUP_BUCKET:?}" "${R2_S3_ENDPOINT:?}" "${R2_BACKUP_ACCESS_KEY_ID:?}" "${R2_BACKUP_SECRET_ACCESS_KEY:?}"
echo "[upload] -> B2"
put "${B2_BACKUP_BUCKET:?}" "${B2_S3_ENDPOINT:?}" "${B2_BACKUP_KEY_ID:?}" "${B2_BACKUP_APP_KEY:?}"
echo "[upload] done: $key"
