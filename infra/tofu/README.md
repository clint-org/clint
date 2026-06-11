# Clint infrastructure as code (OpenTofu)

Codifies Clint's Cloudflare and (later) Supabase infrastructure so it can be
reviewed, version-controlled, and rebuilt. Part of WS3 of the DR remediation
program. See `docs/superpowers/specs/2026-06-10-ws3-iac-foundation-design.md`.

## Prerequisites
- OpenTofu (`tofu version`).
- A scoped Cloudflare API token, exported as an env var (never committed):
  ```sh
  export CLOUDFLARE_API_TOKEN=...        # scoped token, see the spec
  export TF_VAR_cloudflare_account_id=...# your Cloudflare account id
  ```

## Commands
```sh
tofu init       # download providers (no credentials needed)
tofu validate   # check the config is well-formed (no credentials needed)
tofu fmt        # format the .tf files
tofu plan       # dry run: show what would change, changes nothing
tofu apply      # make changes real
```

## Importing existing resources (config-driven)
1. Add an `import` block (see `imports.tf`).
2. Generate the matching config: `tofu plan -generate-config-out=generated.tf`.
3. Review `generated.tf`, then `tofu apply` to bring the resource into state.
4. Fold the generated block into a permanent file and remove the import block.

## State
State is local during Phase A so you can see it. It moves to an encrypted remote
backend in Phase B. State is never committed (see `.gitignore`).
