# Grid Filtering, Sorting, and Pagination — Design

**Status:** Draft — awaiting review before implementation plan
**Date:** 2026-04-11
**Scope:** Add in-place column filtering, multi-column sorting, and pagination to every tabular grid in the manage section (five grids: companies, products, trials, therapeutic-areas, marker-types). Replace the existing one-way deep-link filter pattern (`?company=<id>`, `?product=<id>`) with a unified, URL-synced filter model. Keep the existing PrimeNG `p-table` baseline; do not introduce a new data-grid library.

**Explicitly excluded:** `space-list` is a responsive card grid (clickable cards in a CSS grid), not a tabular `p-table`. Cards have at most 5–30 entries per tenant and serve a workspace-picker role, not a data-exploration role. Building a card-grid variant of the toolbar would add infrastructure for a use case nobody asked for. Out of scope for this design.

---

## 1. Problem

Today, the five manage list pages (companies, products, trials, therapeutic-areas, marker-types) have no in-place filtering, no sorting, and no pagination. The only filtering affordance is a one-way deep-link pattern set by the dashboard — clicking a company on the dashboard navigates to `products?company=<id>` and the product list filters itself to that company. There is no way to start from the products page and filter to one company, and no way to filter by any other field on any grid.

This is a missing floor, not a missing ceiling. BD analysts need to be able to explore the grids ad-hoc without being forced through a specific navigation path.

## 2. Goals and non-goals

**In scope:**
- Per-column sorting on every grid (click header to sort, click again to reverse, third click clears)
- Per-column filtering via PrimeNG's built-in funnel-icon popovers — text, select, numeric, date kinds depending on column type
- A slim top toolbar per grid with global search input + active-filters chip row + clear-all button
- Pagination (PrimeNG paginator, 25 rows default, options [10, 25, 50, 100])
- All filter/sort/page state URL-synced as query params — shareable links, back-button-safe, refresh-preserving
- Legacy `?company=<id>` / `?product=<id>` deep-links recognized on load and rewritten to the unified schema
- One shared pattern used by all five grids

**Out of scope (explicitly deferred):**
- Switching to AG Grid (would be a library migration project, not a filtering project — revisit when data scale outgrows PrimeNG)
- Excel-style set filters, advanced multi-condition filter builder, column picker, density toggle, CSV export, saved views per user (workbench features — premature until users live in the grids)
- Server-side row model / virtualization — current row counts (companies ~50, products ~300, trials ~2000 at realistic space size) don't warrant server-side filtering
- localStorage persistence of last-used filter state (URL is the source of truth; opening a page with no query params defaults to unfiltered)
- Column resize / reorder / hide

## 3. Design principles (restated from brand guide)

- Instrument-grade density — the toolbar is compact, borderless, slate-tinted. No toolbar chrome unless it earns its pixels.
- Authority through restraint — PrimeNG's built-in column filter popovers already feel Bloomberg-Terminal-shaped. Don't overbuild.
- WCAG AA baseline — keyboard navigation through search input, chips, and clear-all; ARIA labels on every interactive element; focus-visible on all controls.
- One mental model for filters — arriving via deep-link and filtering in place are the same thing, represented the same way in the URL and the chip row.

## 4. Architecture overview

Three isolated units, one wiring pattern per grid:

```
                          URL (source of truth)
                                ↕
                       ┌──────────────────┐
                       │  createGridState │   pure factory
                       │  (filter/sort/    │   - owns filter algebra
                       │   page signals +  │   - owns URL encode/decode
                       │   URL sync)       │   - exposes filteredRows(raw)
                       └──────────────────┘
                         ↑           ↓
                 events  │           │ state
                         │           ↓
  ┌──────────────┐  ┌────────┐  ┌────────────────┐
  │   p-table    │  │ grid-  │  │ list component │
  │  (lazy=true) │←─│toolbar │←─│ (owns columns, │
  │              │  │        │  │  cells, CRUD)  │
  └──────────────┘  └────────┘  └────────────────┘
```

**Isolation guarantee:** the list component never handles URL params, never implements filter logic, never renders toolbar chrome. It owns its columns, its cells, its CRUD. Everything filter-related is behind the `grid` interface.

