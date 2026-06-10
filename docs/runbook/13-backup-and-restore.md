# Backup and Restore

## What is backed up
Per backup (per environment) the bundle holds four SQL artifacts:
- `roles.sql` - database roles and grants.
- `schema.sql` - the full `public` schema DDL.
- `data.sql` - all `public` schema data.
- `auth_storage.sql` - data for the platform-managed identity and file-pointer
  tables: `auth.users`, `auth.identities`, `storage.buckets`, `storage.objects`.

Plus a `manifest.json` (env, tier, timestamp, sha256 of the encrypted bundle,
and the captured auth/storage row counts).

Not in scope: the materials file blobs already live in Cloudflare R2 (materials
cutover); this policy backs up only the Postgres pointers to them. Give that
bucket its own Bucket Lock + lifecycle separately.

## Restore target (important)
Restores target a **Supabase project (new or self-hosted)**, not a bare vanilla
Postgres. The `auth`, `storage`, and `extensions` schemas (and extensions such as
`pg_net` and `pg_trgm`) are provisioned by the Supabase platform; the `public`
schema DDL depends on them. The backup artifacts are intentionally clean (no
stubbed auth schema), so they restore onto a target that already provides that
environment.

## Where backups live
- Primary: Cloudflare R2 bucket `clint-db-backups`, prefixes
  `clint/<env>/{daily,weekly,monthly,pre-migration}/`.
- Secondary (cross-cloud): Backblaze B2 bucket `clint-db-backups`, same prefixes.
- Immutability: R2 uses Cloudflare **Bucket Lock** (R2 has no S3 versioning);
  B2 uses Object Lock + versioning. The backup job holds write-only credentials
  (no delete). Retention is enforced by lifecycle rules, not the job. On R2 the
  lock window is <= the shortest tier (7 days) so lifecycle can still reclaim
  space (Bucket Lock takes precedence over lifecycle).

## Schedule and retention (GFS)
- Daily 09:00 UTC (`backup-db.yml`); kept 7 days.
- Weekly (Sundays); kept 28 days.
- Monthly (1st); kept 365 days.
- Pre-migration snapshot before every prod deploy (`deploy-prod.yml`); kept 30 days.

## Encryption / key custody
- Bundles are `age`-encrypted. Public key: `BACKUP_AGE_PUBLIC_KEY` (CI secret).
- PRIVATE key (`clint-backup-age.key`) is held offline in <password manager /
  vault>. Custodians: <NAME 1>, <NAME 2>. It is also stored as the
  `backup-verify`-environment secret `BACKUP_AGE_PRIVATE_KEY` (no reviewers, so
  the weekly verify runs unattended) for the verification workflow only.

## Verification
- Weekly `backup-verify.yml`: for BOTH object stores (R2 and B2, in separate
  steps), pulls the newest bundle and checks freshness (newest daily <= 26h) +
  capture integrity (checksum matches manifest; all five artifacts present; core
  public DDL present; auth/storage dump row counts match the manifest). The shared
  per-store logic lives in `scripts/backup/verify-remote.sh`. It does NOT run a
  live restore (a generic runner lacks the Supabase environment).
- Quarterly manual drill (below): the true end-to-end restore into a real
  Supabase project.

## RPO / RTO
- RPO: ~24h off-site; last-deploy via pre-migration snapshot; seconds via
  Supabase PITR where enabled and intact.
- RTO: ~30-60 min for a full restore (procedure below).

## Restore procedure
1. Identify the bundle: `aws s3 ls s3://clint-db-backups/clint/prod/daily/ --endpoint-url https://<acct>.r2.cloudflarestorage.com`
2. Download it and its `.manifest.json`; verify `sha256` against the manifest.
3. Decrypt: `age -d -i clint-backup-age.key -o bundle.tar.zst bundle.tar.zst.age`
4. Unpack: `zstd -d bundle.tar.zst -o bundle.tar && tar -xf bundle.tar`
5. Provision the target: a fresh Supabase project (or self-hosted Supabase). Note
   its session-mode connection string as `$URL`.
