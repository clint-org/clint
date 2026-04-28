# Whitelabel Unit 5: Microsoft (Azure) OAuth + Branded Login

**Date:** 2026-04-28
**Branch:** `feature/whitelabel-auth-login`
**Depends on:** Units 1-4 (schema, theme/brand context, routing/cookies/CSP)

## Goal

Add Microsoft (Azure) OAuth as a second auth provider alongside Google, and rebuild the login screen to be brand-aware — pulling logo, app display name, allowed providers, and self-join hint from `BrandContextService`.

## Scope

### Code

1. `src/client/src/app/core/services/supabase.service.ts`
   - Add `signInWithMicrosoft()` mirroring `signInWithGoogle()`. Uses `provider: 'azure'`, scopes `email openid profile`, redirects to `/auth/callback`.

2. `supabase/config.toml`
   - Add `[auth.external.azure]` block with env-var-driven client id, secret, and tenant URL.

3. `src/client/src/app/features/auth/login.component.ts`
   - Replace hard-coded "Clinical trial intelligence" + Clint logo + Google button with brand-driven version:
     - Logo: `brand.logoUrl()` (img) when set, else `<app-clint-logo>` fallback.
     - Headline: `Sign in to {{ brand.appDisplayName() }}`.
     - Provider buttons: iterate `brand.authProviders()`, switch on `'google'` / `'microsoft'`.
     - Self-join hint: when `brand.hasSelfJoin()` is true, show "Use your work email to join automatically." (no domain reveal).
   - Loading state typed as provider name (`'google' | 'microsoft' | null`) so the right button shows the spinner.
   - Error display preserved.

### Behavior on default host

`DEFAULT_BRAND.auth_providers = ['google']` — only Google button renders in dev. Microsoft only appears on tenant subdomains where `get_brand_by_host` returns it.

## Azure pre-work (manual, user-side)

Before Microsoft sign-in works in any environment:

1. Register a new app in Azure Portal: **Azure AD > App registrations > New registration**.
2. Set redirect URI to the Supabase callback: `https://<project-ref>.supabase.co/auth/v1/callback` (production) and `http://localhost:54321/auth/v1/callback` (local).
3. Under **Certificates & secrets**, create a client secret. Note the value (only shown once).
4. Note the Application (client) ID and Directory (tenant) ID.
5. Populate env vars consumed by `config.toml`:
   - `MICROSOFT_OAUTH_CLIENT_ID` = Application (client) ID
   - `MICROSOFT_OAUTH_CLIENT_SECRET` = client secret value
   - `MICROSOFT_OAUTH_TENANT_URL` = `https://login.microsoftonline.com/<tenant-id>/v2.0` (or `common` for multi-tenant)
6. For production, mirror the same secrets in the Supabase Dashboard under Authentication > Providers > Azure.

## Tasks

1. Plan file (this).
2. `signInWithMicrosoft()` in `SupabaseService`.
3. `[auth.external.azure]` block in `config.toml`.
4. Brand-driven `login.component.ts`.
5. `ng lint` + `ng build` verification.

One commit per task.

## Verification

- `ng build` succeeds.
- `ng lint` clean (or pre-existing only).
- On default host (localhost), only the Google button renders and works as before.
- On a tenant subdomain (where brand returns `['google', 'microsoft']`), both buttons render. Microsoft sign-in requires the Azure pre-work above.

## Out of scope

- Tenant/agency-specific provider restrictions beyond the `auth_providers` array.
- Email/password fallback.
- Provider-specific group/role mapping.
