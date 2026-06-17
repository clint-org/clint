# Disaster Recovery Plan

## Purpose and scope
This runbook enumerates every way Clint can lose data or go down, and the
procedure to recover from each. It is the index and decision layer across all
failure domains: database, object storage, secrets, DNS, identity, the Supabase
project, the Cloudflare account, CI/CD, vendors, monitoring, people, and security
incidents. It deliberately does **not** restate the Postgres backup and restore
mechanics: those live in `13-backup-and-restore.md`, which owns the bundle format,
the GFS schedule, the encryption keys, the restore keystrokes, and the
DB-specific drill log. This file links out to it for domain 1 and otherwise covers
the domains that document does not. Where a fact could not be confirmed from the
codebase or config it is tagged `UNKNOWN - needs owner confirmation` rather than
guessed.

## Severity levels
| Level | Definition | Example | Response time |
|-------|-----------|---------|---------------|
| SEV1  | Full outage or unrecoverable data loss. All tenants blocked, or data lost beyond its RPO. | Supabase prod project deleted; materials bucket purged (currently unrecoverable, see domain 2); Cloudflare account suspended (app + DNS + materials + primary DB backups in one blast radius). | Acknowledge < 15 min; incident lead engaged immediately; customer/status comms within 1h. |
| SEV2  | Major feature down or scoped to one tenant. Product still usable for most. | A bad migration wrote wrong values to prod (recoverable via restore); one tenant custom domain TLS broken; login via one OAuth provider down; CT.gov ingest failing for days; AI extraction down. | Acknowledge < 2h; same-day mitigation. |
| SEV3  | Degraded, a workaround exists. | Brandfetch down (manual logo entry); CT.gov snapshot stale for a day; invite email delayed; slow queries. | Next business day. |

## Roles and key custody
- Incident lead: UNKNOWN - needs owner confirmation: who owns an active incident.
- age private key custodians: <NAME 1>, <NAME 2> (same custodians as `13-backup-and-restore.md`).
- Cloudflare account owner: UNKNOWN - needs owner confirmation. Note: a single Cloudflare account holds prod and dev Workers, both materials buckets, the primary DB backup bucket, and the `clintapp.com` zone/registrar (confirmed concentration risk, see below).
- Supabase org owner: UNKNOWN - needs owner confirmation.
- Registrar / DNS owner: UNKNOWN - needs owner confirmation. Per the account topology above, DNS and the registrar sit inside the same Cloudflare account.
- Where this runbook lives during an outage: it is in the repo at `docs/runbook/`, served from GitHub. A GitHub or Cloudflare outage makes it unreachable through the normal path. Keep an exported copy (this file plus `13-backup-and-restore.md`) in the same offline vault that holds the age key and the secrets inventory, so the recovery steps and the keys to execute them live together. UNKNOWN - needs owner confirmation: that an offline copy exists and where.

## Failure-domain register (summary)
One row per detailed section below. RPO/RTO are stated per domain; "target" is the
goal, "actual" is what evidence supports today.