**Why not a generic grid wrapper with columns config?** The existing grids have meaningfully custom cell rendering — teal navigation-link buttons, status tags, row-action menus with per-row dynamic items, logo images with error fallbacks, trial counts that become arrow links. Forcing those through a columns config inverts template control and turns the wrapper into a mini framework. At five grids with rich cells, that's premature abstraction; the shared-helper-plus-presenter pattern lets each list component stay in charge of its own cells.

## 5. `createGridState` helper

**Location:** `src/client/src/app/shared/grids/create-grid-state.ts`

**Shape:** plain factory function, no Angular DI ceremony. Called from inside a component, returns a plain object of signals and methods. Internally it reads `ActivatedRoute` and `Router` via `inject()` (which works inside component constructors / field initializers).

### Input config

```ts
interface GridConfig<T> {
  columns: ColumnDef<T>[];
  globalSearchFields: string[];        // view-model paths the toolbar search hits
  defaultSort?: { field: string; order: 1 | -1 };
  defaultPageSize?: number;            // default 25
  pageSizeOptions?: number[];          // default [10, 25, 50, 100]
  legacyQueryParamAdapter?: (params: ParamMap) => Partial<FilterState>;
}

interface ColumnDef<T> {
  field: string;                       // supports dotted paths, e.g. 'product.company_id'
  header: string;
  filter?:
    | { kind: 'text' }
    | { kind: 'select'; options: () => { label: string; value: unknown }[] }
    | { kind: 'numeric' }
    | { kind: 'date' };
  sortable?: boolean;                  // default true when field is present
}
```

### Return shape

```ts
interface GridState<T> {
  // writable signals
  globalSearch: WritableSignal<string>;
  filters: WritableSignal<Record<string, FilterValue>>;
  sort: WritableSignal<{ field: string; order: 1 | -1 } | null>;
  page: WritableSignal<{ first: number; rows: number }>;

  // derived
  activeFilters: Signal<ActiveFilterChip[]>;
  isFiltered: Signal<boolean>;
  totalRecords: Signal<number>;        // post-filter, pre-paginate

  // projection — wrap the component's raw rows signal, returns the visible page
  filteredRows: (raw: Signal<T[]>) => Signal<T[]>;

  // event handlers wired to p-table
  onLazyLoad: (e: TableLazyLoadEvent) => void;
  onGlobalSearchInput: (value: string) => void;

  // imperative
  clearAll: () => void;
  clearFilter: (field: string) => void;
}
```

### Internal behavior

- **URL decode** runs once in the factory from the current `ActivatedRoute` snapshot. If a `legacyQueryParamAdapter` is provided and the current params match a legacy shape, it runs first and the URL is rewritten to the unified shape via `router.navigate([], { queryParams, replaceUrl: true })`. `replaceUrl: true` prevents a back-button trap on the legacy migration step.
- **URL encode** runs inside an Angular `effect()` that reads all four signals and produces a normalized query-param map. If the encoded map equals the current URL's query-param map, nothing happens — this avoids echo loops when decode-then-encode is identity. Otherwise `router.navigate([], { queryParams, replaceUrl: true })` updates the URL. `replaceUrl` means filter toggles don't pollute history; top-level route changes still create history entries.
- **Filter algebra** applies in order: (1) debounced global search across `globalSearchFields`, contains, case-insensitive; (2) per-column filters — text contains, select `in`, numeric with operator, date range; (3) sort via `Intl.Collator('en', { numeric: true, sensitivity: 'base' })` for text and numeric compare for numbers; (4) page slice. Pure function over the raw rows signal, no side effects.
- **Debounce** for global search is a second signal that updates after 200 ms of idle. The filter algebra reads the debounced signal, not the raw input, so typing is responsive but filtering doesn't thrash.
- **Page reset:** any filter or global-search change resets `page` to `{ first: 0, rows: page().rows }`. Sort changes do NOT reset page — matches spreadsheet muscle memory.
- **Stale select values:** if a select filter contains a value that no longer matches any live option (e.g., deleted company UUID in URL), the filter stays active with a fallback chip label `<Header>: <unknown>`. The table renders its "no matches" empty state. User can click `×` to clear. This surfaces stale deep-links rather than silently un-filtering.

## 6. `<app-grid-toolbar>` component

**Location:** `src/client/src/app/shared/components/grid-toolbar.component.ts`

Pure presenter. Standalone, signals, `inject()`.

**Inputs:**
- `state: GridState<unknown>` — the object returned by `createGridState`
- `searchPlaceholder: string` — e.g. "Search products..."

