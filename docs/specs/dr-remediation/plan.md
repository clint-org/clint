# Disaster Recovery Remediation Plan

Program to close the gaps in `docs/runbook/14-disaster-recovery.md`. This is the
execution plan behind that runbook's action register. Each task maps back to a
failure domain and an action-register row. As tasks land, update the runbook
register (close the row, log any drill) in the same change set.

## Decisions (locked)
- **Secrets management: Infisical, self-hostable.** Closes the escrow gap, gives
  rotation + auto-sync into the four secret stores. The offline age key stays
  air-gapped and is never imported. Infisical becomes a new DR failure domain with
  its own break-glass export.
- **IaC: OpenTofu** with the Cloudflare and Supabase providers. Codifies the
  currently-manual Cloudflare and Supabase configuration. State lives in an
  encrypted remote backend.
- **Delivery: Phase 0 starts immediately** (tool-independent), the rest is
  sequenced behind the two tool stand-ups.

## Guardrails
- Age key is never placed in Infisical, IaC state, or any always-on system.
- IaC state can contain secrets: use an encrypted remote backend, least-privilege
  state access, and never commit plaintext state.
- Every phase updates `docs/runbook/14-disaster-recovery.md` (close the matching
  action-register row, add any drill log) in the same PR. No drift.
- Pair each behavioral change with its test in the same change (Vitest for Worker
  code; `tofu validate`/`plan` for IaC).

## Open sub-decisions (needed before the phase that uses them)
- Infisical hosting: self-host (Fly/Railway/VM) vs Infisical Cloud. Needed at
  Phase 2 start. UNKNOWN - needs owner confirmation.
- Alert channel beyond a GitHub issue (Slack/email/PagerDuty). Phase 0 ships a
  dependency-free GitHub-issue baseline; richer channel is an upgrade. UNKNOWN.
- Whether to split the backup R2 token or DNS into a second Cloudflare account to
  break the concentration risk (Phase 3). UNKNOWN.

---

## Phase 0 - stop the bleeding (tool-independent, start now)
No dependency on Infisical or OpenTofu. Highest value per unit effort.

### 0.1 Materials R2 durability (domain 2, action P1)
- Enable object **versioning** on `clint-materials` and a **Bucket Lock**
  retention rule (mirror the DB backup immutability posture). If Object Lock
  requires a new bucket, do a one-time `rclone` copy into a locked bucket and
  repoint `R2_BUCKET` / `MATERIALS_BUCKET`. (Codified in Phase 1 OpenTofu; set
  now via dashboard/API so the protection exists immediately.)
- Stand up a scheduled **R2 to B2 materials mirror** as a GitHub Actions workflow
  (`.github/workflows/backup-materials.yml`), modeled on `backup-db.yml`: `rclone`
  or `aws s3 sync` from `clint-materials` to a B2 `clint-materials` bucket, daily.
  Needs a new read-only R2 token scoped to the materials bucket and reuses the B2
  credentials. Verify object count/size after sync.
- Acceptance: versioning on; a daily B2 copy exists; a deleted object is
  recoverable from a version or the B2 copy. Update runbook domain 2 RPO/RTO from
  "unrecoverable" to the real numbers and log a materials-restore drill.
- Owner split: bucket settings and the new R2 token are ops/owner actions; the
  workflow and verify script are in-repo (mine).

### 0.2 Failure and uptime alerting (domain 10, action P1)
- Add a notify-on-failure step to `backup-db.yml` and `backup-verify.yml` that
  opens a GitHub issue via `actions/github-script` (uses `GITHUB_TOKEN`, no new
  secret). Baseline alerting with zero new dependency.
- Add a scheduled synthetic check workflow (`.github/workflows/uptime-check.yml`):
  curl `clintapp.com` and one representative tenant host, assert 200 + expected
  brand, and check TLS expiry via `openssl s_client` (warn under 21 days). Open an
  issue on failure.
- Acceptance: a forced backup failure opens an issue; an expiring cert opens an
  issue. Update runbook domain 10.
- Upgrade path (later): swap the GitHub-issue sink for Slack/email/PagerDuty once a
  channel is chosen.

### 0.3 r2_pending_deletes drain guardrail (domain 2, action P3 pulled forward)
- In `worker/r2-drain/queue.ts`, cap deletes per run (configurable max) and, if the
  pending count exceeds the cap, process up to the cap and emit an alert signal
  rather than draining the whole queue. Prevents a faulty or malicious enqueue from
  emptying the live bucket in a single 07:00 fire and buys detection time.
- Pair with a Vitest unit test asserting the cap holds and the overage alerts.
- Acceptance: test proves a 10k-item queue drains at most the cap and signals.
  Update runbook domain 2 (remove the unguarded-drain note).

---

