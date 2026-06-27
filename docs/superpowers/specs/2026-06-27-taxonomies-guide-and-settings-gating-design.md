# Taxonomies guide + reference-settings gating

Date: 2026-06-27
Status: Design (approved for spec)

## Problem

Read-only (viewer) space members currently see two Settings nav items that are
management surfaces: **Taxonomies** (`settings/taxonomies`) and **Marker Types**
(`settings/marker-types`). Both are tagged "Reference settings: read-only,
visible to all space roles" in `sidebar-nav.ts`, neither route is guarded, and
the page bodies gate edit controls behind `SpaceRoleService.canEdit()`. So a
viewer can browse them but cannot mutate anything.

This is intended today, but it is asymmetric and puts "Settings" management
pages in a viewer's nav:

- **Marker Types** already has a dedicated read-only guide at `help/markers`
  (`markers-help.component.ts`), surfaced to viewers from the dashboard legend.
  The settings page is a redundant table for viewers.
- **Taxonomies** has *no* guide. The settings page is the only place a viewer
  can discover the controlled vocabularies (indications / therapeutic areas,
  mechanisms of action, routes of administration) that drive the landscape
  filters.

## Goal

Make the read-only reference experience consistent with the existing
markers/phases help pattern, and stop surfacing management pages to viewers:

1. Add a **Taxonomies guide** help page modeled on `markers-help`
   (live-rendered, no drift).
2. Add a **Reference** nav group (visible to all roles) that collects the
   Taxonomies, Markers, and Phases guides in one predictable place.
3. Gate the **Taxonomies** and **Marker Types** *settings* entries (nav + route)
   to editors and owners. Viewers get the guides instead of the management
   pages.

Non-goals: changing the Roles guide surfacing (stays tenant-level, linked from
members settings); changing how the dashboard legend links to markers/phases
guides; touching the markers/phases/roles help content.

## Existing patterns this builds on

- **Help pages** live in `src/app/features/help/` as standalone OnPush
  components wrapped in `ManagePageShellComponent`. Shape: header + summary +
  capability/descriptor table + FAQ + back link. `markers-help` *live-renders*
  from `MarkerTypeService.list()`; `phases-help` imports the static
  `PHASE_DESCRIPTORS` constant; `roles-help` uses static arrays.
- **Help routes**: `help/markers` is space-level (`/t/:id/s/:id/help/markers`,
  inherits `spaceGuard`); `help/phases` and `help/roles` are tenant-level
  (`/t/:id/help/...`).
- **Nav links resolve space-relative.** `sidebar.component` emits `item.route`
  to `app-shell.onNavItemClick` -> `navigateToSpaceRoute`, which prefixes
  `/t/:tenantId/s/:spaceId/`. So a nav item `route: 'help/phases'` resolves to a
  *space-level* URL, which does not exist today (phases-help is tenant-level).
- **Nav gating**: `filterNavSections(sections, canEdit, isOwner)` drops the
  `manage` section when `!canEdit`, and drops per-item `ownerOnly` items when
  `!isOwner`. There is currently no per-item editor gate.
- **Role model**: `SpaceRoleService` exposes `isOwner`, `canEdit` (owner OR
  editor), `canRead` from `space_members.role` (`owner | editor | viewer`).
- **Route guards**: `spaceOwnerGuard` (owner-only) and `auditSpaceGuard` exist.
  There is no editor-level guard yet.
- **Taxonomy data**: `IndicationService.list(spaceId)`,
  `MechanismOfActionService.list(spaceId)`,
  `RouteOfAdministrationService.list(spaceId)` (all cached). Row shapes:
  - Indication: `name`, `abbreviation` (nullable), `display_order`, ...
  - MechanismOfAction: `name`, `description` (nullable), `display_order`, ...
  - RouteOfAdministration: `name`, `abbreviation` (nullable), `display_order`, ...
- **Help-page drift guard**: `.claude/hooks/runbook-review-guard.sh` `helpRules`
  maps changed source paths to help pages that may need editorial updates
  (CLAUDE.md "In-app Help Pages").

## Design

### 1. Taxonomies guide page (new)

`src/app/features/help/taxonomies-help.component.ts` — standalone, OnPush,
wrapped in `ManagePageShellComponent`. Mirrors `markers-help`.

**Live-renders** from the three existing services in `ngOnInit`
(`IndicationService`, `MechanismOfActionService`, `RouteOfAdministrationService`,
scoped to the current `spaceId`) so it cannot drift from the space's actual
vocabulary.

Sections:

- **Header + summary** — what taxonomies are; that they power the landscape
  filters (MoA / RoA / therapeutic area) and tag trials and assets.
- **Therapeutic areas / Indications** — table: name + abbreviation.
- **Mechanisms of action (MoA)** — table: name + description.
- **Routes of administration (RoA)** — table: name + abbreviation.
- **How these are used** — short explainer pointing at the landscape filters.
- **Common questions** — FAQ, agency-aware text substitution like the others.
- **Back link** — to the timeline (space context), matching markers-help.

