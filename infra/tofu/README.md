# Clint infrastructure as code (OpenTofu)

Codifies Clint's Cloudflare and (later) Supabase infrastructure. Part of WS3 of
the DR remediation program. See
`docs/superpowers/specs/2026-06-10-ws3-iac-foundation-design.md`.

## Layout: one root config per environment
Each folder is an independent OpenTofu root with its own state and its own Scalr
workspace, so the blast radius of any change is one environment.

```
infra/tofu/
  shared/   account-level + cross-env resources (clint-db-backups, later the
            clintapp.com DNS zone, account settings)   -> Scalr workspace clint-shared
  dev/      dev-only resources (clint-dev, clint-materials-dev, dev Supabase)
                                                        -> clint-dev   (to be built)
  prod/     prod-only resources (clint, clint-materials, prod Supabase)
                                                        -> clint-prod  (to be built)
```

Reusable resource templates (modules) get factored out only once dev and prod have
near-identical resources worth sharing. Not needed yet.

## State backend: Scalr (CLI-driven for now)
State lives in Scalr (off Cloudflare, so the recovery map does not sit inside the
thing it would help rebuild). We run `tofu` locally and Scalr stores state. We will
flip these workspaces to VCS-driven remote execution later to unlock run history,
drift detection, and prod approval gates (a workspace setting, not a redo).

## Prerequisites
- OpenTofu (`tofu version`).
- A scoped Cloudflare API token and the account id, exported in your shell (never
  committed):
  ```sh
  export CLOUDFLARE_API_TOKEN=...
  export TF_VAR_cloudflare_account_id=...
  ```
- Authenticated to Scalr: `tofu login <account>.scalr.io`.

## Workflow (per environment folder)
```sh
cd shared            # or dev / prod
tofu init            # first run migrates/links state to the Scalr workspace
tofu plan            # dry run
tofu apply           # make changes real
```

## Importing existing resources (config-driven)
1. Add an `import` block.
2. `tofu plan -generate-config-out=generated.tf` to generate matching config.
3. Review, `tofu apply` to bring it into state.
4. Fold the generated block into a permanent file; remove the import block.

State is never committed (see `.gitignore`). The provider lock
(`.terraform.lock.hcl`) is committed.
