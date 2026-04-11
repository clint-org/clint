# MOA / ROA Attributes and Landscape Filters

**Status:** Draft
**Date:** 2026-04-11
**Related:** `docs/specs/landscape-bullseye/spec.md`, `docs/superpowers/specs/2026-04-11-grid-filtering-design.md`

## Summary

Add two new drug attributes — **Mechanism of Action (MOA)** and **Route of Administration (ROA)** — as first-class reference entities managed in the same way as companies, products, and therapeutic areas. Surface them as hideable columns on the dashboard grid, filterable facets on the dashboard filter panel, and a new filter bar on the landscape bullseye. Non-matching dots on the bullseye fade out without reflow. Preferences are session-only.

## Goals

- Let users tag each drug with one or more MOAs and one or more ROAs through the existing manage screens.
- Show MOA and ROA on the dashboard grid as compact, hideable columns.
- Let users filter the dashboard grid and the landscape bullseye by MOA and ROA (plus other facets on the landscape that don't exist today).
- Preserve the bullseye's fixed geometry under filtering by fading non-matching dots rather than reflowing.
- Keep the feature self-contained: no persistent user preferences, no new storage layer.

## Non-Goals

- Persistent user preferences (column visibility, filter state) in localStorage or a DB preferences table. Session-only is explicit.
- Generic column picker for the dashboard grid. Only MOA and ROA are togglable in v1.
- MOA taxonomy / hierarchy / class grouping. Flat list only.
- "Primary" flag on join tables (which MOA or ROA is the main one). Unordered set.
- Visual encoding of MOA or ROA on bullseye dots (color, glyph, badge). Data appears only in the detail panel.
- Sorting the dashboard grid by MOA or ROA.
- Backfilling the in-flight `grid-filtering-design.md` work with column hide/reorder — that remains out of its scope.

## Users and Motivation

Pharma BD analysts scanning competitive landscapes currently cannot ask "show me every PD-1 inhibitor in oncology" or "only IV-administered P3 assets." MOA and ROA are two of the first facets they reach for when triaging a landscape. The feature closes that gap while keeping the existing data-density ethos.

## Architecture Overview

### Data model

Four new tables, all scoped to `space_id` with RLS mirrored from the existing reference tables.

```sql
-- Reference tables
mechanisms_of_action (
  id            uuid primary key,
  space_id      uuid not null references spaces(id) on delete cascade,
  name          text not null,
  description   text,
  display_order integer not null default 0,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (space_id, name)
);

routes_of_administration (
  id            uuid primary key,
  space_id      uuid not null references spaces(id) on delete cascade,
  name          text not null,               -- "Intravenous"
  abbreviation  text,                         -- "IV" (rendered in dense cells)
  display_order integer not null default 0,
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (space_id, name)
);

-- Join tables (many-to-many, unordered)
product_mechanisms_of_action (
  product_id uuid not null references products(id) on delete cascade,
  moa_id     uuid not null references mechanisms_of_action(id) on delete cascade,
  primary key (product_id, moa_id)
);

product_routes_of_administration (
  product_id uuid not null references products(id) on delete cascade,
  roa_id     uuid not null references routes_of_administration(id) on delete cascade,
  primary key (product_id, roa_id)
);
```

RLS policies: SELECT, INSERT, UPDATE, DELETE all gated on the caller being a member of the row's space. Join-table RLS checks the parent product's `space_id`, matching the pattern used elsewhere in the schema.

### RPC update

`get_bullseye_data(p_space_id, p_therapeutic_area_id)` is updated to return two new columns per product:

```
moas jsonb   -- [{ "id": "...", "name": "PD-1 inhibitor" }, ...]
roas jsonb   -- [{ "id": "...", "name": "Intravenous", "abbreviation": "IV" }, ...]
```

Aggregated via `jsonb_agg` with `FILTER (WHERE x.id IS NOT NULL)` so products with zero MOAs return `'[]'::jsonb` not `'[null]'::jsonb`. Ordering within each array is by `display_order` then `name`.

### TypeScript models

```ts
// core/models/mechanism-of-action.model.ts
export interface MechanismOfAction {
  id: string;
  space_id: string;
  name: string;
  description: string | null;
  display_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// core/models/route-of-administration.model.ts
export interface RouteOfAdministration {
  id: string;
  space_id: string;
  name: string;
  abbreviation: string | null;
  display_order: number;
  created_by: string;
  created_at: string;
  updated_at: string;
}

// core/models/product.model.ts — additions
export interface Product {
  // ...existing fields
  mechanisms_of_action?: MechanismOfAction[];
  routes_of_administration?: RouteOfAdministration[];
}

// core/models/landscape.model.ts — additions on BullseyeProduct
export interface BullseyeProduct {
  // ...existing fields
  moas: Array<{ id: string; name: string }>;
  roas: Array<{ id: string; name: string; abbreviation: string | null }>;
}
```

### Services

- **`core/services/mechanism-of-action.service.ts`** — CRUD via Supabase, signal-backed list, mirrors `company.service.ts` exactly. Methods: `list()`, `create()`, `update()`, `delete()`.
- **`core/services/route-of-administration.service.ts`** — same shape as above.
- **`core/services/product.service.ts`** — extended to:
  - Hydrate `mechanisms_of_action` and `routes_of_administration` via Supabase nested selects on the product fetch used by the dashboard and the manage product list.
  - Add `setMechanisms(productId: string, moaIds: string[]): Promise<void>` — two sequential Supabase calls: a `delete` for all rows where `product_id = ?`, then an `insert` of the new set. Both wrapped in a single try/catch so the caller gets one error if either step fails. No server-side RPC for this — the two-call pattern matches how the existing product service handles its other M2M relationships.
  - Add `setRoutes(productId: string, roaIds: string[]): Promise<void>` — same two-call pattern against `product_routes_of_administration`.

## Feature Design

### 1. Manage screens — MOA and ROA CRUD

Two new feature folders under `features/manage/`, each mirroring `features/manage/companies/`:

```
features/manage/mechanisms-of-action/
  list.component.ts       — PrimeNG p-table, uses the shared grid state from the grid-filtering design
  form.component.ts       — dialog with name + description + display_order inputs
  routes.ts               — route definitions

features/manage/routes-of-administration/
  list.component.ts
  form.component.ts       — name + abbreviation + display_order inputs
  routes.ts
```

Two new routes registered in `features/manage/manage.routes.ts`. Two new nav links wherever the manage sidebar / top nav lists companies, products, TAs, marker types.

The list components reuse the shared `createGridState` helper defined in the grid-filtering-design spec so filter/sort/pagination behavior is identical to the existing five manage grids.

### 2. Product form — MOA and ROA selection

`features/manage/products/product-form.component.ts` gains two new fields below the existing inputs:

```
Mechanisms of action    [multiselect: PD-1 inhibitor ×, BCL-2 inhibitor ×  ▾]
Routes of administration [multiselect: IV ×, Oral ×                         ▾]
```

Both use PrimeNG `p-multiselect` populated from the respective service. On save, after the product upsert, the form calls `setMechanisms(productId, moaIds)` and `setRoutes(productId, roaIds)`.

### 3. Dashboard grid — hideable MOA and ROA columns

**Column placement** — between the product cell and the trial cell:

```
Company | Product | MOA | ROA | Trial | Sample | Status | Phase bar ...
```

**MOA cell**: vertical stack of slate pill-chips (`text-[10px]`, slate-700 text on slate-100 background, 2px/6px padding, 3px corner radius). Shows up to 2 MOAs; for 3+ shows the first two then `+N`. Empty state: a dim em-dash. Tooltip on hover shows all MOA names.

**ROA cell**: same pill pattern using `abbreviation` when present (e.g. `PO`, `IV`), falling back to the full name. Tooltip shows full name.

**Column widths**: `min-w-[88px] max-w-[140px]` with the grid's existing text-truncation rule.

**Column-visibility control**:
- A single `p-button` icon (`pi pi-sliders-h`) in the grid toolbar, right-aligned next to the zoom control.
- Opens a `p-popover` labeled "Columns" with two checkboxes:
  ```
  ☑ Mechanism of Action
  ☑ Route of Administration
  ```
- State: two signals on `dashboard-grid.component.ts`:
  ```ts
  readonly showMoaColumn = signal(true);
  readonly showRoaColumn = signal(true);
  ```
- **Scope is MOA/ROA-only for v1.** Existing columns are not togglable. This intentionally aligns with the grid-filtering-design spec which excluded column hide/reorder/resize from its scope.
- Default: both columns visible on first load. Session-only state — no persistence.
- Hidden columns are removed from the DOM entirely (not `display: none`) so screen readers don't announce them.

**Accessibility**:
- Popover button: `aria-label="Toggle columns"`, `aria-haspopup="dialog"`, `aria-expanded` bound to open state.
- Each checkbox: proper `<label for>` association and keyboard-navigable tab order.
- Column headers get `scope="col"`; cells align with the existing grid pattern.

### 4. Dashboard filter panel — MOA and ROA facets

`features/dashboard/filter-panel/filter-panel.component.ts` gains two new `p-multiselect` controls:

- **"Mechanism of Action"** — populated from `MechanismOfActionService.list()`, placeholder `"Any MOA"`.
- **"Route of Administration"** — populated from `RouteOfAdministrationService.list()`, placeholder `"Any route"`.

Both slot below the existing "Therapeutic area" field and above "Phase".

The `DashboardFilters` type on `dashboard.component.ts` gains two new fields:

```ts
type DashboardFilters = {
  // ...existing
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
};
```

**Filter semantics** (applied in the existing `filteredTrials` computed signal):

```
trialPasses(trial) :=
  (moaIds.length === 0 OR trial.product.mechanisms_of_action.some(m => moaIds.includes(m.id)))
  AND
  (roaIds.length === 0 OR trial.product.routes_of_administration.some(r => roaIds.includes(r.id)))
  AND [...existing predicates unchanged]
```

**No URL sync.** Session-only filter state per the design decision — `buildFilterQueryParams` is left untouched. (Note: existing dashboard filters that already serialize to URL params continue to do so; this spec does not add or remove URL persistence for anything.)

### 5. Landscape filter bar

**New component**: `features/landscape/landscape-filter-bar.component.ts`, rendered above the bullseye SVG in `landscape.component.ts`, directly below the existing TA selector.

**Layout** — a data-dense toolbar (not a sidebar panel):

```
[TA: Oncology ▾]   [MOA ▾]  [ROA ▾]  [Company ▾]  [Product ▾]  [Phase: P1 P2 P3 Appr]  [Status ▾]  [Study type ▾]   Clear
```

Each dropdown filter is a compact PrimeNG overlay (`p-multiselect` with icon-only trigger and a count badge when populated). The Phase filter is a segmented button group — small fixed set, needs fast clicks. A "Clear" text button resets all filter fields at once. Active filters get a thin teal underline on the chip.

**State type**:

```ts
type LandscapeFilters = {
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  companyIds: string[];
  productIds: string[];
  phases: TrialPhase[];
  recruitmentStatuses: RecruitmentStatus[];
  studyTypes: StudyType[];
};
```

Stored as a `signal<LandscapeFilters>` on `landscape.component.ts`. Session-only; no URL sync, no localStorage.

**Filter predicate** (applied in a `matchedProductIds` computed signal derived from `bullseyeData + filters`):

```
productMatches(product) :=
  (moaIds.length === 0 OR product.moas.some(m => moaIds.includes(m.id)))
  AND (roaIds.length === 0 OR product.roas.some(r => roaIds.includes(r.id)))
  AND (companyIds.length === 0 OR companyIds.includes(product.company_id))
  AND (productIds.length === 0 OR productIds.includes(product.id))
  AND (phases.length === 0 OR phases.includes(product.highest_phase))
  AND (statuses.length === 0 OR product.trials.some(t => statuses.includes(t.recruitment_status)))
  AND (studyTypes.length === 0 OR product.trials.some(t => studyTypes.includes(t.study_type)))
```

**Filtering is client-side** on already-loaded `bullseyeData`. The RPC is only re-called when the selected TA changes, not when filters change.

### 6. Bullseye fade-out behavior

`bullseye-chart.component.ts` gains an optional input:

```ts
readonly matchedProductIds = input<Set<string> | null>(null);
```

- `null` means "no filter active" — all dots render at full opacity.
- Otherwise, dots whose id is in the set render normally; dots whose id is NOT in the set render with:
  - `opacity: 0.15`
  - `pointer-events: none` (disables hover, click, focus)
  - A dimmed stroke color (slate-300 instead of slate-500)
- Transitions: 200ms ease-out on opacity change, matching the existing polish patterns.
- No layout reflow. Dots stay in their sector and ring.
- Hover tooltips, click-to-select, and keyboard focus are all suppressed on faded dots.

### 7. Landscape detail panel — MOA and ROA display

`bullseye-detail-panel.component.ts` gains two new metadata rows between the company row and the trials list:

```
Mechanism of action
  [PD-1 inhibitor]  [anti-PD-1 mAb]

Route of administration
  [IV]  [SC]
```

Rendered with the same slate pill-chip component used in the grid. If a product has zero MOAs, the entire "Mechanism of action" block is omitted (not shown as em-dash) — the detail panel is already tall and dense, so omitting blank sections reduces noise. Same rule for ROAs.

**No hide toggle** on the detail panel. It's already dismissable as a whole, and this data is load-bearing when the panel is open.

## Data Flow

```
User opens product form in manage
  -> fetches MOAs + ROAs via services (cached in signals)
  -> submits form
  -> upsert product, then setMechanisms + setRoutes
  -> list refreshes

User opens dashboard
  -> fetches trials via product service (nested select hydrates MOAs + ROAs)
  -> column toggle state defaults both to visible
  -> filter panel populates MOA/ROA dropdowns from services
  -> user picks filter -> filteredTrials recomputes -> grid re-renders

User opens landscape
  -> selects TA -> calls get_bullseye_data (now returns moas + roas per product)
  -> opens filter bar -> picks MOA + ROA values
  -> matchedProductIds computed -> bullseye re-renders with fade-out
  -> clicks a dot -> detail panel shows MOA + ROA rows
```

## Error Handling

- If MOA or ROA service calls fail: show a toast ("Unable to load mechanisms of action"), leave the dropdown empty with a "Retry" action. Does not block the dashboard or landscape from rendering.
- If `setMechanisms` / `setRoutes` fail after a successful product upsert: show a toast ("Product saved, but mechanism assignment failed. Try again."), leave the form open. The product exists in a partially-correct state until the user retries or cancels.
- If the RPC returns `null` for `moas` / `roas` (shouldn't happen, but defensively): treat as `[]`.
- Deleting a MOA or ROA that's still assigned to products: cascade is handled by the join table's `on delete cascade`. Before showing the confirm dialog, the manage delete handler runs a count query against the relevant join table (`select count(*) from product_mechanisms_of_action where moa_id = ?`). The dialog text reads "This MOA is assigned to N products. Delete anyway?" when N > 0, or the standard confirm text when N = 0.

## Accessibility

- All new `p-multiselect` controls inherit PrimeNG's built-in keyboard navigation and ARIA labeling.
- Column-toggle popover: `aria-label`, `aria-haspopup`, `aria-expanded`, keyboard-accessible Escape-to-close.
- Landscape filter bar: each filter chip reachable by Tab; Phase segmented buttons use arrow-key navigation within the group.
- Faded bullseye dots have `pointer-events: none` and are removed from the tab order when filtered out (set `tabindex="-1"`).
- `aria-live="polite"` region on the filter bar announces "N of M products shown" after filter changes.
- WCAG 2.1 AA contrast holds on the slate pill-chips (slate-700 on slate-100 = 7.7:1).

## Testing Strategy

**Unit tests**:
- `mechanism-of-action.service.spec.ts` — list, create, update, delete, space-scoping behavior.
- `route-of-administration.service.spec.ts` — same coverage.
- Dashboard filter predicate tests — empty filter, single match, multi-match, no-match edge cases, interaction with existing filters.
- Landscape filter predicate tests — same coverage, including multi-facet intersection.
- RPC fixture test — product with 2 MOAs and 2 ROAs, assert result shape and stable ordering.

**Component tests**:
- `landscape-filter-bar.component.spec.ts` — clicking a MOA chip updates filter signal; Clear resets all; count badges reflect selection; disabled state when TA not yet selected.
- `dashboard-grid.component.spec.ts` — column toggle popover opens, checkboxes flip signal state, columns disappear from DOM (not hidden).

**Accessibility smoke tests**:
- Keyboard-only navigation of the new manage screens, column toggle, and filter bar.
- Screen reader label verification on the column toggle popover.

**Manual QA**:
- Seed the local DB, open the dashboard, toggle the MOA column off and on via the column-visibility popover, apply an MOA filter, verify rows narrow correctly, reload, verify filter state is cleared (session-only, expected).
- Open the landscape, pick a TA, apply MOA + ROA filters, verify dots fade correctly, verify Clear restores, click a filtered-in dot and verify the detail panel shows MOA/ROA pills.
- Edit a product in manage, add two MOAs and one ROA, save, re-open, verify the selections round-trip correctly.
- Delete an MOA that's assigned to one or more products, verify the confirm dialog shows the affected count and that confirming deletes the MOA and removes it from those products.

## Migrations

Three new migration files, ordered:

1. **`YYYYMMDDHHmmss_create_mechanisms_and_routes.sql`** — reference tables + RLS policies + indexes on `(space_id, display_order, name)`.
2. **`YYYYMMDDHHmmss_create_product_moa_roa_join_tables.sql`** — join tables + RLS policies that inherit via the parent product's `space_id`.
3. **`YYYYMMDDHHmmss_update_bullseye_data_function.sql`** — replaces `get_bullseye_data` with the version that returns `moas` and `roas`. Uses `create or replace function`.

Seed file update: `supabase/seed.sql` gains ~8 MOAs, ~7 ROAs, and assigns 1–2 MOAs + 1 ROA to each existing seeded product. The existing seed content is not edited — new INSERTs are appended.

## File Inventory

**New files**:
- `supabase/migrations/<ts>_create_mechanisms_and_routes.sql`
- `supabase/migrations/<ts>_create_product_moa_roa_join_tables.sql`
- `supabase/migrations/<ts>_update_bullseye_data_function.sql`
- `src/client/src/app/core/models/mechanism-of-action.model.ts`
- `src/client/src/app/core/models/route-of-administration.model.ts`
- `src/client/src/app/core/services/mechanism-of-action.service.ts`
- `src/client/src/app/core/services/route-of-administration.service.ts`
- `src/client/src/app/features/manage/mechanisms-of-action/list.component.ts`
- `src/client/src/app/features/manage/mechanisms-of-action/form.component.ts`
- `src/client/src/app/features/manage/mechanisms-of-action/routes.ts`
- `src/client/src/app/features/manage/routes-of-administration/list.component.ts`
- `src/client/src/app/features/manage/routes-of-administration/form.component.ts`
- `src/client/src/app/features/manage/routes-of-administration/routes.ts`
- `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`

**Modified files**:
- `supabase/seed.sql`
- `src/client/src/app/core/models/product.model.ts`
- `src/client/src/app/core/models/landscape.model.ts` (BullseyeProduct)
- `src/client/src/app/core/services/product.service.ts`
- `src/client/src/app/core/services/landscape.service.ts` (type wiring)
- `src/client/src/app/features/manage/manage.routes.ts`
- `src/client/src/app/features/manage/products/product-form.component.ts`
- `src/client/src/app/features/dashboard/dashboard.component.ts` (filters + predicate)
- `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts`
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` (columns + toggle)
- `src/client/src/app/features/dashboard/filter-query-params.ts` (adds `moa`, `roa` keys)
- `src/client/src/app/features/landscape/landscape.component.ts` (filter bar + matchedProductIds)
- `src/client/src/app/features/landscape/bullseye-chart.component.ts` (matchedProductIds input + fade)
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` (MOA/ROA rows)

## Open Questions

None blocking. The "filter by Trial" interpretation on the landscape was resolved as "trial-level attributes (recruitment status, study type)" with `has >= 1 matching trial` semantics. Date range was omitted from v1 to keep the filter bar from exploding; it can be added later if BD analysts ask.
