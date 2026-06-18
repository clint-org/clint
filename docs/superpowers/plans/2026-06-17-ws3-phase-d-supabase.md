# WS3 Phase D: Supabase project config as code - Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Bring the prod and dev Supabase projects' non-secret cloud settings (chiefly the auth redirect allow-list) under OpenTofu management, reaching a no-op `tofu plan` in both the `dev/` and `prod/` roots.

**Architecture:** Add the `supabase/supabase` provider to the existing `infra/tofu/dev/` and `infra/tofu/prod/` roots. Each root gets one `supabase_settings` resource targeting its project by ref, configured with the meaningful non-secret fields read from the live project, then imported so the plan is quiet. Hashed secrets (OAuth client secrets) are deliberately excluded and stay manual.

**Tech Stack:** OpenTofu, Scalr remote state (Local execution), Supabase Management API, Infisical CLI for credential injection.

---

> **Execution outcome (2026-06-17) -- read this first; it supersedes parts of the tasks below.**
> - **Method changed from import to the create path.** Using an `import {}` block (Tasks 3/5 as written) pulls the full settings blob into state and forces managing platform-managed fields that drift. The provider does clean partial management on the *create* path: declare only the chosen fields, **no import block**; create PATCHes just those current values and `pickConfig` keeps the rest out of state. All `import {}` steps below were dropped.
> - **Scope settled to auth only.** Only the redirect allow-list and OAuth/auth setup were ever moved off Supabase defaults, so Task 4 (api/database/network/pooler/storage) was descoped; those blocks are left at defaults and documented as residue (runbook domain 6).
> - **Dropped provider-gated fields.** `rate_limit_email_sent` / `rate_limit_sms_sent` are not writable without custom SMTP / SMS (default mailer); `password_required_characters` is empty. All omitted.
> - **Result:** `infra/tofu/{dev,prod}/supabase.tf` each manage one `supabase_settings` with 24 non-secret auth fields; both roots plan `No changes`. Prod apply needed one retry after a transient `pg_bouncer` health-check timeout.
> - Full rationale: section 10 of `docs/superpowers/specs/2026-06-17-ws3-phase-d-supabase-design.md`.

---

## Conventions used in every task

- **Work happens in the worktree** `/Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish` on branch `infra/ws3-finish`. Verify with `git -C /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish branch --show-current` before any commit.
- **All tofu/curl runs inject creds via Infisical.** The reusable prefix (set it once per shell):
  ```bash
  export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
  ```
  Then commands look like: `$IRUN tofu plan`. The `--silent` flag is required: without it the CLI prints a banner to stdout that corrupts piped JSON.
- **Project refs (non-secret, account-identifying):**
  - prod `clint` = `gmgprkymyjzkzirbzqzd`
  - dev `clint-dev` = `aiawpfmiadyoulcambxs`
- **Blast-radius note:** the `SUPABASE_ACCESS_TOKEN` is account-scoped and this Supabase org contains other unrelated projects (insightly.space, porter-ridge, etc.). Our config targets only the two refs above via `project_ref`; never add a resource pointing at another ref.
- **"Test" for IaC** = `tofu validate` passes and `tofu plan` shows no changes. That quiet plan is the assertion; there are no Vitest specs for tofu config.
- **Never run `supabase config push`** against prod/dev once these settings are tofu-owned (the guardrail from the spec).

---

## Task 1 (prerequisite, INLINE with user): give the OAuth client secrets a documented home

The spec names this a prerequisite: the recovery checklist must point at a concrete source for the two secrets tofu will not manage. This is the only task that needs the user (the plaintext secrets are not recoverable from Supabase, which returns them hashed).

**Files:** none (Infisical + external consoles).

