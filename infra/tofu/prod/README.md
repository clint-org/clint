# prod environment

OpenTofu root for prod-only resources. State lives in the Scalr workspace
`clint-prod` (Local execution). Candidate for VCS-driven remote execution with an
approval gate. Currently managed:
- `clint-materials` R2 bucket (`r2.tf`)
- prod Worker custom domains `clintapp.com` + `www.clintapp.com` and the
  `*.clintapp.com` tenant-wildcard route (`workers.tf`)
- the `clint` (prod) Supabase project's non-secret auth settings (`supabase.tf`, WS3
  Phase D): redirect allow-list, site URL, Google/Microsoft enabled flags + client
  ids, and auth policy (JWT/refresh expiry, MFA, password length, IP rate limits)

The Worker script and its bindings stay owned by wrangler/GHA; tofu takes only the
dashboard-manual edge config. Supabase secrets are excluded by design (the API
returns them hashed); see `../README.md` and
`docs/superpowers/specs/2026-06-17-ws3-phase-d-supabase-design.md`.