| # | Domain | What fails | Blast radius | Detection | RPO / RTO | Current mitigation | Top gap |
|---|--------|-----------|--------------|-----------|-----------|--------------------|---------|
| 1 | Database (Postgres) | data loss or corruption | all prod data | weekly `backup-verify` (no failure alert); no live uptime check | ~24h / ~1h (cloud drill 2026-06-10: ~29s) | off-site R2 + B2, pre-migration snapshot, restore proven into a cloud project. See `13-backup-and-restore.md` | DNS repoint to a restored project still untested; verify failures are silent |
| 2 | Materials / object storage (R2) | bucket delete, object corruption, account loss, bad `r2_pending_deletes` drain | every tenant's uploaded files | none | unrecoverable today / unrecoverable today | none. DB backup stores only the pointers | single copy: no versioning, no Object Lock, no off-cloud copy |
| 3 | Secrets and encryption keys | key lost or leaked; Infisical unavailable | varies by secret; age key loss blocks all DB restores | weekly break-glass export (opens an issue on failure) | n/a / minutes (edit in Infisical) | Infisical Cloud is the source of truth, syncing to GHA + Workers + tofu; weekly age-encrypted break-glass export to R2 + B2 | automated rotation still manual (own spec); a few provider secrets (OAuth, Resend) not yet migrated |
| 4 | DNS and domains | registrar lapse, zone change, custom-domain or TLS misconfig | one tenant (custom domain) up to all tenants (apex zone) | none (no cert-expiry or uptime alert) | n/a / minutes to days | Cloudflare-managed certs; brand resolution by host | DNS sits in the same single Cloudflare account; zone/records + prod platform domains/route now in IaC, per-tenant custom domains still manual |
| 5 | Identity and auth | OAuth client deleted/expired, redirect drift, Auth config loss | nobody can log in (provider-scoped or total) | user reports / login failures | n/a / ~1h | Google + Microsoft providers; live redirect allow-list codified in `infra/tofu/{dev,prod}/supabase.tf` | provider client secrets stay console-only by design (API returns them hashed) |
| 6 | Supabase project (config, not data) | project deleted; dashboard config lost | all auth, RLS, storage, pooler, edge function config | none | n/a / hours | schema/RLS/extensions in migrations; live auth (redirect allow-list + OAuth setup) codified in `infra/tofu/{dev,prod}/supabase.tf` | residue: OAuth client secrets (regenerate from Google/Azure console), edge secrets, invite webhook; pooler/storage left at Supabase defaults |
| 7 | Cloudflare account and Workers | bad deploy, wrangler config loss, account compromise/suspension | bad deploy: all tenants briefly. Account loss: app + DNS + materials + primary DB backups | none (no uptime check) | n/a / minutes (deploy) to days (account) | GHA deploy with prod approval gate; rollback via redeploy | account is the largest single blast radius; B2 is the only DB backup outside it |
| 8 | CI/CD and source (GitHub) | repo/account loss, GHA secrets loss | cannot deploy via the normal path | push failures, workflow errors | n/a / minutes to hours | local `wrangler deploy` + `supabase db push` work without GitHub | deploy secrets live in GHA; partial offline copy only |
| 9 | Third-party vendors and billing | vendor outage, account termination, billing lapse, free-tier auto-pause | degrade (most) to hard-down (Supabase, Cloudflare) | in-app `/api/ai/health` for Anthropic only | varies | feature gates; non-blocking design for Brandfetch/Resend/CT.gov | Supabase free-tier auto-pause and project quota are live failure modes |
| 10| Detection and monitoring | a failure goes unnoticed | every domain above | backup/verify failures + 6-hourly uptime/cert check open GitHub issues (Phase 0.2); in-app AI health poll | n/a | issue-based alerting on backup, edge reachability, cert expiry | no app-level error monitoring (Sentry); no materials/pointer reconciliation; issue sink is baseline |
| 11| People and process | bus factor, no reachable runbook, no comms plan | recovery stalls regardless of tooling | n/a | n/a | runbook in repo | single-operator risk; no confirmed contact tree or status page |
| 12| Security incident | credential leak, RLS bypass / exfiltration, ransomware | data breach or destructive action | none active | n/a / hours | write-only backup creds; Object Lock on backups; Tier-1 audit log | no intrusion detection; materials bucket has no immutable copy to restore from |

## Concentration risks
Two dependencies turn an otherwise recoverable incident into an unrecoverable one.

1. **The single Cloudflare account.** Confirmed: prod and dev Workers, both
   materials buckets (`clint-materials`, `clint-materials-dev`), the primary DB
   backup bucket (`clint-db-backups`), the rate limiters, and the `clintapp.com`
   zone and registrar all live in one Cloudflare account. A compromise, suspension,
   or billing lockout of that one account simultaneously takes down the app, makes
   every uploaded file inaccessible, removes DNS for every tenant, and removes the
   primary copy of the database backups. The only things outside it are the
   Backblaze B2 copy of the DB backups, the Supabase project (the data itself),
   and the GitHub repo (the code). So a total Cloudflare loss is survivable for the
   *database* (restore from B2 into a new Supabase project, repoint DNS once a new
   zone exists) but is currently **unsurvivable for materials**, which have no copy
   anywhere else.

2. **The single age private key.** No key, no DB restore, for any scenario.
   `13-backup-and-restore.md` already names this as its single point of failure.
   It spans every database-recovery path in this document. Escrow is currently
   partial (a password manager) with only the key itself confirmed offline.

Other dependencies to assess: the single Supabase project per environment (no read
replica, no warm standby), and the single GitHub repository (sole home of
migrations and deploy workflows).

```mermaid
flowchart TD
  subgraph CF[Cloudflare account - one login, one blast radius]
    W[Workers: clint + clint-dev]
    M[(R2: clint-materials<br/>+ dev - SINGLE COPY)]
    RB[(R2: clint-db-backups<br/>primary)]
    DNS[clintapp.com zone + registrar + TLS]
  end
  subgraph OUT[Outside the Cloudflare account]
    B2[(B2: clint-db-backups<br/>cross-cloud copy)]
    SB[(Supabase project<br/>Postgres + Auth + config)]
    GH[GitHub repo<br/>migrations + deploy workflows]
    AGE{{age private key<br/>offline; decrypts backups + break-glass}}
    INF{{Infisical Cloud<br/>secrets source of truth}}
  end
  W --> M
  W --> SB
  DNS --> W
  RB -. mirror .-> B2
  GH -- deploy --> W
  GH -- db push --> SB
  INF -- syncs secrets --> W
  INF -- syncs secrets --> GH
  INF -. weekly break-glass<br/>age-encrypted .-> RB
  AGE -- decrypts --> RB
  AGE -- decrypts --> B2
  M -. NO BACKUP .-> X[lost if CF account<br/>or bucket is lost]
```

