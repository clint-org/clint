# Dev e2e regression suite

Whole-app Playwright regression suite that runs against the **deployed dev stack**
(`*.dev.clintapp.com`), not local. It exercises the real Cloudflare edge, real
auth + cross-subdomain cookies, real workers, and whitelabel-by-host branding,
so it catches integration regressions a local suite can't. This is distinct from
the local `e2e/` suite (localhost + `supabase db reset`) and the `integration/`
suite (RPC/RLS/triggers).

> Not a PR gate. It depends on a deployed env + live DB + (for some specs)
> external services. Run it after a dev deploy and on demand.

## How to run

```bash
cd src/client
./e2e-dev/run.sh                              # full suite
./e2e-dev/run.sh e2e-dev/tests/smoke.spec.ts  # one file
./e2e-dev/run.sh --grep @firewall             # by tag
```

`run.sh` wraps Playwright in `infisical run --env dev --path /supabase`, which
injects the **only required secret**: `SUPABASE_DEV_DB_POOLER_URL` (write-capable
Postgres). The dev Supabase URL + anon key are public (they ship in
`environment.dev.ts`). No service-role key or JWT secret is needed.

**Runs HEADED.** Headless never clears the Cloudflare managed challenge; real
headed Chrome auto-solves it in a few seconds. Do not set `PWDEV_HEADLESS=1`
unless the environment has a Cloudflare WAF bypass.

Prereqs: Google Chrome installed (the suite uses `channel: 'chrome'`), the
Infisical CLI authenticated (`infisical login`), and `npm ci` already run.

## Data isolation (no db reset)

Each test provisions a throwaway **agency -> tenant -> space** via the real
`provision_*` / `create_space` RPCs, plus the role users it needs, then tears
everything down via the pooler in `afterEach`/`afterAll` (even on failure).
Scratch entities use the reserved-safe `pwreg-<shortid>` prefix. Because every
run owns its own tenant, tests are isolated from real dev data and from parallel
runs without any reset.

## Auth (pooler-only, no Google login)

1. A user is created by direct SQL into `auth.users` + `auth.identities` via the
   write-capable pooler (the token columns are set to `''` or GoTrue 500s; email
   is pre-confirmed).
2. `signInWithPassword` with the public anon key returns a **real GoTrue session**.
3. The session is injected as the `sb-auth-dev` cookie (`Domain=.dev.clintapp.com`),
   which the app reads because the scratch host is `*.dev.clintapp.com` (apex
   cookie storage). No Google OAuth, no service-role key, no JWT minting.

GoTrue rate-limits auth per IP, so worlds provision **only the roles a spec
needs** (default: owner; the firewall spec opts into all four) and sign-in retries
with backoff.

## Layout

```
playwright.dev.config.ts      headed, chrome channel, Cloudflare fingerprint, no webServer
e2e-dev/
  run.sh                      infisical wrapper
  global-setup.ts             preflight: pooler + dev schema + GoTrue reachable
  fixtures.ts                 test.extend: world + pageAs(role) + gotoSettled; openAs/settle/apiAs
  helpers/
    dev-env.ts                public constants + the one required secret
    scratch-world.ts          provision agency/tenant/space + role users + teardown
    auth-cookie.ts            sb-auth-dev cookie builder
    seed.ts                   seedBasics(): company -> asset -> Phase 3 trial -> event
  tests/                      one spec per surface (see docs/notes/dev-regression-suite.md)
```

## Tags

Verified green: `@smoke @firewall @nav @landscape @intelligence @help @anon @seeded
@crud @taxonomy @export @contract @adversarial @security`. The `@contract` test
(`rpc-contract.spec.ts`) is pooler-only (no browser) and asserts every client `.rpc()`
call resolves against the deployed signature -- run it first; it is the fastest
regression net and catches the client↔DB PGRST202 class.

Scaffolds (`test.fixme`, authored + harness-ready) pending a verification pass:
`entity-crud-events` (`@crud @event` -- edit half blocked by the live `update_event`
bug), `ai-import`/`ai-usage` (`@external`, live AI), `admin-portals` (`@admin`,
agency + `admin.dev.clintapp.com` super-admin hosts). See the Phase 2 section of
`docs/notes/dev-regression-suite.md`.
