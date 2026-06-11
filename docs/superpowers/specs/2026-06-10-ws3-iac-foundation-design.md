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

## 3. Repository layout (decided)
One root config per environment, each with its own state and Scalr workspace, so a
change's blast radius is one environment:
- `infra/tofu/shared/` - account-level and cross-env resources (`clint-db-backups`,
  later the `clintapp.com` DNS zone, account settings). Scalr workspace
  `clint-shared`.
- `infra/tofu/dev/` - dev-only resources. Scalr workspace `clint-dev` (Phase C).
- `infra/tofu/prod/` - prod-only resources. Scalr workspace `clint-prod` (Phase C).

We did NOT use `terraform workspace` (CLI workspaces) for env separation: separate
root configs isolate blast radius and avoid wrong-target applies. Modules are
factored out later, only when dev and prod have near-identical resources worth
sharing. State is never committed (`.gitignore` excludes `*.tfstate*`,
`.terraform/`, `*.tfvars`); the provider lock is committed.

## 4. Phased delivery (within WS3)
Foundations-first means WS3 itself ships before the resilience workstreams, but it
is still built in small, verifiable phases.

- **Phase A - first real slice.** Local state. Import one existing real bucket
  (`clint-db-backups`, chosen for low blast radius) and reach a no-op `plan`,
  learning import/plan on a real resource. (Throwaway create/destroy step dropped
  per user: go straight to real resources.) Success: the user can run the loop,
  read a plan, and a real resource is managed with no changes pending.
- **Phase B - remote state backend (decided: Scalr).** State moves to Scalr, off
  Cloudflare so the recovery map does not live inside the thing it rebuilds. Used
  CLI-driven for now (runs stay local, Scalr stores state); flip to VCS-driven
  remote execution later to unlock run history, drift detection, and prod approval
  gates (a workspace setting, not a redo). The `shared` workspace migrates the
  Phase A state in first.
- **Phase C - widen Cloudflare.** Import, one resource type at a time with a no-op
  plan after each: the other R2 buckets, rate limiters, DNS records, Workers and
  routes, tenant custom domains. Each type is its own small change set.
- **Phase D - Supabase config.** Add the Supabase provider; codify what it supports;
  document the dashboard-only residue as runbook-tracked manual steps.
- **Phase E - drift gate.** A `tofu plan` check (local script, later CI) that fails
  on unexpected drift, so reality and config stay in sync going forward.

## 5. State backend decision (Scalr)
Chosen: Scalr (managed, OpenTofu-native, free tier), CLI-driven for now. Rationale:
isolates state from Cloudflare (the #1 concentration risk), and the managed platform
gives a path to run history, drift detection, and prod approval gates when we flip
to VCS-driven execution. Options considered and rejected for now:
- Cloudflare R2: simplest, but state would live in the same account it manages
  (storing the recovery map inside the thing it rebuilds).
- Backblaze B2 (S3 backend): outside Cloudflare and no new vendor, but state-locking
  via the S3 backend is finicky and it offers no run history or drift detection.
- HCP Terraform: OpenTofu compatibility not guaranteed since the fork.

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
