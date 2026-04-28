# Whitelabel Super-Admin Portal Implementation Plan

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `/super-admin` placeholder with the real super-admin
portal: the platform owner's UI for provisioning agencies, registering custom
domains for tenants, and supervising the install (retired hostnames, full
agency/tenant directory).

**Scope contract:**
- `/super-admin` continues to be gated by `superAdminGuard` (kind === 'super-admin') + `authGuard`.
- All existing routes (`/admin/*`, `/t/:tenantId/*`, etc.) remain untouched.
- Single shell pattern mirrors the agency portal: topbar + side nav + child outlets.
- All RPCs already deployed (`provision_agency`, `register_custom_domain`, `check_subdomain_available`).
- Direct SELECTs on `agencies`, `tenants`, and `retired_hostnames` are gated by RLS to platform admins via `is_platform_admin()`.

**Bootstrap:** A user becomes a platform admin via `INSERT INTO platform_admins (user_id) VALUES ('<uuid>')` in psql against the Supabase database. After insert, the host RPC `get_brand_by_host` does NOT auto-elevate; the dev override `?wl_kind=super-admin` is the local entry point. In production, the super-admin host (e.g. `super.<apex>`) should resolve to a `super-admin` brand via the host->brand mapping.

**Tech:** Angular 19 standalone, PrimeNG 19, Tailwind v4, signals.

---

## File structure

```
src/client/src/app/
  core/
    services/
      super-admin.service.ts                 [new]
  features/
    super-admin/
      super-admin-shell.component.ts         [new — replaces placeholder]
      super-admin-agencies.component.ts      [new]
      super-admin-tenants.component.ts       [new]
      super-admin-domains.component.ts       [new]
      super-admin-placeholder.component.ts   [delete]
  app.routes.ts                              [modify — restructure /super-admin]
main.ts                                      [no change — already supports wl_kind=super-admin]
docs/superpowers/plans/
  2026-04-28-whitelabel-super-admin.md       [this file]
```

---

## Tasks

### Task 1: Plan + SuperAdminService + verify dev override
- [ ] Create this plan file
- [ ] Create `super-admin.service.ts` with `listAllAgencies`, `listAllTenants`, `listRetiredHostnames`, `provisionAgency`, `registerCustomDomain`, `checkSubdomainAvailable`, `lookupUserByEmail` (caveat-noted)
- [ ] Confirm `main.ts` already accepts `?wl_kind=super-admin` (no changes needed)
- [ ] Commit `feat(super-admin): plan + super-admin service`

### Task 2: Super-admin shell + side nav + restructured routes
- [ ] Delete `super-admin-placeholder.component.ts`
- [ ] Create `super-admin-shell.component.ts` with topbar (Super-admin badge + signout) + side nav (Agencies / Tenants / Domains)
- [ ] Restructure `/super-admin` parent route in `app.routes.ts`; mount shell + child routes (default → /agencies)
- [ ] Commit `feat(super-admin): shell layout + restructured routes`

### Task 3: Agencies page + provision-agency dialog
- [ ] Create `super-admin-agencies.component.ts` with PrimeNG p-table
- [ ] Columns: name, slug, subdomain, plan_tier, max_tenants, tenant_count, created_at
- [ ] "Provision agency" button opens p-dialog with form (name, slug, subdomain w/ live availability, owner_user_id uuid input, contact_email)
- [ ] Submit calls `provisionAgency`; toast on success; refresh list
- [ ] Commit `feat(super-admin): agencies page + provision-agency dialog`

### Task 4: Tenants page + register-domain dialog
- [ ] Create `super-admin-tenants.component.ts` with PrimeNG p-table
- [ ] Columns: name, agency, subdomain, custom_domain, suspended_at, created_at
- [ ] Filter by agency (Select)
- [ ] Row click opens p-dialog tenant detail with "Register custom domain" form
- [ ] Submit calls `registerCustomDomain`; toast on success; refresh list
- [ ] Commit `feat(super-admin): tenants page + register-domain dialog`

### Task 5: Retired-hostnames page
- [ ] Create `super-admin-domains.component.ts` with PrimeNG p-table
- [ ] Columns: hostname, retired_at, released_at, previous_kind, previous_id (read-only)
- [ ] Filter to active holds (`released_at > now()`) by default; toggle to show all
- [ ] Commit `feat(super-admin): retired hostnames page`

### Task 6: Final lint + build
- [ ] `cd src/client && ng lint && ng build`
- [ ] Manual smoke (if a platform-admin row exists): `/super-admin?wl_kind=super-admin` lists agencies, tenants, retired hostnames

---

## Out of scope

- Agency/tenant editing (use the agency portal).
- Removing custom domains (no RPC yet).
- Email-based user lookup: `auth.users` is not exposed via PostgREST. v1 takes a raw uuid in the provision-agency dialog with a clear caveat/help text. Future plan: add a `lookup_user_by_email` SECURITY DEFINER RPC that platform admins can call.
- Suspending tenants from this UI.
- Bulk operations.

## What ships when this plan merges

- Platform admins can provision new agencies (with first-owner assignment) from `/super-admin/agencies`.
- Platform admins can register a custom domain for any tenant from `/super-admin/tenants`.
- Platform admins can audit the retired-hostnames hold list at `/super-admin/domains`.
- Dev override `?wl_kind=super-admin` allows local smoke testing.
