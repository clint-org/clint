# DB Backup Policy -- Design

**Date:** 2026-06-07
**Status:** Approved (pending implementation plan)
**Owner:** Aaditya Madala

## Problem

Clint's production and dev data live entirely in Supabase Postgres. The only
backups today are whatever Supabase provides natively. We need an independent,
off-site, immutable backup policy that protects against four threats the user
explicitly called out:

1. **Losing Supabase entirely** -- account suspension, vendor outage, billing
   dispute, or a deliberate migration off Supabase. Requires a self-contained
   dump restorable into *any* Postgres 17, with no dependency on Supabase's own
   backup infrastructure.
2. **Data corruption / bad migration** -- a buggy deploy or RPC mangles data.
   Requires the ability to roll back to a known-good snapshot.
3. **Accidental deletion / ransomware** -- someone or something deletes rows or
   drops tables. Requires immutable, versioned off-site copies that an attacker
   holding DB (or CI) credentials cannot also wipe.
4. **Compliance / audit retention** -- pharma clients expect a demonstrable,
   off-platform backup schedule with a defined retention curve and a documented
   recovery procedure.

## Context

- **Stack:** Supabase Postgres 17, two projects -- prod (`clintapp.com`) and dev
  (`dev.clintapp.com`). Deploys run through GitHub Actions with the Supabase CLI
  installed and the following secrets already wired:
  `SUPABASE_{PROD,DEV}_PROJECT_REF`, `SUPABASE_{PROD,DEV}_DB_PASSWORD`,
  `SUPABASE_ACCESS_TOKEN`, `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN`.
- **File storage already off Supabase:** the `materials_r2_cutover` migration
  dropped the Supabase `materials` bucket and `storage.objects` rows. File bytes
  now live in Cloudflare R2; Postgres holds only the metadata pointers. Supabase
  Storage is therefore **not** a meaningful backup target -- this policy is
  effectively a Postgres-database policy.
- **No existing scheduled workflows.** GHA scheduled minutes are included at no
  extra cost.

## Decisions (from brainstorming)

| Question | Decision |
|---|---|
| Threat model | All four above |
| Destination | **Two destinations**: Cloudflare R2 (primary) + Backblaze B2 (secondary, cross-cloud) |
| Orchestration | Scheduled GitHub Actions workflow (reuses existing CLI + secrets, runs outside Supabase) |
| Cadence | **Daily** off-site dumps; sub-day RPO delegated to Supabase PITR |
| Retention | **GFS 7/4/12** (daily 7d, weekly 4w, monthly 12mo) + pre-migration snapshot (30d) |
| Scope | **Prod + dev, both full** (public + auth + storage metadata + roles/grants) |

Secondary destination confirmed as **B2** (cheapest, S3-compatible, supports
Object Lock). Swappable to AWS S3 later without changing the workflow shape --
both speak the S3 API.

## Layered recovery model

The four threats are served by three layers; only L2 and L3 are built here.

| Layer | Mechanism | Covers | RPO |
|---|---|---|---|
| **L1** | Supabase native PITR (if enabled) | Sub-day corruption/deletion, fast in-place rollback | seconds |
| **L2** | Off-site daily logical dumps -> R2 + B2 | Lose Supabase entirely; long-horizon retention; compliance | ~24h |
| **L3** | Pre-migration snapshot before each prod deploy | Bad migration | last deploy |

L1 is a Supabase setting, not something we build; the design documents its
state but does not require it. The off-site dumps capture roles/grants, the full
`public` schema (DDL + data), and the user-identity + file-pointer data from the
platform-managed schemas (`auth.users`, `auth.identities`, `storage.buckets`,
`storage.objects`).

