# WS3 Phase D: Supabase project config as code - Design

Status: approved (design). Date: 2026-06-17.
Part of the DR remediation program (`2026-06-10-dr-program-design.md`), workstream 3
(IaC foundation). Builds on the WS3 design (`2026-06-10-ws3-iac-foundation-design.md`),
which deferred Phase D pending a scope decision. WS4 (Infisical secrets) is complete,
so provider credentials now have a proper home.

This spec is written to teach as well as specify (the user is new to IaC), so it
includes a short concepts primer it would otherwise omit.

## 1. Concepts primer (reference)
- **Supabase project config vs. data.** A Supabase project holds two separable
  things: the *database* (tables, RLS, functions, extensions) and a set of
  *project settings* (auth redirect rules, password policy, connection pooler,
  storage limits, and so on). The database is already code: it lives in
  `supabase/migrations/` and rebuilds by re-running those files. The project
  settings are not: today they live only in the Supabase dashboard, set by clicking.
  Phase D brings the settings under code too.
- **Why it matters (the failure it prevents).** If a project is ever re-provisioned
  (accidental deletion, account/suspension trouble, a deliberate DR drill, or a
  rebuild after a security incident), re-running migrations restores every table,
  but the new project's settings start blank. The highest-consequence blank is the
  auth *redirect allow-list*: the set of URLs Supabase is permitted to send a user
  back to after Google sign-in. Empty, every tenant's login breaks. The hard part
  of restoring it is not typing it back, it is *knowing the complete correct list*,
  which grows over time as tenant custom domains are added. Recording it as code
  removes that from human memory and lets the Phase E drift gate watch it.
- **The Supabase OpenTofu provider.** `supabase/supabase`. The one resource we use
  is `supabase_settings`, which takes a project's settings as serialised JSON blocks
  (`auth`, `api`, `database`, `network`, `pooler`, `storage`) plus an
  `ssl_enforcement` flag, and PATCHes them onto a live project through Supabase's
  Management API. It does **not** manage schema or data (migrations own those), and
  it does **not** create or destroy the project itself.
- **Partial management.** For each block you supply only the fields you choose. The
  provider PATCHes only those fields and, on read, compares only those fields. So you
  are never forced to manage a whole category at once, and unmanaged fields do not
  show as drift.
- **Drift / the hashed-secret trap.** "Drift" is when the live resource no longer
  matches the recorded config, so `tofu plan` proposes a change. The Management API
  returns certain sensitive fields **hashed/redacted** rather than as their real
  value (the provider docs name `smtp_pass` and the external-provider secrets). Any
  such field placed under management can never match what we wrote, so it would show
  as drift on *every* plan, forever, which would make the Phase E drift gate
  useless. These fields are therefore deliberately excluded.

## 2. Goal and scope
Goal: the in-scope cloud settings of the prod and dev Supabase projects are codified
in OpenTofu and reach a no-op `tofu plan`, so a re-provisioned project can be
restored from code plus a short, documented secret-paste step.

Scope decision (resolved 2026-06-17): **codify everything we can** -- every
non-secret setting across all blocks the provider supports -- with the
hashed/redacted secrets carved out. This is broader than the minimal
(redirect-list-only) option, chosen because a static runbook checklist goes stale
as settings change, whereas code can be diffed and watched by the Phase E gate.

### In scope (codify to a no-drift plan), for both prod and dev
The final codified set is "every non-secret field that reaches a quiet plan",
confirmed empirically per field. Target fields by block:

| Block | Codify (non-secret, clean) |
|-------|----------------------------|
| `auth` | site address; redirect allow-list (`uri_allow_list`); signup + anonymous-signin toggles; JWT + refresh-token expiry and rotation; password rules; login rate limits; MFA policy; OTP lengths/expiry; **Google + Microsoft external providers: `enabled` flag, client id, redirect url**; SMTP host/port/user (if prod uses SMTP) |
| `api` | exposed schemas, extra search path, max rows |
| `database` | statement timeout and any non-default Postgres knobs; SSL enforcement (`ssl_enforcement`) |
| `network` | DB-connection IP allow-list, if any is set |
| `pooler` | pool mode, pool size |
| `storage` | file size limit, image-transformation / S3-protocol toggles |

### Out of scope
- **Hashed/redacted secrets** (the only auth gaps): Google client *secret*, Microsoft
  client *secret*, SMTP password, and Twilio/captcha secrets if ever enabled.
  Documented manual residue (section 5).
