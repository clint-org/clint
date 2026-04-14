# Navigation and Layout Overhaul

## Summary

Redesign the app shell to fix four interrelated UX issues: inconsistent sidebar expand behavior, redundant page titles across three layers, buried org/space selection, and inconsistent filter display patterns.

## Decisions

| Issue | Decision |
|-------|----------|
| Sidebar expand behavior | Always push content (both hover and pin use `position: relative`) |
| Page identity ownership | Topbar owns all page identity; in-page headers removed |
| Org/Space selection | Both move to topbar as breadcrumb: Org / Space \| Page |
| Filter display | Context-appropriate input (dropdowns for charts, column headers for tables), unified chip output on all pages |

## 1. Sidebar: Always Push

### Current behavior
- Collapsed: 48px, icons only
- Hover-expand: 220px, `position: absolute` (overlay, covers content)
- Pinned: 220px, `position: relative` (pushes content)

### New behavior
- Collapsed: 48px, icons only
- Hover-expand: 220px, `position: relative` (pushes content)
- Pinned: 220px, `position: relative` (pushes content)
- 200ms ease-out transition on width change
- No overlay mode, no shadow, no scrim

### Sidebar header changes
- Remove org name and space picker from sidebar header
- Sidebar header becomes logo mark + pin toggle only
- Pin button remains in the header row (right side of logo) so users can lock the sidebar open
- Org/space selection moves entirely to the topbar

### Files affected
- `src/client/src/app/core/layout/sidebar.component.ts` -- remove overlay CSS (`.sidebar--expanded:not(.sidebar--pinned)` absolute positioning, z-index, box-shadow), remove org/space inputs and template markup, simplify header to logo only
- `src/client/src/app/core/layout/app-shell.component.ts` -- remove org/space props passed to sidebar, add org/space to topbar

## 2. Topbar: Owns All Page Identity

### Structure

The topbar (42px) gets a unified layout across all page types:

```
[Org badge + name ▼] / [Space name ▼] | [Page-specific content] ... [Actions]
```

### Page type variants

**List pages** (Events, Catalysts, Companies, Products, Trials, Settings pages):
```
Org / Space | Events                                    247  [+ New Event]
```
- Title as plain text
- Record count on the right
- Action buttons (e.g., "+ New Event") projected into topbar-actions slot

**Landscape pages** (Timeline, Bullseye, Positioning):
```
Org / Space | Landscape | [Timeline] [Bullseye] [Positioning]     [Export]
```
- Section label "Landscape" followed by tab buttons
- View-specific actions on the right

**Detail pages** (Trial detail):
```
Org / Space | ← Trials | Novo Nordisk / TRIM-1
```
- Back button with parent list name
- Entity context (company) as eyebrow, entity name below

**Blank pages** (no space selected, spaces list):
```
Org / Space |
```
- Just the breadcrumb, no page-specific content

### Org dropdown behavior
- Clicking the org name opens a dropdown listing all tenants (only if 2+ tenants exist)
- Selecting a tenant navigates to `/t/{tenantId}/spaces`
- If only one tenant, the org name is non-interactive (no dropdown arrow)

### Space dropdown behavior
- Clicking the space name opens a dropdown listing all spaces in the current tenant
- Selecting a space navigates to `/t/{tenantId}/s/{spaceId}`
- Dropdown includes space names only (no additional metadata)

### Files affected
- `src/client/src/app/core/layout/contextual-topbar.component.ts` -- add org/space breadcrumb section, add action button content projection for list pages, add org/space inputs and dropdown logic
- `src/client/src/app/core/layout/app-shell.component.ts` -- pass org/space data to topbar, move action button projection through topbar

## 3. Remove In-Page Headers

### What gets removed
- `ManagePageShellComponent` eyebrow, title row, count badge, and action slot
- The component either becomes a padding-only wrapper or is removed entirely
- Each page that uses `<app-manage-page-shell>` needs its title/count/actions moved to topbar

### What stays
- The padding/layout wrapper (if `manage-page-shell` is kept as a simple container)
- Page-level content: search bars, filter toolbars, tables, forms

### Vertical space recovered
- Eyebrow (~16px) + title row (~32px) + padding/border (~24px) = ~60-70px per page

### Pages affected (all current users of `app-manage-page-shell`)
- `features/events/events-page.component.html`
- `features/catalysts/catalysts-page.component.html`
- `features/manage/companies/company-list.component.html`
- `features/manage/products/product-list.component.html`
- `features/manage/trials/trial-list.component.html`
- `features/manage/trials/trial-detail.component.html`
- `features/manage/therapeutic-areas/therapeutic-area-list.component.html`
- `features/manage/routes-of-administration/route-of-administration-list.component.html`
- `features/manage/mechanisms-of-action/mechanism-of-action-list.component.html`
- `features/manage/marker-types/marker-type-list.component.html`
- `features/manage/taxonomies/taxonomies-page.component.ts` (inline template)
- `features/tenant-settings/tenant-settings.component.ts`
- `features/spaces/space-list.component.ts`

### How page actions move to topbar
Each page needs to project its action buttons into the topbar's `topbar-actions` slot. The `app-shell` already supports content projection via `<ng-content select="[topbar-actions]">`. Individual pages will need a mechanism to contribute actions to the topbar -- either through a service signal or through the router outlet context.

Recommended approach: a `TopbarActionsService` with a signal that pages can set, and the shell reads:
```typescript
// Page component sets actions
this.topbarActions.set([{ label: 'New Event', icon: 'fa-plus', action: () => this.openCreate() }]);

// Shell reads and renders in topbar
@for (action of topbarActions(); track action.label) { ... }
```

## 4. Filter Chip Consistency

### Landscape views (new: add chip row)
- Keep the existing multiselect dropdown filter bar (Company, Product, Therapy Area, MOA, ROA, Phase, etc.)
- Add a chip summary row below the filter bar when any filters are active
- Each chip shows `Field: Value` with a remove button
- "Clear" button already exists in the filter bar

### List/grid views (existing: no change to chips)
- Keep PrimeNG column-header filters as the input mechanism
- Keep the existing chip row from `GridToolbarComponent`
- No changes needed -- this pattern already works

### Chip styling (shared)
Both chip rows use identical styling:
- `inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700`
- Field label in `text-slate-500`, value in `text-slate-700`
- Remove button: `fa-xmark` icon, `text-slate-400 hover:text-slate-700`

### Files affected
- `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` -- add chip summary row below the dropdown filters, reading from `LandscapeStateService.filters` signal
- Consider extracting a shared `FilterChipRowComponent` if the chip markup is worth reusing (evaluate during implementation)

## Component Impact Summary

| Component | Change |
|-----------|--------|
| `SidebarComponent` | Remove overlay CSS, remove org/space UI, keep pin toggle, simplify header to logo + pin |
| `ContextualTopbarComponent` | Add org/space breadcrumb, add list-page title/count/actions, add dropdown logic |
| `AppShellComponent` | Rewire org/space to topbar, add `TopbarActionsService`, remove org/space props from sidebar |
| `ManagePageShellComponent` | Strip to padding wrapper or remove |
| `LandscapeFilterBarComponent` | Add chip summary row |
| `LandscapeShellComponent` | Remove view-specific controls that duplicate topbar (export button moves to topbar) |
| All page components using `manage-page-shell` | Move title/count/actions to topbar via service |

## Out of Scope

- Landscape filter bar dropdown redesign (input mechanism stays as-is)
- Grid column filter UI changes (PrimeNG column filters stay as-is)
- Mobile/responsive behavior changes
- Notification bell relocation (stays in topbar-actions)
- Settings pages layout changes beyond header removal