**Restore target (revision 2026-06-07):** the `auth` and `storage` schemas are
provisioned and managed by the Supabase platform (GoTrue / Storage), not by our
migrations. Their *data* can therefore only be restored into a target that
already provides those schemas -- a **fresh Supabase project or a self-hosted
Supabase**, not a bare vanilla Postgres. The backup artifacts are kept clean
(no stubbed `auth.*` objects, no `CREATE OR REPLACE` that would clobber the
platform's real auth functions); restoring them onto a Supabase target is the
documented recovery path. The `public` schema alone does restore into any
Postgres 17, which is what the automated verification exercises (see below).

**Cost note:** at a deliberately pessimistic 500 MB/dump, GFS 7/4/12 across both
environments stores ~23 GB and costs well under USD 1/month combined across R2 +
B2. Realistic dump size (likely <100 MB) makes it pennies. Cost is not a design
constraint. The only real spend is Supabase PITR itself (a paid Supabase
add-on), which is an independent decision outside this policy.

## Components

### 1. `backup-db.yml` -- scheduled backup workflow

- **Triggers:** `schedule` (daily 09:00 UTC) + `workflow_dispatch` (manual).
- **Strategy:** matrix over `[prod, dev]`.
- **Per-environment steps:**
  1. Install Supabase CLI (`supabase/setup-cli@v1`).
  2. `supabase link --project-ref <env ref>`.
  3. Produce four artifacts: `roles.sql` (`supabase db dump --role-only`),
     `schema.sql` (`supabase db dump`, public DDL), `data.sql`
     (`supabase db dump --data-only -s public`), and `auth_storage.sql`
     (a targeted `pg_dump --data-only` of `auth.users`, `auth.identities`,
     `storage.buckets`, `storage.objects`). Artifacts are kept clean -- no
     stubbed `auth.*` schema and no `CREATE OR REPLACE` of platform functions.
  4. Bundle (`tar`) and compress (`zstd`).
  5. **Encrypt** the bundle with `age` using `BACKUP_AGE_PUBLIC_KEY`.
  6. Compute `sha256` and write a small JSON manifest (env, tier, timestamp,
     size, checksum, dump tool versions).
  7. Upload encrypted bundle + manifest to **R2** and **B2** via their
     S3-compatible APIs.
- **Object key layout:** `clint/<env>/<tier>/<UTC-timestamp>.tar.zst.age`
  (+ sibling `.manifest.json`).

### 2. GFS tiering by prefix

Each run always writes to `daily/`. On Sundays it additionally writes the same
artifact to `weekly/`; on the 1st of the month, additionally to `monthly/`.
Tiering is decided by the job from the run date -- no server-side copy logic
required.

### 3. Retention via bucket lifecycle, not the job

Retention is enforced by **bucket lifecycle rules**, never by the backup job
deleting objects:

| Prefix | Expire after |
|---|---|
| `daily/` | 7 days |
| `weekly/` | 28 days |
| `monthly/` | 365 days |
| `pre-migration/` | 30 days |

The backup job's credentials are **write-only** (`PutObject`, no `Delete`,
no lock-bypass). A compromised CI token therefore cannot erase history -- it can
only add to it. This is the core ransomware/accidental-deletion guarantee on the
write path.

### 4. Immutability

Both buckets are created with **Object Lock (compliance mode) + versioning**,
with lock retention matching each tier's lifecycle window. Even an actor with
full bucket-admin credentials cannot delete or overwrite an object before its
retention expires. Lifecycle rules then reclaim space once the lock lapses.

### 5. On-deploy (pre-migration) snapshot

`deploy-prod.yml` invokes the backup as a **reusable workflow** step *before*
`supabase db push`, writing prod to the `pre-migration/` prefix. A bad migration
always has an immediate, immutable pre-change snapshot. The deploy proceeds only
after the snapshot upload succeeds.

### 6. `backup-verify.yml` -- restore verification

Untested backups are not backups. A **weekly** workflow:

1. Pulls the newest prod backup from R2.
2. Decrypts it (private `age` key supplied via a guarded secret -- see Key
   custody) and decompresses.
3. Spins up a `postgres:17` service container and restores `schema.sql` +
   `data.sql` (the `public` schema, which is platform-independent) into it.
4. Asserts sanity: schema applies clean; key application tables have row counts
   > 0; and `auth_storage.sql` is present and contains the four expected
   identity/storage tables (capture integrity).
