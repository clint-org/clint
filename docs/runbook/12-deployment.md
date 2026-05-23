# Deployment

[Back to index](README.md)

---

## Architecture

- **Frontend** -- Angular SPA deployed to Cloudflare (Workers + static-assets binding) as a static site. Wildcard `*.<apex>` and apex are served by a single Worker.
- **Backend** -- Supabase Cloud (managed PostgreSQL, Auth, PostgREST, Edge Functions)
- **Email** -- Resend (transactional)
- No server-side processes beyond one Edge Function (`send-invite-email`)

## Cloudflare Setup

The frontend is configured by `src/client/wrangler.jsonc`, which declares two environments in one file:

- **top-level** -- prod (`clint` Worker, Custom Domains `clintapp.com` + `*.clintapp.com`)
- **`[env.dev]`** -- dev (`clint-dev` Worker, Custom Domains `dev.clintapp.com` + `*.dev.clintapp.com`)

The dev block overrides `name`, `vars` (`ALLOWED_APEXES`, `R2_BUCKET`), `r2_buckets` (`MATERIALS_BUCKET` -> `clint-materials-dev`), rate-limiter `namespace_id`s (1003/1004 vs. prod 1001/1002), and disables the daily CT.gov cron (`triggers.crons: []`). Everything else (compatibility date, `assets`, `compatibility_flags`, the prod cron schedule) inherits from the top-level config.

