# Dev e2e regression suite: delivery note

A durable, whole-app Playwright regression suite that runs against the **deployed
dev stack** (`*.dev.clintapp.com`). It provisions its own throwaway tenants (no
db reset), authenticates programmatically (no Google login), clears Cloudflare,
and exercises every major user-facing surface plus the role firewall. Run it
after a dev deploy and on demand.

Code: `src/client/playwright.dev.config.ts` + `src/client/e2e-dev/` (see that
README for architecture). This note is the run model + coverage map.

## Why dev (not local)

Unit (vitest) and integration (`src/client/integration/`) are the deterministic
local gate and already run in CI; this suite does not duplicate them. Playwright's
unique value is the real browser on the real deployed stack: real Cloudflare edge,
real auth + cross-subdomain cookies, real ct.gov sync, real AI import, real
whitelabel-by-host branding. So it targets dev.

## How to run

```bash
cd src/client
./e2e-dev/run.sh                     # full suite (headed)
./e2e-dev/run.sh --grep @firewall    # one area
```

`run.sh` wraps Playwright in `infisical run --env dev --path /supabase`. The only
secret is `SUPABASE_DEV_DB_POOLER_URL`; the dev URL + anon key are public. Runs
**headed** (see Cloudflare below), except the `@contract` test which is pooler-only
(no browser). Phase 1 baseline: 24 passed, 7 scaffolds skipped. Phase 2 added the
`@contract`, `@adversarial`, `@security`, and `@intelligence` (briefs) suites
(verified green) plus `@crud`/`@external`/`@admin` scaffolds (`test.fixme`, pending
verification passes -- see Phase 2 section).

## Run model (decisions, 2026-06-29)

- **Local / on-demand only for now.** A dedicated GitHub workflow exists
  (`.github/workflows/regression-dev-e2e.yml`, `workflow_dispatch`) with an
  always-on preflight (secrets + dev reachability) and a ready-to-flip test job.
  Real CI execution is **deferred** behind the `DEV_E2E_ENABLED` repo variable.
- **Not a PR gate.** Depends on a deployed env + live DB + external services.
- **Auth = pooler-only.** No service-role key or JWT secret (neither is in
  Infisical; only the pooler URL is).

### The Cloudflare gate (why CI is deferred)

dev sits behind a Cloudflare managed challenge. **Headless never clears it**
(verified: the full interstitial, zero `/rest/v1` calls). **Headed real Chrome
auto-solves it** in a few seconds. A GitHub-runner has a datacenter IP and is
challenged even headed, so automated CI needs a Cloudflare WAF bypass first. To
turn CI on later: add a WAF custom rule that skips bot protection for a secret
header (sent via `use.extraHTTPHeaders`), then set `DEV_E2E_ENABLED=true` and
optionally add the `workflow_run` post-deploy trigger (commented in the workflow).

## Data isolation + auth (how it works)

Each test provisions a throwaway agency -> tenant -> space via the real
`provision_*`/`create_space` RPCs (called by a platform-admin "provisioner" the
harness creates), plus the role users it needs, then tears everything down via
the pooler even on failure. Users are created by SQL into `auth.users` +
`auth.identities`, signed in with the public anon key for a real GoTrue session,
and that session is injected as the `sb-auth-dev` apex cookie. No service-role
key, no JWT minting, no Google OAuth. GoTrue rate-limits auth per IP, so worlds
provision only the roles a spec needs (default owner; firewall opts into all four)
and sign-in retries with backoff.

## Coverage matrix

Status: **verified** = green headed run today; **partial** = surface loads /
core path asserted, deeper assertions to add; **scaffold** = `test.fixme`,
authored from a verified TP but pending a verification pass or harness extension;
**external** = hits a live external service.

