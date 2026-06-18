# WS3 Phase E: IaC drift-check gate - Design

Status: approved (design). Date: 2026-06-17.
Part of the DR remediation program (`2026-06-10-dr-program-design.md`), workstream 3
(IaC foundation), the final WS3 phase. Builds on the WS3 design
(`2026-06-10-ws3-iac-foundation-design.md`) and Phase D
(`2026-06-17-ws3-phase-d-supabase-design.md`, whose section 6 handed the
config.toml policy comparison to Phase E).

Written to teach as well as specify (the user is new to IaC), so it includes a short
concepts primer.

## 1. Concepts primer (reference)
- **Drift:** when a live resource no longer matches its committed config, because
  someone changed it out of band (a dashboard edit, a console tweak). IaC's promise
  is only as good as our confidence that config still matches reality; drift silently
  erodes that. A drift check periodically asks "does reality still match the code?"
- **`tofu plan -detailed-exitcode`:** the gate primitive. Exit `0` = no changes (in
  sync), `2` = changes pending (drift), `1` = error. A scheduled job that fails on
  exit `2` turns drift into an alert.
- **Refresh:** `tofu plan` first refreshes state by reading each resource from its
  provider's API. This is read-only (no writes), so a scheduled plan is safe to run
  against live prod.
- **Credential-free vs credential-needing checks:** `tofu validate` / `fmt` and a
  pure file-comparison need no live credentials (they never call a provider), so they
  can run on every PR. `tofu plan` calls provider APIs and the Scalr state backend,
  so it needs credentials and runs on a schedule.
- **GitHub OIDC machine identity:** CI proves its identity to Infisical with a
  short-lived GitHub-signed token (no stored secret), then reads secrets. WS4 already
  created a read-only one (`github-break-glass`); Phase E reuses it.

## 2. Goal and scope
Goal: reality and the committed IaC stay in sync going forward. A scheduled check
fails (and alerts) when the live Cloudflare / B2 / Supabase resources drift from
`infra/tofu/`, and a credential-free PR gate catches malformed config and
local/cloud auth-policy divergence before merge. This satisfies the WS3
success criterion "a drift-check command exists" and closes out WS3.

Engine decision (resolved 2026-06-17): **DIY** -- a local script plus a scheduled
GitHub Actions job, reusing the existing Infisical break-glass OIDC identity and the
repo's GitHub-issue alerting pattern. Rejected for now: flipping Scalr workspaces to
Remote execution for native drift detection (it would duplicate the tofu creds into
Scalr beyond Infisical, requires learning the Remote model, and its scheduled drift
detection may be a paid/limited tier). The Scalr Remote flip -- which also unlocks
run history and a prod approval gate -- is a possible separately-specced future
upgrade, consistent with the WS3 design's "flip to Remote later" note.

### In scope
- A local + CI drift check over all three roots (shared, dev, prod).
- A credential-free PR gate (fmt, validate, config-parity).
- The config.toml-vs-tofu auth-policy comparison (Phase D spec section 6).
- Interim alerting via a labeled GitHub issue.

### Out of scope
- Scalr Remote execution / native drift detection / prod approval gates (future).
- Per-tenant custom domains in IaC; GitHub config as IaC.
- The real alerting channel (WS2 replaces the interim GitHub issue).
- Auto-remediation: the gate detects and alerts; it never auto-applies.

## 3. Components (split by whether they need credentials)
**Credential-free (run anywhere, including every PR):**
- `infra/tofu/scripts/config-parity-check.py` -- pure file parsing (Python, using
  `tomllib` for `config.toml`; a small regex for the `.tf` `auth` block). Compares
  the should-match auth policy fields across three sources and exits non-zero on any
  disagreement. See section 5.
- `tofu fmt -check` and `tofu validate` (after `tofu init -backend=false`, which
  installs providers without touching the Scalr backend) -- catch malformed/invalid
  config without credentials.

**Credential-needing (scheduled only):**
- `infra/tofu/scripts/drift-check.sh` -- runs `tofu plan -detailed-exitcode` in each
  of `shared`, `dev`, `prod` via `infisical run --env=shared --path=/iac`, and
  reports per-root: clean (0), drift (2), or error (1). Aggregates a non-zero exit if
  any root drifts. Usable locally on demand and called by the scheduled CI job.
  Locally it relies on the developer's `tofu login` token for Scalr; in CI it reads
  `TF_TOKEN_clintapp_scalr_io` (see section 4).

## 4. Scheduled drift workflow (`.github/workflows/iac-drift.yml`)
Modeled on `backup-db.yml` + `uptime-check.yml`.
- **Trigger:** `schedule` daily + `workflow_dispatch`. `permissions: id-token: write`
  (OIDC) and `issues: write` (notify job).
