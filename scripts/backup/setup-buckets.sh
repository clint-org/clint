#!/usr/bin/env bash
# =============================================================================
# scripts/backup/setup-buckets.sh
#
# ONE-TIME OPERATOR SCRIPT. Run this manually with cloud admin credentials.
# Do NOT run in CI. Do NOT execute via Claude or any automated agent.
#
# Purpose: provision backup buckets on Cloudflare R2 (primary) and
#          Backblaze B2 (secondary), configure versioning, Object Lock
#          retention, lifecycle expiration rules, and document how to
#          create scoped write-only credentials for CI.
#
# Buckets provisioned:
#   R2 (Cloudflare) : clint-db-backups
#   B2 (Backblaze)  : clint-db-backups
#
# Required environment variables for R2:
#   CLOUDFLARE_ACCOUNT_ID  - your Cloudflare account ID (40-char hex)
#   CLOUDFLARE_API_TOKEN   - API token with R2:Edit scope
#
# Required for R2 S3-compat operations (lifecycle read-back):
#   AWS_ACCESS_KEY_ID      - R2 API token ID
#   AWS_SECRET_ACCESS_KEY  - R2 API token secret
#   (Both are obtained from the Cloudflare dashboard R2 "Manage R2 API Tokens"
#    after creating the token below. Set them in your shell before running.)
#
# Required environment variables for B2 (section 3):
#   B2_APPLICATION_KEY_ID  - Backblaze application key ID (admin-level)
#   B2_APPLICATION_KEY     - Backblaze application key secret
#
# Tool prerequisites:
#   wrangler  (npm install -g wrangler, v4+)
#   aws CLI   (with s3 and s3api subcommands -- used against R2 S3 endpoint)
#   jq        (for JSON pretty-print in verify section)
#   b2        (Backblaze CLI, for B2 section -- https://github.com/Backblaze/B2_Command_Line_Tool)
#
# Object Lock notes (R2 vs S3 API surface):
#   Cloudflare R2 does NOT implement the S3 PutObjectLockConfiguration or
#   PutBucketVersioning API calls. R2 uses its own "Bucket Lock" system
#   managed via the Cloudflare dashboard or wrangler r2 bucket lock commands.
#   S3 PutBucketLifecycleConfiguration IS supported on R2 and is used here.
# =============================================================================

set -euo pipefail

# ---------------------------------------------------------------------------
# Configuration: read from env with safe defaults.
# CLOUDFLARE_ACCOUNT_ID is mandatory.
# ---------------------------------------------------------------------------
R2_BUCKET="${R2_BACKUP_BUCKET:-clint-db-backups}"
B2_BUCKET="${B2_BACKUP_BUCKET:-clint-db-backups}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID must be set (your 40-char Cloudflare account ID)}"

R2_ENDPOINT="https://${CLOUDFLARE_ACCOUNT_ID}.r2.cloudflarestorage.com"

echo ""
echo "================================================================"
echo " Clint backup bucket setup"
echo " R2 bucket : ${R2_BUCKET}"
echo " B2 bucket : ${B2_BUCKET}"
echo " R2 endpoint: ${R2_ENDPOINT}"
echo "================================================================"
echo ""


# =============================================================================
# SECTION 1 -- Cloudflare R2 bucket
# =============================================================================
echo "--- SECTION 1: Cloudflare R2 ---"
echo ""

# Step 1a: Create the R2 bucket.
# wrangler r2 bucket create does not accept an Object Lock flag. The bucket is
# created first, then Object Lock retention is configured separately (step 1c).
# If the bucket already exists, wrangler exits non-zero; the operator can
# safely comment this line out on re-runs once the bucket exists.
echo "[R2] Creating bucket: ${R2_BUCKET} ..."
wrangler r2 bucket create "${R2_BUCKET}"
echo "[R2] Bucket created."
echo ""

# Step 1b: Versioning on R2.
# R2 does NOT support the S3 PutBucketVersioning API (as of 2026-06).
# Cloudflare R2 Bucket Lock (step 1c) provides immutability without requiring
# versioning to be toggled separately. No command is needed here.
echo "[R2] Versioning: R2 does not expose a PutBucketVersioning S3 API."
echo "     Immutability is enforced by Bucket Lock rules (step 1c)."
echo "     No action required -- proceed to step 1c."
echo ""

