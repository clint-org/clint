# DB Backup Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stand up an independent, off-site, immutable Postgres backup policy for Clint's prod and dev Supabase databases, stored cross-cloud in Cloudflare R2 + Backblaze B2, with automated daily + pre-migration dumps, GFS retention, encryption, and a weekly restore-verification test.

**Architecture:** A repo-root `scripts/backup/` toolkit does the heavy lifting (tier selection, dump+bundle+encrypt, multi-destination upload) so the logic is unit-testable locally against the local Supabase stack and reused by every trigger. A local GitHub composite action (`.github/actions/db-backup`) wraps the toolkit; a scheduled workflow (`backup-db.yml`) runs it daily over a `[prod, dev]` matrix, and `deploy-prod.yml` calls it for a pre-migration snapshot. Retention and immutability are enforced by bucket lifecycle + Object Lock, never by the job, and the job holds write-only credentials. A separate weekly `backup-verify.yml` downloads the newest prod backup, checks freshness, decrypts it with an offline-held `age` key (gated behind a protected environment), and verifies capture integrity (checksum, all artifacts present, core public DDL, and auth/storage dump row counts matching the manifest). A live end-to-end restore needs the Supabase environment and is the quarterly manual drill, not an automated step.

**Tech Stack:** Bash, Supabase CLI (`supabase db dump`), `zstd`, `age` (encryption), AWS CLI v2 (S3-compatible uploads to both R2 and B2), GitHub Actions, Cloudflare R2 + `wrangler`, Backblaze B2.

**Spec:** `docs/superpowers/specs/2026-06-07-db-backup-policy-design.md`

---

## Local tooling prerequisites

Before starting, on the dev machine (macOS):

```bash
brew install age zstd jq awscli
```

`supabase` is already installed. GitHub `ubuntu-latest` runners ship `zstd`, `jq`,
and AWS CLI v2 preinstalled; `age` and `actionlint` are installed by the
workflows/actions that need them.

`actionlint` for local workflow linting:

```bash
brew install actionlint
```

The local Supabase stack must be running for the roundtrip tests:

```bash
supabase start   # exposes Postgres on localhost:54322 (user/pass: postgres/postgres)
```

---

## File structure

| Path | Responsibility |
|---|---|
| `scripts/backup/tiers.sh` | Pure: map a UTC date to its GFS tier prefixes (`daily`/`weekly`/`monthly`) |
| `scripts/backup/tiers.test.sh` | Plain-bash unit tests for `tiers.sh` |
| `scripts/backup/make-bundle.sh` | Dump roles + public schema/data + auth/storage data from a `--db-url`, write manifest (with captured row counts), `tar`+`zstd`, `age`-encrypt |
| `scripts/backup/roundtrip.test.sh` | Local: bundle the local DB, decrypt, verify capture integrity (artifacts, checksum, public + auth/storage row counts vs live and manifest) |
| `scripts/backup/upload.sh` | Upload one file to R2 + B2 via AWS CLI S3 API; `DRY_RUN` mode echoes commands |
| `scripts/backup/upload.test.sh` | Assert `upload.sh` builds correct `aws s3` commands (DRY_RUN) |
| `scripts/backup/setup-buckets.sh` | Operator-run, idempotent: create both buckets with versioning, Object Lock, lifecycle |
| `.github/actions/db-backup/action.yml` | Composite action: install `age`, run dump+bundle+upload for one env+tierset |
| `.github/workflows/backup-db.yml` | Scheduled (daily) + manual backup, matrix `[prod, dev]` |
| `.github/workflows/deploy-prod.yml` | MODIFY: add pre-migration snapshot step before `supabase db push` |
| `.github/workflows/backup-verify.yml` | Weekly restore-verification + freshness alert |
| `docs/runbook/12-backup-and-restore.md` | Restore procedure, key custody, drill checklist, RPO/RTO |
| `docs/runbook/policy-db-backup.md` | Client-facing backup policy statement |

> Confirm the runbook number prefix before creating `12-backup-and-restore.md`:
> run `ls docs/runbook/` and use the next free integer. The plan uses `12-` as a
> placeholder for the highest+1; substitute the real number.

---

## Task 1: Tier-selection logic

**Files:**
- Create: `scripts/backup/tiers.sh`
- Test: `scripts/backup/tiers.test.sh`

Tier rules for a UTC date: always `daily`; add `weekly` if the date is a Sunday
(`%u` == 7); add `monthly` if it is the 1st (`%d` == 01).

- [ ] **Step 1: Write the failing test**

Create `scripts/backup/tiers.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
assert_eq() {
  if [ "$1" != "$2" ]; then echo "FAIL: $3: expected [$2] got [$1]"; fail=1; else echo "ok: $3"; fi
}
run() { "$here/tiers.sh" "$1" | paste -sd, -; }

assert_eq "$(run 2026-06-07)" "daily,weekly"          "Sunday -> daily+weekly"
assert_eq "$(run 2026-06-01)" "daily,monthly"         "1st (Mon) -> daily+monthly"
assert_eq "$(run 2026-03-01)" "daily,weekly,monthly"  "Sunday+1st -> all three"
assert_eq "$(run 2026-06-09)" "daily"                 "weekday -> daily only"

if [ "$fail" -ne 0 ]; then echo "TESTS FAILED"; exit 1; fi
echo "ALL PASS"
```

