# Roles and Permissions: Spec

[Back to test plan](2026-04-29-whitelabel-access-model.md)

---

The expected behavior of every editable UI surface in Clint, by actor class. Pure spec, no test recipes and no bug list. When the implementation diverges from this doc, the implementation is wrong, not this doc.

## Legend

| Symbol | Meaning |
|---|---|
| `RW` | Visible AND editable. Action buttons render and submission succeeds. |
| `R` | Visible but read-only. Action buttons absent or disabled, fields non-editable. |
| `—` | Not visible. Route guard redirects, RLS removes every row, or the empty state hides everything. |

## Actor classes

`tenant_members.role` and `agency_members.role` are both constrained to `'owner'`. There is no non-owner tenant or agency member; "tenant member" and "tenant owner" mean the same thing. Space-level membership uses three roles: `owner`, `editor` (UI label "Contributor"), `viewer` (UI label "Reader").

| Actor | Definition |
|---|---|
| **Platform Admin** | Row in `platform_admins`. Cross-cutting read access to everything; writes go through gated super-admin RPCs. |
| **Agency Owner** | Row in `agency_members.role='owner'` for the parent agency of the tenant. NOT in `tenant_members` for this tenant, NOT in `space_members` for this space. |
| **Tenant Owner** | Row in `tenant_members.role='owner'` for the tenant. NOT in `space_members` for the space being viewed. |
| **Space Owner** | Row in `space_members.role='owner'` for the space. (Typically also a tenant owner via the path that added them.) |
| **Space Contributor** | Row in `space_members.role='editor'` for the space. UI label "Contributor". |
| **Space Reader** | Row in `space_members.role='viewer'` for the space. UI label "Reader". |
| **Anonymous** | No auth session. |

Important: under the migration-75 firewall, an Agency Owner has full agency-portal authority and tenant-level read/write authority via the `is_tenant_member` agency-disjunct, but holds no implicit space data access. Space data is reachable only by an explicit `space_members` row (or platform-admin read-only bypass).

## Tenant settings

Route: `<tenant>.clintapp.com/t/<tenantId>/settings`. Component: `tenant-settings.component.ts`. Route gated by `tenantGuard` (`is_tenant_member(tenant_id) OR is_platform_admin`).

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Page renders, members table read | RW | RW | RW | RW | — | — | — |
| Add tenant owner button + dialog | RW | RW | RW | RW | — | — | — |
| Remove tenant owner per-row action | RW | RW | RW (except own row, self-protection) | RW (except own row) | — | — | — |
| Tenant branding fields (display name, logo, primary color, email_from_name): direct customer (`agency_id IS NULL`) | RW | n/a | RW | RW | — | — | — |
| Tenant branding fields: agency-managed (`agency_id IS NOT NULL`) | RW | RW | R (agency owns branding) | R | — | — | — |
| Access settings (`email_domain_allowlist`, `has_self_join`) | RW | RW | RW | RW | — | — | — |
| Suspend / unsuspend tenant button | RW | R | R | R | — | — | — |
| Delete tenant button (direct customers only, agency_id IS NULL) | RW | n/a | RW | RW | — | — | — |

Tenant Owner and Space Owner columns collapse for the tenant-settings page because Space Owner status implies tenant_members membership (Space Owners are always at least Tenant Owners in practice, or Agency Owners). Where the cells say RW for Space Owner the user is doing the action because they are a tenant owner, not because they are a space owner.

Space Contributor and Space Reader hold no `tenant_members` row by definition, so the `tenantGuard` bounces them. They never render this page.

## Space settings

Routes: `<tenant>.clintapp.com/t/<tenantId>/s/<spaceId>/settings/general` and `/settings/members`. Components: `space-general.component.ts`, `space-members.component.ts`.

### Space general

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Page renders | RW | — | — | RW | R | R | — |
| Space name input | RW | — | — | RW | R | R | — |
| Space description textarea | RW | — | — | RW | R | R | — |
| Save changes button | RW | — | — | RW | R | R | — |
| Delete space button (Danger zone) | RW | — | — | RW | R | R | — |