# Step 1c: Object Lock (Bucket Lock) on R2.
# R2 uses Cloudflare's own Bucket Lock system, not the S3 Object Lock API.
# wrangler r2 bucket lock set applies a JSON rule file.
# The JSON shape matches the Cloudflare Bucket Lock API request body.
# We set a default compliance-style rule covering all objects (empty prefix)
# with a 7-day minimum retention (daily backup horizon).
#
# NOTE: "bucket lock rules take precedence over lifecycle rules" (Cloudflare docs).
# The lock duration below (7 days) is intentionally shorter than the shortest
# lifecycle expiration (also 7 days for daily), so lifecycle deletions can
# still run after the lock window closes. Adjust if your compliance posture
# requires longer immutability.

LOCK_JSON_FILE="$(mktemp /tmp/r2-bucket-lock-XXXXXX.json)"
trap 'rm -f "$LOCK_JSON_FILE"' EXIT

cat > "$LOCK_JSON_FILE" <<'EOF'
{
  "rules": [
    {
      "id": "clint-default-7d-retain",
      "enabled": true,
      "condition": {
        "type": "Age",
        "maxAgeSeconds": 604800
      }
    }
  ]
}
EOF

echo "[R2] Applying Bucket Lock rules from ${LOCK_JSON_FILE} ..."
wrangler r2 bucket lock set "${R2_BUCKET}" --file "${LOCK_JSON_FILE}"
echo "[R2] Bucket Lock rules applied."
echo ""

# Step 1d: Lifecycle rules on R2 via S3 API.
# R2 supports PutBucketLifecycleConfiguration over the S3-compatible endpoint.
# Requires AWS_ACCESS_KEY_ID and AWS_SECRET_ACCESS_KEY to be set to an R2
# API token (create one via the dashboard or step 2a below and export them
# before running this section).
#
# Seven rules covering both clint/prod/* and clint/dev/* prefix hierarchies:
#   prod/daily      expires after   7 days
#   prod/weekly     expires after  28 days
#   prod/monthly    expires after 365 days
#   prod/pre-migration expires after 30 days
#   dev/daily       expires after   7 days
#   dev/weekly      expires after  28 days
#   dev/monthly     expires after 365 days

LIFECYCLE_JSON_FILE="$(mktemp /tmp/r2-lifecycle-XXXXXX.json)"
# Update trap to also clean this file.
trap 'rm -f "$LOCK_JSON_FILE" "$LIFECYCLE_JSON_FILE"' EXIT

cat > "$LIFECYCLE_JSON_FILE" <<'EOF'
{
  "Rules": [
    {
      "ID": "clint-prod-daily-7d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/prod/daily/" },
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "clint-prod-weekly-28d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/prod/weekly/" },
      "Expiration": { "Days": 28 }
    },
    {
      "ID": "clint-prod-monthly-365d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/prod/monthly/" },
      "Expiration": { "Days": 365 }
    },
    {
      "ID": "clint-prod-pre-migration-30d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/prod/pre-migration/" },
      "Expiration": { "Days": 30 }
    },
    {
      "ID": "clint-dev-daily-7d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/dev/daily/" },
      "Expiration": { "Days": 7 }
    },
    {
      "ID": "clint-dev-weekly-28d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/dev/weekly/" },
      "Expiration": { "Days": 28 }
    },
    {
      "ID": "clint-dev-monthly-365d",
      "Status": "Enabled",
      "Filter": { "Prefix": "clint/dev/monthly/" },
      "Expiration": { "Days": 365 }
    }
  ]
}
EOF

echo "[R2] Applying lifecycle rules ..."
aws s3api put-bucket-lifecycle-configuration \
  --bucket "${R2_BUCKET}" \
  --lifecycle-configuration "file://${LIFECYCLE_JSON_FILE}" \
  --endpoint-url "${R2_ENDPOINT}"
echo "[R2] Lifecycle rules applied."
echo ""


# =============================================================================
# SECTION 2 -- Scoped write-only credentials for CI
# =============================================================================
echo "--- SECTION 2: Scoped CI credentials ---"
echo ""

# Step 2a: R2 API token (write-only, no delete) for CI.
# Create this via the Cloudflare dashboard -- wrangler does not expose a
# "create API token" command. Follow these steps in the dashboard:
#
#   1. Go to: https://dash.cloudflare.com/profile/api-tokens
#   2. Click "Create Token" -> "Create Custom Token".
#   3. Name: "clint-backup-ci-r2-write"
#   4. Permissions:
#        R2  -> Object Read and Write  (NOT "Object Delete")
#   5. Account Resources: Include -> your account.
#   6. Click "Continue to Summary" -> "Create Token".
#   7. Copy the token and the key ID from the confirmation screen.
#   8. Store both as GitHub Actions secrets:
#        BACKUP_R2_API_TOKEN_ID  (the key ID / access key)
#        BACKUP_R2_API_TOKEN_SECRET (the token secret / secret key)
#
# IMPORTANT: "Object Read and Write" permission grants PutObject but NOT
# DeleteObject. Verify this in the token's permission summary before saving.
echo "[ACTION REQUIRED] Create an R2 API token with Object Read+Write (no Delete)"
echo "  Dashboard: https://dash.cloudflare.com/profile/api-tokens"
echo "  Store as GitHub secrets: BACKUP_R2_API_TOKEN_ID, BACKUP_R2_API_TOKEN_SECRET"
echo ""

