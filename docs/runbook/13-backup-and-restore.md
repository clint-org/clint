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
  `production`-environment secret `BACKUP_AGE_PRIVATE_KEY` for the verification
  workflow only.

## Verification
- Weekly `backup-verify.yml`: freshness (newest daily <= 26h) + capture integrity
  (checksum matches manifest; all five artifacts present; core public DDL present;
  auth/storage dump row counts match the manifest). It does NOT run a live restore
  (a generic runner lacks the Supabase environment).
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
   - `psql "$URL" -f data.sql` (public data)
   - `psql "$URL" -f auth_storage.sql` (auth/storage data; the auth/storage
     schemas already exist on a Supabase target)
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