The Agency Owner and Tenant Owner cells are `—` because they hold no `space_members` row, and `has_space_access` is the SELECT/UPDATE/DELETE gate on `spaces`. Platform Admin gets read-only access via `has_space_access`'s admin bypass for non-write checks; the RW cells reflect platform-admin write authority via the data-layer admin bypass plus direct table rights.

### Space members

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Page renders, members list visible | RW | — | — | RW | R | R | — |
| Invite to space dialog | RW | — | — | RW | R | R | — |
| Per-member role select | RW | — | — | RW | R | R | — |
| Remove member action | RW | — | — | RW | R | R | — |

## Spaces list

Route: `<tenant>.clintapp.com/t/<tenantId>/spaces`. Component: `space-list.component.ts`. Route gated by `tenantGuard`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Page renders | RW | RW | RW | RW | RW | RW | — |
| Spaces visible in list | RW (every space in tenant) | RW (every space in tenant via `is_tenant_member` agency-disjunct on `spaces` SELECT) | RW (every space in tenant) | RW (every space in tenant) | RW (every space in tenant) | RW (every space in tenant) | — |
| Create space button + submission | RW | R (no `tenant_members` row, `create_space` gate rejects) | RW | RW | RW | RW | — |

Reader holds a `space_members` row for one specific space, but not necessarily a `tenant_members` row. If they hold `tenant_members` (added through normal flow) they can create new spaces; if not, they reach the spaces list (because `tenantGuard` lets them through if they are a tenant owner) but `create_space` rejects.

## Catalysts and trials

Routes under `<tenant>.clintapp.com/t/<tenantId>/s/<spaceId>/`:

- `/catalysts` (catalysts table)
- `/manage/companies`, `/manage/products`, `/manage/trials`, `/manage/trials/:id`
- `/` (timeline view), `/bullseye/...`, `/positioning/...` (read-only landscape views)

Components: `catalysts-page.component.ts`, `manage/companies/company-list.component.ts`, `manage/products/product-list.component.ts`, `manage/trials/trial-list.component.ts`, `manage/trials/trial-detail.component.ts`, `landscape/timeline-view.component.ts`, `landscape/landscape.component.ts`, `landscape/positioning-view.component.ts`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Catalysts table renders | RW | — | — | RW | RW | R | — |
| Catalysts inline edits | RW | — | — | RW | RW | R | — |
| Companies list, add/edit/delete | RW | — | — | RW | RW | R | — |
| Products list, add/edit/delete | RW | — | — | RW | RW | R | — |
| Trials list, add/edit/delete | RW | — | — | RW | RW | R | — |
| Trial detail page (edit, add marker, add note, delete actions) | RW | — | — | RW | RW | R | — |
| Trial notes inside trial detail | RW | — | — | RW | RW | R | — |
| Landscape, bullseye, positioning views | RW (read-only by design) | — | — | RW | RW | RW | — |
| Timeline view (read-only by design) | RW | — | — | RW | RW | RW | — |

## Events

Routes: `<tenant>.clintapp.com/t/<tenantId>/s/<spaceId>/events`. Components: `events-page.component.ts`, `event-form.component.ts`, `event-detail-panel.component.ts`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Events page renders, list visible | RW | — | — | RW | RW | R | — |
| New event button + form | RW | — | — | RW | RW | R | — |
| Event detail panel (open existing) | RW | — | — | RW | RW | R | — |
| Edit event form (existing event) | RW | — | — | RW | RW | R | — |
| Delete event action | RW | — | — | RW | RW | R | — |
| New event-thread (during create) | RW | — | — | RW | RW | R | — |
| Add source URL / label rows | RW | — | — | RW | RW | R | — |
| Link event to another event | RW | — | — | RW | RW | R | — |

System event categories (`is_system = true`) are visible to every space member regardless of role and are read-only for everyone except via direct DB access.

## Taxonomies and per-space global data

