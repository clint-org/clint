# UI Editability Matrix

[Back to test plan](2026-04-29-whitelabel-access-model.md)

---

A row-by-row spec of every editable UI surface in Clint, with expected behavior for each actor class. Used by the access-model test pass to systematically verify role enforcement at both the UI layer (visible / disabled / hidden) and the data layer (RLS or RPC permission gate). Last walked: 2026-05-01 against commits up to `9631070`.

## Legend

| Symbol | Meaning |
|---|---|
| `RW` | Surface is visible AND editable. The action button is present and enabled, the form is editable, and submission succeeds at the server. |
| `R` | Surface is visible but read-only. Action buttons are absent or disabled, fields are non-editable, and any submission attempt is rejected by RLS or by an RPC permission gate. |
| `—` | Surface is not visible. Either a route guard redirects the user away, the empty state hides everything, or RLS removes every row so there's nothing to render. |
| `BUG: <description>` | Current actual behavior diverges from expected. The cell describes what the user sees and what should happen instead. |
| `?` | Behavior not yet verified by the access-model test pass. Test in browser and replace with one of the above. |

## Actor classes

| Actor | Definition | Test plan account |
|---|---|---|
| **Owner** | At space-scoped surfaces: `space_members.role = 'owner'` for the space. At tenant-scoped surfaces: `tenant_members.role = 'owner'` for the tenant. At agency-scoped surfaces: `agency_members.role = 'owner'`. | `aadi529@gmail.com` (owns Stout, Pfizer, and the Survodutide Pipeline space in the test pass) |
| **Contributor** | `space_members.role = 'editor'`. UI label is "Contributor". Applies only to space-scoped surfaces; the tenant and agency layers have no contributor role (owner-only since migration 75). | `aadimadala@gmail.com` after Section 4 invite |
| **Reader** | `space_members.role = 'viewer'`. UI label is "Reader". Read-only at the space layer. | `madaladodbele@gmail.com` after Section 5 invite |
| **Tenant-owner-not-space-member** | `tenant_members.role = 'owner'` for the tenant, but NO `space_members` row for the space being viewed. The migration-75 firewall: tenant ownership grants no implicit space data access. | `aadimadala@gmail.com` between Section 3 (joined tenant) and Section 4 (added to space) |
| **Anonymous** | No auth session. Hits the route logged-out. | (any incognito with no sign-in) |

## How to test a row

For each row, sign in as one of the actors, navigate to the route, observe whether the UI matches the cell. If it doesn't, file the divergence as a bug in the failure-triage table at the bottom of the access-model test plan and update the cell here.

For server-side verification (when the UI says one thing but RLS or RPC rejection is the actual gate), use either:

- Browser dev-tools console with the supabase client temporarily exposed (Recipe B in Section 7c of the access-model test plan), or
- `curl` with the actor's JWT lifted from cookies / local storage (Recipe A).

A row is correctly enforced when both UI and data layer agree. A row marked `BUG:` typically means the UI layer is more permissive than the data layer (action visible, server rejects). The opposite (UI hides what server allows) is rarer but should also be flagged.

## Tenant settings

Route: `pfizer.clintapp.com/t/<tenantId>/settings`. Component: `tenant-settings.component.ts`. Read access: `is_tenant_member(tenant_id) OR is_agency_member(agency_id) OR is_platform_admin()` per `tenants` SELECT policy. Route gated by `tenantGuard` (commit `f57c4bf`).

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Page renders (chrome, members table read) | RW | — (not a tenant member) | — (not a tenant member) | RW (they ARE a tenant member) | — (redirected to /login) |
| Add tenant owner button + dialog | RW | — | — | RW | — |
| Remove tenant owner action menu (per-row) | RW (except on own row, see Section 7 self-protection) | — | — | RW (except own row) | — |
| Tenant branding fields (display_name, logo_url, primary_color, email_from_name) | RW only when `tenant.agency_id IS NULL` (direct customer); read-only otherwise (agency owns branding for managed tenants, set from agency portal) | — | — | RW only when `tenant.agency_id IS NULL` | — |
| Access settings (`email_domain_allowlist`, `has_self_join` toggle) | RW | — | — | RW | — |
| Suspend / unsuspend tenant button | R (currently surfaced only to platform admin via super-admin portal; no tenant-owner UI) | — | — | R | — |
| Delete tenant button (Danger zone, owner-only, direct-customer tenants only) | RW only when `tenant.agency_id IS NULL`; hidden otherwise. UI gating implemented via `currentUserIsOwner() && !tenant().agency_id` at line 212 of `tenant-settings.component.ts`. | — | — | RW only when `tenant.agency_id IS NULL` | — |