**Outputs:** none. Writes directly to `state` signals.

**Layout:**

```
┌─────────────────────────────────────────────────────────────┐
│ [🔍 Search products...]           [Clear all (3)]           │  ← always rendered
│ Company: Pfizer ×   Status: Active ×   Name: "emp" ×        │  ← only when activeFilters().length > 0
└─────────────────────────────────────────────────────────────┘
```

- Row 1 is always rendered. Search input ~18rem wide, left-aligned. Clear-all is right-aligned, `severity="secondary"` text button, shows active filter count in parens, disabled when count is 0.
- Row 2 is conditional (`@if (state.activeFilters().length > 0)`). Chips render as small slate-50 background / slate-700 text pills, tight horizontal padding, tiny `×` button aligned right of each label. Matches existing `status-tag` aesthetic.
- Search input uses PrimeNG `pInputText` with a Font Awesome search icon prefix.
- Vertical rhythm: `mb-3` below the toolbar to separate from the table, `mt-2` on row 2 when rendered. No borders, no background fill — structure inside the shell, matches brand restraint.

**Accessibility:**
- Search input: `aria-label` from `searchPlaceholder`
- Chip `×`: `aria-label="Remove <Header>: <Value> filter"`
- Clear-all: `aria-label="Clear all filters"`
- Tab order: search input → each chip's `×` in visual order → clear-all

## 7. Per-grid wiring pattern

Each list component adds ~20-30 lines plus a column-config object. Custom cell templates stay unchanged. Illustrated with `product-list.component.ts`:

**TypeScript delta:**

```ts
import { createGridState } from '../../../shared/grids/create-grid-state';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';

// inside the component class:
readonly grid = createGridState<ProductRow>({
  columns: [
    { field: 'product.name', header: 'Name', filter: { kind: 'text' } },
    { field: 'product.generic_name', header: 'Generic', filter: { kind: 'text' } },
    {
      field: 'product.company_id',
      header: 'Company',
      filter: {
        kind: 'select',
        options: () => this.companies().map(c => ({ label: c.name, value: c.id })),
      },
    },
    { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
    { field: 'product.display_order', header: 'Order', filter: { kind: 'numeric' } },
  ],
  globalSearchFields: ['product.name', 'product.generic_name', 'companyName'],
  defaultSort: { field: 'product.display_order', order: 1 },
  legacyQueryParamAdapter: (params) => {
    const company = params.get('company');
    return company
      ? { filters: { 'product.company_id': { kind: 'select', values: [company] } } }
      : {};
  },
});

readonly visibleRows = this.grid.filteredRows(this.rows);
```

**Removed from the component:**
- `companyFilter` signal, `companyLabel` computed, `clearFilter()` method
- `queryParamMap.subscribe(...)` in `ngOnInit`
- inline `.filter(p => !filter || p.company_id === filter)` in the `rows` computed — `rows` now only decorates

**Template delta:**

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Products"
  [count]="grid.totalRecords()"
  subtitle="Drug programs being tracked. Click a product to drill into its trials."