- **Credentials:** authenticate to Infisical via GitHub OIDC against the existing
  read-only `github-break-glass` machine identity (`INFISICAL_MACHINE_IDENTITY_ID` /
  `INFISICAL_PROJECT_ID` GitHub secrets), then `infisical run --env=shared
  --path=/iac -- ...`. The read-only identity can read `/iac`; no new identity or
  GitHub secret sync is needed.
- **One prerequisite secret:** the runner authenticates to the Scalr state backend
  via the env var `TF_TOKEN_clintapp_scalr_io` (OpenTofu reads `TF_TOKEN_<host>` for
  backend auth). A **Scalr API token is added to Infisical `shared/iac`** (minted in
  Scalr; the break-glass identity reads it; `drift-check.sh` exports it). Local runs
  fall back to the developer's `tofu login` token when the env var is absent.
- **Exit-code handling (per root):** `0` pass; `2` drift -> fail the run, include the
  redacted plan summary in the alert; `1` error -> retry that root once, and if it
  still errors, report a **check error** distinct from drift (so a transient provider
  blip -- e.g. the `pg_bouncer` timeout seen in Phase D -- does not masquerade as
  real drift).
- **Alerting:** a `notify-failure` job using the same `actions/github-script`
  open-or-comment pattern as `uptime-check.yml`, under the label `iac-drift`, with the
  issue body distinguishing "drift detected in <roots>" from "drift check errored."
  Interim channel; WS2 later routes it to real alerting.

## 5. Config-parity check (`config-parity-check.py`)
- **Compares three sources that should agree:** `supabase/config.toml` `[auth]`,
  `infra/tofu/dev/supabase.tf`, and `infra/tofu/prod/supabase.tf`. Fails if any
  should-match field disagrees across the three (catches local-vs-cloud and
  dev-vs-prod policy drift at once).
- **Maintained mapping table** (config.toml name -> tofu/API name), kept explicit in
  the script:
  - `minimum_password_length` -> `password_min_length`
  - `jwt_expiry` -> `jwt_exp`
  - `enable_refresh_token_rotation` -> `refresh_token_rotation_enabled`
  - `refresh_token_reuse_interval` -> `security_refresh_token_reuse_interval`
  - `enable_signup` -> `disable_signup` (inverted; handled explicitly)
  - `enable_anonymous_sign_ins` -> `external_anonymous_users_enabled`
  - `[auth.mfa] max_enrolled_factors` -> `mfa_max_enrolled_factors`;
    `[auth.mfa.totp]`/`[auth.mfa.phone]` `enroll_enabled`/`verify_enabled` ->
    the `mfa_*_enroll_enabled`/`mfa_*_verify_enabled` fields
- **Deliberately excluded** (documented in a script comment so the table does not
  silently rot): the rate-limit fields (config.toml's `token_verifications` / `web3`
  naming does not map cleanly to the API's), and the env-divergent fields (site_url,
  redirect allow-list, OAuth client ids) which are supposed to differ.
- **Behavior:** prints each mismatch as `field: config.toml=X dev=Y prod=Z`, exits
  non-zero on any.

### First-run reconciliation (known)
The check passing requires `config.toml`'s policy to match the codified cloud values.
One mismatch is already known: `config.toml` has TOTP MFA **off** locally
(`[auth.mfa.totp] enroll_enabled = false`), while the cloud projects have it **on**
(`mfa_totp_enroll_enabled = true`). At first run, for each mismatched field
implementation either **reconciles** `config.toml` to match or **excludes** the field
as legitimately env-divergent (the MFA toggles are the likely exclude candidates,
since MFA enrollment is awkward in local dev). Decided per field against the actual
first-run diff.

## 6. Success criteria (Phase E / WS3 done)
- `drift-check.sh` runs `tofu plan -detailed-exitcode` across all three roots via
  `infisical run`, reports per-root status, exits non-zero on drift; runs clean today.
- `config-parity-check.py` compares the three sources and exits non-zero on policy
  divergence; passes after first-run reconciliation.
- A PR gate runs fmt + validate + parity (credential-free) on changes to
  `infra/tofu/**` or `supabase/config.toml`.
- `iac-drift.yml` runs daily, authenticates via the break-glass OIDC identity, and
  opens a labeled GitHub issue distinguishing drift from check-error.
- A Scalr API token is added to Infisical `shared/iac` (the one prerequisite).
- Runbook updated: the WS3 "a drift-check command exists" criterion satisfied;
  domains 6/7 reference the gate; action register updated. WS3 marked complete.

## 7. Next step
Write the Phase E implementation plan (the two scripts, the PR gate, the scheduled
workflow, the Scalr-token prerequisite, first-run reconciliation, runbook + WS3
close-out) and execute it. With Phase E done, WS3 is complete and the program moves
to the WS4-unblocked workstreams (WS1 materials durability, WS2 observability, WS5
account hardening), then WS6.