| Surface | Route | Spec | Status |
| --- | --- | --- | --- |
| Auth: protected route redirects to login | `/t/:t/s/:s/*` (anon) | `anon.spec.ts` | verified |
| Marketing landing (apex default host) | `https://dev.clintapp.com/` | `anon.spec.ts` | verified |
| Whitelabel brand-by-host (tenant) | `*.dev.clintapp.com` | `smoke.spec.ts` | verified |
| Dashboard timeline (auth + render) | `/timeline` | `smoke.spec.ts`, `seeded-views.spec.ts` | verified |
| Bullseye landscape | `/bullseye` | `seeded-views.spec.ts` | verified |
| Heatmap (+ facets) | `/heatmap/by-*` | `landscape.spec.ts` | partial |
| Future Events (catalysts redirect) | `/catalysts` -> `/future-events` | `landscape.spec.ts` | partial |
| Companies: create + delete (UI) | `/profiles/companies` | `company-crud.spec.ts` | verified |
| Companies / assets / trials read | `/profiles/*` | `seeded-views.spec.ts` | verified |
| Asset / trial CRUD (UI) | `/profiles/{assets,trials}` | (seed covers create) | partial |
| Entity delete-cascade | `/profiles/*` | `company-crud.spec.ts` (+ integration) | partial |
| Events: create (RPC) | `create_event` | `helpers/seed.ts` | verified |
| Events: merged form create/edit/re-anchor (UI) | trial detail | `event-form.spec.ts` | scaffold |
| Activity page (no 404) | `/activity` | `intelligence.spec.ts` | verified |
| Intelligence feed | `/intelligence` | `intelligence.spec.ts` | verified |
| Materials browser | `/materials` | `intelligence.spec.ts` | verified |
| Briefs / citations / history | `/intelligence` | (integration today) | gap |
| Source import: ct.gov sync | trial detail CT.GOV | `external-services.spec.ts` | external |
| Source import: AI extract + dedup | `/import` | `external-services.spec.ts` | external |
| Taxonomies (Indication/MOA/ROA) admin | `/settings/taxonomies` | `taxonomies.spec.ts` | verified |
| Event types / categories admin | `/settings/taxonomies` | `taxonomies.spec.ts` | partial |
| Space settings: members/roles | `/settings/members` | `role-firewall.spec.ts` | verified |
| Tenant branding / access / custom domains | `/t/:t/settings`, super-admin | `admin-portals.spec.ts` | scaffold |
| Agency portal | `/admin/*` | `admin-portals.spec.ts` | scaffold |
| Super-admin console | `/super-admin/*` | `admin-portals.spec.ts` | scaffold |
| Audit log (space/tenant/agency) | `/settings/audit-log` etc. | `admin-portals.spec.ts` | scaffold |
| Export PNG (blob) | `/timeline` Export | `export.spec.ts` | verified |
| Export PPTX / XLSX | `/timeline` Export | `export.spec.ts` (same path) | partial |
| Command palette (Cmd+K) | any space route | `navigation.spec.ts` | verified |
| Navigation / app shell / sidebar | space routes | `navigation.spec.ts` | verified |
| Help / reference pages | `/help/*` | `help.spec.ts` | verified |
| Empty vs populated states | timeline/bullseye | `smoke` (empty), `seeded-views` (populated) | verified |
| **Role firewall (owner/editor/viewer/non-member)** | space/settings/import/profiles | `role-firewall.spec.ts` | verified |

## Gated / scaffold items and what they need

- **Event merged form (`@event`)**: trial-detail dialog selectors need one headed
  verification pass; flow is documented from TP-009 / QA-004. Event creation is
  already covered at the RPC layer by `seedBasics`.
- **External (`@external`)**: ct.gov sync hits clinicaltrials.gov (pin a stable
  NCT, generous timeouts); AI import needs the scratch tenant's
  `ai_config.ai_enabled = true` (a harness extension) plus live AI workers.
- **Admin (`@admin`)**: agency portal needs an agency-host page helper +
  `agency_members` row; super-admin needs a super-admin host (or the
  `?wl_kind=super-admin` dev override) for the platform-admin provisioner; audit
  logs need audited actions seeded first. Regression guard target: QA-009 (agency
  audit ACTOR renders "--").
- **Briefs/citations**: currently covered by the integration suite; add a seeded
  brief + citation-resolve e2e when authoring is wired into the harness.

## Phase 2: exhaustive-coverage additions (2026-06-29)