>
  <div actions>
    <p-button label="Add product" ... />
  </div>

  <app-grid-toolbar [state]="grid" searchPlaceholder="Search products..." />

  <p-table
    styleClass="manage-table"
    [value]="visibleRows()"
    [loading]="loading()"
    [tableStyle]="{ 'min-width': '56rem' }"
    [lazy]="true"
    (onLazyLoad)="grid.onLazyLoad($event)"
    [paginator]="true"
    [rows]="grid.page().rows"
    [first]="grid.page().first"
    [totalRecords]="grid.totalRecords()"
    [rowsPerPageOptions]="[10, 25, 50, 100]"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="product.name">
          Name <p-sortIcon field="product.name" />
          <p-columnFilter type="text" field="product.name" display="menu" />
        </th>
        <!-- etc. -->
      </tr>
    </ng-template>
    <!-- body template unchanged -->
    <ng-template #emptymessage>
      <tr>
        <td colspan="6">
          @if (grid.isFiltered()) {
            No products match your filters.
          } @else {
            No products yet. Add one to get started.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>
</app-manage-page-shell>
```

**PrimeNG coupling:** `<p-columnFilter>` inside column headers with `[lazy]="true"` on `<p-table>` makes PrimeNG emit `TableLazyLoadEvent` on filter/sort/page commits. `grid.onLazyLoad` translates that event shape into unified filter-state updates. The column filter's *display* (menu popover, text input, select dropdown, accessible popover markup) stays PrimeNG's; `createGridState` just captures the commit event and owns the actual filter semantics. One adapter point.

**Keeping PrimeNG's popover state in sync:** `p-table` also has a `[filters]` input (a `Record<string, FilterMetadata[]>`) that drives what the column-filter popover shows when re-opened. Because our unified filter model is the source of truth, `createGridState` exposes a derived signal `primengFilters()` that translates the unified state into PrimeNG's `FilterMetadata` shape, and the template binds `[filters]="grid.primengFilters()"`. Reopening a column filter popover then shows the current active values, not stale ones. This is the one adapter layer between our model and PrimeNG's internals; keeping it isolated in the helper means individual list components never need to touch `FilterMetadata` directly.

**Accessibility of column filter popovers:** PrimeNG's built-in `<p-columnFilter>` ships with ARIA-labeled popover markup, focus management, and keyboard support (Escape to close, Enter to commit). The Playwright integration test verifies keyboard-driven filter flow end-to-end so any PrimeNG regression here is caught.

The same pattern applies to the other four grids with their own column configs.

### Per-grid column and filter summary

Columns are listed in display order. "Sortable only" columns have a click-to-sort header but no filter popover. Logo, Color, and actions columns are neither sortable nor filterable.

| Grid | Columns filterable / sortable | Legacy deep-link |
|---|---|---|
| `company-list` | name (text), display_order (numeric, sortable only) | — |
| `product-list` | name (text), generic_name (text), company_id (select from companies), trialCount (numeric), display_order (numeric, sortable only) | `?company=<id>` |
| `trial-list` | name (text), identifier (text), product_id (select from products), companyName (select from companies, via product join), status (select from trial status enum), phaseCount (numeric), markerCount (numeric) | `?product=<id>` |
| `therapeutic-area-list` | name (text), abbreviation (text) | — |
| `marker-type-list` | name (text), shape (select from enum), fill_style (select from enum), origin (select from enum) | — |

## 8. URL schema

Every default is omitted. Unfiltered grids have clean URLs.

| Concept | Shape | Example |
|---|---|---|
| Global search | `q=<text>` | `?q=empagliflozin` |
| Text filter | `filter.<field>=<contains>` | `?filter.product.name=emp` |
| Select filter (single) | `filter.<field>=<value>` | `?filter.product.company_id=abc123` |
| Select filter (multi) | `filter.<field>=<a>,<b>` | `?filter.status=active,recruiting` |
| Numeric filter | `filter.<field>=<op>:<n>` | `?filter.trialCount=gte:5` |
| Date range filter | `filter.<field>=<from>..<to>` | `?filter.created=2025-01-01..2025-12-31` |
| Sort asc | `sort=<field>` | `?sort=product.name` |
| Sort desc | `sort=-<field>` | `?sort=-trialCount` |
| Page (1-indexed) | `page=<n>` | `?page=2` |
| Page size | `pageSize=<n>` | `?pageSize=50` |

**Notes:**
- Dotted field paths are allowed in query-param keys; Angular Router encodes them safely.
- Commas in select values are assumed not to occur (all select filters filter by UUIDs, enums, or phase names). If a future column needs comma-safe multi-select, it switches to repeated params (`filter.x=a&filter.x=b`) — `createGridState` recognizes both forms.
- Numeric operators: `eq` (default, bare — `filter.trialCount=5` means equals 5), `gte`, `lte`, `gt`, `lt`.
- Round-trip identity: parsing URL → state → re-encoding produces the same query-param set (order-insensitive). Unit-tested explicitly.
- Legacy adapters run before anything else and rewrite the URL via `replaceUrl: true`. After that, only the unified schema is emitted.

## 9. Error handling and edge cases

- **Malformed filter param** (e.g., `?filter.trialCount=banana`): catch parse error, single `console.warn` with offending key, drop filter, rewrite URL via `replaceUrl`. Do not crash, do not surface user-facing error.
- **Unknown field** (`?filter.fooBar=x` where no column matches): drop silently, rewrite URL.
- **Stale select value** (`?filter.product.company_id=<deleted-uuid>`): keep the filter active, show chip with fallback label `Company: <unknown>`, table renders "no matches" empty state. Surfaces the stale state; user clicks `×` to clear.
- **Empty filtered result:** `<ng-template #emptymessage>` conditioned on `grid.isFiltered()` to distinguish "no data yet" ("Add one to get started") from "no matches for your filters."
- **Page out of range:** if URL says `?page=9` but filtered set has 3 pages, clamp to last non-empty page during decode, rewrite URL.
- **Filter changes reset page to first:** `page` signal resets to `{ first: 0, rows: page().rows }`. Sort changes do NOT reset page.
- **CRUD modal close:** `loadData()` refreshes raw rows; filter/sort/page state preserved. If current page is now out of range after a delete, clamp.
- **Race between legacy adapter and manual URL edits:** adapter runs only on initial snapshot. Manual legacy URL edits after that won't parse; acceptable because no supported flow does this.
- **Query-param encoding of special characters:** delegated to Angular Router. Global search with `&`, `=`, `%` round-trips safely.
- **`manage-page-shell`'s `count` input** now reads `grid.totalRecords()` (post-filter) rather than `rows().length` (raw). Semantic change: header shows "Products (7)" when filtered to 7, not "Products (122)". Matches what users expect from a filtered view and what chip count implies. Total unfiltered count is no longer displayed; defer adding it until asked.

## 10. Testing

**Unit — `createGridState`** (plain TS, signal-aware via `TestBed.runInInjectionContext`):

- URL encode/decode round-trip for every filter kind (text, select single, select multi, numeric each operator, date range)
- Legacy query-param adapter: `?company=<id>` on products translates correctly and rewrites URL
- Filter algebra: text contains case-insensitive, select `in`, numeric operators, date range bounds, global search across multiple fields
- Sort stability: equal keys preserve insertion order; text sort uses `Intl.Collator` numeric+base-sensitivity
- Page slicing, reset-on-filter-change, clamp-out-of-range
- `clearAll()` / `clearFilter(field)` update both signals and URL
- Stale select value preserved with fallback chip label

**Component — `GridToolbarComponent`** (Angular TestBed):

- Chip row renders from `state.activeFilters()`
- Clear-all disabled when empty, enabled otherwise
- Clicking chip `×` calls `state.clearFilter(field)`
- Search input two-way binds with 200 ms debounce (fake timers)
- Accessibility: search input has `aria-label`, chips have descriptive `aria-label` on remove

**Integration / Playwright — product-list** (covers legacy deep-link, select filter, text filter, sort, paginate):

- Open products page, verify default state
- Type in global search, verify URL updates and row count drops
- Open Company column filter, select one, verify chip appears, verify URL
- Click sortable column header, verify sort indicator + URL
- Click paginator page 2, verify `?page=2` in URL
- Browser back, verify previous state restored
- Navigate via legacy dashboard → company → products deep-link, verify URL rewritten to unified shape and chip shows company name
- Clear all, verify URL returns to clean shape

**Regression — dashboard deep-link to products page** stays one test in the existing dashboard spec.

## 11. Rollout

Single PR. All five grids migrate together. Reasons:
- `createGridState` + `GridToolbarComponent` must exist before any grid can use them
- Migrating one grid at a time leaves the codebase in an inconsistent state where some grids have filtering and others don't — confusing for users and reviewers
- The five grids are small; migration is mechanical once the pattern is proven on the first one
- Runbook update for the frontend architecture doc is one change, not five

Implementation order inside the PR:
1. `createGridState` helper + unit tests
2. `GridToolbarComponent` + component test
3. `product-list` migration (hardest — has legacy deep-link, select filter, richest columns) — validates the pattern end-to-end
4. Remaining four grids, in any order
5. Playwright integration test
6. `docs/runbook/05-frontend-architecture.md` update documenting the pattern

## 12. Open questions / follow-ups

- Should the `manage-page-shell` `count` show "7 of 122" when filtered, or just "7"? Deferred — start with just "7", revisit after usage.
- Should legacy `?company=<id>` URLs remain valid indefinitely, or can they be removed once the dashboard's click-through is updated to emit the new shape? Safe answer: support both forever (cost is tiny — one small adapter function).
- Global search debounce is 200 ms by default. Adjust after usage if it feels wrong.
- Default page size is 25. Adjust per grid if any grid has obviously different ideal density.
