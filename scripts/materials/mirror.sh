#!/usr/bin/env bash
# Add-only mirror of one R2 materials bucket to its B2 backup bucket (WS1).
# No --delete: a bad R2 deletion must never propagate to the off-cloud copy.
# Streams via a local staging dir; a future event-driven mirror replaces this
# for sub-24h RPO.
set -euo pipefail

: "${R2_SRC_BUCKET:?}" "${R2_S3_ENDPOINT:?}" "${R2_ACCESS_KEY_ID:?}" "${R2_SECRET_ACCESS_KEY:?}"
: "${B2_DST_BUCKET:?}" "${B2_S3_ENDPOINT:?}" "${B2_KEY_ID:?}" "${B2_APP_KEY:?}"

workdir="$(mktemp -d)"; trap 'rm -rf "$workdir"' EXIT

echo "[mirror] pull R2 -> local"
AWS_ACCESS_KEY_ID="$R2_ACCESS_KEY_ID" AWS_SECRET_ACCESS_KEY="$R2_SECRET_ACCESS_KEY" \
  aws s3 sync "s3://$R2_SRC_BUCKET" "$workdir" --endpoint-url "$R2_S3_ENDPOINT" --only-show-errors

echo "[mirror] push local -> B2 (add-only, no delete)"
AWS_ACCESS_KEY_ID="$B2_KEY_ID" AWS_SECRET_ACCESS_KEY="$B2_APP_KEY" \
  aws s3 sync "$workdir" "s3://$B2_DST_BUCKET" --endpoint-url "$B2_S3_ENDPOINT" --only-show-errors

echo "[mirror] done: $R2_SRC_BUCKET -> $B2_DST_BUCKET"
