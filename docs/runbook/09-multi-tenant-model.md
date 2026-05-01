# Multi-Tenant Model

[Back to index](README.md)

---

## Hierarchy

```
Agency (Consultancy partner; optional)            e.g. ZS Associates -> zs.yourproduct.com
  +-- email_domain (optional lock; gates agency + tenant owner adds)
  +-- AgencyMembers (role: owner only)
  +-- Tenants (Pharma client organizations)        e.g. Pfizer -> pfizer.yourproduct.com
        +-- TenantMembers (role: owner only -- agency-domain emails)
        +-- TenantInvites (code-based, role=owner; consumed by accept_invite)
        +-- Spaces (Engagements / pipeline projects)
              +-- SpaceMembers (role: owner | editor | viewer; ANY email)
              +-- SpaceInvites (code-based; consumed by accept_space_invite)
              +-- Data (companies, products, trials, ...)
```

`tenants.agency_id` is nullable. Direct customers (no agency) live on the apex (`yourproduct.com`) or claim their own subdomain via tenant settings; they keep working unchanged from the pre-whitelabel design.

A user can be an owner of multiple agencies AND multiple tenants directly.

## Roles & Permissions

| Role | Scope | Can Do |
|---|---|---|
| Agency Owner | Agency | Provision tenants, edit agency branding (incl. email_domain lock), add other agency owners, edit tenant branding, add tenant owners. Does NOT see space data unless explicitly added to a space. |
| Tenant Owner | Tenant | Rename tenant, manage other tenant owners, create spaces, delete tenant (direct customers only). Does NOT see space data unless explicitly added to a space. |
| Space Owner | Space | Full CRUD on space data, manage space members + invites, change member roles |
| Space Editor (Contributor in UI) | Space | Create/edit/delete data within the space |
| Space Viewer (Reader in UI) | Space | Read-only access to space data |
| Platform Admin | Global | Cross-cutting read access; writes only via super-admin RPCs; bypasses agency.email_domain enforcement |

`tenant_members.role` and `agency_members.role` are both constrained to `owner` only -- non-owner roles at those levels carry no surface area in the product. Space-level access uses the three-tier `owner | editor | viewer` (rendered as Owner / Contributor / Reader in the UI).

**Authority cascade was removed in migration 75.** Tenant owners and agency owners get NO implicit space access. Data visibility is space-scoped, period. To see a tenant's catalysts, you must hold a `space_members` row for the relevant space -- being a tenant or agency owner is not enough. This protects firewalled engagements: a Stout consultant on the Pfizer engagement does not see Boehringer's data just because Stout owns both tenants.

**Tenant clients cannot evict their parent agency from their own tenant (migration 85).** `is_tenant_member()` has three disjuncts (explicit `tenant_members` row OR agency owner of parent OR platform admin); the `enforce_tenant_member_guards` trigger raises `42501` when a non-platform-admin tries to DELETE a `tenant_members` row whose user is also an owner of the tenant's parent agency. Detaching a tenant from its agency is a contractual matter and goes through a platform admin. The tenant-settings UI hides the row-actions menu and shows a "via agency" tag for these rows, surfaced from `tenant_members_view.is_agency_backed`.

**Tenants no longer auto-provision a default space (changed 2026-04-30).** `provision_tenant` creates the tenant + adds the caller as `tenant_members.role='owner'` only. Spaces are real engagements named by the analyst doing the work (e.g. "Survodutide Q2 Pipeline"), created explicitly via `create_space`. The spaces-list page handles the zero-spaces state with a Create-space CTA.

`agencies.email_domain` is an optional lock. When set, every `agency_members` and `tenant_members` insert under that agency must reference a user whose email is on that domain (enforced by the `enforce_member_email_domain` BEFORE-INSERT trigger). Platform admins bypass. Null = no enforcement.

## Role-Access Matrix

| Actor | Space data SELECT | Space data WRITE | Tenant settings | Agency portal | Platform admin |
|---|---|---|---|---|---|
| Space viewer | own space | none | none | none | none |
| Space editor | own space | own space | none | none | none |
| Space owner | own space | own space | none | none | none |
| Tenant owner | spaces they're members of | spaces they're members of | own tenant | none | none |
| Agency owner | spaces they're members of | spaces they're members of | tenants under agency | full | none |
| Platform admin | all (read) | only via write RPCs | all (via super-admin) | all (read) | all |

Write access on tenant child tables (companies, products, trials, etc.) goes through `has_space_access(space_id, ['owner', 'editor'])` -- the row check enforces an explicit `space_members` membership.

## Tenant Suspension

`tenants.suspended_at` is enforced, not informational. When set, `has_space_access` short-circuits to `false` for write-role checks. Read access continues so users can export their data and the UI can show a "this workspace is suspended" banner.

## Host-Based Tenant Resolution

Tenant identity is resolved from the host before Angular bootstraps. There is no per-request URL parameter for tenant/agency identity on subdomain installs — `BrandContextService.id()` is the source of truth. Legacy `/t/:tenantId/...` URLs still work for direct customers on the apex during the cutover window.