6. Restore in order with `-v ON_ERROR_STOP=1`:
   - `psql "$URL" -f roles.sql` (skip or expect benign "role exists" notices if
     the target manages its own roles)
   - `psql "$URL" -f schema.sql` (public schema DDL)
   - Restore the data with FK checks deferred. `data.sql` and `auth_storage.sql`
     are `--data-only` (COPY) dumps and some tables have circular foreign keys
     (e.g. `indications`), so the load order can violate constraints. Wrap them in
     `session_replication_role = replica` (Supabase's `postgres` role may set it;
     otherwise use pg_dump's `--disable-triggers` or temporarily drop the
     constraints):
     ```
     psql "$URL" -v ON_ERROR_STOP=1 <<'SQL'
     set session_replication_role = replica;
     \i data.sql
     \i auth_storage.sql
     set session_replication_role = default;
     SQL
     ```
7. Sanity-check: `select count(*) from public.marker_types;` (> 0) and
   `select count(*) from auth.users;` (matches the manifest's recorded count).
8. Repoint the app's Supabase connection / DNS to the restored instance.

## Quarterly restore drill (checklist)
- [ ] Pull the latest prod bundle and run the full restore procedure into a fresh
      throwaway Supabase project (including `auth_storage.sql`).
- [ ] Confirm `public` row counts on key tables and `auth.users` count match the
      manifest.
- [ ] Time the restore; record against the RTO target.
- [ ] Confirm the offline private key is still accessible to both custodians.
- [ ] Tear down the throwaway project.

## Drill log

### 2026-06-10 - full restore from the B2 copy (PASS)
- **Source:** newest prod daily bundle in **Backblaze B2** (secondary cloud),
  `clint/prod/daily/clint-prod-daily-20260610T122205Z.tar.zst.age` (1.26 MB
  encrypted; ~6h old at drill time). Downloaded via the B2 S3 endpoint with the
  backup key id / app key.
- **Integrity:** `sha256` matched the sibling manifest; `age`-decrypted and
  unpacked all five artifacts cleanly.
- **Target:** an **isolated local Supabase stack** (separate `supabase start`
  instance on a +100 port range), not a cloud project - the free-tier project
  quota was exhausted. This validates the restore mechanics, ordering, and
  capture completeness against a real Supabase environment (auth/storage/
  extensions schemas present); it does not exercise cloud-platform specifics
  (PITR, platform role provisioning). Substitute a fresh cloud project when a
  slot is available.
- **Procedure:** `roles.sql` -> `schema.sql` -> (`data.sql` + `auth_storage.sql`
  wrapped in `session_replication_role = replica`), each with `ON_ERROR_STOP=1`.
  All phases exited 0 on a pristine target.
- **Sanity:** `public.marker_types` = 13 (> 0); `auth.users` = 14, matching the
  manifest. `auth.identities` = 14, `storage.buckets` = 1, `storage.objects` = 1
  all matched the manifest. 51 public tables, 4808 live rows restored (markers
  708, trials 144, materials 304, ...).
- **Timing:** download + verify + decrypt + unpack and the full restore each
  completed in seconds (well under the 30-60 min RTO target; the prod dataset is
  small).
- **Findings:**
  - `roles.sql` uses `CREATE ROLE "audit_writer"` without `IF NOT EXISTS`, so it
    is not idempotent: clean on a truly fresh target, but errors `role
    "audit_writer" already exists` on a re-run against the same target. Expected
    per the restore procedure's "benign role exists" note; only matters if you
    re-restore into a non-pristine target.
  - A fresh `supabase start` provisions `pg_net`/`pgcrypto`/`uuid-ossp` but not
    `pg_trgm`; `schema.sql` self-creates all required extensions with `CREATE
    EXTENSION IF NOT EXISTS ... WITH SCHEMA "extensions"`, so no manual
    pre-provisioning was needed.