Backing tables: `tenants` (UPDATE policy `is_tenant_member(id, ['owner']) OR (agency_id IS NOT NULL AND is_agency_member(agency_id, ['owner'])) OR is_platform_admin()`); `tenant_members` (DELETE/UPDATE policy `is_tenant_member(tenant_id, ['owner'])`); `tenant_invites` (DELETE/SELECT/UPDATE policy `is_tenant_member(tenant_id, ['owner'])`).

Backing RPCs: `add_tenant_owner` (gate: `is_tenant_member(p_tenant_id, ['owner'])`); `update_tenant_branding` (gate: `is_tenant_member(p_tenant_id, ['owner']) OR is_agency_member OR is_platform_admin`); `update_tenant_access` (same gate as branding).

## Space settings

Route: `pfizer.clintapp.com/t/<tenantId>/s/<spaceId>/settings/general` and `/settings/members`. Components: `space-general.component.ts`, `space-members.component.ts`. No `spaceGuard` is wired up yet (flagged as a follow-up in `08-authentication-security.md`); routes activate on `tenantGuard` only.

### Space general (`/settings/general`)

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Page renders | RW | RW (sees the form, see BUG below) | RW (sees the form, see BUG below) | RW (no spaceGuard; chrome renders) | — |
| Space name input | RW | BUG: form/button visible to Contributor; should be Owner-only at UI level. Save submission rejected by `spaces` UPDATE policy (`has_space_access(id, ['owner'])`). | BUG: form visible to Reader; save rejected by RLS. | BUG: form visible to non-space-member; save rejected by RLS. | — |
| Space description textarea | RW | BUG: form/button visible to Contributor and Reader; should be Owner-only at UI level. | BUG: same as Contributor. | BUG: same. | — |
| Save changes button | RW | BUG: button visible and enabled when `hasChanges()`; click submits and gets rejected silently or with an error. Should be hidden for non-owners. | BUG: same. | BUG: same. | — |
| Delete space button (Danger zone) | RW | BUG: button visible to Contributor; click opens confirmation; on accept, `delete_space` server call fails (RLS rejects). The user reported this exact path on 2026-05-01: "I was able to click delete space but it didn't delete it." | BUG: same as Contributor. | BUG: same. | — |

Backing table: `spaces` (UPDATE/DELETE policy `has_space_access(id, ['owner'])`).

### Space members (`/settings/members`)

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Page renders, members list visible | RW | R (UI gating in place: `currentUserIsOwner()` at line 262 of `space-members.component.ts` hides write controls) | R (same UI gating) | R | — |
| Invite to space dialog (button + form) | RW | R (button hidden via `@if (currentUserIsOwner())`) | R | R | — |
| Per-member role select (change role) | RW | R (`[disabled]="!currentUserIsOwner()"` on the dropdown) | R | R | — |
| Remove member action | RW | R | R | R | — |

Backing table: `space_members` (DELETE/UPDATE policy `has_space_access(space_id, ['owner'])`); `space_invites` (SELECT policy: space owner OR platform admin).

Backing RPC: `invite_to_space` (gate: `space_members.role='owner'` for caller OR `is_platform_admin()`).

## Spaces list