| Host | Resolves to | Source |
|---|---|---|
| `pfizer.yourproduct.com` | tenant | `tenants.subdomain` |
| `competitive.pfizer.com` | tenant | `tenants.custom_domain` |
| `zs.yourproduct.com` | agency | `agencies.subdomain` |
| `admin.yourproduct.com` | super-admin | reserved subdomain |
| `yourproduct.com` (apex) | default | marketing landing (signed-in users with no roles get bounced to `/onboarding` with a join-code-only form) |

See [Architecture Overview](04-architecture-overview.md) for the full host-resolution flow.

**Switching tenants from the topbar dropdown.** Because the brand is bound to the host (CSS vars + PrimeNG preset are set on `:root` *before* Angular boots), an SPA-only navigation between tenants leaves the previous tenant's brand applied. `AppShellComponent.switchTenant()` therefore inspects the target tenant's `custom_domain ?? subdomain.<apexDomain>` and, when it differs from `window.location.host`, performs a full-page navigation (`window.location.href`) so the bootstrap re-runs against the new host. Same-host picks (e.g. an apex user with multiple tenants on the apex during cutover) still go through `router.navigate`. The `Tenant` interface exposes `subdomain` and `custom_domain` for this lookup; the data was already returned by `select('*')` and is RLS-scoped to the user's tenant memberships.

## Auto-Provisioning (handle_new_user trigger)

The `handle_new_user` trigger on `auth.users` was retired during the whitelabel rollout (migration 41) and re-extended in migration 69 with one job: consume any pending `agency_invites` rows matching the new user's email. If a super-admin provisioned an agency to an email that had not yet signed in, the invite is held in `agency_invites`; on that user's first sign-in, the trigger promotes it to an `agency_members` `owner` row and marks the invite accepted. The trigger does not provision tenants or spaces. Tenant invites are unchanged: still code-based via `accept_invite(p_code)`.

Self-provisioning RPCs (`create_tenant`, `provision_demo_workspace`) and the `/provision-demo` route were dropped on 2026-04-30 — they let any authenticated user spawn an agency-less ("orphan") tenant, which broke the whitelabel hierarchy. All tenant creation now goes through `provision_tenant`, which requires the caller to be an agency owner or platform admin. Direct-customer (no-agency) provisioning is not currently exposed; it can be added later as a platform-admin-only branch on `provision_tenant` if needed.

## Onboarding Flow

New users land on `/onboarding` after first sign-in (when not auto-routed by self-join or invite acceptance). Behavior depends on the host kind:

### Tenant subdomain (`kind = tenant`)

- `/onboarding?code=...` accepts an invite via `accept_invite()` and routes into the tenant
- If `brand.has_self_join` is true and the user's email matches the tenant's `email_domain_allowlist`, the auth callback short-circuits and calls `self_join_tenant(p_subdomain)` before navigating — user becomes a `tenant_members.role = 'member'` row
- The "create tenant" path is not offered (and is no longer offered anywhere — see below)

### Default host (`kind = default`, apex)

- The page renders a single "Join with Code" form. The user enters an invite code (tenant or space) and is routed into the corresponding tenant/space.
- There is no self-serve "create tenant" path. Users without an invite see a hint to ask their administrator. New tenants are provisioned by an agency owner from `/admin/tenants` or by a platform admin from the super-admin portal.

### Agency subdomain (`kind = agency`)

- Lands on `/admin/tenants` after sign-in (handled by `agencyGuard` + the post-callback redirect)
- Agency owners provision new tenants from `/admin/tenants/new`

## Tenant Settings

The `TenantSettingsComponent` provides:

- **Branding (logo + tenant name)**: shown only when `tenant.agency_id IS NULL` (direct-customer tenants self-serve branding). For agency-managed tenants, branding is owned by the agency portal's tenant detail page (`/admin/tenants/<id>`); the tenant settings page replaces the editor with a read-only identity card and a hint pointing to the agency. Logo upload is stored in the `tenant-logos` Supabase storage bucket; owners can upload/delete, all members can read.
- **Access** (owners only): `email_domain_allowlist` chip editor + "Allow employees to self-join this workspace" toggle, persisted via `update_tenant_access`. Loaded via `get_tenant_access_settings` (auth-only — never returned to anon)
- **Members table**: lists all members with name, email, role; remove button per member (with confirmation)
- **Pending invites table**: shows invite code, email, role, expiration
- **Invite dialog**: email + role dropdown to generate new invite codes (triggers branded email via the `send-invite-email` Edge Function)

**Ownership boundary:** for agency-managed tenants, the agency owns branding (display name, logo, primary color, email_from_name — all editable via `update_tenant_branding` from the agency portal) and the tenant team owns access (members, invites, self-join, danger zone — editable from tenant settings). Both roles still call the same RPCs; the split is enforced in the UI, not in the data model.

## Data Isolation

All data tables include a `space_id` column. RLS policies enforce that users can only access data in spaces where they (a) are explicit space members, (b) are owners or members of the parent tenant, (c) are owners of the parent tenant's parent agency, (d) are members of the parent tenant's parent agency (read-only), or (e) are platform admins (read-only). All other paths are denied.

There is no way to query across spaces or tenants — isolation is enforced at the database level, validated by the cross-tenant isolation smoke test in migration 24 of the foundation schema (`20260428042300_whitelabel_isolation_smoke_tests.sql`).