## Recovery procedures by domain

### 1. Database (Postgres)
Owns: `docs/runbook/13-backup-and-restore.md`. That file holds the bundle format,
GFS schedule, encryption, the full restore procedure, the scenario decision tree
(A bad migration, B whole-project loss, C scoped row recovery, D ransomware), and
the DB drill log. Summary only here: three restore sources freshest-first are
Supabase PITR (not enabled on free tier), the pre-migration snapshot (taken before
every prod deploy), and the daily off-site bundle in R2 or B2. RPO ~24h, RTO ~1h
(drill restored the full prod dataset in seconds).

### 2. Materials / object storage (R2 user files)
- What can fail: the `clint-materials` bucket is deleted; objects are corrupted or
  overwritten; the Cloudflare account is lost (domain 7); or a faulty or malicious
  enqueue into `r2_pending_deletes` causes the daily 07:00 UTC drain
  (`worker/r2-drain/queue.ts`) to delete live objects. Files are keyed
  `{space_id}/{material_id}/{file_name}`; the DB row in `public.materials`
  (`file_path`, `file_name`, `finalized_at`) is only the pointer.
- Blast radius: every tenant and space that has uploaded materials. Loss is total
  and customer-visible (briefings, decks, PDFs). The DB still lists the files, so
  the app shows download links that 404, which is worse than an honest empty state.
- Detection: none today. There is no integrity check, no object-count reconciliation
  against `public.materials`, and no alert on the drain deleting more than expected.
- Current mitigation: **none.** Confirmed: the bucket has no versioning, no Object
  Lock, and no cross-cloud copy. The DB backup explicitly stores only the pointers
  (`13-backup-and-restore.md`, "What the DB backup does NOT cover"). This is the
  single largest data-loss gap in the system.
- RPO / RTO: target RPO 24h / RTO 4h once protection exists. Actual today:
  **unrecoverable.** A delete or account loss is permanent.
- Recovery procedure (today, honest):
  1. There is no restore source for the blobs. If only the DB was lost, restore it
     (domain 1); the pointers return but the files they point to are intact only if
     the bucket itself survived.
  2. If the bucket or its objects were lost, recovery is not possible. Identify the
     affected `space_id`s from `public.materials`, mark those materials as missing
     in-app, and notify the affected tenants. Treat as SEV1.
- Recovery procedure (target state, after the action-register items land):
  1. Enable R2 versioning and Object Lock on `clint-materials`, plus a scheduled
     cross-cloud copy to B2 (mirror the DB backup posture).
  2. On accidental delete or overwrite within the lock window, restore the prior
     object version.
  3. On bucket or account loss, rehydrate from the B2 copy into a fresh bucket and
     repoint `R2_BUCKET` / `MATERIALS_BUCKET`.
- Known gaps: no backup, no versioning, no Object Lock, no off-cloud copy, no
  drain guardrail, no pointer/object reconciliation. See action register P1 and P3.

### 3. Secrets and encryption keys
As of WS4, **Infisical Cloud is the canonical source of truth** for every live
secret (project `clint`; environments `dev` / `prod` / `shared`; folders by domain:
`/cloudflare`, `/supabase`, `/backups`, `/ai`, `/iac`, `/ci`). Infisical **syncs/
pushes** each secret out to the system that consumes it -- GitHub Actions secrets
(GitHub App) and Cloudflare Worker secrets (`clint`, `clint-dev`) -- and the laptop
injects tofu's provider creds with `infisical run --env=shared --path=/iac`. CI and
the Workers read their native secret stores unchanged; Infisical keeps them in sync.
Adding or rotating a secret is one edit in one place.

Inventory by Infisical location -> consumer:

