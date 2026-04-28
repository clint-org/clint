# Whitelabel Agency Portal Implementation Plan

> Steps use checkbox (`- [ ]`) syntax.

**Goal:** Replace the `/admin` placeholder with the real agency-host UI: a self-serve portal where consultancy partners (agencies) provision pharma client tenants, edit branding, and manage agency members.

**Scope contract:**
- `/admin` continues to be gated by `agencyGuard` (kind === 'agency') + `authGuard`.
- All existing routes (`/t/:tenantId/*`, `/onboarding`, `/login`, `/auth/callback`, `/spaces`) remain untouched.
- Single-tenant pattern: agency owners do all writes; agency members get read-only.
- All RPCs already deployed (`provision_tenant`, `update_tenant_branding`, `update_agency_branding`, `check_subdomain_available`, etc.).

**Tech:** Angular 19 standalone, PrimeNG 19, Tailwind v4, signals.

---

## File structure

```
src/client/src/app/
  core/
    models/
      agency.model.ts                  [new]
    services/
      agency.service.ts                [new]
  features/
    agency/
      agency-shell.component.ts        [new — replaces placeholder]
      agency-tenant-list.component.ts  [new]
      agency-tenant-new.component.ts   [new]
      agency-tenant-detail.component.ts[new]
      agency-members.component.ts      [new]
      agency-branding.component.ts     [new]
      agency-placeholder.component.ts  [delete]
  app.routes.ts                        [modify — restructure /admin]
main.ts                                [modify — add ?wl_kind dev override]
supabase/migrations/
  20260428060000_agency_members_view.sql  [new — mirror tenant_members_view]
```

---

## Tasks

### Task 1: Plan + AgencyService + agency model + agency_members_view migration
- [ ] Create `agency.model.ts` with `Agency`, `AgencyMember`, `AgencyTenantSummary` interfaces
- [ ] Create `agency.service.ts` with all 13 methods listed in spec
- [ ] Create `20260428060000_agency_members_view.sql` mirroring `tenant_members_view`
- [ ] Run `supabase db reset` to verify migration applies
- [ ] `ng build` passes
- [ ] Commit `feat(agency): agency service + model + members view`

### Task 2: Agency shell + side nav + restructured routes
- [ ] Delete `agency-placeholder.component.ts`
- [ ] Create `agency-shell.component.ts` with topbar (brand display name + signout) + side nav (Tenants / Members / Branding) + `<router-outlet>`
- [ ] Restructure `/admin` parent route in `app.routes.ts`; mount shell + child routes
- [ ] `ng build` passes
- [ ] Commit `feat(agency): agency shell layout + restructured routes`

### Task 3: Tenant list page
- [ ] Create `agency-tenant-list.component.ts` with PrimeNG p-table
- [ ] Columns: logo, name, subdomain, member count, created_at, status (suspended badge)
- [ ] Row click → `/admin/tenants/:id`
- [ ] "Provision new tenant" button → `/admin/tenants/new`
- [ ] Commit `feat(agency): tenant list page`

### Task 4: Provisioning wizard
- [ ] Create `agency-tenant-new.component.ts`
- [ ] Form: name, subdomain (debounced live availability), primary color picker, first user email
- [ ] Submit → `provisionTenant`, optionally create `tenant_invites` row for first user
- [ ] Toast on success, redirect to tenant detail
- [ ] Commit `feat(agency): tenant provisioning wizard`

### Task 5: Tenant detail page
- [ ] Create `agency-tenant-detail.component.ts`
- [ ] Branding form (display name, logo URL, primary color, accent color, email_from_name) calling `updateTenantBranding`
- [ ] Read-only members list
- [ ] "Open tenant" button (cross-host redirect or /t/:id/spaces fallback in dev)
- [ ] Commit `feat(agency): tenant detail with branding edit`

### Task 6: Agency members page
- [ ] Create `agency-members.component.ts`
- [ ] PrimeNG p-table of agency members (email, role, joined)
- [ ] Add member dialog (email lookup TBD; simplest: existing-user-id input or by email if a lookup view exists). Since auth.users isn't queryable and we don't have an agency_invites table, do v1 with raw user_id input
- [ ] Remove member action (confirm)
- [ ] Commit `feat(agency): agency members management`

### Task 7: Agency branding page
- [ ] Create `agency-branding.component.ts`
- [ ] Form: display name, primary color, accent color, contact_email
- [ ] Submit → `updateAgencyBranding`
- [ ] Commit `feat(agency): agency branding edit`

### Task 8: Dev query-string brand override + smoke fixes
- [ ] Modify `main.ts`: when `!environment.production`, read `?wl_kind=agency&wl_id=<id>` and short-circuit `fetchBrand()` to a synthetic agency Brand
- [ ] Final lint + build
- [ ] Commit `feat(agency): dev query-string brand override for local agency portal smoke testing`

---

## Out of scope

- Agency invites (no `agency_invites` table exists). Adding members needs a user_id known to the agency owner (can be obtained via a separate user-lookup feature in a later plan).
- Tenant member promotion/demotion from agency portal (left to tenant settings).
- Cross-host tenant switcher.
- Custom-domain registration UX (platform-admin only RPC `register_custom_domain`).

## What ships when this plan merges

- Agency owners can list, provision, brand, and inspect their tenants from a self-serve UI at `/admin`.
- Agency owners can manage agency-level branding and member roster.
- All operations enforce existing RLS / RPC security boundaries.
- Dev override allows local smoke-testing without DNS/Netlify config.