New surfaces, built from a parallel grounded-discovery workflow (8 read-only agents
returning draft specs + harness extensions grounded in origin/develop), then verified
serially headed through the main loop.

**Verified green**
| Surface | Spec | Tag | Notes |
| --- | --- | --- | --- |
| **Client↔DB RPC signature contract** | `rpc-contract.spec.ts` | `@contract` | pooler-only; asserts `required ⊆ client ⊆ params` for ALL ~109 client `.rpc()` calls (map in `fixtures/rpc-contracts.ts`). Green on the tracked `KNOWN_DIVERGENCES`, RED on any new drift. |
| Adversarial create_event validation (QA-008) | `adversarial-create-event.spec.ts` | `@adversarial` | RPC guard contract (accepted vs blocked SQLSTATEs) + XSS-title rendered escaped (security). |
| Browser threat model | `security-threat-model.spec.ts` | `@security` | cross-space IDOR (two worlds), tampered/expired `sb-auth-dev` cookie fails closed, viewer deep-links to gated routes. |
| Intelligence briefs + citations + filters | `intelligence-briefs.spec.ts` | `@intelligence` | author via `upsert_primary_intelligence`, published/drafts, citation resolves to anchored trial (matrix row 6), ENTITY/SINCE filters. |

**Scaffold (`test.fixme`, authored + harness-ready, pending a verification pass)**
| Surface | Spec | Blocked on |
| --- | --- | --- |
| Entity CRUD + merged event form (edit-matrix) | `entity-crud-events.spec.ts` | PrimeNG datepicker fill race; the EDIT/re-anchor half is blocked by the live `update_event` bug below. |
| AI import (NCT + dedup + text/URL) | `ai-import.spec.ts` | live Anthropic + ct.gov verification pass (`enableAi` harness ready). |
| AI cost / token accounting | `ai-usage.spec.ts` | live AI + super-admin host (`admin.dev.clintapp.com`, kind confirmed). |
| Agency / super-admin / audit | `admin-portals.spec.ts` | 3-host headed Cloudflare verification pass; QA-009 actor-email soft assertions expected red. |

New harness: `helpers/ai-config.ts` (`enableAi`), `helpers/admin-context.ts`
(`agencyPageAs`/`superAdminPageAs` via real host brand resolution -- the `?wl_kind`
override is disabled on dev because `environment.dev.ts` ships `production:true`),
`helpers/session-tamper.ts`, `helpers/ctgov-lock.ts`, `helpers/intelligence.ts`,
`helpers/ai-usage.ts`, and `scratch-world.ts` now exposes `world.provisioner`.

## Findings raised (not fixed here)

- **Client↔DB RPC divergences (the `@contract` sweep found 3, all real PGRST202 risks
  the UI hides as "Could not save"):**
  1. **`update_event` omits required `p_source_url`** -- the client's `UpdateEventArgs`
     dropped it but the deployed function requires it (no default) -> **every event edit
     fails on dev**. `create_event` works only by luck (its `p_source_url` has a default).
     Owned by the DB session; fix = drop `p_source_url` from `update_event` or give it a
     default. The in-migration smoke calls it *positionally* with a dummy value, so the DB
     smoke is green while the client's named-arg path is broken.
  2. **`update_event_links` dropped** (`20260629020000_drop_dead_event_feed_fns`) but still
     called by `EventService.updateLinks()` -> PGRST202 when adding an event link.
  3. **`get_marker_history` dropped** (`20260628070739_drop_marker_event_tables`) but still
     called by `change-event.service.ts` (legacy marker-detail-content.component).
  These are tracked in `KNOWN_DIVERGENCES`; the contract test goes green automatically as
  each is fixed and flags any NEW divergence. See memory `reference_client_db_rpc_contract_gap`.
- **QA-008 confirmed accepted-by-design** at the RPC layer (pinned with REGRESSION-WATCH):
  inverted date range, empty/6000-char title, far dates. XSS title renders escaped (safe).
- **GoTrue auth rate limit**: a naive full suite (5 users/world) tripped the
  per-IP limiter. Mitigated by provisioning only needed roles + sign-in backoff;
  a very large suite from one IP may still approach it.
