# Deployment

[Back to index](README.md)

---

## Architecture

- **Frontend** -- Angular SPA deployed to Cloudflare (Workers + static-assets binding) as a static site. Wildcard `*.<apex>` and apex are served by a single Worker.
- **Backend** -- Supabase Cloud (managed PostgreSQL, Auth, PostgREST, Edge Functions)
- **Email** -- Resend (transactional)
- No server-side processes beyond one Edge Function (`send-invite-email`)

## Cloudflare Setup

The frontend is configured by a small set of files in `src/client/`:

```jsonc
// src/client/wrangler.jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "clint",
  "compatibility_date": "2026-04-28",
  "assets": {
    "directory": "./dist/clinical-trial-dashboard/browser",
    "not_found_handling": "single-page-application"
  }
}
```

```
# src/client/public/_headers (security headers, honored by static-assets)
/*
  X-Frame-Options: DENY
  X-Content-Type-Options: nosniff
  Referrer-Policy: strict-origin-when-cross-origin
  Content-Security-Policy: default-src 'self'; connect-src 'self' https://*.supabase.co wss://*.supabase.co; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: https: blob:; frame-ancestors 'none'; base-uri 'self'; form-action 'self'
```

`not_found_handling: "single-page-application"` is the Worker-level catch-all that hands every unknown route back to `/index.html`. There is no `_redirects` file -- Cloudflare's docs explicitly reject the Netlify-style `/* /index.html 200` rewrite as recursive.

The Cloudflare Workers Builds dashboard wires the build:

| Setting | Value |
|---|---|
| Root directory | `src/client` |
| Build command | `node scripts/set-env.js && npm ci && npx ng build --configuration production` |
| Deploy command | `npx wrangler deploy` |
| Non-production branch deploy command | `npx wrangler versions upload` |
| Env var: `NODE_VERSION` | `20` |

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
export const environment = {
  production: true,
  supabaseUrl: 'https://<project-ref>.supabase.co',
  supabaseAnonKey: '<anon-key>',
  apexDomain: 'yourproduct.com',  // <-- enables cookie session storage on *.yourproduct.com
};
```

`apexDomain: ''` in dev keeps the localStorage path. With `apexDomain` set, Supabase JS uses `Domain=.yourproduct.com` cookies on apex hosts and falls back to localStorage on custom domains (which are a separate trust boundary).

### 7. Deploy the Edge Function

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase functions deploy send-invite-email
```

The function ships a Deno-runtime handler under `supabase/functions/send-invite-email/index.ts`. URL imports only -- no `npm install` step.

- [ ] **Verify:** `supabase functions list` shows `send-invite-email` as `ACTIVE`.

### 8. Configure the database webhook

In **Supabase Dashboard > Database > Webhooks** (this cannot be expressed in `config.toml`):

- [ ] Create a webhook on `public.tenant_invites` for `INSERT` events
- [ ] Set the URL to `https://<project-ref>.supabase.co/functions/v1/send-invite-email`
- [ ] Add HTTP header: `webhook-signature: <same value as EMAIL_WEBHOOK_SECRET>`
- [ ] **Verify:** issue a test invite from the agency portal; check Resend dashboard for delivery and recipient inbox for the branded email. Forged calls without the header should return 401.

### 9. Bootstrap the first platform admin

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

### 10. Provision the first agency

From psql, before the super-admin UI is wired (or as a smoke test of the RPC):

```sql
SELECT public.provision_agency(
  p_name             => 'ZS Associates',
  p_slug             => 'zs',
  p_subdomain        => 'zs',
  p_owner_user_id    => '<owner-auth-uid>'
);
```

After this, the agency owner can sign in at `https://zs.yourproduct.com`, land on `/admin/tenants`, and provision pharma client tenants self-serve.

### 11. Provisioning a custom domain (manual ops checklist, sales-led)

Custom domains are sales-led. There's no self-serve path. When a customer requests `competitive.pfizer.com`:

1. **Customer side:** add a `CNAME` from `competitive.pfizer.com` pointing at the `clint` worker's `workers.dev` hostname (e.g. `clint.<account>.workers.dev`)
2. **Ops side, Cloudflare Workers & Pages -> `clint` worker -> Settings -> Domains & Routes:** add `competitive.pfizer.com` as a Custom domain. Cloudflare will validate the CNAME and provision a Let's Encrypt cert (takes a few minutes; the customer's zone does NOT need to be on your Cloudflare account)
3. **Ops side, super-admin portal:** at `/super-admin/tenants`, find the tenant and use the "Register custom domain" dialog. This calls `register_custom_domain(p_tenant_id, p_custom_domain)` which validates uniqueness across `tenants.custom_domain` and `agencies.custom_domain` plus the retired-hostname holdback
4. **Verify:** `curl -sI https://competitive.pfizer.com/` returns 200; `get_brand_by_host('competitive.pfizer.com')` returns the right tenant's brand
5. **Note:** custom domains do NOT share the apex session cookie. Users sign in fresh on the custom domain

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

The pharma demo data was previously seeded via the `handle_new_user` trigger; that trigger was retired in migration 41 (its body is now a no-op). For new signups, the `provision_demo_workspace()` SECURITY DEFINER RPC creates Boehringer Ingelheim + Azurity Pharmaceuticals on demand for the calling user (idempotent). The frontend exposes this via the `/provision-demo` route. For existing tenants, `seed_demo_data(p_space_id)` populates a space with sample companies, products, and trials.