# Step 2b: B2 application key (write-only, no delete) for CI.
# Create this via the Backblaze dashboard or CLI. Follow these steps:
#
#   1. Log into https://secure.backblaze.com/b2_buckets.htm
#   2. Navigate to "App Keys" -> "Add a New Application Key".
#   3. Name: "clint-backup-ci-b2-write"
#   4. Allow access to: your backup bucket only.
#   5. File name prefix: (leave blank to allow all prefixes)
#   6. Capabilities: readFiles, writeFiles, listBuckets, listFiles
#      -- do NOT include: deleteFiles, deleteFileVersions
#   7. Click "Create New Key".
#   8. Record the keyID and applicationKey immediately (shown only once).
#   9. Store as GitHub Actions secrets:
#        BACKUP_B2_KEY_ID
#        BACKUP_B2_APP_KEY
#
# Alternatively via the b2 CLI:
#   b2 create-key --bucket "${B2_BUCKET}" \
#     clint-backup-ci-b2-write \
#     readFiles,writeFiles,listBuckets,listFiles
echo "[ACTION REQUIRED] Create a B2 application key with writeFiles+listBuckets (no deleteFiles)"
echo "  Dashboard: https://secure.backblaze.com/b2_buckets.htm -> App Keys"
echo "  Store as GitHub secrets: BACKUP_B2_KEY_ID, BACKUP_B2_APP_KEY"
echo ""


# =============================================================================
# SECTION 3 -- Backblaze B2 bucket (guided steps)
# =============================================================================
echo "--- SECTION 3: Backblaze B2 (guided -- verify exact flags in B2 docs) ---"
echo ""
echo "The B2 CLI flag surface for Object Lock and lifecycle differs from the"
echo "S3 API and changes between B2 CLI versions. Verify each command against:"
echo "  https://b2-command-line-tool.readthedocs.io/en/master/"
echo "  https://www.backblaze.com/apidocs/introduction-to-the-b2-native-api"
echo ""

# Step 3a: Authorize B2 CLI.
echo "[B2 GUIDED STEP 3a] Authorize B2 CLI with admin credentials:"
echo "  Ensure B2_APPLICATION_KEY_ID and B2_APPLICATION_KEY are exported, then run:"
echo "    b2 account authorize"
echo ""

# Step 3b: Create B2 bucket with File Lock enabled.
# File Lock (B2's term for Object Lock) must be enabled at creation time --
# it cannot be added to an existing bucket. Use --file-lock-enabled.
# Use --default-server-side-encryption SSE-B2 for encryption at rest.
echo "[B2 GUIDED STEP 3b] Create the B2 bucket with File Lock enabled:"
echo "  b2 bucket create \\"
echo "    --default-server-side-encryption SSE-B2 \\"
echo "    --file-lock-enabled \\"
echo "    ${B2_BUCKET} allPrivate"
echo ""
echo "  Note: 'allPrivate' means no public access. File Lock enables compliance-"
echo "  mode locking. Verify --file-lock-enabled is the current flag name in"
echo "  your installed b2 CLI version (it may appear as --fileLockEnabled in"
echo "  older versions). See: https://b2-command-line-tool.readthedocs.io/"
echo ""

# Step 3c: Enable versioning on B2 (File Lock implies versioning).
# When File Lock is enabled at creation, B2 automatically enables versioning.
# No separate versioning step is needed.
echo "[B2 GUIDED STEP 3c] Versioning: automatically enabled when File Lock is on."
echo "  No separate step required."
echo ""

# Step 3d: Set default retention on the B2 bucket.
# This mirrors the 7-day minimum retention set on R2.
echo "[B2 GUIDED STEP 3d] Set default file lock retention (7 days, compliance mode):"
echo "  b2 bucket update \\"
echo "    --file-lock-enabled \\"
echo "    --default-retention-mode compliance \\"
echo "    --default-retention-period 7days \\"
echo "    ${B2_BUCKET}"
echo ""
echo "  Verify the --default-retention-mode and --default-retention-period flag"
echo "  names in your b2 CLI version. Alternative: configure via the B2 dashboard"
echo "  under Bucket Settings -> Default File Lock."
echo ""