Route: add `help/taxonomies` at **space level** (inherits `spaceGuard`), beside
`help/markers` in `app.routes.ts`.

**Naming check (implementation, not a design blocker):** the landscape filter
bar injects `TherapeuticAreaService` for the indication/therapeutic-area filter,
while the taxonomies settings page uses `IndicationService`. Verify the
relationship (same underlying table vs. a grouping) during implementation and
label the guide section so it matches the filter label viewers actually see.

### 2. "Reference" nav group (new)

Add a new bottom section to `NAV_SECTIONS` in `sidebar-nav.ts`, visible to all
roles (no `ownerOnly`, not gated by `canEdit`):

```
{
  id: 'reference',            // add to SidebarSectionId union
  label: 'Reference',
  bottom: true,
  items: [
    { label: 'Taxonomies guide', route: 'help/taxonomies', icon: ... },
    { label: 'Markers guide',    route: 'help/markers',     icon: ... },
    { label: 'Phases guide',     route: 'help/phases',      icon: ... },
  ],
}
```

Because nav links resolve space-relative, add a **space-level route alias for
phases-help** (`help/phases` under `/t/:id/s/:id`) pointing at the existing
`PhasesHelpComponent`. Phases-help has no space-specific data (it reads the
static `PHASE_DESCRIPTORS` constant), so a space-level alias is safe. The
existing tenant-level `help/phases` route and the dashboard-legend link stay
unchanged. (`help/markers` and `help/taxonomies` are already space-level, so no
alias needed for those.)

Keep `id: 'reference'` in sync with the `Section` union in
`app-shell.component.ts` per the existing comment contract.

### 3. Gate the management pages to editor/owner

- Add an `editorOnly?: boolean` flag to the `NavItem` interface in
  `sidebar-nav.ts`. Extend `filterNavSections` to also drop items where
  `item.editorOnly && !canEdit`. Mark the **Taxonomies** and **Marker Types**
  settings items `editorOnly: true` (remove the "visible to all space roles"
  comment).
- Add a `spaceEditorGuard` (mirror `spaceOwnerGuard`, gate on
  `SpaceRoleService.canEdit()`; redirect denied viewers to a sensible read-only
  surface). Apply it via `canActivate` to the `settings/taxonomies` and
  `settings/marker-types` routes so deep-links are denied for viewers.

Net effect by role:

| Role   | Reference group (guides) | Taxonomies / Marker Types settings |
| ------ | ------------------------ | ---------------------------------- |
| viewer | yes                      | no (nav hidden, route guarded)     |
| editor | yes                      | yes                                |
| owner  | yes                      | yes                                |

The taxonomies/marker-types page bodies keep their internal `canEdit()` gating;
the viewer-facing read-only branches simply become unreachable (harmless; no
cleanup required for this change).

### 4. Drift guard + tests

- Extend `.claude/hooks/runbook-review-guard.sh` `helpRules` so changes to
  `indications`, `mechanisms_of_action`, and `routes_of_administration`
  (migrations or the three services) flag `taxonomies-help` for editorial
  review, matching the markers/phases convention.
- Tests, paired per task (not deferred to a phase):
  - `filterNavSections` unit spec: `editorOnly` items dropped when `!canEdit`,
    kept when `canEdit`; the new `reference` section survives for all roles.
  - `spaceEditorGuard` spec: owner/editor allowed, viewer denied/redirected.
  - `taxonomies-help` render spec: renders the three live-rendered tables from
    mocked services; back link present.

## Open editorial choices (safe to settle in review)

- **Group label**: "Reference" (default) vs "Guides". Pick one; this spec uses
  "Reference".
- **Icons**: reuse the existing `taxonomies` / `marker-types` nav icons (or a
  neutral guide/book icon) for the Reference items.

## Files touched

- New: `src/app/features/help/taxonomies-help.component.ts` (+ spec)
- New: `src/app/core/guards/space-editor.guard.ts` (+ spec) — name/location to
  match the existing `spaceOwnerGuard`
- Edit: `src/app/core/layout/sidebar-nav.ts` (NavItem `editorOnly`, Reference
  section, `editorOnly` on the two settings items, `filterNavSections`) (+ spec)
- Edit: `src/app/core/layout/app-shell.component.ts` (`Section` union sync)
- Edit: `src/app/app.routes.ts` (`help/taxonomies` space route; space-level
  `help/phases` alias; `spaceEditorGuard` on `settings/taxonomies` and
  `settings/marker-types`)
- Edit: `.claude/hooks/runbook-review-guard.sh` (`helpRules`)

## Verification

```bash
cd src/client && ng lint && ng build
cd src/client && npm run test:units
```

Manual: as a viewer, confirm Reference group shows all three guides, the
Taxonomies guide live-renders the space's vocabularies, and direct-navigating to
`settings/taxonomies` / `settings/marker-types` is denied. As an editor/owner,
confirm both the guides and the management pages are reachable.