## Phase 1 - IaC foundation with OpenTofu (domains 4, 6, 7)
Closes the "manual, no IaC" top-gaps. Import existing resources, do not recreate.

### 1.1 Bootstrap
- `infra/tofu/` with the Cloudflare and Supabase providers pinned. Encrypted
  remote state backend (R2 via the S3 backend, or TF Cloud). Document the apply
  path and least-privilege tokens.

### 1.2 Codify Cloudflare (domains 4, 7)
- Workers (both envs) and routes, R2 buckets including the versioning/lock settings
  from 0.1, rate limiters, the `clintapp.com` DNS zone and records, and tenant
  custom domains / custom hostnames. Import current state; `tofu plan` must show no
  drift after import.
- Tenant custom domains are data-driven (rows in `tenants`/`agencies`). Generate
  the Cloudflare custom-hostname resources from that list so a zone rebuild is one
  `tofu apply`, not a manual walk (closes domain 4's rebuild gap).

### 1.3 Codify Supabase (domain 6)
- Use the Supabase provider for project settings and auth config where supported
  (providers enabled, redirect allow-list). Document the parts the provider cannot
  manage (edge function secrets, the invite DB webhook) as runbook-tracked manual
  steps with exact values' locations.
- Acceptance: a fresh project can be brought to current config via `tofu apply`
  plus the documented manual residue. Update runbook domain 6 recovery procedure to
  reference the IaC.

---

## Phase 2 - Infisical secrets platform (domain 3, + new domain 13)
### 2.1 Stand up + import
- Deploy Infisical (hosting per the open sub-decision). Create the project,
  environments (prod/dev), and a machine identity for CI. Import the full inventory
  from runbook domain 3's table. The age key is excluded by policy.

### 2.2 Wire syncs (build on Secret Syncs, not the deprecating native integrations)
- Cloudflare Workers Secret Sync to push Worker runtime secrets.
- GitHub sync (or the Infisical Actions step) for the GHA secrets.
- Supabase: manage project secrets via sync where supported, else document.
- Acceptance: rotating a secret in Infisical propagates to the target store; CI
  reads from Infisical via the machine identity.

### 2.3 Rotation
- Automatic rotation + dynamic secrets for DB credentials first (the highest-value,
  fully-automatable case). Third-party API keys (Anthropic, Brandfetch, Resend)
  are manual-rotate-at-provider then auto-sync; document the cadence.

### 2.4 Make Infisical itself recoverable
- Break-glass export of all secrets to the offline vault on a schedule. Add a new
  failure domain (13, Secrets platform) to the runbook: what fails, blast radius,
  and the break-glass restore. Without this, Infisical is a new single point of
  failure for every secret.

---

## Phase 3 - resilience and ops hardening
### 3.1 Cloudflare account hardening (domain 7, action P2)
- Hardware-key MFA on the account, a break-glass second admin, confirmed
  account-recovery contacts. Evaluate moving the backup R2 token and/or DNS into a
  separate account to break the single-account blast radius (the top concentration
  risk).

### 3.2 Monitoring depth (domain 10)
- Error monitoring in the Worker and the Angular app (Sentry or Workers Logpush +
  alerts). A scheduled reconciliation of `public.materials` rows against R2 objects
  (and against the B2 mirror) to catch silent divergence.

### 3.3 People and process (domain 11, action P3)
- Name incident roles and a contact tree, pick an out-of-band status channel that
  does not depend on Cloudflare/Supabase, and place an offline copy of runbook 13
  and 14 in the vault with the age key.

### 3.4 Drills (domains 1, 2, 6)
- DNS-repoint drill (closes the one open DB item), materials-restore drill (now
  possible after 0.1), and a project re-provision dry run (domain 6). Log each in
  the relevant runbook drill log.

---

## Traceability (action register row to phase)
| Runbook action | Domain | Phase |
|----------------|--------|-------|
| Materials no backup/versioning/lock | 2 | 0.1 |
| No backup/uptime/cert alerting | 10 | 0.2 |
| r2_pending_deletes drain guardrail | 2 | 0.3 |
| Cloudflare account concentration | 7 | 3.1 |
| Secrets escrow partial | 3 | 2.1 to 2.4 |
| Supabase config dashboard-only | 6 | 1.3 |
| DNS/custom domains manual, no IaC | 4 | 1.2 |
| Single age key, custody | 3 | 2.4 + 3.3 |
| Incident roles / comms | 11 | 3.3 |
| DNS-repoint drill / roles.sql idempotency | 1 | 3.4 |

## New work this plan adds to the runbook
- A new failure domain 13 (Secrets platform / Infisical) once Phase 2 lands.
- IaC referenced in the recovery procedures for domains 4, 6, 7.
- A materials-mirror line in domain 2 and `13-backup-and-restore.md` scope note
  (materials are now backed up, the long-standing "not in scope" caveat changes).
