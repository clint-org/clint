# WS3: IaC Foundation (OpenTofu) - Design

Status: approved (design). Date: 2026-06-10.
Part of the DR remediation program (`2026-06-10-dr-program-design.md`), workstream 3.
Closes runbook domains 4 (DNS/custom domains), 6 (Supabase config), and the config
part of 7 (Cloudflare account/Workers): the "manual, no IaC" top-gaps.

This spec is written to teach as well as specify (the user is new to IaC), so it
includes a concepts primer it would otherwise omit.

## 1. Concepts primer (reference)
- **Infrastructure as Code (IaC):** infrastructure (Workers, R2 buckets, DNS
  records, custom domains, rate limiters, Supabase project settings) described as
  committed text files, with a tool reconciling reality to the files. Gives infra
  the same version history, review, and rebuild-from-scratch that code has.
- **OpenTofu:** the open-source (Linux Foundation) fork of Terraform after
  Terraform moved to the BSL license. Drop-in compatible: same config language
  (HCL), same providers. Skills transfer to Terraform.
- **Provider:** a plugin that translates config into a service's API calls. We use
  the Cloudflare provider and the Supabase provider.
- **The loop:** `write` config, `tofu init` (fetch providers), `tofu plan` (dry
  run, changes nothing), `tofu apply` (make it real), `tofu import` (adopt an
  existing resource without recreating it). After importing, a `plan` showing "no
  changes" proves config matches reality.
- **State:** a JSON ledger mapping config to real resources. It can contain secrets
  in plaintext, so it must be encrypted and access-controlled and never committed.
  It is the tool's source of truth, so it lives in a durable remote backend.

## 2. Goal and scope
Goal: a fresh Clint environment can be stood up from OpenTofu config plus a short
documented manual residue, and `tofu plan` against the live environments shows no
drift.

In scope (codify and import to no-drift):
- Cloudflare: Workers (prod `clint`, dev `clint-dev`) and routes, R2 buckets
  (`clint-materials`, `clint-materials-dev`, `clint-db-backups`) including
  versioning/Object Lock settings, the `clintapp.com` DNS zone and records, tenant
  custom domains / custom hostnames, rate limiters.
- Supabase: project settings manageable by the provider (auth providers, redirect
  allow-list where supported).

Out of scope:
- App code and database migrations (keep their existing pipelines).
- Secret values (managed in WS4 Infisical; this spec only references where secrets
  that land in state are handled, see section 6).
- The Supabase dashboard-only residue the provider cannot manage (documented, not
  codified).

## 3. Repository layout
- `infra/tofu/` holds the OpenTofu project (committed config).
- State is never committed. `.gitignore` excludes `*.tfstate*`, `.terraform/`, and
  any `*.auto.tfvars` holding values.
- Environment separation (dev vs prod) decided in Phase B; the thin slice starts
  single-config.

## 4. Phased delivery (within WS3)
Foundations-first means WS3 itself ships before the resilience workstreams, but it
is still built in small, verifiable phases.

- **Phase A - thin learning slice (first).** Local state. (1) Create then destroy a
  throwaway R2 bucket (`clint-iac-smoke`) to learn create/plan/apply/destroy on
  something disconnected from the app. (2) Import one existing real bucket
  (`clint-db-backups`) and reach a no-op `plan`. Success: the user can run the loop,
  read a plan, and a real resource is managed with no changes pending.
- **Phase B - remote state backend.** Choose and migrate state to a durable,
  encrypted remote backend (decision deferred to the start of this phase, when state
  is concrete; options previewed in section 5). Migrate the Phase A state into it.
- **Phase C - widen Cloudflare.** Import, one resource type at a time with a no-op
  plan after each: the other R2 buckets, rate limiters, DNS records, Workers and
  routes, tenant custom domains. Each type is its own small change set.
- **Phase D - Supabase config.** Add the Supabase provider; codify what it supports;
  document the dashboard-only residue as runbook-tracked manual steps.
- **Phase E - drift gate.** A `tofu plan` check (local script, later CI) that fails
  on unexpected drift, so reality and config stay in sync going forward.

## 5. State backend options (previewed; decided in Phase B)
Surfaced now for context; chosen once state is concrete. Cost/benefit per the
decide-cost-per-item principle.
- Backblaze B2 (S3-compatible backend): already used for backups, lives outside the
  Cloudflare account so it survives the single-account concentration risk; no new
  vendor.
- Cloudflare R2: simplest, already present, supports the native lockfile; but state
  would live in the same account it manages (mild concentration smell, mitigated
  because config in git can rebuild state via re-import).
- Managed backend (HCP Terraform / Scalr / env0 free tier): adds locking and run
  history and isolates state from Cloudflare; a new vendor account.

## 6. Secrets in state (boundary with WS4)
Some imported resources expose sensitive attributes that land in state. Until WS4
(Infisical) exists: keep provider credentials in shell env vars only (never in
committed files), keep state local or in an access-controlled remote backend, and
avoid importing resources whose primary purpose is a secret. The age key is never
involved. WS4 later supplies provider credentials to CI via a machine identity.

## 7. Prerequisites
- OpenTofu installed locally (install command provided at implementation time).
- A scoped Cloudflare API token (user mints it; least-privilege, starting with R2
  permissions, widened per phase). Lives in a shell env var now, moves to Infisical
  in WS4. A dashboard walkthrough is provided when we reach it.
- Phase D adds a Supabase access token (similar handling).

## 8. Success criteria (WS3 done)
- `infra/tofu/` brings the in-scope Cloudflare and Supabase resources under
  management with a clean `tofu plan` (no drift).
- State is in an encrypted remote backend with documented access.
- A drift-check command exists.
- Runbook domains 4, 6, 7 recovery procedures reference the IaC; the action register
  rows are updated. The documented manual residue (what IaC cannot manage) is
  listed.

## 9. Next step
Write the Phase A implementation plan (the thin slice) and execute it. Later phases
get their own plans as we reach them.