5. **Freshness check:** fails/alerts if the newest backup object is older than
   26 hours (catches a silently broken nightly job).

**Verification split (revision 2026-06-07):** because the `postgres:17` service
container does not carry Supabase's platform-managed `auth`/`storage` schemas,
the automated weekly job restores and asserts on the `public` schema and
verifies that the auth/storage *data* was captured (the dump contains the four
tables with the row counts recorded in the manifest). A **full** restore that
loads `auth_storage.sql` into a live target is exercised by the **quarterly
manual restore drill** against a real fresh Supabase project (runbook). The
local `roundtrip.test.sh` mirrors the automated check: full `public`
restore + auth/storage capture-integrity (live source row counts equal the rows
present in `auth_storage.sql`).

### 7. Failure alerting

Any failed run in `backup-db.yml`, the on-deploy snapshot, or
`backup-verify.yml` raises a notification. Start with GitHub's built-in
failed-run email; an optional Slack/webhook step can be layered on.

## Encryption and key custody

Dumps contain `auth.users` PII (pharma users), so bundles are encrypted at rest
with **`age`** (in addition to provider-side encryption):

- **Public key** -> `BACKUP_AGE_PUBLIC_KEY` GHA secret. Used to encrypt. Safe to
  hold in CI.
- **Private key** -> held **offline** (password manager / break-glass), never
  stored in normal CI context. Named key custodians documented in the runbook.
- The restore-verification workflow needs the private key. It is supplied via a
  secret scoped to a protected environment (reviewer-gated), not the default
  build context, so routine CI runs never see it.

## Secrets

**Already present:** `SUPABASE_{PROD,DEV}_PROJECT_REF`,
`SUPABASE_{PROD,DEV}_DB_PASSWORD`, `SUPABASE_ACCESS_TOKEN`,
`CLOUDFLARE_ACCOUNT_ID`.

**New, required:**

- `R2_BACKUP_BUCKET`, `R2_BACKUP_ACCESS_KEY_ID`, `R2_BACKUP_SECRET_ACCESS_KEY`
  (write-only token scoped to the backup bucket).
- `B2_BACKUP_BUCKET`, `B2_S3_ENDPOINT`, `B2_BACKUP_KEY_ID`, `B2_BACKUP_APP_KEY`
  (write-only application key).
- `BACKUP_AGE_PUBLIC_KEY` (encryption).
- `BACKUP_AGE_PRIVATE_KEY` (decryption, restricted to the verification workflow's
  protected environment only).

## Documentation deliverables

1. **Restore runbook** in `docs/runbook/`:
   - Exact decrypt + restore steps into a fresh Supabase project or self-hosted
     Postgres 17.
   - RTO target: ~30-60 minutes for a full restore.
   - Key custody (who holds the offline `age` private key).
   - Quarterly manual restore-drill checklist.
2. **Policy statement** (client-facing compliance artifact): cadence, retention
   curve (GFS 7/4/12), off-site + cross-cloud + immutable guarantees, RPO/RTO.

## RPO / RTO targets

- **RPO:** ~24h via off-site dailies for the "lose Supabase entirely" case;
  bounded to the last prod deploy via the pre-migration snapshot; seconds via
  Supabase PITR where it is intact and enabled.
- **RTO:** ~30-60 min to restore a full logical dump into a new project,
  validated weekly by the automated restore test and quarterly by a manual
  drill.

## Out of scope (flagged, not built here)

- **R2 materials blobs.** File bytes already live in R2; this policy backs up
  only the Postgres metadata that points at them. Ensure the materials bucket
  has versioning + lifecycle so a DB restore does not leave dangling pointers.
  Adjacent DR item, tracked separately.
- **Enabling/paying for Supabase PITR.** A separate Supabase decision. The
  design functions with or without it; documenting its state is part of the
  runbook.

## Open questions

None. Secondary destination resolved to B2; all scope, cadence, and retention
decisions confirmed during brainstorming.
