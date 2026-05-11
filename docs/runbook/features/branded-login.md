---
surface: Branded Login
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Branded Login

Single login component at `/login`, rendered on every host. Reads from `BrandContextService`:
- Logo + `app_display_name` headline ("Sign in to {{ brand.appDisplayName() }}")
- One button per provider in `brand.auth_providers` (Google, Microsoft)
- Self-join hint copy when `brand.has_self_join` is true ("Use your work email to join automatically")

The default-host login also surfaces a workspace hint when navigated to with `?workspace=<subdomain>` — used by the marketing landing's "Find your workspace" form.

## Authentication

See [Authentication & Security](08-authentication-security.md) for full details.

Google OAuth and Microsoft (Azure AD) OAuth via Supabase Auth. Users sign in with one of the providers exposed by their tenant's `brand.auth_providers`; no password management required. Cross-subdomain session is shared via cookies on the apex domain.

## Capabilities

```yaml
- id: branded-login-page
  summary: Single login component at /login on every host, branded via BrandContextService (logo, display name, provider buttons).
  routes:
    - /login
  rpcs:
    - get_brand_by_host
  tables:
    - tenants
    - agencies
  related:
    - whitelabel-dynamic-preset
  user_facing: true
  role: viewer
  status: active
- id: branded-login-workspace-hint
  summary: Default-host login surfaces a workspace hint when queried with workspace param, used by the marketing landing form.
  routes:
    - /login
  rpcs: []
  tables: []
  related:
    - marketing-landing-page
  user_facing: true
  role: viewer
  status: active
- id: auth-oauth-providers
  summary: Google and Microsoft OAuth via Supabase Auth, per-tenant provider list, no password management.
  routes:
    - /login
    - /auth/callback
  rpcs:
    - handle_new_user
  tables: []
  related:
    - branded-login-page
  user_facing: true
  role: viewer
  status: active
- id: auth-callback
  summary: OAuth callback completes sign-in, runs handle_new_user, and applies self-join when applicable.
  routes:
    - /auth/callback
  rpcs:
    - handle_new_user
    - self_join_tenant
  tables:
    - tenant_members
    - agency_members
  related:
    - self-join-tenant
  user_facing: true
  role: viewer
  status: active
- id: auth-cross-subdomain-session
  summary: Apex-cookie session storage so sign-in on apex carries across tenant subdomains.
  routes: []
  rpcs: []
  tables: []
  related:
    - auth-oauth-providers
  user_facing: false
  role: viewer
  status: active
```