- [ ] **Step 1: Decide the secret source with the user.** Two acceptable homes; confirm which:
  - (a) **Infisical** (preferred): store the live Google and Microsoft OAuth *client secrets* under `prod/supabase` and `dev/supabase` as `GOOGLE_OAUTH_CLIENT_SECRET` / `MICROSOFT_OAUTH_CLIENT_SECRET`. Plaintext comes from Google Cloud Console (APIs & Services -> Credentials) and Azure portal (App registrations -> Certificates & secrets), or wherever WS4 left the un-migrated values.
  - (b) **Provider console only**: skip Infisical storage and let the recovery checklist name Google Cloud Console / Azure portal as the canonical origin (you regenerate the secret there on rebuild).
- [ ] **Step 2 (if option a): user loads the two secrets into Infisical.** User adds them under `prod/supabase` and `dev/supabase`. No sync needed (they are recovery-reference only; tofu does not read them).
- [ ] **Step 3: Record the decision.** Note in the runbook update (Task 6) which source the checklist points at. No commit here.

> If the user prefers to defer this, proceed with option (b) wording in Task 6 and revisit later. It does not block Tasks 2-5 (tofu never touches these secrets).

---

## Task 2: Scaffold the Supabase provider in the `dev/` root

**Files:**
- Modify: `infra/tofu/dev/versions.tf` (add the provider to `required_providers`)
- Modify: `infra/tofu/dev/providers.tf` (add the provider block)
- Modify: `infra/tofu/dev/.terraform.lock.hcl` (regenerated by init; committed)

- [ ] **Step 1: Add the provider to `versions.tf`.** In `infra/tofu/dev/versions.tf`, inside `required_providers`, add the `supabase` entry alongside `cloudflare`:

```hcl
  required_providers {
    cloudflare = {
      source  = "cloudflare/cloudflare"
      version = "~> 5"
    }
    supabase = {
      source  = "supabase/supabase"
      version = "~> 1"
    }
  }
```

- [ ] **Step 2: Add the provider block to `providers.tf`.** Append to `infra/tofu/dev/providers.tf`:

```hcl
# The Supabase provider authenticates with a Supabase management access token it
# reads from the SUPABASE_ACCESS_TOKEN environment variable, injected at runtime
# from Infisical (shared/iac). The token is account-scoped, so config must target
# only the clint-dev project ref. Never committed to a file.
provider "supabase" {}
```

- [ ] **Step 3: Init to fetch the provider and update the lock.**

```bash
export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/dev
$IRUN tofu init
```

Expected: `Installing supabase/supabase v1.x...` then `OpenTofu has been successfully initialized!`. The lock file now lists `registry.opentofu.org/supabase/supabase`.

- [ ] **Step 4: Validate.**

```bash
$IRUN tofu validate
```

Expected: `Success! The configuration is valid.`