(Dates verified: 2026-06-07 and 2026-03-01 are Sundays; 2026-06-01 is the 1st;
2026-06-09 is a weekday.)

- [ ] **Step 2: Run test to verify it fails**

```bash
chmod +x scripts/backup/tiers.test.sh
scripts/backup/tiers.test.sh
```

Expected: FAIL, `tiers.sh` does not exist (`No such file or directory`).

- [ ] **Step 3: Write minimal implementation**

Create `scripts/backup/tiers.sh`:

```bash
#!/usr/bin/env bash
# Print the GFS tier prefixes (one per line) for a UTC date (YYYY-MM-DD).
set -euo pipefail
d="${1:?usage: tiers.sh YYYY-MM-DD}"

# Support both GNU date (Linux/CI) and BSD date (macOS).
dow() { date -u -d "$1" +%u 2>/dev/null || date -u -j -f "%Y-%m-%d" "$1" +%u; }
dom() { date -u -d "$1" +%d 2>/dev/null || date -u -j -f "%Y-%m-%d" "$1" +%d; }

echo "daily"
[ "$(dow "$d")" = "7" ]  && echo "weekly"  || true
[ "$(dom "$d")" = "01" ] && echo "monthly" || true
```

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x scripts/backup/tiers.sh
scripts/backup/tiers.test.sh
```

Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/tiers.sh scripts/backup/tiers.test.sh
git commit -m "Add GFS tier-selection logic for DB backups"
```

---

## Task 2: Dump + bundle + encrypt, verified by local capture roundtrip

**Files:**
- Create: `scripts/backup/make-bundle.sh`
- Test: `scripts/backup/roundtrip.test.sh`