| Secret(s) | Infisical (env/folder) | Synced to | Recover / rotate by |
|-----------|------------------------|-----------|---------------------|
| `CLOUDFLARE_API_TOKEN` (deploy), `CLOUDFLARE_ACCOUNT_ID` | shared/cloudflare | GHA | reissue "Edit Cloudflare Workers" token |
| `CLOUDFLARE_API_TOKEN` (tofu), `TF_VAR_cloudflare_account_id`, `B2_APPLICATION_KEY*` | shared/iac | laptop via `infisical run` | reissue scoped DNS/zone/Workers + B2 mgmt keys |
| `R2_BACKUP_*`, `B2_BACKUP_*`, `BACKUP_AGE_PUBLIC_KEY` | shared/backups | GHA | reissue tokens in R2 / B2; public key re-derives |
| `SUPABASE_DEV_*` | dev/supabase | GHA | rotate in Supabase dashboard |
| `SUPABASE_PROD_*`, `SUPABASE_ACCESS_TOKEN` | shared/supabase | GHA | rotate in Supabase dashboard |
| Worker runtime set (`ANTHROPIC_API_KEY`, `BRANDFETCH_API_KEY`, `EXTRACT_SOURCE_WORKER_SECRET`, `CTGOV_WORKER_SECRET`, `R2_WORKER_SECRET`, `R2_ACCESS_KEY_ID/_SECRET_ACCESS_KEY/_ACCOUNT_ID`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`) | dev/ai, prod/ai | Cloudflare Workers | reissue provider key; the three `*_WORKER_SECRET`s validate against `vault.secrets` rows -- rotate Worker + DB row together |
| age **private** key (`clint-backup-age.key`) | **NOT in Infisical** (deliberate) -- offline vault + `backup-verify` GHA secret | n/a | restore from custodian copy; cannot reissue |
| `GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `RESEND_API_KEY`, `EMAIL_WEBHOOK_SECRET` | not yet migrated (Supabase project secrets) | n/a | reissue in provider console |

- **Break-glass export.** A weekly GitHub Actions workflow (`secrets-break-glass.yml`)
  authenticates to a read-only Infisical machine identity (`github-break-glass`) via
  GitHub OIDC -- no stored bootstrap secret -- exports every secret across all envs
  and folders, age-encrypts the bundle to `BACKUP_AGE_PUBLIC_KEY`, and writes it to
  R2 + B2 under `clint/secrets/` (same Object Lock immutability as DB backups). Only
  the offline age private key decrypts it. This covers the residual "Infisical Cloud
  is lost/unavailable" risk.
- **Two deliberate boundaries.** (1) The age **private** key never enters Infisical;
  its only homes are the offline custodian vault and the `backup-verify` GHA secret,
  so the key that decrypts the break-glass copy is not stored inside the system it
  protects. (2) **Automated rotation is out of scope** for WS4 (its own follow-on
  spec); rotation today is the manual per-secret procedure below.
- Recovery procedure (lost age key): if both custodians and the `backup-verify`
  env copy are gone, every existing backup bundle (DB and secrets) is permanently
  undecryptable. Generate a new keypair, re-encrypt going forward, treat prior
  bundles as lost. The quarterly drill re-confirms custodian access.
- Recovery procedure (leaked credential): edit the secret in Infisical; the sync
  propagates it to GitHub / the Worker, or `infisical run` picks it up for tofu. For
  the three `*_WORKER_SECRET`s, also update the matching `vault.secrets` row. If the
  leak is broad (repo or CI compromise), rotate every secret plus the age keypair,
  per scenario D in `13-backup-and-restore.md`.
- Recovery procedure (Infisical account lost): restore the latest `clint/secrets/`
  break-glass bundle from R2 or B2, decrypt with the offline age key, then re-populate
  a fresh Infisical project (or set the consumer secrets directly from the bundle).

### 4. DNS and domains
- What can fail: registrar lapse (domain expiry), an accidental zone or record
  change, a tenant subdomain or custom-domain misconfiguration, or a TLS cert
  failure. Brand resolution is host-based: `get_brand_by_host(p_host)` matches the
  request host against `tenants.custom_domain`, `agencies.custom_domain`,
  `admin.<apex>`, `tenants.subdomain`, `agencies.subdomain`, then `default`. So a
  DNS break does not just drop traffic, it can silently fall a tenant back to the
  default brand or break logins on a custom domain (a separate auth trust boundary).
- Source of truth for which domains exist: the database. `tenants.custom_domain`
  and `agencies.custom_domain` (unique, validated), with a 30-day reuse holdback in
  `public.retired_hostnames`. The matching Cloudflare side (Custom Domain on the
  Worker, custom hostname, TLS cert) is configured manually in the dashboard, with
  no IaC. The two must agree: a row in the DB with no Cloudflare custom domain does
  not resolve, and vice versa.
- Blast radius: a single custom domain (one tenant) up to the whole `clintapp.com`
  zone (all tenants and the apex marketing site).
- Detection: none. No cert-expiry alert, no synthetic check that each tenant host
  resolves and serves the right brand.
- Recovery procedure:
  1. Registrar lapse: renew immediately; the registrar is in the same Cloudflare
     account, so account access is a prerequisite (domain 7).
  2. Bad zone/record change: revert the record in the Cloudflare dashboard; certs
     are Cloudflare-managed and reissue automatically.
  3. Tenant custom-domain break: confirm the DB row exists
     (`select custom_domain from tenants where id = ...`), confirm the Cloudflare
     Custom Domain and cert are present and active, and that the customer's CNAME
     still points at the Worker. Re-add the Cloudflare custom domain if missing
     (see `12-deployment.md`).
  4. Full zone rebuild after account loss: the `clintapp.com` zone and its records
     are codified in OpenTofu (`infra/tofu/shared/dns.tf`, Scalr `clint-shared`). The
     prod Worker's platform custom domains (`clintapp.com`, `www.clintapp.com`) and
     the `*.clintapp.com` tenant-wildcard route are codified in
     `infra/tofu/prod/workers.tf` (Scalr `clint-prod`), and the dev routes
     (`dev.clintapp.com/*`, `*.dev.clintapp.com/*`) plus the `clint-materials-dev`
     bucket in `infra/tofu/dev/` (Scalr `clint-dev`). Point the provider at the new
     account (update
     `TF_VAR_cloudflare_account_id` and mint a token), then `tofu apply` in each root
     recreates the zone, records, and routing. Then walk every per-tenant
     `custom_domain` in `tenants` and `agencies` and re-add each as a Cloudflare
     Custom Domain (the per-tenant custom-domain side is not yet codified).
- Known gap: the apex zone, its records, the prod platform custom domains, and the
  tenant-wildcard route are now captured as code; the per-tenant custom-domain /
  custom-hostname side is still manual, so that part of a rebuild is a walk of the DB
  domain list. No cert-expiry monitoring.

### 5. Identity and auth (Google + Microsoft OAuth via Supabase Auth)
- What can fail: an OAuth client is deleted or its secret expires (Google or Azure),
  redirect URLs drift from the configured allow-list, or Supabase Auth config is
  lost with the project. Providers configured in `supabase/config.toml`:
  `[auth.external.google]` and `[auth.external.azure]` enabled; Apple stubbed but
  off. Cross-subdomain sessions use a cookie scoped to `Domain=.clintapp.com`;
  custom domains require a fresh sign-in (separate trust boundary).
- Blast radius: provider-scoped (one provider down, the other still works) up to
  total (Auth config lost, nobody can log in). Existing sessions survive a provider
  outage until they expire.
- Detection: user reports and login-failure spikes. No active check.
- Recovery procedure:
  1. Provider client lost/expired: recreate the OAuth client in the Google Cloud
     or Azure AD console, set the redirect URL to the Supabase callback, and update
     `GOOGLE_OAUTH_*` / `MICROSOFT_OAUTH_*` in the Supabase project secrets.
  2. Redirect drift: align the provider console redirect URLs and the Supabase Auth
     redirect allow-list. The allow-list is codified in
     `infra/tofu/{dev,prod}/supabase.tf`; `tofu apply` restores it and `tofu plan`
     detects drift from it.
  3. Auth config lost with the project: see domain 6; the live auth settings are in
     tofu, the client secrets are not (regenerate from the provider console).
- Known gap: the live redirect allow-list and OAuth setup are now codified in
  `infra/tofu/{dev,prod}/supabase.tf` (WS3 Phase D); the provider client secrets
  remain dashboard-only by design (the Management API returns them hashed, so they
  cannot be managed as code), recoverable from the Google Cloud / Azure AD console.

### 6. Supabase project (configuration, not data)
The DB restore (domain 1) recovers DATA. This domain recovers the PROJECT around
it: Auth providers and redirect URLs, Storage config, RLS, extensions, the pooler,
the edge function and its secrets, and OAuth setup.
- Captured as code: the `public` schema, all RLS policies, all RPCs, and the
  required extensions are in `supabase/migrations/`. The intended Auth shape and the
  edge runtime config are in `supabase/config.toml` (which configures the local
  stack). The live cloud auth settings -- the redirect allow-list, the Google and
  Microsoft enabled flags and client ids, and the auth policy (JWT/refresh expiry,
  MFA, password length, IP rate limits) -- are codified in
  `infra/tofu/{dev,prod}/supabase.tf` (WS3 Phase D, create-path partial management).
  The one edge function, `send-invite-email`, is in `supabase/functions/`.
- Not captured as code (dashboard only): the live OAuth client secrets (excluded by
  design -- the Management API returns them hashed; regenerate from the Google Cloud
  / Azure AD console), the edge function secrets (`RESEND_API_KEY`,
  `EMAIL_WEBHOOK_SECRET`, `EMAIL_FROM`, `EMAIL_BASE_URL`), and the DB webhook that
  triggers the invite email. The pooler, storage, network, and API settings are left
  at Supabase defaults (nothing was changed from them, so there is nothing to restore).
- Recovery procedure (re-provision from scratch):
  1. Create a fresh Supabase project. Record its session-mode pooler URL.
  2. `supabase db push` (or restore a bundle per domain 1) to rebuild the schema,
     RLS, RPCs, and extensions.
  3. Restore the data (domain 1) including `auth_storage.sql`.
  4. Restore Auth settings with IaC: set the new project ref in
     `infra/tofu/{dev,prod}/supabase.tf`, then `tofu apply` (via
     `infisical run --env=shared --path=/iac -- tofu apply`) to re-apply the redirect
     allow-list, the Google/Microsoft enabled flags and client ids, and the auth
     policy. Then paste the reissued OAuth client secrets from the Google Cloud /
     Azure AD console (tofu does not manage secrets; domain 5).
  5. Deploy the edge function and set its secrets.
  6. Recreate the DB webhook that fires `send-invite-email` on insert into the
     invites table (shared secret `EMAIL_WEBHOOK_SECRET`).
  7. Update `SUPABASE_*` GHA secrets and the app's environment config to the new
     project ref, pooler URL, and keys; repoint DNS (domain 4).
- Known gap: the auth settings (step 4) are now codified in tofu; the residue is the
  OAuth client secrets (step 4, intentional -- console-sourced), the edge function
  secrets (step 5), and the invite DB webhook (step 6). Guardrail: tofu owns the
  remote auth settings -- never run `supabase config push` against dev/prod, or it
  would fight tofu for the same fields (`config.toml` configures the local stack
  only). UNKNOWN - needs owner confirmation: whether the DB webhook definition is
  recorded anywhere outside the live project.

### 7. Cloudflare account and Workers
- What can fail: a bad Worker deploy; loss of `wrangler.jsonc`; or
  compromise/suspension/billing-lockout of the whole account.
- Blast radius: a bad deploy briefly affects all tenants (one prod Worker serves
  every host). Account loss is the worst case in this document: app, DNS,
  materials, and the primary DB backup bucket all go at once (see Concentration
  risks). Only the B2 DB copy, the Supabase project, and the GitHub repo survive.
- Detection: none. No uptime check on `clintapp.com` or a tenant host.
- Recovery procedure (bad deploy): redeploy the prior known-good build. Prod
  deploys run through `deploy-prod.yml` behind the `production` environment approval
  gate; roll back by deploying the previous commit, or run `wrangler deploy` locally
  from a clean checkout. `wrangler.jsonc` is the source of truth for routes,
  bindings, R2 buckets, rate limiters, and the cron, so it rebuilds the Worker shape
  exactly.
- Recovery procedure (account loss): this is a multi-day rebuild. Stand up a new
  Cloudflare account, mint a token and update `TF_VAR_cloudflare_account_id`, then
  `tofu apply` the `infra/tofu/` roots to recreate the `clintapp.com` zone + records,
  both materials buckets and both backup buckets (R2 `clint-db-backups` + the B2
  cross-cloud copy with its compliance Object Lock), and the prod Worker custom
  domains + tenant-wildcard route (shared / prod / dev roots). Re-add every per-tenant custom
  domain (domain 4, still manual), re-deploy both Workers via wrangler, re-add Worker
  runtime secrets via `wrangler secret put`, and restore the DB from B2. The buckets
  recreate empty: materials contents are not recoverable in this path under the
  current single-copy posture. Engage Cloudflare support for account recovery in
  parallel.
- Known gap: the account is the largest single blast radius; account-recovery
  contacts, MFA/hardware-key enrollment, and a break-glass second-admin are
  UNKNOWN - needs owner confirmation.

### 8. CI/CD and source (GitHub)
- What can fail: the repo or GitHub account is lost; GHA secrets are lost; or
  deploys cannot run.
- Can we deploy without GitHub: yes. Deploys are `wrangler deploy` plus
  `supabase db push`, both runnable from a local clean checkout given the secrets.
  GitHub is the convenient path (and the only one with the prod approval gate and
  the automatic pre-migration snapshot), not a hard dependency for emergency deploys.
- Where deploy secrets live: GitHub Actions secrets (Supabase refs/passwords/pooler
  URLs, Cloudflare token/account, backup R2/B2 creds, age public key). These are
  partially mirrored in the password manager (domain 3), so a GitHub loss does not
  by itself lose the secrets, but the inventory is incomplete.
- Recovery procedure: clone from any local checkout or fork to a new remote, restore
  GHA secrets from the password-manager inventory, and re-point the deploy workflows.
  For an urgent fix during a GitHub outage, deploy locally with the env/secrets in
  hand, then reconcile back through GitHub once it returns. Note that a local deploy
  skips the prod approval gate and the automatic pre-migration snapshot, so take a
  manual snapshot first (`13-backup-and-restore.md`).
- Known gap: the secrets inventory is partial; without GitHub the prod safety rails
  (approval gate, pre-migration snapshot) are bypassed.

### 9. Third-party vendors and billing
Behavior per vendor when it degrades or goes hard-down, and the billing failure mode.

| Vendor | Used for | Outage behavior | Billing / termination mode |
|--------|----------|-----------------|----------------------------|
| Supabase | DB, Auth, Storage config, edge fn | hard-down: app unusable | free-tier project auto-pause after inactivity; project quota exhausted (blocks the cloud restore drill); plan lapse risks the project |
| Cloudflare | Workers, R2, DNS, TLS | hard-down: app + materials + DNS unreachable | account suspension is the SEV1 concentration case (domain 7) |
| Anthropic | AI source extraction | degrade: extraction errors, rest of app fine; `/api/ai/health` polls `status.claude.com` (60s cache) | key disabled stops AI only; feature-gated by `ai_extraction_enabled` |
| Backblaze B2 | cross-cloud DB backup copy | degrade: primary R2 copy still works | account lapse loses the off-Cloudflare backup copy, collapsing two stores into one |
| ClinicalTrials.gov | daily trial ingest | degrade: daily 07:00 cron no-ops, snapshots in `trial_ctgov_snapshots` go stale; app serves last-known | public API, no account; no fallback beyond stale data |
| Brandfetch | logo/brand lookup during provisioning | degrade: lookup returns 502, user enters logo/colors manually | non-blocking |
| Resend | invite emails (edge fn) | degrade: invite email fails, invite code still generated in-app | non-blocking; deliver code out-of-band |
| Google / Azure AD | OAuth login | degrade: one provider down, the other still works | client deletion = provider-scoped login outage (domain 5) |

- Known gap: Supabase free-tier auto-pause and tight project quota are live
  failure modes, not hypotheticals (the 2026-06-10 cloud restore drill had to pause
  the dev project to free a slot for the throwaway target). UNKNOWN - needs owner
  confirmation: whether prod Supabase is on a paid plan; if it stays free-tier, RPO
  is floored at ~24h (no PITR) and the project can auto-pause.

### 10. Detection and monitoring
How would we know each domain failed? Today, mostly we would not. This is the
highest-leverage cross-cutting gap.
- Exists: the weekly `backup-verify.yml` checks both R2 and B2 bundles (freshness,
  checksum, artifact presence, row-count match); the in-app `/api/ai/health`
  endpoint polls Anthropic status. As of the DR remediation Phase 0.2: `backup-db`
  and `backup-verify` open a deduplicated GitHub issue on failure, and
  `uptime-check.yml` runs a 6-hourly synthetic reachability + TLS-expiry check on
  the apex hosts (`clintapp.com`, `dev.clintapp.com`) that also opens an issue on
  failure.
- Missing: error monitoring (no Sentry or equivalent) in the Worker or the Angular
  app; no reconciliation of `public.materials` rows against R2 objects; no alarm on
  an abnormally deep `r2_pending_deletes` queue (the circuit breaker in 0.3
  addresses the deletion side; queue-depth alerting is still open). The
  issue-based alert sink is a baseline; richer routing (Slack/PagerDuty) is a later
  upgrade. Tenant custom domains are not yet covered by the synthetic check.
- Consequence: backup and edge failures now surface as issues rather than silent
  Actions-tab failures. The remaining blind spots are app-level errors and silent
  materials/pointer divergence (action register, lowered priority).

### 11. People and process
- Bus factor: roles in this document are largely UNKNOWN - needs owner confirmation,
  which implies a single-operator risk. A DR plan only works if more than one person
  can execute it.
- Contact tree and escalation: UNKNOWN - needs owner confirmation. Define who is
  paged for SEV1, who is the backup, and how they are reached.
- Runbook reachability: covered under Roles and key custody. The plan must be
  readable when GitHub or Cloudflare is the thing that is down.
- Customer / status communication: UNKNOWN - needs owner confirmation. There is no
  status page or comms template. For a SEV1 (app down, or data loss), tenants need a
  channel that does not depend on the same infrastructure.

### 12. Security incident
- Credential leak: rotate per domain 3; if broad, rotate everything plus the age
  keypair.
- RLS bypass / data exfiltration: the Tier-1 audit log (`record_audit_event`,
  enforced by the audit-coverage smoke migration) records governance actions, so
  scope the blast radius from `audit_events`. Contain by revoking the leaked
  credential or disabling the affected RPC, then assess what was read or changed.
- Ransomware / destructive actor with DB access: this is why the backup job holds
  write-only credentials and the backup buckets use Object Lock / Bucket Lock, so an
  attacker cannot delete or overwrite existing DB backups (scenario D in
  `13-backup-and-restore.md`). Restore from the immutable copy into a clean project,
  then rotate all credentials and the age keypair.
- The materials gap also applies here: because `clint-materials` has no immutable
  copy, an attacker who reaches the bucket (or the account) can destroy every
  uploaded file with no restore source. Materials Object Lock (action register P1)
  closes the destructive-actor case for files, not just the accidental one.
- Known gap: no intrusion detection and no anomaly alerting on auth or data access.

## Drill log
Same pattern as `13-backup-and-restore.md`: date, scenario, result, timing,
findings. The DB restore drills live in that file. This log is for the **non-DB**
procedures (materials restore, DNS/zone rebuild, project re-provision, account-loss
walkthrough), which are not yet exercised. Schedule at least one tabletop or live
drill of a non-DB domain per quarter.

UNKNOWN - needs owner confirmation: no non-DB drill has been run yet. First
candidates, cheapest first: (1) a project re-provision dry run into a throwaway
Supabase project, timing steps 1 to 7 of domain 6; (2) a materials restore drill,
which is currently blocked because there is no backup to restore from (it becomes
possible once P1 lands).

## Action register (prioritized)
Likelihood x impact, with effort and free-tier constraints flagged.

| Priority | Gap | Domain | Likelihood x impact | Effort / cost | Free-tier constrained? | Owner | Status |
|----------|-----|--------|---------------------|---------------|------------------------|-------|--------|
| 1 | Materials bucket has no backup, versioning, or Object Lock; single copy in one account. Permanent customer data loss on delete or account loss. | 2 | medium x catastrophic | low for versioning + Object Lock; medium for B2 cross-cloud copy | no (R2 feature) | UNKNOWN | open |
| done | Backup/verify failure alerting + synthetic uptime/cert check. Landed in Phase 0.2 (`backup-db.yml`/`backup-verify.yml` notify-on-failure, `uptime-check.yml`). | 10 | high x high | low | no | UNKNOWN | done |
| 3 | No app-level error monitoring (Sentry/Logpush) and no `public.materials`-to-R2 reconciliation; issue-based alert sink is a baseline, no Slack/PagerDuty routing. | 10 | medium x medium | medium | no | UNKNOWN | open |
| 2 | Cloudflare account is one blast radius (app + materials + DNS + primary DB backups). | 7 | low x catastrophic | medium: enforce hardware-key MFA, add a break-glass second admin, confirm account-recovery contacts; consider moving backup R2 or DNS out of the account | no | UNKNOWN | open |
| done | Secrets escrow was partial and unaudited. WS4: Infisical Cloud is now the source of truth, syncing to GHA + Cloudflare Workers + tofu (`infisical run`), with a weekly read-only-OIDC break-glass export age-encrypted to R2 + B2. Re-provision after account loss is one restore + re-populate. | 3 | medium x high | done | no | UNKNOWN | done |
| 3 | Automated secret rotation is still manual (WS4 deferred it to a follow-on spec), and a few provider secrets (Google/Microsoft OAuth, Resend) are not yet migrated into Infisical. | 3 | low x medium | medium: write the rotation spec; migrate the remaining provider secrets | no | UNKNOWN | open |
| 2 | Supabase auth config (redirect allow-list + OAuth setup) is now codified in `infra/tofu/{dev,prod}/supabase.tf` (WS3 Phase D, create-path partial management). Residual dashboard-only: OAuth client secrets (intentional -- API returns them hashed; from Google/Azure console), edge function secrets, and the invite DB webhook definition. | 6 | low x medium | low: document the edge secrets + webhook; secrets stay console-sourced by design | no | UNKNOWN | partial |
| 3 | Cloud-target restore is now proven (drill 2026-06-10, ~29s into a real cloud project); the one step still untested end-to-end is the DNS repoint to a restored project (the drill tore down the throwaway before repoint). | 1 | low x medium | low | no | UNKNOWN | open |
| 3 | `r2_pending_deletes` drain has no guardrail or alert; a bad enqueue deletes live materials with no backup to recover from. | 2 | low x high | low: add a per-run delete cap and an alert | no | UNKNOWN | open |
| 3 | Single age key, custodians unconfirmed. | 3 | low x catastrophic | low: confirm both custodians can retrieve it; consider a second recipient key | no | UNKNOWN | open |
| 3 | Per-tenant custom-domain / custom-hostname config is manual with no IaC; that part of a zone rebuild is a hand walk of the DB domain list. (WS3 Phase C: `clintapp.com` zone + records in `infra/tofu/shared/dns.tf`, the prod Worker platform custom domains + `*.clintapp.com` route + `clint-materials` in `infra/tofu/prod/`, and the dev routes + `clint-materials-dev` in `infra/tofu/dev/`; per-tenant custom domains still pending.) | 4 | low x medium | medium: script the rebuild from `tenants`/`agencies` rows | no | UNKNOWN | open |
| 3 | No defined incident roles, contact tree, or status-comms channel; likely single-operator. | 11 | medium x high | low: name roles, write a contact tree, pick an out-of-band status channel | no | UNKNOWN | open |
| 3 | `roles.sql` is not idempotent (`CREATE ROLE` without `IF NOT EXISTS`); benign on a fresh target, errors on re-run (carried from `13-backup-and-restore.md`). | 1 | low x low | low | no | UNKNOWN | open |