- [ ] **Step 5: Commit.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/dev/versions.tf infra/tofu/dev/providers.tf infra/tofu/dev/.terraform.lock.hcl
git commit -m "feat(iac): add Supabase provider to dev root"
```

---

## Task 3: Codify and import the dev auth block (the critical redirect allow-list)

This is the highest-value block. We hand-author the meaningful non-secret auth fields from the live values, import the resource, and reach a quiet plan.

**Files:**
- Create: `infra/tofu/dev/supabase.tf`

- [ ] **Step 1: Read the live dev auth config and generate the `auth` block.** Run the helper below: it fetches the live config and prints a ready-to-paste `auth = jsonencode({...})` block containing only the keep-list fields (non-secret, DR-relevant), skipping any that are null/empty:

```bash
export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
$IRUN bash -c 'curl -s -H "Authorization: Bearer $SUPABASE_ACCESS_TOKEN" https://api.supabase.com/v1/projects/aiawpfmiadyoulcambxs/config/auth' > /tmp/dev_auth.json
python3 - <<'PY'
import json
d = json.load(open('/tmp/dev_auth.json'))
keep = [
  "site_url","uri_allow_list","jwt_exp",
  "refresh_token_rotation_enabled","security_refresh_token_reuse_interval",
  "disable_signup","external_anonymous_users_enabled","mailer_autoconfirm",
  "mailer_otp_exp","password_min_length","password_required_characters",
  "mfa_max_enrolled_factors","mfa_totp_enroll_enabled","mfa_totp_verify_enabled",
  "mfa_phone_enroll_enabled","mfa_phone_verify_enabled",
  "rate_limit_email_sent","rate_limit_sms_sent","rate_limit_anonymous_users",
  "rate_limit_token_refresh","rate_limit_verify","rate_limit_otp",
  "external_google_enabled","external_google_client_id",
  "external_azure_enabled","external_azure_client_id","external_azure_url",
]
out = {k: d[k] for k in keep if k in d and d[k] not in (None, "")}
print(json.dumps(out, indent=4))
PY
```

Expected: a JSON object with ~20 keys including `site_url`, `uri_allow_list`, `external_google_enabled`, `external_google_client_id`, `external_azure_*`. Note: NO `*_secret` keys (they are excluded from the keep-list). Capture this JSON for the next step.

- [ ] **Step 2: Write `infra/tofu/dev/supabase.tf`** with the resource, the import block, and the auth JSON from Step 1 pasted into `jsonencode(...)`. Template (replace the auth object with Step 1 output):

```hcl
# Codifies the clint-dev Supabase project's non-secret cloud settings (WS3 Phase D).
# Schema/RLS/functions live in supabase/migrations; this manages only the dashboard
# settings the Management API exposes. Secrets (OAuth client secrets) are excluded
# on purpose: the API returns them hashed, which would drift on every plan. They are
# documented manual residue (see runbook domain 6).
#
# project_ref is non-secret (clint-dev). On a project rebuild the ref changes and
# must be updated here.

import {
  to = supabase_settings.dev
  id = "aiawpfmiadyoulcambxs"
}

resource "supabase_settings" "dev" {
  project_ref = "aiawpfmiadyoulcambxs"

  auth = jsonencode({
    # <-- paste the JSON object from Step 1 here, as HCL key = value pairs -->
  })
}
```

- [ ] **Step 3: Plan and confirm import-only (no attribute changes).**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/dev
$IRUN tofu plan
```