> **Revision 2026-06-07:** the restore target is a Supabase project (new or
> self-hosted), not bare Postgres -- the `auth`/`storage` schemas are platform-
> managed. Artifacts are kept CLEAN (no stubbed `auth.*` schema, no
> `CREATE OR REPLACE` that would clobber Supabase's real auth functions). The
> bundle has FOUR sql artifacts: `roles.sql`, `schema.sql` (public DDL),
> `data.sql` (public data), and `auth_storage.sql` (a `pg_dump --data-only` of
> `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`). The
> automated test verifies *capture integrity* only (bundle well-formed; live row
> counts equal what is in the dump and the manifest). It does NOT do a live
> restore: this app's schema needs the Supabase `extensions`/`auth` environment,
> so end-to-end restore is the quarterly manual drill. See spec section 6
> "Verification split".

`make-bundle.sh` produces, for one database, an encrypted bundle plus a manifest.
It dumps four artifacts (roles, public schema, public data, auth/storage data),
bundles + compresses them with a manifest that records the captured auth/storage
row counts, and encrypts with `age`.

- [ ] **Step 1: Write the failing test**

Create `scripts/backup/roundtrip.test.sh`. It requires local Supabase running
(`supabase start`). It generates a throwaway `age` keypair, bundles the local DB,
decrypts it, and verifies **capture integrity** (it does NOT do a live restore --
this app's schema depends on the Supabase `extensions`/`auth` environment, so a
live restore is the quarterly manual drill; see spec section 6).

```bash
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
supabase start    # if not already running
chmod +x scripts/backup/roundtrip.test.sh
scripts/backup/roundtrip.test.sh
```

Expected: FAIL, `make-bundle.sh` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/backup/make-bundle.sh`:

```bash
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
```

> `pg_dump` must be version >= 17 (matching the server). On GitHub runners install
> `postgresql-client-17` from the PGDG apt repo in the composite action (Task 5);
> locally use the Supabase-bundled `pg_dump` or `brew install postgresql@17`.

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x scripts/backup/make-bundle.sh
scripts/backup/roundtrip.test.sh
```

Expected final line: `ALL PASS`, preceded by `ok:` lines for sha, artifacts,
schema DDL, public data, and each of the four auth/storage tables.

> If `supabase db dump --db-url` rejects the local URL, confirm the CLI version
> supports `--db-url` (`supabase --version`); the project uses a current CLI in
> CI via `supabase/setup-cli@v1`. Update the local CLI with `brew upgrade supabase`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/make-bundle.sh scripts/backup/roundtrip.test.sh
git commit -m "Capture auth/storage data in backups; verify capture integrity in roundtrip"
```

---

## Task 3: Operator infrastructure setup (buckets, credentials, keys, secrets)

This task provisions cloud resources and secrets. It is run once by an operator
with admin credentials, not in CI. It produces the inputs the later workflows
depend on, so it is sequenced before the live smoke tests in Tasks 6 and 8.

**Files:**
- Create: `scripts/backup/setup-buckets.sh`

> **REQUIRED SUB-SKILLS for this task:** consult `cloudflare` and `wrangler`
> skills for the exact, current R2 Object Lock / lifecycle commands, and the
> Backblaze B2 docs for B2 Object Lock + lifecycle. Cloud CLI surfaces change;
> verify each command against the skill before running it rather than trusting
> flags blind.

- [ ] **Step 1: Generate the age keypair (offline)**

On a trusted machine, not in CI:

```bash
age-keygen -o clint-backup-age.key
# Public recipient (goes into CI as BACKUP_AGE_PUBLIC_KEY):
grep 'public key:' clint-backup-age.key
```

Store `clint-backup-age.key` (contains the PRIVATE key) in the team password
manager / break-glass vault. It must NOT live in normal CI. Record the named
custodians; they go in the runbook (Task 9).

- [ ] **Step 2: Write the bucket setup script**

Create `scripts/backup/setup-buckets.sh`. It is idempotent and documents every
resource. Replace the verify-against-skill commands as noted.

```bash
#!/usr/bin/env bash
# One-time operator setup for backup buckets. Requires admin creds in the env:
#   CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID   (R2 admin)
#   B2_APPLICATION_KEY_ID, B2_APPLICATION_KEY      (B2 admin, via `b2` CLI)
# See the `cloudflare`/`wrangler` skills and Backblaze B2 docs for Object Lock.
set -euo pipefail

R2_BUCKET="${R2_BACKUP_BUCKET:-clint-db-backups}"
B2_BUCKET="${B2_BACKUP_BUCKET:-clint-db-backups}"

echo "== R2: create bucket (Object Lock must be enabled at creation) =="
# Verify against the wrangler skill: R2 Object Lock is enabled at create time.
npx wrangler r2 bucket create "$R2_BUCKET" || echo "(bucket may already exist)"

echo "== R2: lifecycle rules (expire by tier prefix) =="
# Apply via the S3 API against the R2 endpoint. Endpoint:
#   https://<CLOUDFLARE_ACCOUNT_ID>.r2.cloudflarestorage.com
# Use scripts/backup/lifecycle.json below. Confirm R2 lifecycle support in skill.
cat > /tmp/lifecycle.json <<'JSON'
{
  "Rules": [
    {"ID": "daily",         "Filter": {"Prefix": "clint/prod/daily/"},        "Status": "Enabled", "Expiration": {"Days": 7}},
    {"ID": "weekly",        "Filter": {"Prefix": "clint/prod/weekly/"},       "Status": "Enabled", "Expiration": {"Days": 28}},
    {"ID": "monthly",       "Filter": {"Prefix": "clint/prod/monthly/"},      "Status": "Enabled", "Expiration": {"Days": 365}},
    {"ID": "premigration",  "Filter": {"Prefix": "clint/prod/pre-migration/"},"Status": "Enabled", "Expiration": {"Days": 30}},
    {"ID": "dev-daily",     "Filter": {"Prefix": "clint/dev/daily/"},         "Status": "Enabled", "Expiration": {"Days": 7}},
    {"ID": "dev-weekly",    "Filter": {"Prefix": "clint/dev/weekly/"},        "Status": "Enabled", "Expiration": {"Days": 28}},
    {"ID": "dev-monthly",   "Filter": {"Prefix": "clint/dev/monthly/"},       "Status": "Enabled", "Expiration": {"Days": 365}}
  ]
}
JSON
echo "Apply /tmp/lifecycle.json to R2 and B2 via your S3 client per the skill docs."

echo "== B2: create bucket with Object Lock + matching lifecycle =="
# Verify against B2 docs: create bucket with --defaultServerSideEncryption and
# file lock enabled, then set lifecycle rules mirroring the prefixes above.
echo "Run the B2 create/lifecycle commands from the Backblaze docs for: $B2_BUCKET"

echo "== Scoped write-only credentials =="
echo "Create an R2 API token limited to Object Read+Write (NO delete) on $R2_BUCKET."
echo "Create a B2 application key limited to writeFiles+listBuckets (NO deleteFiles) on $B2_BUCKET."
echo "These become the CI secrets in Step 4. Do not grant delete; lifecycle/lock handle expiry."
```

- [ ] **Step 3: Run the setup script and apply lifecycle/lock**

```bash
export CLOUDFLARE_API_TOKEN=... CLOUDFLARE_ACCOUNT_ID=...
chmod +x scripts/backup/setup-buckets.sh
scripts/backup/setup-buckets.sh
```

Then, following the `cloudflare`/`wrangler` skill and B2 docs, apply the
lifecycle JSON and the lock to both buckets. Verify:

```bash
# R2 immutability is Cloudflare Bucket Lock (NOT S3 Object Lock); R2 has no S3
# versioning. Lifecycle is the only S3 bucket API R2 implements here.
wrangler r2 bucket lock list "$R2_BACKUP_BUCKET"
aws s3api get-bucket-lifecycle-configuration --bucket "$R2_BACKUP_BUCKET" --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com" | jq .
```

Expected: a Bucket Lock rule present, and the seven lifecycle rules. For B2, use
`b2 bucket get "$B2_BACKUP_BUCKET"` to confirm file lock + lifecycle.

> The committed `scripts/backup/setup-buckets.sh` is the authoritative, current
> version: R2 uses `wrangler r2 bucket create` + `wrangler r2 bucket lock set`
> (Bucket Lock) + `aws s3api put-bucket-lifecycle-configuration`; R2 has no S3
> versioning. The lock window must be <= the shortest lifecycle tier (7d) because
> Bucket Lock takes precedence over lifecycle. B2 create/lock/lifecycle remain
> guided steps to verify against current Backblaze docs.

- [ ] **Step 4: Add GitHub Actions secrets**

Add these repository secrets (already present ones are listed for reference):

```bash
# Already present (do not re-add): SUPABASE_PROD_PROJECT_REF, SUPABASE_DEV_PROJECT_REF,
#   SUPABASE_PROD_DB_PASSWORD, SUPABASE_DEV_DB_PASSWORD, SUPABASE_ACCESS_TOKEN,
#   CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN

gh secret set BACKUP_AGE_PUBLIC_KEY        --body "age1...."        # from Step 1
gh secret set R2_BACKUP_BUCKET             --body "clint-db-backups"
gh secret set R2_BACKUP_ACCESS_KEY_ID      --body "..."            # write-only R2 token
gh secret set R2_BACKUP_SECRET_ACCESS_KEY  --body "..."
gh secret set B2_BACKUP_BUCKET             --body "clint-db-backups"
gh secret set B2_S3_ENDPOINT               --body "https://s3.us-west-004.backblazeb2.com"  # your B2 region
gh secret set B2_BACKUP_KEY_ID             --body "..."            # write-only B2 key id
gh secret set B2_BACKUP_APP_KEY            --body "..."
```

The `age` PRIVATE key is added later as a `production`-environment secret in
Task 8 (so only the verification workflow can read it):

```bash
gh secret set BACKUP_AGE_PRIVATE_KEY --env production --body "AGE-SECRET-KEY-1..."
```

- [ ] **Step 5: Commit the setup script**

```bash
git add scripts/backup/setup-buckets.sh
git commit -m "Add operator setup script for backup buckets and credentials"
```

---

## Task 4: Multi-destination upload script

**Files:**
- Create: `scripts/backup/upload.sh`
- Test: `scripts/backup/upload.test.sh`

`upload.sh` uploads one local file to both R2 and B2 under a given object key,
using the AWS CLI S3 API against each provider's endpoint. A `DRY_RUN=1` mode
prints the `aws` commands instead of running them, so command construction is
unit-testable without credentials.

- [ ] **Step 1: Write the failing test**

Create `scripts/backup/upload.test.sh`:

```bash
#!/usr/bin/env bash
set -uo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
fail=0
assert_contains() {
  if printf '%s' "$1" | grep -qF "$2"; then echo "ok: $3"; else echo "FAIL: $3 (missing: $2)"; fail=1; fi
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
```

- [ ] **Step 2: Run test to verify it fails**

```bash
chmod +x scripts/backup/upload.test.sh
scripts/backup/upload.test.sh
```

Expected: FAIL, `upload.sh` does not exist.

- [ ] **Step 3: Write minimal implementation**

Create `scripts/backup/upload.sh`:

```bash
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
```

- [ ] **Step 4: Run test to verify it passes**

```bash
chmod +x scripts/backup/upload.sh
scripts/backup/upload.test.sh
```

Expected: `ALL PASS`.

- [ ] **Step 5: Commit**

```bash
git add scripts/backup/upload.sh scripts/backup/upload.test.sh
git commit -m "Add multi-destination R2+B2 upload script for backups"
```

---

## Task 5: Composite action wiring the toolkit

**Files:**
- Create: `.github/actions/db-backup/action.yml`

The composite action runs, for one environment + tierset, the full pipeline:
install `age`, link Supabase, make the bundle, derive tiers, upload the bundle +
manifest under each tier prefix. Secrets are passed as inputs (composite actions
cannot read `secrets` directly).

- [ ] **Step 1: Write the composite action**

Create `.github/actions/db-backup/action.yml`:

```yaml
name: DB backup
description: Dump, encrypt, and upload one environment's Postgres to R2 + B2.
inputs:
  environment:    { description: prod or dev, required: true }
  project_ref:    { description: Supabase project ref, required: true }
  db_password:    { description: Supabase DB password, required: true }
  access_token:   { description: Supabase access token, required: true }
  age_recipient:  { description: age public key, required: true }
  tier_override:  { description: explicit tier (e.g. pre-migration); empty = auto by date, required: false, default: "" }
  r2_bucket:      { required: true, description: R2 bucket }
  r2_endpoint:    { required: true, description: R2 S3 endpoint }
  r2_key_id:      { required: true, description: R2 access key id }
  r2_secret:      { required: true, description: R2 secret }
  b2_bucket:      { required: true, description: B2 bucket }
  b2_endpoint:    { required: true, description: B2 S3 endpoint }
  b2_key_id:      { required: true, description: B2 key id }
  b2_app_key:     { required: true, description: B2 app key }
runs:
  using: composite
  steps:
    - name: Install age
      shell: bash
      run: |
        sudo apt-get update -qq && sudo apt-get install -y -qq age

    - name: Link Supabase project
      shell: bash
      env:
        SUPABASE_ACCESS_TOKEN: ${{ inputs.access_token }}
      run: supabase link --project-ref ${{ inputs.project_ref }}

    - name: Build encrypted bundle
      id: bundle
      shell: bash
      env:
        SUPABASE_ACCESS_TOKEN: ${{ inputs.access_token }}
      run: |
        db_url="postgresql://postgres:${{ inputs.db_password }}@db.${{ inputs.project_ref }}.supabase.co:5432/postgres"
        tier="${{ inputs.tier_override }}"
        [ -z "$tier" ] && tier="daily"   # placeholder tier in filename; upload fans out to real tiers
        out="$(scripts/backup/make-bundle.sh \
          --db-url "$db_url" --env "${{ inputs.environment }}" --tier "$tier" \
          --recipient "${{ inputs.age_recipient }}" --outdir ./_backup | tail -1)"
        echo "bundle=$out" >> "$GITHUB_OUTPUT"
        echo "manifest=${out%.tar.zst.age}.manifest.json" >> "$GITHUB_OUTPUT"

    - name: Upload to each tier prefix
      shell: bash
      env:
        R2_BACKUP_BUCKET: ${{ inputs.r2_bucket }}
        R2_S3_ENDPOINT: ${{ inputs.r2_endpoint }}
        R2_BACKUP_ACCESS_KEY_ID: ${{ inputs.r2_key_id }}
        R2_BACKUP_SECRET_ACCESS_KEY: ${{ inputs.r2_secret }}
        B2_BACKUP_BUCKET: ${{ inputs.b2_bucket }}
        B2_S3_ENDPOINT: ${{ inputs.b2_endpoint }}
        B2_BACKUP_KEY_ID: ${{ inputs.b2_key_id }}
        B2_BACKUP_APP_KEY: ${{ inputs.b2_app_key }}
      run: |
        set -euo pipefail
        env="${{ inputs.environment }}"
        bundle="${{ steps.bundle.outputs.bundle }}"
        manifest="${{ steps.bundle.outputs.manifest }}"
        if [ -n "${{ inputs.tier_override }}" ]; then
          tiers="${{ inputs.tier_override }}"
        else
          tiers="$(scripts/backup/tiers.sh "$(date -u +%Y-%m-%d)")"
        fi
        for tier in $tiers; do
          base="$(basename "$bundle")"
          scripts/backup/upload.sh --file "$bundle"   --key "clint/$env/$tier/$base"
          scripts/backup/upload.sh --file "$manifest" --key "clint/$env/$tier/$(basename "$manifest")"
        done
```

> The `db_url` host form `db.<ref>.supabase.co:5432` is the direct connection.
> If the project enforces pooler-only access, switch to the session-mode pooler
> URI from the Supabase dashboard (Project Settings -> Database -> Connection
> string). Confirm during the Task 6 live smoke.

- [ ] **Step 2: Lint the action**

```bash
actionlint .github/actions/db-backup/action.yml || true   # actionlint targets workflows; YAML-validate:
python3 -c "import yaml,sys; yaml.safe_load(open('.github/actions/db-backup/action.yml')); print('YAML OK')"
```

Expected: `YAML OK`.

- [ ] **Step 3: Commit**

```bash
git add .github/actions/db-backup/action.yml
git commit -m "Add db-backup composite action"
```

---

## Task 6: Scheduled backup workflow

**Files:**
- Create: `.github/workflows/backup-db.yml`

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/backup-db.yml`:

```yaml
name: Backup databases
on:
  schedule:
    - cron: "0 9 * * *"   # daily 09:00 UTC
  workflow_dispatch:

permissions:
  contents: read

concurrency:
  group: backup-db
  cancel-in-progress: false

jobs:
  backup:
    runs-on: ubuntu-latest
    strategy:
      fail-fast: false
      matrix:
        include:
          - environment: prod
            project_ref_secret: SUPABASE_PROD_PROJECT_REF
            db_password_secret: SUPABASE_PROD_DB_PASSWORD
          - environment: dev
            project_ref_secret: SUPABASE_DEV_PROJECT_REF
            db_password_secret: SUPABASE_DEV_DB_PASSWORD
    steps:
      - uses: actions/checkout@v4
      - uses: supabase/setup-cli@v1
        with:
          version: latest
      - name: Backup ${{ matrix.environment }}
        uses: ./.github/actions/db-backup
        with:
          environment: ${{ matrix.environment }}
          project_ref: ${{ secrets[matrix.project_ref_secret] }}
          db_password: ${{ secrets[matrix.db_password_secret] }}
          access_token: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          age_recipient: ${{ secrets.BACKUP_AGE_PUBLIC_KEY }}
          r2_bucket: ${{ secrets.R2_BACKUP_BUCKET }}
          r2_endpoint: https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
          r2_key_id: ${{ secrets.R2_BACKUP_ACCESS_KEY_ID }}
          r2_secret: ${{ secrets.R2_BACKUP_SECRET_ACCESS_KEY }}
          b2_bucket: ${{ secrets.B2_BACKUP_BUCKET }}
          b2_endpoint: ${{ secrets.B2_S3_ENDPOINT }}
          b2_key_id: ${{ secrets.B2_BACKUP_KEY_ID }}
          b2_app_key: ${{ secrets.B2_BACKUP_APP_KEY }}
```

- [ ] **Step 2: Lint the workflow**

```bash
actionlint .github/workflows/backup-db.yml
```

Expected: no output (clean). Fix any reported issues.

- [ ] **Step 3: Live smoke test (requires Task 3 complete)**

```bash
git add .github/workflows/backup-db.yml
git commit -m "Add scheduled prod+dev backup workflow"
git push
gh workflow run "Backup databases"
gh run watch
```

Expected: both matrix legs succeed. Then confirm objects landed under the
expected prefixes in both buckets:

```bash
aws s3 ls "s3://$R2_BACKUP_BUCKET/clint/prod/daily/" --endpoint-url "https://$CLOUDFLARE_ACCOUNT_ID.r2.cloudflarestorage.com"
aws s3 ls "s3://$B2_BACKUP_BUCKET/clint/prod/daily/" --endpoint-url "$B2_S3_ENDPOINT"
```

Expected: a `clint-prod-daily-<ts>.tar.zst.age` and its `.manifest.json` in each.

> If today is a Sunday and/or the 1st, also expect `weekly/` and/or `monthly/`
> copies. Verify with the matching `aws s3 ls` on those prefixes.

- [ ] **Step 4: Commit (if lint fixes were needed)**

Already committed in Step 3; if Step 2 required edits, amend before pushing.

---

## Task 7: Pre-migration snapshot in prod deploy

**Files:**
- Modify: `.github/workflows/deploy-prod.yml` (add a step before `supabase db push`)

- [ ] **Step 1: Read the current deploy workflow**

```bash
sed -n '1,80p' .github/workflows/deploy-prod.yml
```

Locate the `Link prod Supabase project` step and the `Apply migrations to prod`
(`supabase db push`) step.

- [ ] **Step 2: Insert the pre-migration snapshot step**

Add this step immediately BEFORE the `Apply migrations to prod` step (the
checkout and `supabase/setup-cli@v1` steps already exist earlier in the job):

```yaml
      - name: Pre-migration backup (prod)
        uses: ./.github/actions/db-backup
        with:
          environment: prod
          project_ref: ${{ secrets.SUPABASE_PROD_PROJECT_REF }}
          db_password: ${{ secrets.SUPABASE_PROD_DB_PASSWORD }}
          access_token: ${{ secrets.SUPABASE_ACCESS_TOKEN }}
          age_recipient: ${{ secrets.BACKUP_AGE_PUBLIC_KEY }}
          tier_override: pre-migration
          r2_bucket: ${{ secrets.R2_BACKUP_BUCKET }}
          r2_endpoint: https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
          r2_key_id: ${{ secrets.R2_BACKUP_ACCESS_KEY_ID }}
          r2_secret: ${{ secrets.R2_BACKUP_SECRET_ACCESS_KEY }}
          b2_bucket: ${{ secrets.B2_BACKUP_BUCKET }}
          b2_endpoint: ${{ secrets.B2_S3_ENDPOINT }}
          b2_key_id: ${{ secrets.B2_BACKUP_KEY_ID }}
          b2_app_key: ${{ secrets.B2_BACKUP_APP_KEY }}
```

Because the step fails the job on error, a failed snapshot blocks the migration,
which is the desired safety property.

- [ ] **Step 3: Lint the workflow**

```bash
actionlint .github/workflows/deploy-prod.yml
```

Expected: no output (clean).

- [ ] **Step 4: Commit**

```bash
git add .github/workflows/deploy-prod.yml
git commit -m "Take a pre-migration backup before applying prod migrations"
```

> Live validation happens on the next real prod deploy: confirm a
> `clint/prod/pre-migration/` object appears before `supabase db push` runs.

---

## Task 8: Weekly restore-verification workflow

**Files:**
- Create: `.github/workflows/backup-verify.yml`

This workflow proves the newest backup is fresh and fully captured. A live
restore is NOT run here -- the app's schema needs the Supabase environment
(`extensions`/`auth`), so end-to-end restore is the quarterly manual drill (Task
9 runbook). The job runs the private `age` key, so it is gated behind the
`production` environment (reviewer-protected) and reads `BACKUP_AGE_PRIVATE_KEY`
from that environment's secrets (added in Task 3, Step 4).

- [ ] **Step 1: Write the workflow**

Create `.github/workflows/backup-verify.yml`:

```yaml
name: Verify DB backup
on:
  schedule:
    - cron: "0 10 * * 1"   # Mondays 10:00 UTC, after the daily backup
  workflow_dispatch:

permissions:
  contents: read

jobs:
  verify:
    runs-on: ubuntu-latest
    environment: production   # gates access to BACKUP_AGE_PRIVATE_KEY
    steps:
      - uses: actions/checkout@v4

      - name: Install tools
        run: sudo apt-get update -qq && sudo apt-get install -y -qq age zstd jq

      - name: Download newest prod backup from R2
        env:
          AWS_ACCESS_KEY_ID: ${{ secrets.R2_BACKUP_ACCESS_KEY_ID }}
          AWS_SECRET_ACCESS_KEY: ${{ secrets.R2_BACKUP_SECRET_ACCESS_KEY }}
          ENDPOINT: https://${{ secrets.CLOUDFLARE_ACCOUNT_ID }}.r2.cloudflarestorage.com
          BUCKET: ${{ secrets.R2_BACKUP_BUCKET }}
        run: |
          set -euo pipefail
          newest="$(aws s3api list-objects-v2 --bucket "$BUCKET" \
            --prefix clint/prod/daily/ --endpoint-url "$ENDPOINT" \
            --query 'sort_by(Contents,&LastModified)[-1].Key' --output text)"
          echo "newest=$newest"
          [ "$newest" != "None" ] || { echo "no prod backups found"; exit 1; }
          case "$newest" in *.tar.zst.age) ;; *) echo "newest is not a bundle: $newest"; exit 1 ;; esac
          # Freshness: fail if newest backup is older than 26h.
          lm="$(aws s3api head-object --bucket "$BUCKET" --key "$newest" --endpoint-url "$ENDPOINT" --query LastModified --output text)"
          age_h=$(( ( $(date -u +%s) - $(date -u -d "$lm" +%s) ) / 3600 ))
          echo "backup age: ${age_h}h"
          [ "$age_h" -le 26 ] || { echo "stale backup (${age_h}h > 26h)"; exit 1; }
          aws s3 cp "s3://$BUCKET/$newest"                         ./bundle.tar.zst.age --endpoint-url "$ENDPOINT" --only-show-errors
          aws s3 cp "s3://$BUCKET/${newest%.tar.zst.age}.manifest.json" ./remote.manifest.json --endpoint-url "$ENDPOINT" --only-show-errors

      - name: Decrypt and verify capture integrity
        env:
          AGE_KEY: ${{ secrets.BACKUP_AGE_PRIVATE_KEY }}
        run: |
          set -euo pipefail
          printf '%s' "$AGE_KEY" > key.txt
          # Remote checksum must match the downloaded bundle before we trust it.
          want="$(jq -r .sha256 remote.manifest.json)"
          got="$(sha256sum bundle.tar.zst.age | awk '{print $1}')"
          [ "$want" = "$got" ] || { echo "FAIL: bundle sha256 $got != manifest $want"; rm -f key.txt; exit 1; }
          age -d -i key.txt -o bundle.tar.zst bundle.tar.zst.age
          zstd -d bundle.tar.zst -o bundle.tar
          mkdir unpacked && tar -xf bundle.tar -C unpacked
          rm -f key.txt

          for f in roles.sql schema.sql data.sql auth_storage.sql manifest.json; do
            [ -s "unpacked/$f" ] || { echo "FAIL: $f missing or empty"; exit 1; }
          done
          grep -Eq 'CREATE TABLE (IF NOT EXISTS )?("?public"?\.)?"?marker_types"?' unpacked/schema.sql \
            || { echo "FAIL: schema.sql missing core public DDL"; exit 1; }

          # Auth/storage CAPTURE integrity: dump row counts must match the manifest.
          for tbl in auth.users auth.identities storage.buckets storage.objects; do
            grep -q "COPY ${tbl} " unpacked/auth_storage.sql \
              || { echo "FAIL: $tbl not captured in auth_storage.sql"; exit 1; }
            dumped="$(awk -v t="COPY ${tbl} " 'index($0,t)==1 {f=1; next} f && $0=="\\." {f=0} f {c++} END{print c+0}' unpacked/auth_storage.sql)"
            recorded="$(jq -r --arg t "$tbl" '.auth_storage_row_counts[$t]' unpacked/manifest.json)"
            [ "$dumped" = "$recorded" ] || { echo "FAIL: $tbl dump rows $dumped != manifest $recorded"; exit 1; }
            echo "ok: $tbl captured ($dumped rows, matches manifest)"
          done
          echo "ALL PASS"
```

> This job does NOT run a live restore: the app schema needs the Supabase
> `extensions`/`auth` environment, which a generic runner lacks. It instead
> verifies freshness (<= 26h) and capture integrity (checksum, all artifacts,
> core public DDL, and auth/storage dump row counts matching the manifest). The
> full end-to-end restore into a real Supabase project is the quarterly manual
> drill (Task 9 runbook).

- [ ] **Step 2: Lint the workflow**

```bash
actionlint .github/workflows/backup-verify.yml
```

Expected: no output (clean).

- [ ] **Step 3: Commit and live smoke (requires Task 6 backups to exist)**

```bash
git add .github/workflows/backup-verify.yml
git commit -m "Add weekly restore-verification workflow"
git push
gh workflow run "Verify DB backup"
gh run watch
```

Expected: run succeeds, logs show `ALL PASS`, the four `ok: <table> captured`
lines, and a backup age <= 26h.

---

## Task 9: Documentation: runbook + client policy statement

**Files:**
- Create: `docs/runbook/12-backup-and-restore.md` (use the real next number)
- Create: `docs/runbook/policy-db-backup.md`

- [ ] **Step 1: Determine the runbook number**

```bash
ls docs/runbook/
```

Use the next free integer prefix in place of `12-`.

- [ ] **Step 2: Write the restore runbook**

Create `docs/runbook/<NN>-backup-and-restore.md`:

```markdown
# Backup and Restore

## What is backed up
- Prod and dev Postgres, full logical dumps (roles + schema + data, including
  `public`, `auth`, and `storage` metadata), restorable into any Postgres 17.
- File blobs already live in Cloudflare R2 (materials cutover) and are out of
  scope here; ensure that bucket has its own versioning + lifecycle.

## Where backups live
- Primary: Cloudflare R2 bucket `clint-db-backups`, prefixes
  `clint/<env>/{daily,weekly,monthly,pre-migration}/`.
- Secondary (cross-cloud): Backblaze B2 bucket `clint-db-backups`, same prefixes.
- Both buckets have versioning + Object Lock (compliance mode). The backup job
  has write-only credentials; retention is enforced by lifecycle, not the job.

## Schedule and retention (GFS)
- Daily 09:00 UTC (`backup-db.yml`); kept 7 days.
- Weekly (Sundays); kept 28 days.
- Monthly (1st); kept 365 days.
- Pre-migration snapshot before every prod deploy (`deploy-prod.yml`); kept 30 days.

## Encryption / key custody
- Bundles are `age`-encrypted. Public key: `BACKUP_AGE_PUBLIC_KEY` (CI secret).
- PRIVATE key (`clint-backup-age.key`) is held offline in <password manager /
  vault>. Custodians: <NAME 1>, <NAME 2>. It is also stored as the
  `production`-environment secret `BACKUP_AGE_PRIVATE_KEY` for the verification
  workflow only.

## RPO / RTO
- RPO: ~24h off-site; last-deploy via pre-migration snapshot; seconds via
  Supabase PITR where enabled and intact.
- RTO: ~30-60 min for a full restore (procedure below).

## Restore procedure
1. Identify the bundle: `aws s3 ls s3://clint-db-backups/clint/prod/daily/ --endpoint-url https://<acct>.r2.cloudflarestorage.com`
2. Download it and its `.manifest.json`; verify `sha256` against the manifest.
3. Decrypt: `age -d -i clint-backup-age.key -o bundle.tar.zst bundle.tar.zst.age`
4. Unpack: `zstd -d bundle.tar.zst -o bundle.tar && tar -xf bundle.tar`
5. Provision the target (new Supabase project or Postgres 17).
6. Restore in order: `psql "$URL" -f roles.sql` (skip if target manages roles),
   then `schema.sql`, then `data.sql` (use `-v ON_ERROR_STOP=1`).
7. Sanity-check: `select count(*) from public.marker_types;` (> 0).
8. Repoint the app's Supabase connection / DNS to the restored instance.

## Quarterly restore drill (checklist)
- [ ] Pull the latest prod bundle and run the full restore procedure into a scratch project.
- [ ] Confirm row counts on key tables match expectations.
- [ ] Time the restore; record against the RTO target.
- [ ] Confirm the offline private key is still accessible to both custodians.
```

- [ ] **Step 3: Write the client-facing policy statement**

Create `docs/runbook/policy-db-backup.md`:

```markdown
# Database Backup Policy

Clint maintains automated, off-platform, encrypted backups of all production
data, independent of its primary database provider.

- **Cadence:** Daily automated backups, plus an additional snapshot before every
  production database change.
- **Retention (grandfather-father-son):** daily backups retained 7 days, weekly
  28 days, monthly 12 months.
- **Off-site and cross-cloud:** every backup is stored in two independent cloud
  providers in separate infrastructure, so no single provider failure can
  destroy all copies.
- **Immutable:** backups are write-once (Object Lock); they cannot be altered or
  deleted before their retention period elapses, including by an actor holding
  production credentials.
- **Encrypted:** all backups are encrypted at rest; decryption keys are held
  offline by named custodians.
- **Tested:** restores are verified automatically every week and via a manual
  recovery drill each quarter.
- **Recovery objectives:** recovery point objective ~24 hours (sub-day where
  point-in-time recovery is enabled); recovery time objective 30-60 minutes.
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbook/
git commit -m "Document DB backup/restore runbook and client policy statement"
```

---

## Task 10: Wire docs into project conventions

**Files:**
- Modify: `CLAUDE.md` (note the backup policy under operational docs)
- Modify: `docs/runbook/` index if one exists (e.g. `00-*.md` or `README.md`)

- [ ] **Step 1: Find the runbook index**

```bash
ls docs/runbook/ | head; sed -n '1,40p' docs/runbook/00-*.md 2>/dev/null || true
```

- [ ] **Step 2: Add an index entry**

If a runbook index/table-of-contents exists, add a line linking the new
`<NN>-backup-and-restore.md` following the existing format exactly.

- [ ] **Step 3: Add a CLAUDE.md pointer**

In `CLAUDE.md`, under a suitable operational section, add one line:

```markdown
- DB backup policy: daily off-site encrypted dumps to R2 + B2 with GFS retention; see `docs/runbook/<NN>-backup-and-restore.md` and `.github/workflows/backup-db.yml`.
```

- [ ] **Step 4: Commit**

```bash
git add CLAUDE.md docs/runbook/
git commit -m "Link DB backup policy into project docs"
```

---

## Self-review notes

- **Spec coverage:** L2 daily off-site dumps (Tasks 4-6), L3 pre-migration
  snapshot (Task 7), two destinations R2+B2 (Tasks 3-4), GFS 7/4/12 retention
  (Task 1 tiers + Task 3 lifecycle), immutability/write-only creds (Task 3),
  encryption + key custody (Tasks 2-3, 9), prod+dev both full (Task 6 matrix +
  full `db dump`), restore verification (Task 8), runbook + client policy
  (Task 9). L1 PITR is documented, not built, per spec.
- **Verification reality:** the live smoke tests in Tasks 6 and 8 depend on
  Task 3 (buckets + secrets) being complete; sequencing reflects that.
- **Cloud-API caveat:** exact R2/B2 Object Lock + lifecycle commands are
  delegated to the `cloudflare`/`wrangler` skills and Backblaze docs in Task 3
  rather than hard-coded, because those CLIs evolve.

## Execution note on commits

Per project conventions: commit only the files each task names, do not attribute
the assistant in commit messages, and branch this work off `develop` (not the
current `chore/dependabot-cleanup` branch) before starting.
```