# Step 3e: Lifecycle rules on B2.
# B2 lifecycle rules are set per-bucket and use prefix-based expiration similar
# to S3, but the CLI syntax differs. Mirror the same seven rules as R2.
# Verify each prefix and days value against the B2 lifecycle docs:
#   https://www.backblaze.com/docs/cloud-storage-lifecycle-rules
echo "[B2 GUIDED STEP 3e] Apply lifecycle rules to mirror R2 (7 prefixes)."
echo "  B2 lifecycle rules can be set via b2 bucket update or the dashboard."
echo "  The following prefixes and retention days must be configured:"
echo ""
echo "    Prefix                        | Expire after (days)"
echo "    ------------------------------|--------------------"
echo "    clint/prod/daily/             |   7"
echo "    clint/prod/weekly/            |  28"
echo "    clint/prod/monthly/           | 365"
echo "    clint/prod/pre-migration/     |  30"
echo "    clint/dev/daily/              |   7"
echo "    clint/dev/weekly/             |  28"
echo "    clint/dev/monthly/            | 365"
echo ""
echo "  Via dashboard: go to your B2 bucket -> Lifecycle Rules -> Add Rule."
echo "  Via CLI (example for one rule -- repeat for each prefix):"
echo "    b2 bucket update \\"
echo "      --lifecycle-rule '{\"daysFromHidingToDeleting\":null,\"daysFromUploadingToHiding\":7,\"fileNamePrefix\":\"clint/prod/daily/\"}' \\"
echo "      ${B2_BUCKET}"
echo ""
echo "  IMPORTANT: B2 uses 'daysFromUploadingToHiding' (marks old versions hidden)"
echo "  and 'daysFromHidingToDeleting' (purges hidden versions). Set both to"
echo "  achieve expiration. Verify the exact JSON shape in the B2 docs before"
echo "  applying -- the structure above is illustrative, not guaranteed current."
echo ""


# =============================================================================
# SECTION 4 -- Verify (real read-back commands for R2; note for B2)
# =============================================================================
echo "--- SECTION 4: Verification ---"
echo ""
echo "Verifying R2 configuration (requires AWS_ACCESS_KEY_ID and"
echo "AWS_SECRET_ACCESS_KEY set to your R2 token values) ..."
echo ""

echo "[R2 VERIFY] Bucket Lock rules (via wrangler):"
wrangler r2 bucket lock list "${R2_BUCKET}" || echo "  (wrangler r2 bucket lock list not available -- check dashboard)"
echo ""

echo "[R2 VERIFY] Lifecycle configuration:"
aws s3api get-bucket-lifecycle-configuration \
  --bucket "${R2_BUCKET}" \
  --endpoint-url "${R2_ENDPOINT}" \
  | jq .
echo ""

echo "[R2 VERIFY] Versioning status:"
echo "  Note: R2 does not implement GetBucketVersioning via the S3 API."
echo "  Versioning state is managed by Bucket Lock. Confirm Lock rules above."
echo ""

echo "[R2 VERIFY] Object Lock configuration (S3 API):"
echo "  Note: R2 does not implement GetObjectLockConfiguration via the S3 API."
echo "  Immutability is enforced by Cloudflare Bucket Lock rules (verified above)."
echo ""

echo "[B2 VERIFY] Repeat equivalent checks for B2:"
echo "  b2 bucket get ${B2_BUCKET}"
echo "  -- look for: isFileLockEnabled, defaultRetention, lifecycleRules"
echo ""

echo "================================================================"
echo " Setup complete."
echo " Checklist:"
echo "   [_] R2 bucket created and visible in the Cloudflare dashboard"
echo "   [_] R2 Bucket Lock rules confirmed (wrangler r2 bucket lock list)"
echo "   [_] R2 lifecycle rules confirmed (7 rules, all prefixes present)"
echo "   [_] R2 CI token created (Object Read+Write, no Delete)"
echo "   [_] R2 CI secrets stored in GitHub (BACKUP_R2_API_TOKEN_ID, BACKUP_R2_API_TOKEN_SECRET)"
echo "   [_] B2 bucket created with File Lock enabled"
echo "   [_] B2 default retention set (7 days, compliance)"
echo "   [_] B2 lifecycle rules configured (7 prefixes, matching R2)"
echo "   [_] B2 CI key created (writeFiles+listBuckets, no deleteFiles)"
echo "   [_] B2 CI secrets stored in GitHub (BACKUP_B2_KEY_ID, BACKUP_B2_APP_KEY)"
echo "================================================================"