Routes: `<tenant>.clintapp.com/t/<tenantId>/s/<spaceId>/settings/marker-types` and `/settings/taxonomies`. Components: `manage/marker-types/marker-type-list.component.ts`, `manage/taxonomies/taxonomies-page.component.ts`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Marker types list | RW (all rows) | — | — | RW (system + space rows) | RW | R | — |
| Marker types add / edit / delete | RW (only `is_system = false` editable) | — | — | RW (only `is_system = false`) | RW | R | — |
| Marker categories add / edit / delete | RW (only `is_system = false`) | — | — | RW | RW | R | — |
| Therapeutic areas, MOAs, ROAs (taxonomies) | RW | — | — | RW | RW | R | — |

System rows (`is_system = true`) on `marker_types`, `marker_categories`, and `event_categories` are visible to all space members and read-only for everyone.

## Sidebar and topbar

Components: `core/layout/sidebar.component.ts`, `core/layout/contextual-topbar.component.ts`, `core/layout/app-shell.component.ts`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Tenant switcher dropdown | RW | RW | RW | RW | RW | RW | — |
| Space switcher dropdown | RW | RW | RW | RW | RW | RW | — |
| New space (sidebar / topbar) | RW | R | RW | RW | RW | RW | — |
| Join with code (topbar) | RW | RW | RW | RW | RW | RW | — |
| Tenant settings link | RW | RW | RW | RW | — | — | — |
| Space settings link | RW | — | — | RW | RW | RW | — |

The space switcher and tenant switcher dropdowns enumerate what the user can see (filtered by `spaces` SELECT and tenant memberships). The actions next to them (New space, Tenant settings link, etc.) follow the role gates above.

## Agency portal

Routes: `<agency>.clintapp.com/admin/*`. Components in `features/agency/`. Route gated by `agencyGuard` (`is_agency_member(brand.id) OR is_platform_admin`).

| Surface | Platform Admin | Agency Owner | Non-agency-owner signed in | Anonymous |
|---|---|---|---|---|
| `/admin` chrome renders | RW | RW | — (cross-host redirected by guard) | — |
| `/admin/branding` (agency display name, logo, primary color, email_domain) | RW | RW | — | — |
| `/admin/tenants` list | RW | RW | — | — |
| `/admin/tenants/new` (provision tenant) | RW | RW | — | — |
| `/admin/tenants/:id` detail (member management, danger zone, branding for managed tenants) | RW | RW | — | — |
| `/admin/members` (agency members table + add/remove) | RW | RW | — | — |

## Super-admin portal

Routes: `admin.clintapp.com/super-admin/*`. Components in `features/super-admin/`. Route gated by `superAdminGuard` (`is_platform_admin()`).

| Surface | Platform Admin | Non-platform-admin signed in | Anonymous |
|---|---|---|---|
| `/super-admin/agencies` list + provision-agency | RW | — (cross-host redirected) | — |
| `/super-admin/tenants` list | RW | — | — |
| `/super-admin/domains` (custom domains, retired hostnames) | RW | — | — |
| Suspend / unsuspend tenant action | RW | — | — |
| Delete tenant action | RW | — | — |

## Demo data

Route: `<tenant>.clintapp.com/t/<tenantId>/s/<spaceId>/seed-demo`. Component: `seed-demo.component.ts`.

| Surface | Platform Admin | Agency Owner | Tenant Owner | Space Owner | Space Contributor | Space Reader | Anonymous |
|---|---|---|---|---|---|---|---|
| Visit URL, RPC fires | RW | R | R | RW | R | R | — |

The RPC is idempotent: returns early if the space already has companies. Everyone except a Space Owner or Platform Admin gets `Insufficient permissions`.

## Onboarding

Route: `*/onboarding` and `*/onboarding?tab=join`. Component: `onboarding.component.ts`. No tenant context required.

| Surface | Any signed-in user | Anonymous |
|---|---|---|
| Page renders, join-code form visible | RW | — (redirected to /login) |
| Submit invite code | RW (`accept_invite` validates code, expiry, email match) | — |

## Backing permissions reference

### Helper function summary

| Function | Returns true when |
|---|---|
| `has_space_access(p_space_id, p_roles)` | The caller has a `space_members` row for this space whose role is in `p_roles` (any role if `p_roles IS NULL`); OR (read-only checks only) the caller is a platform admin. NO implicit cascade from tenant or agency level. Short-circuits to false for write-role checks when the parent tenant is suspended. |
| `is_tenant_member(p_tenant_id, p_roles)` | The caller has a `tenant_members` row at the requested role; OR is an agency owner of the parent agency (full disjunct, not role-scoped); OR is a platform admin. |
| `is_agency_member(p_agency_id, p_roles)` | The caller has an `agency_members` row at the requested role (or any role when `p_roles` is null). |
| `is_platform_admin()` | The caller has a row in `platform_admins`. |