Route: `pfizer.clintapp.com/t/<tenantId>/spaces`. Component: `space-list.component.ts`.

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Page renders | RW | RW | RW | RW (sees space list including spaces they're not a member of, since `spaces` SELECT policy includes `is_tenant_member(tenant_id)`) | — |
| Spaces visible in list | RW (all spaces in tenant) | RW (all spaces user has access to OR is tenant member of) | RW (same) | RW (sees space exist; cannot enter or read data inside) | — |
| Create space button + dialog | RW | RW (any tenant member can create a space; `create_space` gate is `tenant_members` membership, no role restriction) | RW (Reader of one space is also typically a tenant member if added through normal flow; create_space succeeds) | RW (tenant owners are tenant members; can create) | — |

Backing RPC: `create_space` (gate: `EXISTS (SELECT 1 FROM tenant_members WHERE tenant_id = p_tenant_id AND user_id = uid)`. NO role restriction; any tenant member can create).

Backing table: `spaces` (INSERT policy is null but the RPC is SECURITY DEFINER and bypasses; SELECT policy `has_space_access(id) OR is_tenant_member(tenant_id)`).

Note: in practice Reader is typically only a `space_members` row, not a `tenant_members` row, so a pure Reader cannot reach the spaces list at all. The Reader column only fills in when the user happens to also be a tenant member.

## Catalysts and trials (data layer)

Routes under `pfizer.clintapp.com/t/<tenantId>/s/<spaceId>/`:
- `/catalysts` (catalysts table)
- `/manage/companies`, `/manage/products`, `/manage/trials`, `/manage/trials/:id`
- `/` (timeline view), `/bullseye/...`, `/positioning/...` (read-only landscape views)

Components: `catalysts-page.component.ts`, `manage/companies/company-list.component.ts`, `manage/products/product-list.component.ts`, `manage/trials/trial-list.component.ts`, `manage/trials/trial-detail.component.ts`, `landscape/timeline-view.component.ts`, `landscape/landscape.component.ts`, `landscape/positioning-view.component.ts`.

None of these components currently include a `currentUserIsOwner()` or equivalent role check. All write controls render for any user who reaches the page. RLS is the actual gate.

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Catalysts table renders | RW | RW | R | — (RLS hides every row; page renders empty state) | — |
| Catalysts inline edits (status, etc.) | RW | RW | BUG: edit controls visible to Reader; writes rejected by RLS (`catalysts` table indirectly via underlying `markers`/`marker_assignments`). Should be R at UI level. | — | — |
| Companies list, add/edit/delete buttons | RW | RW | BUG: Add Company / Edit / Delete buttons visible to Reader; submission fails (companies UPDATE/DELETE/INSERT all gated `has_space_access(space_id, ['owner','editor'])`). Should be R at UI level. | — | — |
| Products list, add/edit/delete | RW | RW | BUG: same pattern as Companies. | — | — |
| Trials list, add/edit/delete | RW | RW | BUG: same pattern as Companies. | — | — |
| Trial detail page (sub-actions: Edit trial, Add marker, Add note, Delete marker, Delete note) | RW | RW | BUG: all action menus visible to Reader; writes rejected by RLS. | — | — |
| Trial notes (CRUD inside trial detail) | RW | RW | BUG: same. | — | — |
| Landscape / bullseye / positioning views | RW (read-only by design; no inline writes) | RW | RW | — (firewall) | — |
| Timeline view (read-only by design) | RW | RW | RW | — | — |

Backing tables (all gated identically): `companies`, `products`, `trials`, `trial_notes`, `markers`, `marker_assignments`, `therapeutic_areas`, `mechanisms_of_action`, `routes_of_administration`, `product_mechanisms_of_action`, `product_routes_of_administration`. SELECT policy `has_space_access(space_id)`. UPDATE/DELETE policy `has_space_access(space_id, ['owner','editor'])`. INSERT policy `NULL` (denied at policy layer; data inserts go through SECURITY DEFINER RPCs OR direct INSERTs that the policy denies).

## Events

Routes: `pfizer.clintapp.com/t/<tenantId>/s/<spaceId>/events`. Components: `events-page.component.ts`, `event-form.component.ts`, `event-detail-panel.component.ts`.

No `currentUserIsOwner()` gating on the events page. Edit / delete actions are surfaced to all space members.

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Events page renders, event list visible | RW | RW | R | — (RLS hides every row) | — |
| New event button + form | RW | RW | BUG: button visible to Reader; submission fails at RLS. Should be R at UI level. | — | — |
| Event detail panel (open existing event) | RW (read) | RW (read) | R | — | — |
| Edit event form (existing event) | BUG: edit form opens empty for existing events; the form's plain props (`title`, `description`, etc. on lines 302–314 of `event-form.component.ts`) suspect a change-detection timing issue between `loadExisting()` and the dialog rendering. Reported by user 2026-05-01. | BUG: edit form opens empty for existing events. | BUG: edit form opens empty for existing events; AND should be R at UI level. | — | — |
| Delete event action | RW | RW | BUG: visible to Reader; rejected by RLS. | — | — |
| New event-thread (during create) | RW | RW | BUG: same. | — | — |
| Add source URL / label rows | RW | RW | BUG: same. | — | — |
| Link event to another event | RW | RW | BUG: same. | — | — |

Backing tables: `events`, `event_threads`, `event_sources`, `event_links`. All UPDATE/DELETE policies: `has_space_access(space_id, ['owner','editor'])`. SELECT: `has_space_access(space_id)` (or chained `EXISTS` for child tables). INSERT: NULL (writes go through direct supabase JS calls; RLS denies for non-editors).

`event_categories`: SELECT `is_system = true OR has_space_access(space_id)`; UPDATE/DELETE `is_system = false AND has_space_access(space_id, ['owner','editor'])`. System categories are global / read-only for everyone.

## Taxonomies and global data (per-space)

Routes: `pfizer.clintapp.com/t/<tenantId>/s/<spaceId>/settings/marker-types` and `/settings/taxonomies`. Components: `manage/marker-types/marker-type-list.component.ts`, `manage/taxonomies/taxonomies-page.component.ts`.

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Marker types list | RW (system + space rows) | RW (system + space rows) | R (system rows always visible; space rows read-only) | — | — |
| Marker types add / edit / delete | RW (only `is_system = false` deletable) | RW (only `is_system = false`) | BUG: visible to Reader; rejected by RLS. | — | — |
| Marker categories add / edit / delete | RW (only `is_system = false`) | RW (only `is_system = false`) | BUG: visible to Reader; rejected by RLS. | — | — |
| Therapeutic areas, MOAs, ROAs (taxonomies page) | RW | RW | BUG: visible to Reader; rejected by RLS. | — | — |

Backing tables: `marker_types`, `marker_categories`, `therapeutic_areas`, `mechanisms_of_action`, `routes_of_administration`. Identical RLS shape to data tables: SELECT for any space member, UPDATE/DELETE for owner+editor, INSERT NULL. System rows (`is_system = true`) are read-only for everyone.

## Sidebar and topbar actions

Components: `core/layout/sidebar.component.ts`, `core/layout/contextual-topbar.component.ts`, `core/layout/app-shell.component.ts`.

| Surface | Owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Tenant switcher dropdown (topbar) | RW | RW | RW | RW | — |
| Space switcher dropdown (topbar) | RW (lists spaces user can access) | RW | RW | RW (lists spaces in their tenant; entering one without `space_members` row hits the firewall) | — |
| New space (sidebar / topbar) | RW (any tenant member can create) | RW | RW | RW | — |
| Join with code (topbar dropdown) | RW (any signed-in user) | RW | RW | RW | RW (visible at /onboarding without sign-in is bounced to /login) |
| Tenant settings (topbar dropdown) | RW (tenant-settings page; chrome-only for non-owners) | — (Contributor is a space role; if also tenant member, can access) | — | RW | — |
| Space settings link (topbar dropdown) | RW | RW (chrome only; see space-general BUG rows) | RW (chrome only) | — (firewall) | — |

## Agency portal

Routes: `stout.clintapp.com/admin/*`. Components in `features/agency/`. Route gated by `agencyGuard` (`is_agency_member(brand.id) OR is_platform_admin`, commit `a548c63`).

| Surface | Agency owner | Non-agency-owner signed in | Anonymous |
|---|---|---|---|
| `/admin` chrome renders | RW | — (cross-host redirected by guard) | — (redirected to /login) |
| `/admin/branding` (agency display name, logo, primary color, email_domain) | RW | — | — |
| `/admin/tenants` list | RW | — | — |
| `/admin/tenants/new` (provision new tenant) | RW | — | — |
| `/admin/tenants/:id` detail (tenant branding for managed tenants, member management, danger zone) | RW (UI gates `isOwner()` line 231 of `agency-members.component.ts`; gating present and working) | — | — |
| `/admin/members` (agency members table + add/remove) | RW | — | — |

Backing table: `agencies` (UPDATE policy `is_agency_member(id, ['owner']) OR is_platform_admin()`). Backing RPCs: `update_agency_branding`, `add_agency_member`, etc., all gated `is_agency_member(p_agency_id, ['owner']) OR is_platform_admin()`.

## Super-admin portal

Routes: `admin.clintapp.com/super-admin/*`. Components in `features/super-admin/`. Route gated by `superAdminGuard` (`is_platform_admin()`, commit `a548c63`).

| Surface | Platform admin | Non-platform-admin signed in | Anonymous |
|---|---|---|---|
| `/super-admin/agencies` list + provision-agency | RW | — (cross-host redirected by guard) | — |
| `/super-admin/tenants` list | RW | — | — |
| `/super-admin/domains` (custom domains, retired hostnames) | RW | — | — |
| Suspend / unsuspend tenant action | RW | — | — |
| Delete tenant action | RW | — | — |

Backing RPCs: `provision_agency`, `register_custom_domain`, `release_retired_hostname`, `lookup_user_by_email`. All gated `is_platform_admin()` only.

## Demo data

Route: `pfizer.clintapp.com/t/<tenantId>/s/<spaceId>/seed-demo`. Component: `seed-demo.component.ts` (commit `9631070`).

| Surface | Space owner | Contributor | Reader | Tenant-owner-not-space-member | Anonymous |
|---|---|---|---|---|---|
| Visit URL, RPC fires | RW (populates space with demo dataset; idempotent — returns early if companies already exist) | R (RPC returns `Insufficient permissions` since gate is `space_members.role='owner'` only) | R | R | — (redirected to /login) |

Backing RPC: `seed_demo_data` (gate: `EXISTS space_members WHERE role = 'owner' OR is_platform_admin()`).

## Onboarding

Route: `*/onboarding` and `*/onboarding?tab=join`. Component: `onboarding.component.ts`. No tenant context required.

| Surface | Any signed-in user | Anonymous |
|---|---|---|
| Page renders, join-code form visible | RW | — (redirected to /login) |
| Submit invite code | RW (RPC `accept_invite` validates code, expiry, email match) | — |

## Backing permissions reference

### RLS policy shapes (canonical patterns)

Most space-scoped data tables follow one of these shapes:

```
-- Pattern A: direct space_id column
SELECT  has_space_access(space_id)
INSERT  NULL  (deny; writes go through RPCs or are blocked)
UPDATE  has_space_access(space_id, ['owner','editor'])
DELETE  has_space_access(space_id, ['owner','editor'])

-- Pattern B: indirect through parent FK (e.g. marker_assignments via markers)
SELECT  EXISTS (SELECT 1 FROM <parent> WHERE id = <fk> AND has_space_access(<parent>.space_id))
UPDATE  EXISTS (... AND has_space_access(parent.space_id, ['owner','editor']))
DELETE  same as UPDATE

-- Pattern C: system + space (marker_types, marker_categories, event_categories)
SELECT  is_system = true OR has_space_access(space_id)
UPDATE  is_system = false AND has_space_access(space_id, ['owner','editor'])
DELETE  same as UPDATE
```

### `has_space_access(p_space_id uuid, p_roles text[]) -> boolean`

Returns true when:
- The calling user has a `space_members` row for `p_space_id` whose role is in `p_roles` (or any role if `p_roles IS NULL`), OR
- The calling user is a platform admin (read-only role check passes; writes still go through write RPCs).

Tenant ownership grants NO implicit space access (migration 75 firewall). Short-circuits to false for write-role checks when `tenants.suspended_at IS NOT NULL`.

### `is_tenant_member(p_tenant_id uuid, p_roles text[]) -> boolean`

Returns true if the calling user has the specified role in `tenant_members`, OR is an agency owner of the parent agency, OR is a platform admin.

### `is_agency_member(p_agency_id uuid, p_roles text[]) -> boolean`

Returns true if the calling user is in `agency_members` for `p_agency_id` with one of the given roles (or any role when `p_roles` is null).

### `is_platform_admin() -> boolean`

Returns true if `auth.uid()` is in `platform_admins`.

### Role mapping (UI label → DB value)

| UI label | `space_members.role` | `tenant_members.role` | `agency_members.role` |
|---|---|---|---|
| Owner | `owner` | `owner` | `owner` |
| Contributor | `editor` | (not used; tenant_members is owner-only) | (not used; agency_members is owner-only) |
| Reader | `viewer` | (not used) | (not used) |

### RPC permission gate summary

| RPC | Gate | Purpose |
|---|---|---|
| `create_space` | tenant_members exists (any role) | Any tenant member creates a space |
| `update_space` (via direct UPDATE on `spaces`) | RLS: `has_space_access(id, ['owner'])` | Space owner only |
| `delete_space` (via direct DELETE on `spaces`) | RLS: `has_space_access(id, ['owner'])` | Space owner only |
| `update_tenant_branding` | `is_tenant_member(['owner']) OR is_agency_member OR is_platform_admin` | Tenant owner or agency owner |
| `update_tenant_access` | same as branding | Same |
| `add_tenant_owner` | `is_tenant_member(['owner'])` | Tenant owner only |
| `update_agency_branding` | `is_agency_member(['owner']) OR is_platform_admin` | Agency owner only |
| `provision_tenant` | `is_agency_member(['owner']) OR is_platform_admin` | Agency owner only |
| `provision_agency` | `is_platform_admin` | Platform admin only |
| `invite_to_space` | space_members.role='owner' for caller OR is_platform_admin | Space owner only |
| `accept_invite` | code+email match (any signed-in user with valid code) | Invitee redeeming a tenant invite |
| `accept_space_invite` | code+email match (any signed-in user with valid code) | Invitee redeeming a space invite |
| `seed_demo_data` | space_members.role='owner' for caller OR is_platform_admin | Space owner explicit demo seed |
| `lookup_user_by_email` | `is_platform_admin` | Super-admin only |
| `register_custom_domain` | `is_platform_admin` | Super-admin only |
| `release_retired_hostname` | `is_platform_admin` | Super-admin only |
| `self_join_tenant` | tenant `has_self_join` config + email_domain_allowlist match | Self-onboarding when enabled by tenant owner |

## Known UI-cosmetic bugs

Consolidated list of `BUG:` annotations from the matrix above. None of these are security bugs (the data layer enforces correctly in every case); they are UX bugs where the UI shows actions that the server will then reject. Tracking issues as a follow-up to harden.

1. **`event-form.component.ts` opens empty for existing events.** When a user clicks Edit on an existing event, the dialog opens but the form fields (`title`, `description`, `eventDateValue`, `categoryId`, `priority`, `tags`, `threadId` on lines 302–314) stay blank. These are plain class properties. Suspect a change-detection timing issue between `loadExisting()` resolving and the dialog rendering, or signals/property mixing. Affects all roles. Reported by user 2026-05-01.
2. **`space-general.component.ts` shows write surface to all space members.** Description textarea, Space name input, Save button, AND Delete-space button visible to Contributor and Reader. Server rejects but UI suggests action is available. Reported by user 2026-05-01: "Space description is not editable just checked. I was able to click delete space but it didn't delete it." Fix: gate with a `currentUserIsOwner()` computed mirroring the `space-members.component.ts` pattern.
3. **`catalysts-page.component.ts`, `manage/companies`, `manage/products`, `manage/trials`, `manage/trials/:id` show write controls to Reader.** Add / Edit / Delete buttons render for any space member. Reader's submissions are rejected by RLS. Fix: add a per-component role check, ideally extracted to a shared service like `currentSpaceRole()` that all data-edit features can read from.
4. **`events-page.component.ts` and `event-form.component.ts` show write controls to Reader.** New event button, edit/delete actions, source/link/thread editors. Same fix as item 3.
5. **`marker-type-list.component.ts` and `taxonomies-page.component.ts` show write controls to Reader.** Same pattern, same fix.
6. **No `spaceGuard` on `/t/:tenantId/s/:spaceId/*` routes.** A tenant-owner-not-space-member can navigate to a space route they don't belong to and render the chrome (catalysts, events, etc.); RLS hides the data, so they see empty pages. This is the firewall test in Section 3 of the access-model test plan and is intentional for the data layer. Adding a `spaceGuard` (parallel to `tenantGuard`) would close the chrome-leak too. Tracked in `08-authentication-security.md` as "Known guard gap."

## Verification status

Run the access-model test plan (Sections 3, 4, 5, 7e) against this matrix and update cells. Empty cells (`?`) are not used in the current pass; if a cell is marked `?` in a future revision, it means the test pass has not yet covered it. Each `BUG:` should also have an entry in the test plan's failure-triage cheat sheet at the bottom of `2026-04-29-whitelabel-access-model.md`.
