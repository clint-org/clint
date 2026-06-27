# Profiles: rename "Manage" and open entity browsing to all members

Date: 2026-06-27
Status: Design approved, pending spec review

## Problem

The "Manage" section (companies, assets, trials) is gated behind `editGuard`, so only
`owner` and `editor` roles can reach it. `viewer` members never see it. This is wrong on
two counts:

1. **Naming.** "Manage" conflates two jobs: browsing/reading entities (everyone wants this)
   and editing them (owner/editor only). The section is named after the edit job, which is
   why it is hidden from viewers.
2. **Access.** A viewer can already see trials on the timeline and markers on the dashboard,
   but cannot open a flat company/asset/trial list or navigate to an entity profile. The
   browse surface is hidden purely because it was built as a CRUD screen, not because of any
   data-access constraint.

There is no security or data reason to hide entity browsing from viewers. The data is
space-scoped, and viewers already have it surfaced elsewhere.

## Goal

Rename the section to **Profiles**, make it visible to every space member (including
`viewer`), and keep all create/edit/delete affordances gated to `owner`/`editor`. One
surface, role-adaptive controls.

## Key facts established during design

These were verified against the codebase and constrain the scope:

1. **Viewers already have DB read access.** The SELECT policies on `companies`, `assets`,
   and `trials` use `has_space_access(space_id)` with no role restriction, so any space
   member (including `viewer`) can read them.
   - `companies`: `supabase/migrations/20260315170100_*.sql` (policy "space members can view companies")
   - `assets`: `supabase/migrations/20260524120200_*.sql` (policy "space members can view assets")
   - `trials`: `supabase/migrations/20260315170100_*.sql` (policy "space members can view trials")
   - `has_space_access`: when `p_roles` is null it returns true for any member role.

2. **The pages are already viewer-safe.** Every New / Add / Edit / Delete control is already
   wrapped in `SpaceRoleService.canEdit()` (`owner || editor`). Viewers render clean
   read-only tables and detail pages with no edit affordances, with zero component changes.
   - `SpaceRoleService`: `src/client/src/app/core/services/space-role.service.ts`
     (`canEdit`, `isOwner` computeds; role fetched from `space_members`).
   - List/detail topbar actions and row menus all gate on `this.spaceRole.canEdit()`, and
     `buildEntityActionMenu` (`src/client/src/app/shared/entity-actions/entity-action-menu.ts`)
     returns early without Edit/Delete when `canEdit` is false.

The only reason viewers cannot reach these pages today is the `editGuard` on the routes plus
the sidebar filtering that strips the section for non-editors.

## Design

### 1. Open access (substantive change)

- **Route guards.** Replace `editGuard` on the three list routes (`companies`, `assets`,
  `trials`) in `src/client/src/app/app.routes.ts` with the viewer-inclusive space-membership
  baseline already used by the detail routes (which are reachable today without `editGuard`).
  Any space member, including `viewer`, can browse. If a dedicated "any space member" guard
  does not already exist, add one that checks `has_space_access(space_id)` with no role
  argument, mirroring the existing guard structure in `src/client/src/app/core/guards/`.
  Do not weaken Settings guards: `spaceOwnerGuard` on General/Members/Fields/Audit stays.
- **Sidebar filtering.** In `src/client/src/app/core/.../sidebar-nav.ts`, stop removing the
  Profiles section for non-editors (currently the `canEdit()` filter drops the whole
  section). The owner-only filtering for Settings items stays exactly as-is.
- **No component changes.** Edit controls remain gated by `canEdit()`; viewers get a
  read-only experience automatically.

### 2. Rename "Manage" to "Profiles" (full sweep)

Greenfield, so rename URLs and labels together. No backward-compat redirects.

- **Labels:**
  - `sidebar-nav.ts`: section label `'Manage'` to `'Profiles'`.
  - `icon-rail.component.ts`: label `'Manage'` to `'Profiles'`.
  - `app-shell.component.ts`: topbar section label `manage: 'Manage'` to `profiles: 'Profiles'`,
    and the topbar title map keys (`'manage/companies'` etc.) to the new paths.
- **Routes:** `/manage/*` to `/profiles/*` in `app.routes.ts`, including list, detail
  (`:id`), and the legacy redirect entries. Update every `.navigate()` / `routerLink` /
  redirect referencing `manage/` across the feature, and the topbar/breadcrumb path maps.
- **Type literal:** `SidebarSectionId` `'manage'` to `'profiles'`; the icon-rail section id
  `'manage'` to `'profiles'`.
- **Copy:** the `label="Manage assets"` CTA on
  `src/client/src/app/.../landscape.component.html` becomes browse-oriented wording
  ("View assets"). The marker-types page "Manage categories" link is a Settings concern, not
  part of this section, and is left unchanged.
- **Tests and comments:** `sidebar-nav.spec.ts` fixtures, any route/e2e specs asserting
  `/manage/*`, and code comments referencing "the Manage dialog" in
  `trial-edit-form.component.ts` and `app-shell.component.ts`.
- **Docs:** any runbook or in-app help references to the "Manage" area.

### 3. Engagement route

`manage/engagement` lives under the `manage/` route children but is presented in the
**Intelligence** nav section, not in Profiles. On rename it becomes `/profiles/engagement`.
The URL prefix and nav section do not have to match: the route moves with the prefix, and the
nav item stays grouped under Intelligence. (Decision confirmed during design.)

## Out of scope

- **No RLS changes.** Reads are already open to all members.
- **No read-only component variants.** Pages are already role-adaptive.
- **No `/manage` to `/profiles` redirects.** Greenfield; old links are not in use.
- **Marker types / categories / taxonomies.** These already moved to Settings and stay there;
  not part of the Profiles section.

## Testing

- Viewer-role nav test: the Profiles section is present for a `viewer`, and edit controls
  (Add / Edit / Delete) are absent on the list and detail pages.
- Owner/editor nav test stays green: section present, edit controls present.
- Route tests updated to the new `/profiles/*` paths (list, `:id` detail, engagement).
- Existing `canEdit()` gating specs stay green unchanged.
- `cd src/client && ng lint && ng build` clean.

## Impact summary (files)

- `src/client/src/app/app.routes.ts` (routes + guards)
- `src/client/src/app/core/guards/` (viewer-inclusive guard if not present)
- `src/client/src/app/.../sidebar-nav.ts` + `sidebar-nav.spec.ts` (label, section id, filtering)
- `src/client/src/app/.../icon-rail.component.ts` (label, section id)
- `src/client/src/app/.../app-shell.component.ts` (topbar label + title/path maps, comment)
- `src/client/src/app/features/manage/**` (directory references, internal navigation, comments)
- `src/client/src/app/.../landscape.component.html` (CTA copy)
- `trial-edit-form.component.ts` (comments)
- Any runbook/help docs referencing "Manage"

Note: whether to physically rename the `features/manage/` directory to `features/profiles/`
is an implementation-plan detail. The user-facing labels and routes are the contract; the
folder name can follow for consistency or stay, to be decided in the plan.
