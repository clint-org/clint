# dev environment

OpenTofu root for dev-only resources. State lives in the Scalr workspace `clint-dev`
(Local execution). Currently managed:
- `clint-materials-dev` R2 bucket (`r2.tf`)
- dev Worker routes `dev.clintapp.com/*` and `*.dev.clintapp.com/*` (`workers.tf`)
- the `clint-dev` Supabase project's non-secret auth settings (`supabase.tf`, WS3
  Phase D): redirect allow-list, site URL, Google/Microsoft enabled flags + client
  ids, and auth policy (JWT/refresh expiry, MFA, password length, IP rate limits)

The Worker script and its bindings stay owned by wrangler/GHA; tofu takes only the
dashboard-manual edge config. Supabase secrets are excluded by design (the API
returns them hashed); see `../README.md` and
`docs/superpowers/specs/2026-06-17-ws3-phase-d-supabase-design.md`.
