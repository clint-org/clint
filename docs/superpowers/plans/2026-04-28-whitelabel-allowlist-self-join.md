# Whitelabel Allowlist + Self-Join Implementation Plan

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Ship the user-facing half of the email-domain self-join feature
(Units 10-11 of the whitelabel rollout): tenant-settings UI for the
`email_domain_allowlist` and `email_self_join_enabled` fields, plus the
post-OAuth flow that auto-calls `self_join_tenant` when a user lands on a
tenant subdomain whose brand exposes `has_self_join`.

**Scope contract:**
- All RPCs (`get_tenant_access_settings`, `update_tenant_access`,
  `self_join_tenant`, `get_brand_by_host`) are already deployed and validated
  server-side. The client surfaces them; it does not re-implement the rules.
- `BrandContext.hasSelfJoin()` is already populated from `get_brand_by_host`.
- Tenant-settings access section renders only when the current user is a
  tenant owner (matching the existing `currentUserIsOwner` check). Agency
  owners and platform admins can also call the RPCs but in v1 they edit
  through their own portals; the tenant-settings page is owner-gated.
- Generic error from `self_join_tenant` is surfaced to the login screen via
  `sessionStorage` (no enumeration leak).

**Tech:** Angular 19 standalone, PrimeNG 19 (`p-checkbox`, `pInputText`),
Tailwind v4, signals.

---

## File structure

```
src/client/src/app/
  core/services/
    tenant.service.ts                          [modify — add 4 methods]
  features/
    tenant-settings/
      tenant-settings.component.ts             [modify — add Access section]
    auth/
      auth-callback.component.ts               [modify — self-join attempt]
      login.component.ts                       [modify — read sessionStorage error]
docs/superpowers/plans/
  2026-04-28-whitelabel-allowlist-self-join.md [this file]
```

---

## Tasks

### Task 1: Plan + TenantService methods
- [ ] Create this plan file
- [ ] Add `getTenantAccessSettings`, `updateTenantAccess`, `selfJoinTenant`,
      `checkIsTenantMember` to `TenantService`
- [ ] Commit `feat(tenant): plan + access-settings + self-join service methods`

### Task 2: Tenant-settings Access section
- [ ] Add an "Access" section after Members in `tenant-settings.component.ts`
- [ ] Render only when `currentUserIsOwner()` is true
- [ ] Toggle: "Allow employees to self-join this workspace" (`p-checkbox` binary)
- [ ] When enabled, render a chip-style domain editor (input + add button + chip list)
- [ ] Client-side validate each domain against `^[a-z0-9.-]+\.[a-z]{2,}$`
- [ ] "Save access settings" button calls `updateTenantAccess`
- [ ] Toasts on success/failure; inline error for invalid domain
- [ ] Load current settings via `getTenantAccessSettings` on init
- [ ] Commit `feat(tenant-settings): access section with allowlist + self-join toggle`

### Task 3: Self-join attempt in auth-callback
- [ ] In `redirectAfterSignIn`, when `kind === 'tenant'` and
      `brand.hasSelfJoin()`, call `selfJoinTenant(subdomain)` before navigating
- [ ] On failure: stash generic message in `sessionStorage`, sign out, route to `/login`
- [ ] Subdomain derived from `window.location.host.split('.')[0]`
- [ ] Commit `feat(auth-callback): attempt self-join on tenant subdomain when enabled`

### Task 4: Login screen reads sessionStorage error
- [ ] In `LoginComponent.ngOnInit`, read `sessionStorage.getItem('login_error')`,
      set `error.set(msg)` and clear the storage entry
- [ ] Commit `feat(login): surface self-join failure message from sessionStorage`

### Task 5: Final lint + build
- [ ] `cd src/client && ng lint && ng build`
- [ ] Manual smoke (best-effort given dev-host limits):
      enable self-join + add `pfizer.com` to allowlist; sign in fresh
      `@pfizer.com` user → becomes a `member` row.

---

## Out of scope

- Editing access settings from the agency portal or super-admin portal (RPCs
  permit it, but UI surfaces are separate plans).
- Per-domain wildcard or sub-domain matching (allowlist is exact match,
  case-insensitive on the server).
- Suspending self-join when the tenant is suspended -- the RPC already
  returns the generic error in that case.
- Custom-domain provisioning UI for tenants -- that's already shipped in the
  super-admin portal.

## What ships when this plan merges

- Tenant owners can enable/disable self-join and curate the allowed email
  domain list from the tenant-settings page.
- Users signing in to a tenant subdomain whose tenant has self-join enabled
  and whose email domain is allowlisted are auto-added at `member` role.
- Users whose self-join attempt fails for any reason land back on the login
  screen with a single generic error message.