### Role mapping (UI label, DB value)

| UI label | `space_members.role` | `tenant_members.role` | `agency_members.role` |
|---|---|---|---|
| Owner | `owner` | `owner` (only allowed value) | `owner` (only allowed value) |
| Contributor | `editor` | not used | not used |
| Reader | `viewer` | not used | not used |

### RLS pattern shapes

```
-- Pattern A: direct space_id column on the table
SELECT  has_space_access(space_id)
INSERT  NULL  (denied at policy layer; data inserts go through SECURITY DEFINER RPCs or are blocked)
UPDATE  has_space_access(space_id, ['owner','editor'])
DELETE  has_space_access(space_id, ['owner','editor'])

-- Pattern B: indirect via parent FK (e.g. marker_assignments via markers, event_sources via events)
SELECT  EXISTS (SELECT 1 FROM <parent> WHERE id = <fk> AND has_space_access(<parent>.space_id))
UPDATE  EXISTS (... AND has_space_access(parent.space_id, ['owner','editor']))
DELETE  same as UPDATE

-- Pattern C: system rows + space rows (marker_types, marker_categories, event_categories)
SELECT  is_system = true OR has_space_access(space_id)
UPDATE  is_system = false AND has_space_access(space_id, ['owner','editor'])
DELETE  same as UPDATE
```

### Tenant-scoped table policies

| Table | SELECT | UPDATE | DELETE |
|---|---|---|---|
| `tenants` | `is_tenant_member(id) OR is_agency_member(agency_id) OR is_platform_admin()` | `is_tenant_member(id, ['owner']) OR is_agency_member(agency_id, ['owner']) OR is_platform_admin()` | `is_platform_admin()` only |
| `tenant_members` | `is_tenant_member(tenant_id)` | `is_tenant_member(tenant_id, ['owner'])` | `is_tenant_member(tenant_id, ['owner'])` |
| `tenant_invites` | `is_tenant_member(tenant_id, ['owner'])` | `is_tenant_member(tenant_id, ['owner'])` | `is_tenant_member(tenant_id, ['owner'])` |
| `spaces` | `has_space_access(id) OR is_tenant_member(tenant_id)` | `has_space_access(id, ['owner'])` | `has_space_access(id, ['owner'])` |
| `space_members` | `has_space_access(space_id)` | `has_space_access(space_id, ['owner'])` | `has_space_access(space_id, ['owner'])` |
| `space_invites` | space owner OR platform admin (see policy body) | space owner OR platform admin | space owner OR platform admin |

### RPC permission gates

| RPC | Gate |
|---|---|
| `create_space` | direct `tenant_members` row (any role; agency disjunct not honored). |
| `update_tenant_branding` | `is_tenant_member(['owner']) OR is_agency_member(['owner']) OR is_platform_admin`. |
| `update_tenant_access` | same as branding. |
| `add_tenant_owner` | `is_tenant_member(['owner'])`. Idempotent on repeat calls (existing valid invite returned). |
| `update_agency_branding` | `is_agency_member(['owner']) OR is_platform_admin`. |
| `provision_tenant` | `is_agency_member(['owner']) OR is_platform_admin`. |
| `provision_agency` | `is_platform_admin` only. |
| `invite_to_space` | space owner OR platform admin. Idempotent. |
| `accept_invite` | code+email match (any signed-in user with valid tenant invite code). |
| `accept_space_invite` | code+email match (any signed-in user with valid space invite code). |
| `seed_demo_data` | space owner OR platform admin. |
| `lookup_user_by_email` | `is_platform_admin` only. |
| `register_custom_domain` | `is_platform_admin` only. |
| `release_retired_hostname` | `is_platform_admin` only. |
| `self_join_tenant` | tenant `has_self_join = true` AND email matches `email_domain_allowlist`. |
