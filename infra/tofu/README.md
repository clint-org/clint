# Clint infrastructure as code (OpenTofu)

Codifies Clint's Cloudflare and Supabase infrastructure. Part of WS3 of the DR
remediation program. See
`docs/superpowers/specs/2026-06-10-ws3-iac-foundation-design.md` and the Supabase
piece `docs/superpowers/specs/2026-06-17-ws3-phase-d-supabase-design.md`.

## Layout: one root config per environment
Each folder is an independent OpenTofu root with its own state and its own Scalr
workspace, so the blast radius of any change is one environment.

```
infra/tofu/
  shared/   account-level + cross-env resources (clint-db-backups, clint-db-backups
            B2 mirror, the clintapp.com DNS zone + records)  -> Scalr workspace clint-shared
  dev/      dev-only resources (clint-materials-dev, dev Worker routes,
            clint-dev Supabase auth settings)             -> clint-dev
  prod/     prod-only resources (clint-materials, prod Worker custom domains +
            tenant-wildcard route, clint Supabase auth settings)  -> clint-prod
```

Reusable resource templates (modules) get factored out only once dev and prod have
near-identical resources worth sharing. Not needed yet.

## State backend: Scalr (CLI-driven, local execution)
State lives in Scalr (off Cloudflare, so the recovery map does not sit inside the
thing it would help rebuild). Host `clintapp.scalr.io`, environment `clint`,
workspace `clint-shared` (later `clint-dev`, `clint-prod`).

Each workspace must be set to **Local execution mode** (workspace Settings ->
Source -> Execution mode). Local mode means: runs execute on your machine using
**shell env vars** (`CLOUDFLARE_API_TOKEN`, `TF_VAR_cloudflare_account_id`, and the
B2 keys), which `infisical run --env=shared --path=/iac` injects from Infisical,
and Scalr only stores state. The default is Remote, which runs on Scalr's infra and
ignores your local vars (it would need the variables set in Scalr instead).

To unlock run history, drift detection, and prod approval gates later, flip a
workspace to Remote execution and move its variables into Scalr (a setting change,
not a redo).

## Prerequisites
- OpenTofu (`tofu version`).
- The Infisical CLI (`infisical --version`), logged in (`infisical login`).
  Provider credentials are **no longer kept in a local `.env.local`** (retired in
  WS4). They live in Infisical -- project `clint`, environment `shared`, folder
  `/iac` -- and are injected per run by `infisical run` (see Workflow). Inspect or
  recover them with `infisical secrets --env shared --path /iac`.
- Authenticated to Scalr: `tofu login <account>.scalr.io`.

## Workflow (per environment folder)
`infisical run --env=shared --path=/iac --` injects the provider credentials as
env vars for the wrapped command only (nothing is written to disk). It sets the
same names tofu already reads: `CLOUDFLARE_API_TOKEN`,
`TF_VAR_cloudflare_account_id`, `B2_APPLICATION_KEY_ID`, `B2_APPLICATION_KEY`.
```sh
cd shared            # or dev / prod
infisical run --env=shared --path=/iac -- tofu init   # first run links state to Scalr
infisical run --env=shared --path=/iac -- tofu plan   # dry run
infisical run --env=shared --path=/iac -- tofu apply  # make changes real
```

## Importing existing resources (config-driven)
1. Add an `import` block.
2. `tofu plan -generate-config-out=generated.tf` to generate matching config.
3. Review, `tofu apply` to bring it into state.
4. Fold the generated block into a permanent file; remove the import block.

State is never committed (see `.gitignore`). The provider lock
(`.terraform.lock.hcl`) is committed.

## Drift detection (WS3 Phase E)
Reality and config are kept in sync by two checks:

- `scripts/drift-check.sh` runs `tofu plan -detailed-exitcode -lock=false` in each
  root via `infisical run` and exits 0 (in sync), 2 (drift), or 1 (check error).
  Run it on demand: `bash infra/tofu/scripts/drift-check.sh`. It runs daily in CI via
  `.github/workflows/iac-drift.yml`, which authenticates to Infisical with the
  read-only GitHub-OIDC machine identity and opens an `iac-drift` issue on failure.
  `-lock=false` keeps the CI Scalr token least-privilege (read-only, no
  `workspaces:lock`); a drift plan never writes state.
- `scripts/config_parity_check.py` asserts the should-match Supabase auth policy
  fields agree across `supabase/config.toml`, `dev/supabase.tf`, and
  `prod/supabase.tf` (credential-free; unit-tested in `test_config_parity.py`).

PRs touching `infra/tofu/**` or `supabase/config.toml` are gated (credential-free) by
`.github/workflows/iac-pr-check.yml`: `tofu fmt -check`, `tofu validate` per root, and
the parity check. The scheduled drift plan needs credentials, so it runs only in
`iac-drift.yml`, which requires `TF_TOKEN_clintapp_scalr_io` in Infisical `shared/iac`.