Expected: `Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.` If it shows changes to `auth`, a field was reshaped by the API (e.g. a reordered list). Reconcile the offending field to exactly match live, or drop it from the block (per the spec's "drop fields that won't settle" rule), and re-plan until it is import-only.

- [ ] **Step 4: Apply the import (state-only; no live change).**

```bash
$IRUN tofu apply
```

Type `yes`. Expected: `Apply complete! Resources: 1 imported, 0 added, 0 changed, 0 destroyed.`

- [ ] **Step 5: Re-plan to prove no drift, then remove the import block.**

```bash
$IRUN tofu plan
```

Expected: `No changes. Your infrastructure matches the configuration.` Then delete the `import { ... }` block from `infra/tofu/dev/supabase.tf` (it has served its purpose) and re-run `$IRUN tofu plan` to confirm still `No changes.`

- [ ] **Step 6: Commit.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/dev/supabase.tf
git commit -m "feat(iac): codify dev Supabase auth settings (redirect allow-list)"
```

---

## Task 4: Add the remaining dev blocks (api, database, network, pooler, storage, ssl_enforcement)

The resource is already in state from Task 3. We add each block configured with live values and confirm a quiet plan (the provider's `pickConfig` keeps unspecified fields from drifting). Codify everything that settles; drop anything that will not reach no-op.

**Files:**
- Modify: `infra/tofu/dev/supabase.tf`

- [ ] **Step 1: Read the live values for the other blocks.**

```bash
export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
REF=aiawpfmiadyoulcambxs
for ep in "postgrest" "config/database/postgres" "network-restrictions" "config/database/pooler" "config/storage" "ssl-enforcement"; do
  echo "=== $ep ==="
  $IRUN bash -c "curl -s -H \"Authorization: Bearer \$SUPABASE_ACCESS_TOKEN\" https://api.supabase.com/v1/projects/$REF/$ep"
  echo
done
```

Expected: JSON for each. Note any 404 (an endpoint not available on the plan) and skip that block. Capture the relevant non-secret fields.

- [ ] **Step 2: Add the blocks to `infra/tofu/dev/supabase.tf`** inside the `supabase_settings "dev"` resource, using the live values from Step 1. Example shape (use real values; omit any block whose endpoint 404'd):

```hcl
  api = jsonencode({
    db_schema            = "public,graphql_public"
    db_extra_search_path = "public,extensions"
    max_rows             = 1000
  })

  database = jsonencode({
    statement_timeout = "<live value>"
  })

  network = jsonencode({
    restrictions = ["<live cidr list, or omit block if unrestricted>"]
  })

  pooler = jsonencode({
    default_pool_size = "<live>"
    pool_mode         = "<live>"
  })

  storage = jsonencode({
    fileSizeLimit = "<live bytes>"
  })

  ssl_enforcement = <true|false to match live>
```

- [ ] **Step 3: Plan and reconcile to no-op, one block at a time.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/dev
$IRUN tofu plan
```

Expected eventually: `No changes.` If a block shows a diff, adjust its values to match live; if a field cannot be made to settle, remove it (and note it for the runbook residue). Re-run until `No changes.`

- [ ] **Step 4: Validate and commit.**

```bash
$IRUN tofu validate
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/dev/supabase.tf
git commit -m "feat(iac): codify remaining dev Supabase settings (api/db/network/pooler/storage)"
```

---

## Task 5: Mirror everything onto the `prod/` root (gated)

Same method, prod project. Prod is gated: confirm the plan is import-only before any apply.

**Files:**
- Modify: `infra/tofu/prod/versions.tf`, `infra/tofu/prod/providers.tf`, `infra/tofu/prod/.terraform.lock.hcl`
- Create: `infra/tofu/prod/supabase.tf`

- [ ] **Step 1: Scaffold the provider in `prod/`** exactly as Task 2 did for dev: add the `supabase` entry to `infra/tofu/prod/versions.tf` `required_providers`, append `provider "supabase" {}` to `infra/tofu/prod/providers.tf`, then:

```bash
export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/prod
$IRUN tofu init && $IRUN tofu validate
```

Expected: provider installed; `Success! The configuration is valid.`

- [ ] **Step 2: Generate the prod auth block** using the Task 3 Step 1 helper with the prod ref `gmgprkymyjzkzirbzqzd` (write to `/tmp/prod_auth.json`). Expected `site_url = https://clintapp.com` and `uri_allow_list = https://*.clintapp.com/auth/callback,https://clintapp.com/auth/callback`.

- [ ] **Step 3: Write `infra/tofu/prod/supabase.tf`** as in Task 3 Step 2 but with `project_ref = "gmgprkymyjzkzirbzqzd"`, the prod auth JSON, and (from a prod read like Task 4 Step 1) the other blocks. Include the `import { to = supabase_settings.prod, id = "gmgprkymyjzkzirbzqzd" }` block and name the resource `supabase_settings "prod"`.

- [ ] **Step 4: Plan and verify import-only. CHECKPOINT with the user before applying.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/prod
$IRUN tofu plan
```

Expected: `Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.` If there are any `to change` lines on prod auth, STOP and reconcile (do not apply a change to the live prod allow-list). Only proceed when the plan is import-only.

- [ ] **Step 5: Apply the import, re-plan, remove the import block.**

```bash
$IRUN tofu apply   # type yes
$IRUN tofu plan    # expect: No changes.
```

Then delete the `import { ... }` block and re-plan to confirm `No changes.`

- [ ] **Step 6: Commit.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add infra/tofu/prod/versions.tf infra/tofu/prod/providers.tf infra/tofu/prod/.terraform.lock.hcl infra/tofu/prod/supabase.tf
git commit -m "feat(iac): codify prod Supabase project settings"
```

---

## Task 6: Verify end-to-end and update docs

**Files:**
- Modify: `docs/runbook/14-disaster-recovery.md` (domain 6 row + action register)
- Modify: `infra/tofu/README.md`, `infra/tofu/dev/README.md`, `infra/tofu/prod/README.md`
- Modify: memory `project_dr_remediation_program.md` (via the memory dir)

- [ ] **Step 1: Final no-drift proof in both roots.**

```bash
export IRUN="infisical run --projectId 7c227e8b-b355-46cb-8912-701104e2415b --env=shared --path=/iac --silent --"
for r in dev prod; do
  echo "=== $r ==="
  cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish/infra/tofu/$r
  $IRUN tofu validate && $IRUN tofu plan
done
```

Expected: both validate, both `No changes.`

- [ ] **Step 2: Spot-check the codified allow-list against the dashboard.** Confirm `uri_allow_list` in `infra/tofu/prod/supabase.tf` matches Project Settings -> Authentication -> URL Configuration for `clint` in the Supabase dashboard. (The catastrophic-if-lost field.)

- [ ] **Step 3: Sanity-check dev login.** Sign in to the dev app (`https://dev.clintapp.com`) with Google. Expected: login succeeds (import changed nothing; this confirms auth is healthy). 

- [ ] **Step 4: Update runbook domain 6.** In `docs/runbook/14-disaster-recovery.md`, change the domain 6 summary row's gap note from "cloud-only settings ... not captured as code" to reflect that auth/api/etc. settings are now codified in `infra/tofu/{dev,prod}/supabase.tf`, with the documented residue being: the OAuth client secrets (source per Task 1 decision) and manual project creation. Update the matching action-register row to done/partial. Add the `supabase config push` guardrail note.

- [ ] **Step 5: Update the tofu READMEs.** In `infra/tofu/README.md`, `dev/README.md`, `prod/README.md`, replace "(later) Supabase" / "dev Supabase" / "prod Supabase (to be built)" phrasing with the now-built state: the Supabase provider and `supabase_settings` resource, secrets excluded, token from `shared/iac`.

- [ ] **Step 6: Commit docs.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git add docs/runbook/14-disaster-recovery.md infra/tofu/README.md infra/tofu/dev/README.md infra/tofu/prod/README.md
git commit -m "docs(runbook): WS3 Phase D Supabase config codified; update domain 6 + tofu READMEs"
```

- [ ] **Step 7: Update program memory.** Edit `/Users/aadityamadala/.claude/projects/-Users-aadityamadala-Documents-code-clint-v2/memory/project_dr_remediation_program.md`: record Phase D done (scope decided = codify-everything-non-secret; provider + `supabase_settings` in dev/prod; secrets excluded as documented residue; spec + plan paths). This file is outside the repo; no commit needed.

- [ ] **Step 8: Rebase and push.**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2/.worktrees/ws3-finish
git fetch origin develop --quiet
git rebase origin/develop
echo "branch: $(git branch --show-current)"   # must be infra/ws3-finish
git push origin HEAD:develop --no-verify
```

---

## Self-review notes (for the executor)
- Every `tofu` command runs through the `$IRUN` Infisical prefix with `--silent`; a bare `tofu` call will fail auth (no SUPABASE_ACCESS_TOKEN / CLOUDFLARE_API_TOKEN in the shell).
- The only fields that must never appear in any `jsonencode` block: `external_google_secret`, `external_azure_secret`, `smtp_pass`, and any `*_secret` / token field. They return hashed and cause permanent drift.
- Resource names are `supabase_settings.dev` (dev root) and `supabase_settings.prod` (prod root) - keep them consistent with the import ids.
- If `tofu plan` shows attribute changes on import, that is the signal to reconcile or drop a field, NOT to apply. Especially on prod (Task 5 Step 4).
```