- **Project lifecycle.** Creating or destroying the Supabase *project* stays manual
  (the dashboard's job). Tofu manages only the settings of an existing project.
- **The Phase E drift script/CI itself**, including the `config.toml`-vs-tofu policy
  comparison (section 6). Phase D produces the inputs; Phase E builds the gate.
- **Per-tenant custom domains as dynamic IaC.** The allow-list is codified as the
  current static list (wildcards plus today's explicit custom-domain entries).
  Making it dynamic from `tenants`/`agencies` rows is the separately-deferred item.
- App code and database migrations (keep their existing pipelines).

## 3. Architecture and wiring
Follows the existing `infra/tofu/` patterns (one root per environment, each with its
own state and Scalr workspace, blast radius of one environment).

- **One `supabase_settings` resource per environment, in the existing env root.**
  `infra/tofu/prod/supabase.tf` manages the prod project; `infra/tofu/dev/supabase.tf`
  manages the dev project. Nothing goes in `shared/` (projects are per-environment).
  State lands in the existing `clint-prod` / `clint-dev` Scalr workspaces (Local
  execution mode, unchanged).
- **Provider added to `prod/` and `dev/` only.** Each root's `versions.tf` gains
  `supabase = { source = "supabase/supabase", version = "~> 1" }`; a one-line
  `provider "supabase" {}` in `providers.tf` (reads its token from the environment,
  same style as `provider "cloudflare" {}`). `shared/` is untouched.
- **Token from Infisical.** The provider reads `SUPABASE_ACCESS_TOKEN` (a Supabase
  *management* token, account-scoped, not per-project). The same token value now
  lives at `shared/iac/SUPABASE_ACCESS_TOKEN` (added 2026-06-17), mirroring the
  two-homes pattern for `CLOUDFLARE_API_TOKEN` (a deploy copy under
  `shared/cloudflare`, a tofu copy under `shared/iac`). The run command is unchanged:
  `infisical run --env=shared --path=/iac -- tofu <cmd>` from a root folder.
- **Project ref as a plain input.** Each project's ref (the id in its dashboard URL)
  is account-identifying but not secret, so it is a `variable` passed via
  `TF_VAR_supabase_project_ref` (or a literal in the env's file), the same treatment
  as `cloudflare_account_id`. Two different refs, one per env root.
- **Import, not create.** The projects exist, so we adopt them: add the resource,
  read current live settings into the config, reach a no-op plan. Tofu never creates
  or destroys the project.

## 4. Method (incremental, evidence-first)
The same import-then-quiet-plan discipline used in Phase C, applied per block:
1. Read the live project's current settings (dashboard / Management API).
2. Add one block (start with `auth`), encoding the current live values verbatim so
   the first plan is a no-op.
3. `infisical run --env=shared --path=/iac -- tofu plan` from the env root. If a
   field will not settle to "no changes" (the API reshaped it, e.g. reordered a
   list or added a trailing slash), drop that field to the manual checklist rather
   than leave the plan noisy.
4. Repeat for the remaining blocks. Do dev first, then prod.

## 5. Documented manual residue (runbook domain 6)
On a project rebuild, tofu re-applies everything in section 2, then a short runbook
checklist covers what it deliberately will not touch:

- **Secret-paste step.** Paste these from Infisical into the Supabase dashboard:
  Google client secret, Microsoft client secret, SMTP password (if used), and any
  Twilio/captcha secret. These live under `prod/supabase` and `dev/supabase` in
  Infisical.
  - **Prerequisite.** WS4's deferred follow-up was to migrate `GOOGLE_OAUTH_*` /
    `MICROSOFT_OAUTH_*` (and Resend/email) into Infisical. Phase D needs these
    secrets to have a documented Infisical home so the checklist points at something
    concrete. Treat that migration as a Phase D prerequisite, not an assumption.
- **Project creation step.** Re-provisioning the project itself (create, link, set
  region/plan) stays a manual dashboard step, documented in the recovery procedure.

### Guardrail: single ownership of remote settings
The Supabase CLI's experimental `supabase config push` can push `config.toml`'s
`[auth]`/`[api]` sections onto a remote project. Once tofu owns those settings, two
tools editing the same fields would fight. Clint's deploy workflow runs
`supabase db push` (migrations only), not `config push`, so there is no conflict
today. The rule is explicit: **remote auth/api/etc. settings are owned by tofu;
never run `supabase config push` against prod or dev.** `config.toml` remains the
source of truth for the *local* `supabase start` stack only.

## 6. Relationship to config.toml (and the handoff to Phase E)
`config.toml` configures the *local* dev stack; `supabase_settings` in tofu
configures the *live cloud* projects. They are not kept byte-identical, because many
fields are legitimately different. Phase D does not change `config.toml`; it makes
the cloud side legible (previously dashboard-only and unknowable) so divergence
becomes diffable.

Field classification (consumed by Phase E):
- **Env-divergent (must never be forced to match):** site address, redirect
  allow-list, OAuth `redirect_uri`, SMTP (local inbucket vs real sender), captcha,
  anything pointing at localhost.
- **Should-match (policy parity):** password rules, JWT/refresh-token expiry and
  rotation, signup and anonymous-signin toggles, MFA policy, OTP lengths, login
  rate limits.

Decision (resolved 2026-06-17): the should-match subset is kept from silently
diverging by **extending Phase E's drift gate** to compare `config.toml`'s policy
fields against the tofu JSON and fail on divergence. Phase D's deliverable here is
only the classification above; building the check is Phase E.

## 7. Secrets in state (boundary with WS4)
`supabase_settings` state can contain the non-secret settings we manage; the
excluded secrets never enter it (that is the point of excluding them). State stays
in the encrypted Scalr backend with documented access, consistent with the rest of
WS3. The provider token is injected at runtime from Infisical and never written to a
file.

## 8. Success criteria (Phase D done)
- `infra/tofu/prod/supabase.tf` and `infra/tofu/dev/supabase.tf` bring the in-scope
  settings under management with a clean `tofu plan` (no drift) in both roots.
- `tofu validate` passes in both roots; the provider lock is committed; state is not.
- The codified redirect allow-list is confirmed to contain today's live entries
  (the catastrophic-if-lost field), spot-checked against the dashboard.
- Login still works in dev after the first apply (auth is what we manage).
- Runbook domain 6 updated: the "cloud config lost on rebuild" gap becomes "codified
  in tofu, minus a documented secret-paste step", and the manual residue (secrets +
  project creation) is listed. Action register row updated.

## 9. Next step
Write the Phase D implementation plan (provider scaffold, then per-block import to a
quiet plan, dev before prod) and execute it inline. Phase E (the drift gate,
including the config.toml policy comparison) gets its own spec afterward.