```
# src/client/public/_headers (security headers, honored by static-assets on both Workers)
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co https://cloudflareinsights.com https://clinicaltrials.gov; script-src 'self' 'unsafe-inline' https://static.cloudflareinsights.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`not_found_handling: "single-page-application"` is the Worker-level catch-all that hands every unknown route back to `/index.html`. There is no `_redirects` file -- Cloudflare's docs explicitly reject the Netlify-style `/* /index.html 200` rewrite as recursive.

## Deploy flow (GHA-driven, atomic per env)

Cloudflare Workers Builds auto-deploys are **disabled**. Both environments deploy via GitHub Actions workflows that call `wrangler deploy` themselves using `CLOUDFLARE_API_TOKEN`. Each workflow is a single atomic job: `supabase db push` runs first; if it fails, `wrangler deploy` is skipped and the Worker stays on the previous build.

### Dev: push to `develop`

Triggers `.github/workflows/deploy-dev.yml`. No approval gate. Workflow steps:

1. `supabase link --project-ref $SUPABASE_DEV_PROJECT_REF`
2. `supabase db push` against the dev project
3. `cd src/client && npm ci`
4. `cd src/client && npm run build -- --configuration dev`
5. `wrangler deploy --env dev` via `cloudflare/wrangler-action@v3`

### Prod: merge `develop -> main`

Triggers `.github/workflows/deploy-prod.yml`. Gated by the `production` GitHub Environment, which requires reviewer approval before any step runs. The reviewer opens the run in Actions, reviews the migration diff and SHA, clicks "Approve and deploy". The workflow then runs the same shape as dev but against the prod project + prod Worker + `--configuration production` (the angular default).

### Destructive migrations (two-deploy pattern)

The atomic flow assumes additive migrations: SPA sees old-or-newer schema, never older. For destructive changes (dropping a column the current prod SPA still reads, renaming an RPC, etc.) there is still a window between the migration step and the wrangler deploy step where the new schema is live and the old SPA is still serving.

Pattern for destructive migrations:

1. **PR 1:** SPA change only. Remove all references to the soon-to-be-dropped column / renamed RPC. Merge, deploy. Prod SPA no longer touches the doomed surface.
2. **PR 2:** Migration only. Drop the column / rename. Merge, deploy.

Convention, not enforcement. When in doubt, split the PR.

### Emergency fallback

The Cloudflare Workers Build connection for the `clint` Worker is left in place, just with "Automatic deploys" turned off. If GHA is unavailable, re-enable auto-deploy on the dashboard as a one-click workaround. Don't forget to re-disable when GHA comes back.

The CSP is conservative -- loosen if a specific integration breaks (see [08-authentication-security.md](08-authentication-security.md) for the full policy and rationale).

## Whitelabel Infrastructure

The whitelabel rollout requires several pieces of external infrastructure to be set up before the platform can serve real customers. This is one-time pre-work.

### 1. Cloudflare zone + wildcard DNS + wildcard route

Cloudflare's free tier gives you wildcard subdomain SSL automatically (no Pro plan required, unlike Netlify). Routing requires three pieces in the Cloudflare dashboard:

- [ ] Add the apex zone (`yourproduct.com`) to your Cloudflare account; update the registrar's nameservers to Cloudflare's
- [ ] **DNS -> Records:** add an `A` record `name=*` pointing to `192.0.2.1` (RFC 5737 placeholder -- never used because the proxy intercepts), Proxy status = **Proxied** (orange cloud ON)
- [ ] **Workers & Pages -> `clint` worker -> Settings -> Domains & Routes:**
  - Add Custom domain `yourproduct.com` (apex)
  - Add Custom domain `www.yourproduct.com`
  - Add Route `*.yourproduct.com/*` mapped to the `clint` worker (wildcard custom domains are not supported in the Custom-domain UI; use a Route + the wildcard DNS record above)
- [ ] **Verify:** `curl -sI https://test-tenant-name.yourproduct.com/` returns 200 and the cert SAN list includes `*.yourproduct.com`

### 2. Resend account + sender domain

- [ ] Create a Resend account
- [ ] Add `yourproduct.com` (or a chosen sender subdomain) and verify DKIM + SPF DNS records
- [ ] Note the API key for the `send-invite-email` function secrets
- [ ] **Verify:** Resend dashboard shows the sender domain as "verified"

### 3. Microsoft Azure AD app registration

- [ ] In Azure Portal: **Azure AD > App registrations > New registration**
- [ ] Set the redirect URI to the Supabase callback (`https://<project-ref>.supabase.co/auth/v1/callback` for production, `http://localhost:54321/auth/v1/callback` for local)
- [ ] **Certificates & secrets:** create a client secret; note the value (only shown once)
- [ ] Note the Application (client) ID and Directory (tenant) ID
- [ ] **Verify:** the redirect URI is exactly the Supabase callback -- no per-host URIs

### 4. Supabase secrets (function + auth provider)

```bash
# Microsoft OAuth (referenced from supabase/config.toml)
supabase secrets set MICROSOFT_OAUTH_CLIENT_ID=<application-id>
supabase secrets set MICROSOFT_OAUTH_CLIENT_SECRET=<client-secret>
supabase secrets set MICROSOFT_OAUTH_TENANT_URL=https://login.microsoftonline.com/<tenant-id>/v2.0
# (or "common" for multi-tenant)

# send-invite-email Edge Function
supabase secrets set RESEND_API_KEY=re_...
supabase secrets set EMAIL_WEBHOOK_SECRET=$(openssl rand -hex 32)
supabase secrets set EMAIL_FROM=noreply@yourproduct.com
supabase secrets set EMAIL_BASE_URL=https://yourproduct.com
```

In production, mirror the Microsoft OAuth values via the Supabase Dashboard under **Authentication > Providers > Azure** so production environment uses them.

- [ ] **Verify:** `supabase secrets list` shows all six.

### 5. Single canonical OAuth callback

Both Google and Microsoft use the Supabase project's auth callback (`https://<project-ref>.supabase.co/auth/v1/callback`). Supabase then redirects to the app at the originating host. The callback validates the `state` parameter against `tenants.subdomain` and `agencies.subdomain` before redirecting (open-redirect prevention).

In **Supabase Dashboard > Authentication > URL Configuration:**

- [ ] Site URL: `https://www.yourproduct.com`
- [ ] Redirect URLs: add `https://yourproduct.com/auth/callback` AND `https://*.yourproduct.com/auth/callback` (the wildcard covers every tenant/agency/admin subdomain)
- [ ] **Verify:** sign in once on `pfizer.yourproduct.com`, you get bounced through the Supabase callback and back to `pfizer.yourproduct.com`. Forge an unknown `state` (e.g. `https://attacker.example/`) -- the callback redirects to apex login, not the attacker.

### 6. Environment configuration

In `src/client/src/environments/environment.ts` (production), set:

```typescript
export const environment: Environment = {
  production: true,
  envName: 'production',           // <-- 'production' | 'dev' | 'local'; controls env banner visibility
  supabaseUrl: 'https://<project-ref>.supabase.co',
  supabaseAnonKey: '<anon-key>',
  apexDomain: 'yourproduct.com',  // <-- enables cookie session storage on *.yourproduct.com
};
```

Bump `APP_VERSION` in `src/client/src/environments/version.ts` alongside `package.json` when cutting a release. The version is shown in the account menu (all environments) and in the env banner (non-prod).

`apexDomain: ''` in dev keeps the localStorage path. With `apexDomain` set, Supabase JS uses `Domain=.yourproduct.com` cookies on apex hosts and falls back to localStorage on custom domains (which are a separate trust boundary).

### 7. Cloudflare Worker (R2 materials)

The materials Worker is bundled into the same Cloudflare Worker as the Angular SPA (entry point `src/client/worker/index.ts`). It is deployed automatically via the Cloudflare Workers Builds pipeline on every push to `main`. The following one-time setup is required before the first deploy.

**Create the R2 bucket:**

```bash
npx wrangler r2 bucket create clint-materials
```

**Configure R2 CORS** (allows the Angular client to PUT directly from the browser):

```bash
# Create a file cors.json with your allowed origins, then:
npx wrangler r2 bucket cors put clint-materials --rules cors.json
```

The CORS policy must allow `PUT` and `GET` from the same origin set as `ALLOWED_APEXES` in the Worker config. A minimal rule allows `PUT` from `https://*.yourproduct.com` and `https://yourproduct.com` for the content types used by materials uploads.

**Set Worker secrets** via `wrangler secret put`:

```bash
npx wrangler secret put SUPABASE_URL
npx wrangler secret put SUPABASE_ANON_KEY
npx wrangler secret put R2_ACCOUNT_ID
npx wrangler secret put R2_ACCESS_KEY_ID
npx wrangler secret put R2_SECRET_ACCESS_KEY
```

`R2_ACCOUNT_ID` is the Cloudflare account ID (found in the Workers dashboard). `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are an R2-scoped API token pair created at **Cloudflare Dashboard > R2 > Manage R2 API Tokens** with "Object Read and Write" permission on the `clint-materials` bucket.

**Rate-limit namespaces:** The Worker uses two Workers Rate Limiting namespaces (one for upload, one for download). Create them in **Cloudflare Dashboard > Workers > Rate Limiting**. Copy the numeric namespace IDs into `src/client/wrangler.jsonc` replacing the `<UPLOAD_NAMESPACE_ID>` and `<DOWNLOAD_NAMESPACE_ID>` placeholders before deploying.

- [ ] **Verify:** `npx wrangler r2 bucket list` shows `clint-materials`. `npx wrangler secret list` shows all five secrets. The namespace IDs in `wrangler.jsonc` are numeric (not placeholder strings).

### 8. Deploy the Edge Function

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase functions deploy send-invite-email
```

The function ships a Deno-runtime handler under `supabase/functions/send-invite-email/index.ts`. URL imports only -- no `npm install` step.

- [ ] **Verify:** `supabase functions list` shows `send-invite-email` as `ACTIVE`.

### 9. Configure the database webhook

In **Supabase Dashboard > Database > Webhooks** (this cannot be expressed in `config.toml`):

- [ ] Create a webhook on `public.tenant_invites` for `INSERT` events
- [ ] Set the URL to `https://<project-ref>.supabase.co/functions/v1/send-invite-email`
- [ ] Add HTTP header: `webhook-signature: <same value as EMAIL_WEBHOOK_SECRET>`
- [ ] **Verify:** issue a test invite from the agency portal; check Resend dashboard for delivery and recipient inbox for the branded email. Forged calls without the header should return 401.

### 10. Bootstrap the first platform admin

`platform_admins` has no UI. After signing in once via the deployed app, find your `auth.uid()`:

```sql
SELECT id, email FROM auth.users WHERE email = 'you@yourproduct.com';
```

Then via the Supabase SQL editor or `psql`:

```sql
INSERT INTO public.platform_admins (user_id) VALUES ('<your-uuid>');
```

Once inserted, you can navigate to the super-admin host (`https://admin.<apex>`) and provision agencies through the UI. The `get_brand_by_host` RPC recognizes the reserved `admin.*` subdomain and returns `kind: "super-admin"` so the guard lets you in.

- [ ] **Verify:** `https://admin.yourproduct.com/super-admin/agencies` loads (instead of redirecting away).

### 11. Provision the first agency

From psql, before the super-admin UI is wired (or as a smoke test of the RPC):

```sql
SELECT public.provision_agency(
  p_name             => 'ZS Associates',
  p_slug             => 'zs',
  p_subdomain        => 'zs',
  p_owner_email      => 'owner@zs.com'
);
```

If the owner has signed in to the platform before, they're inserted directly into `agency_members` with role `owner` (returns `owner_invited: false`). Otherwise an `agency_invites` row is held; the owner's first Google OAuth sign-in fires `handle_new_user`, which promotes the invite to an `agency_members` row silently (returns `owner_invited: true`). After this, the agency owner can sign in at `https://zs.yourproduct.com`, land on `/admin/tenants`, and provision pharma client tenants self-serve.

### 12. Provisioning a custom domain (manual ops checklist, sales-led)

Custom domains are sales-led. There's no self-serve path. When a customer requests `competitive.pfizer.com`:

1. **Customer side:** add a `CNAME` from `competitive.pfizer.com` pointing at the `clint` worker's `workers.dev` hostname (e.g. `clint.<account>.workers.dev`)
2. **Ops side, Cloudflare Workers & Pages -> `clint` worker -> Settings -> Domains & Routes:** add `competitive.pfizer.com` as a Custom domain. Cloudflare will validate the CNAME and provision a Let's Encrypt cert (takes a few minutes; the customer's zone does NOT need to be on your Cloudflare account)
3. **Ops side, super-admin portal:** at `/super-admin/tenants`, find the tenant and use the "Register custom domain" dialog. This calls `register_custom_domain(p_tenant_id, p_custom_domain)` which validates uniqueness across `tenants.custom_domain` and `agencies.custom_domain` plus the retired-hostname holdback
4. **Verify:** `curl -sI https://competitive.pfizer.com/` returns 200; `get_brand_by_host('competitive.pfizer.com')` returns the right tenant's brand
5. **Note:** custom domains do NOT share the apex session cookie. Users sign in fresh on the custom domain

## CT.gov sync

The trial change feed runs from the same Cloudflare Worker as the SPA via a `scheduled()` export.

**Cron schedule.** `0 7 * * *` (07:00 UTC daily) defined in `src/client/wrangler.jsonc` under `triggers.crons`. One run per day pulls fresh CT.gov payloads for every trial whose watermark indicates a change.

**Wrangler vars** (committed in `wrangler.jsonc`):

- `CTGOV_BASE_URL`: `https://clinicaltrials.gov`
- `CTGOV_BATCH_SIZE`: number of trials per polling batch
- `CTGOV_PARALLEL_FETCHES`: concurrency cap on outbound CT.gov fetches

**Worker secret** (set via `wrangler secret put`, never committed):

```bash
npx wrangler secret put CTGOV_WORKER_SECRET
```

The same value must exist in `vault.secrets` named `ctgov_worker_secret` so `_verify_ctgov_worker_secret()` can match it. See [08-authentication-security.md](08-authentication-security.md#worker-secret-model) for the rotation playbook.

**Initial deploy and backfill.** Use the manual admin endpoint to seed the snapshot store before the first scheduled run:

```bash
curl -X POST https://yourproduct.com/admin/ctgov-backfill \
  -H "Authorization: Bearer <platform-admin-jwt>" \
  -H "content-type: application/json" \
  -d '{"nct_ids":["NCT01234567","NCT07654321"]}'
```

Gated by `is_platform_admin()` on the JWT. Same code path as scheduled mode.

**Monitoring.** Each cron invocation writes one row to `ctgov_sync_runs`:

```sql
select * from public.ctgov_sync_runs order by started_at desc limit 10;
```

`status` is `success | partial | failed`. The engagement landing surfaces the latest row via `get_latest_sync_run()` so analysts can see freshness without database access.

## Build Output

The Angular build produces static files in `src/client/dist/clinical-trial-dashboard/browser/`. Cloudflare's Worker static-assets binding (configured in `wrangler.jsonc`) serves these from the global edge. No SSR is configured -- this is a pure client-side SPA. The `public/` directory contents (favicon, `_headers`) are copied into the dist by the Angular build's `assets` entry in `angular.json`.

## Deploying Schema Changes

```bash
# Push local migrations to remote Supabase project
supabase db push
```

Migrations are applied in timestamp order. This is the only supported way to make schema changes -- never modify the database directly via the Supabase dashboard.

If a local migration's timestamp is older than the latest applied remote migration (e.g. you authored it earlier and other migrations were applied to remote in the meantime), Supabase will refuse with a "Found local migration files to be inserted before the last migration on remote database" message. Use `supabase db push --include-all` after confirming the migration is idempotent (e.g. `create or replace function`) or otherwise safe to apply out of order.

For fresh databases or reset to migration state: `supabase db reset` (local only).

## Rollback

Database rollbacks require creating a new down-migration (reverse SQL). There is no automated rollback -- follow the convention: "never edit existing migrations, always add new ones."

## Demo Data

Demo data is populated explicitly per space via the URL `/t/:tenantId/s/:spaceId/seed-demo`. The route mounts `SeedDemoComponent`, which calls `seed_demo_data(p_space_id)` and redirects to the catalysts page on success. The RPC requires the caller to hold a `space_members` row with `role='owner'` for the target space, or be a platform admin; tenant ownership alone is not sufficient. Idempotent: re-hitting the URL on a populated space returns early without re-inserting. The fixture covers 8 real pharma companies (with logo URLs), 20 assets across 4 therapeutic areas, 26 trials in every development phase, 55+ markers, 12 trial notes, 20 events with threads and sources, 5 published primary intelligence reads plus 2 drafts (with cross-entity links), and 3 materials (briefing PPTX, priority notice PDF, ad hoc DOCX) with multi-entity links. Material rows reference plausible storage paths but do not upload actual files; demo download flows 404 cleanly.

Historically (pre-2026-04-30) the platform exposed three demo paths that fired automatically: the `handle_new_user` trigger auto-provisioned Boehringer/Azurity tenants on signup (retired in migration 41); `provision_demo_workspace()` did the same on demand via `/provision-demo` (dropped in migration 78); and `seed_demo_data(p_space_id)` was called by `landscape-state.service` whenever a space had zero companies (briefly dropped in migration 81, restored gated in migration 82). All three auto-paths were vestiges of the pre-firewall era; the URL-triggered, owner-gated flow is the current canonical entry point.
