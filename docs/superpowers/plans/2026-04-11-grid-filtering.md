# Grid Filtering, Sorting, and Pagination Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add in-place column filtering, sorting, and pagination to all five manage-section grids (companies, products, trials, therapeutic-areas, marker-types), with URL-synced state, a shared top toolbar (global search + active-filter chips), and backward compatibility with the existing `?company=<id>` / `?product=<id>` dashboard deep-links.

**Architecture:** One shared factory function `createGridState<T>()` owns filter/sort/page signals and URL encode/decode. A shared presenter `<app-grid-toolbar>` renders the slim toolbar. Each list component keeps its own `<p-table>` markup, flips it to `[lazy]="true"`, wires PrimeNG's events to the state, and passes `grid.filteredRows(rawRows)` to `[value]`. No new data-grid library — we stay on PrimeNG `p-table`.

**Tech Stack:** Angular 19 (standalone components, signals, new control flow), PrimeNG 19 (`p-table`, `p-columnFilter`, `pSortableColumn`, paginator), Tailwind CSS v4, Angular Router for query-param sync. Playwright for all tests (the project has no unit test runner; pure-function tests live in Playwright spec files that never request the `page` fixture, so no browser is launched for them).

**Spec:** `docs/superpowers/specs/2026-04-11-grid-filtering-design.md`

**Rollout:** Single PR. The order below is deliberate — pure modules first, then the factory that composes them, then the presenter, then the pilot grid (products — the hardest, because it has a select filter against a related collection and an outbound deep-link callsite to update), then the remaining four grids, then integration tests, then docs.

---

## File Structure

**New files (shared infrastructure):**

- `src/client/src/app/shared/grids/filter-types.ts` — TypeScript type definitions (FilterValue, ColumnDef, GridConfig, GridState, ActiveFilterChip, FilterState). Pure types, no runtime code.
- `src/client/src/app/shared/grids/url-codec.ts` — Pure functions: `encodeFilterState(state) → Params` and `decodeFilterState(params, columns) → FilterState`. Zero Angular imports.
- `src/client/src/app/shared/grids/filter-algebra.ts` — Pure functions: `applyGlobalSearch`, `applyColumnFilters`, `applySort`, `applyPage`, and the `applyAll` composition. Zero Angular imports.
- `src/client/src/app/shared/grids/create-grid-state.ts` — The factory. Composes url-codec + filter-algebra with Angular signals and effects. Imports `inject`, `signal`, `computed`, `effect` from `@angular/core` and `ActivatedRoute`, `Router` from `@angular/router`.
- `src/client/src/app/shared/grids/index.ts` — Barrel export for the three consumer-facing symbols (`createGridState`, `ColumnDef`, `GridState`).
- `src/client/src/app/shared/components/grid-toolbar.component.ts` — Standalone presenter with inline template. Imports `InputTextModule`, `ButtonModule` from PrimeNG.

**New files (tests, under `src/client/e2e/tests/`):**

- `grid-url-codec.spec.ts` — Pure-function Playwright tests for the URL codec. No `page` fixture.
- `grid-filter-algebra.spec.ts` — Pure-function Playwright tests for the filter algebra. No `page` fixture.
- `grid-filtering-products.spec.ts` — Browser-driven Playwright integration test covering sort, text filter, select filter, global search, pagination, URL round-trip, back button, and inbound deep-link from the companies page on the products grid.

**Modified files:**

- `src/client/src/app/features/manage/products/product-list.component.ts` — add `grid` field, column config; update `openTrials()` to emit unified URL shape via `buildFilterQueryParams`; remove `companyFilter`, `companyLabel`, `clearFilter`, `queryParamMap` subscription, inline `.filter(...)` from `rows` computed.
- `src/client/src/app/features/manage/products/product-list.component.html` — replace subtitle's "Filtered to X" / "Clear filter" button with `<app-grid-toolbar>`; add `[lazy]`, paginator, sort, column-filter bindings to `<p-table>`; update empty message to distinguish "no matches" from "no data"; switch `[count]` to `grid.totalRecords()`; switch `[value]` to `visibleRows()`.
- `src/client/src/app/features/manage/companies/company-list.component.ts` — add `grid` + column config; update `openProducts()` to emit unified URL shape via `buildFilterQueryParams`.
- `src/client/src/app/features/manage/companies/company-list.component.html` — same template pattern as products.
- `src/client/src/app/features/manage/trials/trial-list.component.ts` — add `grid` + column config; remove inline filter.
- `src/client/src/app/features/manage/trials/trial-list.component.html` — same template pattern; covers all seven filter columns.
- `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts` — add `grid` + column config.
- `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html` — same template pattern.
- `src/client/src/app/features/manage/marker-types/marker-type-list.component.ts` — add `grid` + column config.
- `src/client/src/app/features/manage/marker-types/marker-type-list.component.html` — same template pattern.
- `docs/runbook/05-frontend-architecture.md` — document the `createGridState` / `GridToolbar` pattern.

---

## Task 1: Type definitions

**Files:**
- Create: `src/client/src/app/shared/grids/filter-types.ts`

- [ ] **Step 1: Create the filter-types file**

Create `src/client/src/app/shared/grids/filter-types.ts` with:

```ts
import type { Signal, WritableSignal } from '@angular/core';

/**
 * The committed value for a single column filter. Shape depends on filter kind.
 */
export type FilterValue =
  | { kind: 'text'; contains: string }
  | { kind: 'select'; values: unknown[] }
  | { kind: 'numeric'; op: 'eq' | 'gte' | 'lte' | 'gt' | 'lt'; value: number }
  | { kind: 'date'; from: string | null; to: string | null };

/**
 * Declarative column definition. Each filterable column also drives chip labels.
 */
export interface ColumnDef<T> {
  /** Dotted path into the row view-model, e.g. 'product.company_id' or 'companyName'. */
  field: string;
  /** Display header — also used as the chip label prefix. */
  header: string;
  /** Omit to mean "no filter on this column". */
  filter?:
    | { kind: 'text' }
    | { kind: 'select'; options: () => { label: string; value: unknown }[] }
    | { kind: 'numeric' }
    | { kind: 'date' };
  /** Default true when field is present. Set false to suppress the sort header. */
  sortable?: boolean;
  /** Optional custom value getter. Defaults to dotted-path lookup on T. */
  getValue?: (row: T) => unknown;
}

/**
 * Full grid state — serializable to/from URL query params.
 */
export interface FilterState {
  globalSearch: string;
  filters: Record<string, FilterValue>;
  sort: { field: string; order: 1 | -1 } | null;
  page: { first: number; rows: number };
}

/**
 * Config passed to createGridState by each list component.
 */
export interface GridConfig<T> {
  columns: ColumnDef<T>[];
  /** View-model paths the toolbar's global search hits. */
  globalSearchFields: string[];
  defaultSort?: { field: string; order: 1 | -1 };
  /** Default 25. */
  defaultPageSize?: number;
  /** Default [10, 25, 50, 100]. */
  pageSizeOptions?: number[];
}

/**
 * Human-readable representation of one active filter, used by the chip row.
 */
export interface ActiveFilterChip {
  field: string;
  header: string;
  /** Formatted value to display after the header, e.g. "Pfizer" or "contains 'emp'". */
  label: string;
}

/**
 * What createGridState returns. List components bind to this in templates.
 */
export interface GridState<T> {
  readonly globalSearch: WritableSignal<string>;
  readonly filters: WritableSignal<Record<string, FilterValue>>;
  readonly sort: WritableSignal<{ field: string; order: 1 | -1 } | null>;
  readonly page: WritableSignal<{ first: number; rows: number }>;

  readonly activeFilters: Signal<ActiveFilterChip[]>;
  readonly isFiltered: Signal<boolean>;
  readonly totalRecords: Signal<number>;

  filteredRows: (raw: Signal<T[]>) => Signal<T[]>;

  onLazyLoad: (e: { first?: number; rows?: number; sortField?: string | null; sortOrder?: number | null; filters?: Record<string, { value: unknown; matchMode?: string }[] | { value: unknown; matchMode?: string }> }) => void;
  onGlobalSearchInput: (value: string) => void;

  /** PrimeNG filter-metadata shape derived from the unified state, for two-way binding to `<p-table [filters]>`. */
  readonly primengFilters: Signal<Record<string, { value: unknown; matchMode: string }[]>>;

  clearAll: () => void;
  clearFilter: (field: string) => void;
}
```

- [ ] **Step 2: Confirm the file compiles**

Run: `cd src/client && npx tsc --noEmit -p tsconfig.json`
Expected: clean exit, no errors. (The file is only imported later; this step just verifies syntax and type resolution.)

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/grids/filter-types.ts
git commit -m "feat(grids): add shared filter type definitions"
```

---

## Task 2: URL codec — failing test

**Files:**
- Create: `src/client/e2e/tests/grid-url-codec.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/client/e2e/tests/grid-url-codec.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
  encodeFilterState,
  decodeFilterState,
  buildFilterQueryParams,
} from '../../src/app/shared/grids/url-codec';
import type { ColumnDef, FilterState } from '../../src/app/shared/grids/filter-types';

// Shared fixture columns used across codec tests.
interface Row {
  name: string;
  companyId: string;
  trialCount: number;
  created: string;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', filter: { kind: 'text' } },
  { field: 'companyId', header: 'Company', filter: { kind: 'select', options: () => [] } },
  { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
  { field: 'created', header: 'Created', filter: { kind: 'date' } },
];

const defaultPage = { first: 0, rows: 25 };

test.describe('url-codec', () => {
  test('encodes empty state to empty params', () => {
    const state: FilterState = { globalSearch: '', filters: {}, sort: null, page: defaultPage };
    const params = encodeFilterState(state, { defaultPage });
    expect(params).toEqual({});
  });

  test('encodes global search', () => {
    const state: FilterState = {
      globalSearch: 'empagliflozin',
      filters: {},
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ q: 'empagliflozin' });
  });

  test('encodes text filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { name: { kind: 'text', contains: 'emp' } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.name': 'emp' });
  });

  test('encodes single-value select filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { companyId: { kind: 'select', values: ['abc123'] } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.companyId': 'abc123' });
  });

  test('encodes multi-value select filter as comma-separated', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { companyId: { kind: 'select', values: ['a', 'b', 'c'] } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.companyId': 'a,b,c' });
  });

  test('encodes numeric filter with eq as bare value', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { trialCount: { kind: 'numeric', op: 'eq', value: 5 } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.trialCount': '5' });
  });

  test('encodes numeric filter with gte as prefixed value', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ 'filter.trialCount': 'gte:5' });
  });

  test('encodes date range filter', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: { created: { kind: 'date', from: '2025-01-01', to: '2025-12-31' } },
      sort: null,
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({
      'filter.created': '2025-01-01..2025-12-31',
    });
  });

  test('encodes ascending sort as bare field name', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: { field: 'name', order: 1 },
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ sort: 'name' });
  });

  test('encodes descending sort with minus prefix', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: { field: 'trialCount', order: -1 },
      page: defaultPage,
    };
    expect(encodeFilterState(state, { defaultPage })).toEqual({ sort: '-trialCount' });
  });

  test('omits default page and page size', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 0, rows: 25 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({});
  });

  test('encodes non-default page (1-indexed in URL)', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 25, rows: 25 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({
      page: '2',
    });
  });

  test('encodes non-default page size', () => {
    const state: FilterState = {
      globalSearch: '',
      filters: {},
      sort: null,
      page: { first: 0, rows: 50 },
    };
    expect(encodeFilterState(state, { defaultPage: { first: 0, rows: 25 } })).toEqual({
      pageSize: '50',
    });
  });

  test('round trips empty state', () => {
    const empty: FilterState = { globalSearch: '', filters: {}, sort: null, page: defaultPage };
    const params = encodeFilterState(empty, { defaultPage });
    const decoded = decodeFilterState(new Map(Object.entries(params)), columns, { defaultPage });
    expect(decoded).toEqual(empty);
  });

  test('round trips a rich state', () => {
    const rich: FilterState = {
      globalSearch: 'emp',
      filters: {
        name: { kind: 'text', contains: 'emp' },
        companyId: { kind: 'select', values: ['a', 'b'] },
        trialCount: { kind: 'numeric', op: 'gte', value: 3 },
      },
      sort: { field: 'trialCount', order: -1 },
      page: { first: 50, rows: 25 },
    };
    const params = encodeFilterState(rich, { defaultPage });
    const decoded = decodeFilterState(new Map(Object.entries(params)), columns, { defaultPage });
    expect(decoded).toEqual(rich);
  });

  test('drops unknown filter field with a warning', () => {
    const params = new Map(Object.entries({ 'filter.unknownField': 'x' }));
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters).toEqual({});
  });

  test('drops malformed numeric filter value', () => {
    const params = new Map(Object.entries({ 'filter.trialCount': 'banana' }));
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters).toEqual({});
  });

  test('handles repeated-param form for select filters', () => {
    // Simulating URLSearchParams.getAll would return ['a', 'b']; we accept a Map<string, string | string[]>
    const params = new Map<string, string | string[]>([['filter.companyId', ['a', 'b']]]);
    const decoded = decodeFilterState(params, columns, { defaultPage });
    expect(decoded.filters['companyId']).toEqual({ kind: 'select', values: ['a', 'b'] });
  });
});

test.describe('buildFilterQueryParams', () => {
  test('produces query params for a single select filter', () => {
    const params = buildFilterQueryParams({
      'product.company_id': { kind: 'select', values: ['abc123'] },
    });
    expect(params).toEqual({ 'filter.product.company_id': 'abc123' });
  });

  test('produces query params for a text filter', () => {
    const params = buildFilterQueryParams({
      name: { kind: 'text', contains: 'emp' },
    });
    expect(params).toEqual({ 'filter.name': 'emp' });
  });

  test('returns empty object for empty filter map', () => {
    expect(buildFilterQueryParams({})).toEqual({});
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail with "module not found"**

Run: `cd src/client && npx playwright test e2e/tests/grid-url-codec.spec.ts --reporter=list`
Expected: test file fails at import time because `url-codec.ts` does not exist yet. This is the TDD red state.

---

## Task 3: URL codec — implementation

**Files:**
- Create: `src/client/src/app/shared/grids/url-codec.ts`

- [ ] **Step 1: Write the implementation**

Create `src/client/src/app/shared/grids/url-codec.ts`:

```ts
import type { ColumnDef, FilterState, FilterValue } from './filter-types';

interface CodecOptions {
  /** The defaults — if state matches these, they're omitted from the encoded URL. */
  defaultPage: { first: number; rows: number };
}

/**
 * Encode a FilterState into a plain query-param map. Values use the schema
 * documented in spec section 8. Defaults are omitted so unfiltered grids have
 * clean URLs.
 */
export function encodeFilterState(
  state: FilterState,
  options: CodecOptions
): Record<string, string> {
  const out: Record<string, string> = {};

  if (state.globalSearch) {
    out['q'] = state.globalSearch;
  }

  for (const [field, value] of Object.entries(state.filters)) {
    const encoded = encodeFilterValue(value);
    if (encoded !== null) {
      out[`filter.${field}`] = encoded;
    }
  }

  if (state.sort) {
    out['sort'] = state.sort.order === 1 ? state.sort.field : `-${state.sort.field}`;
  }

  const { defaultPage } = options;
  if (state.page.rows !== defaultPage.rows) {
    out['pageSize'] = String(state.page.rows);
  }
  if (state.page.first !== defaultPage.first) {
    const pageNumber = Math.floor(state.page.first / state.page.rows) + 1;
    out['page'] = String(pageNumber);
  }

  return out;
}

function encodeFilterValue(value: FilterValue): string | null {
  switch (value.kind) {
    case 'text':
      return value.contains ? value.contains : null;
    case 'select':
      return value.values.length > 0 ? value.values.map(String).join(',') : null;
    case 'numeric':
      return value.op === 'eq' ? String(value.value) : `${value.op}:${value.value}`;
    case 'date':
      if (value.from === null && value.to === null) return null;
      return `${value.from ?? ''}..${value.to ?? ''}`;
  }
}

/**
 * Decode a query-param map back into FilterState. Accepts either a
 * single-value string or a string[] per key (for repeated-param form of
 * multi-value selects). Invalid values are dropped with a console warning.
 */
export function decodeFilterState<T>(
  params: Map<string, string | string[]>,
  columns: ColumnDef<T>[],
  options: CodecOptions
): FilterState {
  const columnsByField = new Map(columns.map((c) => [c.field, c]));

  const state: FilterState = {
    globalSearch: '',
    filters: {},
    sort: null,
    page: { ...options.defaultPage },
  };

  for (const [key, rawValue] of params.entries()) {
    const value = Array.isArray(rawValue) ? rawValue : rawValue;

    if (key === 'q') {
      state.globalSearch = firstString(value);
      continue;
    }

    if (key === 'sort') {
      const v = firstString(value);
      if (v.startsWith('-')) {
        state.sort = { field: v.slice(1), order: -1 };
      } else if (v) {
        state.sort = { field: v, order: 1 };
      }
      continue;
    }

    if (key === 'page') {
      const n = parseInt(firstString(value), 10);
      if (Number.isFinite(n) && n >= 1) {
        state.page = {
          ...state.page,
          first: (n - 1) * state.page.rows,
        };
      }
      continue;
    }

    if (key === 'pageSize') {
      const n = parseInt(firstString(value), 10);
      if (Number.isFinite(n) && n > 0) {
        state.page = { ...state.page, rows: n };
      }
      continue;
    }

    if (key.startsWith('filter.')) {
      const field = key.slice('filter.'.length);
      const col = columnsByField.get(field);
      if (!col || !col.filter) {
        console.warn(`[grid] Dropping filter for unknown or non-filterable field: ${field}`);
        continue;
      }
      const parsed = parseFilterValue(col.filter.kind, value);
      if (parsed !== null) {
        state.filters[field] = parsed;
      } else {
        console.warn(`[grid] Dropping malformed filter value for ${field}: ${JSON.stringify(value)}`);
      }
    }
  }

  return state;
}

function firstString(value: string | string[]): string {
  return Array.isArray(value) ? (value[0] ?? '') : value;
}

function parseFilterValue(
  kind: 'text' | 'select' | 'numeric' | 'date',
  raw: string | string[]
): FilterValue | null {
  switch (kind) {
    case 'text': {
      const v = firstString(raw);
      return v ? { kind: 'text', contains: v } : null;
    }
    case 'select': {
      if (Array.isArray(raw)) {
        return raw.length > 0 ? { kind: 'select', values: raw.slice() } : null;
      }
      const values = raw.split(',').filter((s) => s.length > 0);
      return values.length > 0 ? { kind: 'select', values } : null;
    }
    case 'numeric': {
      const v = firstString(raw);
      const match = /^(gte|lte|gt|lt):(-?\d+(\.\d+)?)$/.exec(v);
      if (match) {
        return { kind: 'numeric', op: match[1] as 'gte' | 'lte' | 'gt' | 'lt', value: Number(match[2]) };
      }
      const bare = Number(v);
      return Number.isFinite(bare) ? { kind: 'numeric', op: 'eq', value: bare } : null;
    }
    case 'date': {
      const v = firstString(raw);
      const m = /^([^.]*)\.\.(.*)$/.exec(v);
      if (!m) return null;
      const from = m[1] || null;
      const to = m[2] || null;
      if (from === null && to === null) return null;
      return { kind: 'date', from, to };
    }
  }
}

/**
 * Build query params for deep-linking into a grid with specific filters
 * pre-applied. Thin wrapper over encodeFilterState for the common case of
 * "just set these filters, start on page 1, default page size, no sort".
 * Consumers like company-list::openProducts() use this so they don't have
 * to know the full URL schema.
 */
export function buildFilterQueryParams(
  filters: Record<string, FilterValue>,
  pageSize = 25
): Record<string, string> {
  return encodeFilterState(
    {
      globalSearch: '',
      filters,
      sort: null,
      page: { first: 0, rows: pageSize },
    },
    { defaultPage: { first: 0, rows: pageSize } }
  );
}
```

- [ ] **Step 2: Run the test — expect all cases to pass**

Run: `cd src/client && npx playwright test e2e/tests/grid-url-codec.spec.ts --reporter=list`
Expected: all 21 tests pass (18 codec tests + 3 buildFilterQueryParams tests). If any fail, fix the codec, not the tests.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/grids/url-codec.ts src/client/e2e/tests/grid-url-codec.spec.ts
git commit -m "feat(grids): add URL codec with pure-function tests"
```

---

## Task 4: Filter algebra — failing test

**Files:**
- Create: `src/client/e2e/tests/grid-filter-algebra.spec.ts`

- [ ] **Step 1: Write the failing test file**

Create `src/client/e2e/tests/grid-filter-algebra.spec.ts`:

```ts
import { test, expect } from '@playwright/test';
import {
  applyGlobalSearch,
  applyColumnFilters,
  applySort,
  applyPage,
  applyAll,
} from '../../src/app/shared/grids/filter-algebra';
import type { ColumnDef, FilterState } from '../../src/app/shared/grids/filter-types';

interface Row {
  id: string;
  name: string;
  companyId: string;
  trialCount: number;
}

const rows: Row[] = [
  { id: '1', name: 'Empagliflozin', companyId: 'c1', trialCount: 12 },
  { id: '2', name: 'Dapagliflozin', companyId: 'c1', trialCount: 8 },
  { id: '3', name: 'Canagliflozin', companyId: 'c2', trialCount: 5 },
  { id: '4', name: 'Ertugliflozin', companyId: 'c3', trialCount: 2 },
  { id: '5', name: 'Sotagliflozin', companyId: 'c2', trialCount: 0 },
];

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name', filter: { kind: 'text' } },
  { field: 'companyId', header: 'Company', filter: { kind: 'select', options: () => [] } },
  { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
];

const searchFields = ['name'];
const defaultPage = { first: 0, rows: 25 };

function makeState(partial: Partial<FilterState> = {}): FilterState {
  return {
    globalSearch: '',
    filters: {},
    sort: null,
    page: defaultPage,
    ...partial,
  };
}

test.describe('filter-algebra', () => {
  test('global search matches case-insensitively across searchFields', () => {
    const result = applyGlobalSearch(rows, 'EMP', searchFields);
    expect(result.map((r) => r.name)).toEqual(['Empagliflozin']);
  });

  test('global search with empty string is a no-op', () => {
    expect(applyGlobalSearch(rows, '', searchFields)).toEqual(rows);
  });

  test('text column filter does contains match', () => {
    const result = applyColumnFilters(rows, { name: { kind: 'text', contains: 'gli' } }, columns);
    expect(result).toHaveLength(5);
  });

  test('text column filter is case-insensitive', () => {
    const result = applyColumnFilters(rows, { name: { kind: 'text', contains: 'EMP' } }, columns);
    expect(result.map((r) => r.name)).toEqual(['Empagliflozin']);
  });

  test('select filter matches any value in the set', () => {
    const result = applyColumnFilters(
      rows,
      { companyId: { kind: 'select', values: ['c1', 'c2'] } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['1', '2', '3', '5']);
  });

  test('numeric eq filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'eq', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id)).toEqual(['3']);
  });

  test('numeric gte filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['1', '2', '3']);
  });

  test('numeric lt filter', () => {
    const result = applyColumnFilters(
      rows,
      { trialCount: { kind: 'numeric', op: 'lt', value: 5 } },
      columns
    );
    expect(result.map((r) => r.id).sort()).toEqual(['4', '5']);
  });

  test('sort ascending by string uses natural collation', () => {
    const result = applySort(rows, { field: 'name', order: 1 });
    expect(result.map((r) => r.name)).toEqual([
      'Canagliflozin',
      'Dapagliflozin',
      'Empagliflozin',
      'Ertugliflozin',
      'Sotagliflozin',
    ]);
  });

  test('sort descending by numeric', () => {
    const result = applySort(rows, { field: 'trialCount', order: -1 });
    expect(result.map((r) => r.trialCount)).toEqual([12, 8, 5, 2, 0]);
  });

  test('sort is stable for equal keys', () => {
    const tied: Row[] = [
      { id: 'A', name: 'X', companyId: 'c1', trialCount: 5 },
      { id: 'B', name: 'X', companyId: 'c2', trialCount: 5 },
      { id: 'C', name: 'X', companyId: 'c3', trialCount: 5 },
    ];
    const result = applySort(tied, { field: 'name', order: 1 });
    expect(result.map((r) => r.id)).toEqual(['A', 'B', 'C']);
  });

  test('paginate slices first page', () => {
    const result = applyPage(rows, { first: 0, rows: 2 });
    expect(result.map((r) => r.id)).toEqual(['1', '2']);
  });

  test('paginate slices second page', () => {
    const result = applyPage(rows, { first: 2, rows: 2 });
    expect(result.map((r) => r.id)).toEqual(['3', '4']);
  });

  test('applyAll composes global search + filter + sort + page', () => {
    const state = makeState({
      globalSearch: 'gli',
      filters: { companyId: { kind: 'select', values: ['c1', 'c2'] } },
      sort: { field: 'trialCount', order: -1 },
      page: { first: 0, rows: 2 },
    });
    const { rows: visible, total } = applyAll(rows, state, columns, searchFields);
    expect(total).toBe(4); // c1 and c2 rows after global search (all match 'gli')
    expect(visible.map((r) => r.id)).toEqual(['1', '2']); // trialCount desc: 12, 8, 5, 0 → first two
  });

  test('applyAll returns total as post-filter, pre-paginate count', () => {
    const state = makeState({
      filters: { trialCount: { kind: 'numeric', op: 'gte', value: 5 } },
      page: { first: 0, rows: 2 },
    });
    const { rows: visible, total } = applyAll(rows, state, columns, searchFields);
    expect(total).toBe(3);
    expect(visible).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run the test — expect it to fail with module not found**

Run: `cd src/client && npx playwright test e2e/tests/grid-filter-algebra.spec.ts --reporter=list`
Expected: fails at import because `filter-algebra.ts` does not exist yet.

---

## Task 5: Filter algebra — implementation

**Files:**
- Create: `src/client/src/app/shared/grids/filter-algebra.ts`

- [ ] **Step 1: Write the implementation**

Create `src/client/src/app/shared/grids/filter-algebra.ts`:

```ts
import type { ColumnDef, FilterState, FilterValue } from './filter-types';

const collator = new Intl.Collator('en', { numeric: true, sensitivity: 'base' });

/**
 * Resolve a dotted field path on a row. Safe against missing intermediates.
 */
function getField(row: unknown, field: string): unknown {
  let current: unknown = row;
  for (const segment of field.split('.')) {
    if (current == null) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

export function applyGlobalSearch<T>(rows: T[], query: string, fields: string[]): T[] {
  const q = query.trim().toLowerCase();
  if (!q) return rows;
  return rows.filter((row) =>
    fields.some((f) => {
      const v = getField(row, f);
      return v != null && String(v).toLowerCase().includes(q);
    })
  );
}

export function applyColumnFilters<T>(
  rows: T[],
  filters: Record<string, FilterValue>,
  columns: ColumnDef<T>[]
): T[] {
  const columnsByField = new Map(columns.map((c) => [c.field, c]));
  const entries = Object.entries(filters);
  if (entries.length === 0) return rows;

  return rows.filter((row) =>
    entries.every(([field, value]) => {
      const col = columnsByField.get(field);
      const raw = col?.getValue ? col.getValue(row) : getField(row, field);
      return matchFilter(raw, value);
    })
  );
}

function matchFilter(raw: unknown, filter: FilterValue): boolean {
  switch (filter.kind) {
    case 'text': {
      if (raw == null) return false;
      return String(raw).toLowerCase().includes(filter.contains.toLowerCase());
    }
    case 'select': {
      if (filter.values.length === 0) return true;
      return filter.values.some((v) => v === raw);
    }
    case 'numeric': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return false;
      switch (filter.op) {
        case 'eq':
          return raw === filter.value;
        case 'gte':
          return raw >= filter.value;
        case 'lte':
          return raw <= filter.value;
        case 'gt':
          return raw > filter.value;
        case 'lt':
          return raw < filter.value;
      }
    }
    case 'date': {
      if (raw == null) return false;
      const s = String(raw);
      if (filter.from && s < filter.from) return false;
      if (filter.to && s > filter.to) return false;
      return true;
    }
  }
}

export function applySort<T>(
  rows: T[],
  sort: { field: string; order: 1 | -1 } | null
): T[] {
  if (!sort) return rows;
  // Decorate-sort-undecorate for stable sort with numeric fallback.
  const decorated = rows.map((row, index) => ({
    row,
    index,
    key: getField(row, sort.field),
  }));
  decorated.sort((a, b) => {
    const av = a.key;
    const bv = b.key;
    if (av == null && bv == null) return a.index - b.index;
    if (av == null) return 1;
    if (bv == null) return -1;
    let cmp: number;
    if (typeof av === 'number' && typeof bv === 'number') {
      cmp = av - bv;
    } else {
      cmp = collator.compare(String(av), String(bv));
    }
    if (cmp !== 0) return sort.order === 1 ? cmp : -cmp;
    return a.index - b.index; // stable
  });
  return decorated.map((d) => d.row);
}

export function applyPage<T>(rows: T[], page: { first: number; rows: number }): T[] {
  return rows.slice(page.first, page.first + page.rows);
}

/**
 * Compose the full pipeline. Returns the visible page plus the post-filter
 * total count for pagination display.
 */
export function applyAll<T>(
  rows: T[],
  state: FilterState,
  columns: ColumnDef<T>[],
  globalSearchFields: string[]
): { rows: T[]; total: number } {
  const searched = applyGlobalSearch(rows, state.globalSearch, globalSearchFields);
  const filtered = applyColumnFilters(searched, state.filters, columns);
  const sorted = applySort(filtered, state.sort);
  const paged = applyPage(sorted, state.page);
  return { rows: paged, total: filtered.length };
}
```

- [ ] **Step 2: Run the test — expect all cases to pass**

Run: `cd src/client && npx playwright test e2e/tests/grid-filter-algebra.spec.ts --reporter=list`
Expected: all 15 tests pass.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/grids/filter-algebra.ts src/client/e2e/tests/grid-filter-algebra.spec.ts
git commit -m "feat(grids): add pure filter/sort/paginate algebra with tests"
```

---

## Task 6: createGridState factory

**Files:**
- Create: `src/client/src/app/shared/grids/create-grid-state.ts`
- Create: `src/client/src/app/shared/grids/index.ts`

- [ ] **Step 1: Write the factory**

Create `src/client/src/app/shared/grids/create-grid-state.ts`:

```ts
import { computed, effect, inject, signal, Signal, WritableSignal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';

import type {
  ActiveFilterChip,
  ColumnDef,
  FilterState,
  FilterValue,
  GridConfig,
  GridState,
} from './filter-types';
import { encodeFilterState, decodeFilterState } from './url-codec';
import { applyAll } from './filter-algebra';

const DEFAULT_PAGE_SIZE = 25;
const GLOBAL_SEARCH_DEBOUNCE_MS = 200;

/**
 * Factory that wires up a reactive grid state bound to URL query params.
 *
 * MUST be called from within an Angular injection context (component field
 * initializer or constructor). Uses inject() internally for ActivatedRoute
 * and Router, and effect() for URL sync.
 */
export function createGridState<T>(config: GridConfig<T>): GridState<T> {
  const route = inject(ActivatedRoute);
  const router = inject(Router);

  const defaultPageSize = config.defaultPageSize ?? DEFAULT_PAGE_SIZE;
  const defaultPage = { first: 0, rows: defaultPageSize };
  const initialSort = config.defaultSort ?? null;

  // --- decode initial state from URL ----------------------------------------
  const initialParams = paramsMapFromSnapshot(route.snapshot.queryParamMap);
  let initial: FilterState = decodeFilterState(initialParams, config.columns, { defaultPage });

  // Apply default sort if URL didn't specify one.
  if (!initial.sort && initialSort) {
    initial = { ...initial, sort: initialSort };
  }

  // --- core signals ---------------------------------------------------------
  const globalSearch: WritableSignal<string> = signal(initial.globalSearch);
  const debouncedGlobalSearch: WritableSignal<string> = signal(initial.globalSearch);
  const filters: WritableSignal<Record<string, FilterValue>> = signal(initial.filters);
  const sort: WritableSignal<{ field: string; order: 1 | -1 } | null> = signal(initial.sort);
  const page: WritableSignal<{ first: number; rows: number }> = signal(initial.page);

  let debounceTimer: ReturnType<typeof setTimeout> | null = null;

  function onGlobalSearchInput(value: string): void {
    globalSearch.set(value);
    if (debounceTimer !== null) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      debouncedGlobalSearch.set(value);
      // Reset page on search change.
      page.update((p) => ({ first: 0, rows: p.rows }));
    }, GLOBAL_SEARCH_DEBOUNCE_MS);
  }

  // --- URL sync effect ------------------------------------------------------
  effect(() => {
    const state: FilterState = {
      globalSearch: debouncedGlobalSearch(),
      filters: filters(),
      sort: sort(),
      page: page(),
    };
    const encoded = encodeFilterState(state, { defaultPage });
    const current = paramsMapFromSnapshot(route.snapshot.queryParamMap);
    if (sameParams(encoded, current)) return;
    router.navigate([], {
      relativeTo: route,
      queryParams: encoded,
      replaceUrl: true,
    });
  });

  // --- derived state --------------------------------------------------------
  const activeFilters: Signal<ActiveFilterChip[]> = computed(() => {
    const out: ActiveFilterChip[] = [];
    const q = debouncedGlobalSearch();
    if (q) {
      out.push({ field: '__q__', header: 'Search', label: `"${q}"` });
    }
    const columnsByField = new Map(config.columns.map((c) => [c.field, c]));
    for (const [field, value] of Object.entries(filters())) {
      const col = columnsByField.get(field);
      if (!col) continue;
      out.push({ field, header: col.header, label: formatFilterLabel(col, value) });
    }
    return out;
  });

  const isFiltered: Signal<boolean> = computed(() => activeFilters().length > 0);

  const primengFilters: Signal<Record<string, { value: unknown; matchMode: string }[]>> = computed(() => {
    const out: Record<string, { value: unknown; matchMode: string }[]> = {};
    for (const [field, value] of Object.entries(filters())) {
      switch (value.kind) {
        case 'text':
          out[field] = [{ value: value.contains, matchMode: 'contains' }];
          break;
        case 'select':
          out[field] = [{ value: value.values, matchMode: 'in' }];
          break;
        case 'numeric':
          out[field] = [{ value: value.value, matchMode: value.op }];
          break;
        case 'date':
          out[field] = [{ value: [value.from, value.to], matchMode: 'dateRange' }];
          break;
      }
    }
    return out;
  });

  // --- filteredRows + totalRecords ------------------------------------------
  // The consumer wires the raw rows signal exactly once via filteredRows(raw).
  // We stash it in a closed-over reference and use it for both the visible
  // page and the post-filter total, derived from a single applyAll() call.
  let rawRowsSignal: Signal<T[]> | null = null;

  const applyAllResult = computed(() => {
    const raw = rawRowsSignal?.() ?? [];
    const state: FilterState = {
      globalSearch: debouncedGlobalSearch(),
      filters: filters(),
      sort: sort(),
      page: page(),
    };
    return applyAll(raw, state, config.columns, config.globalSearchFields);
  });

  const filteredRows = (raw: Signal<T[]>): Signal<T[]> => {
    rawRowsSignal = raw;
    return computed(() => applyAllResult().rows);
  };

  const totalRecords: Signal<number> = computed(() => applyAllResult().total);

  // Clamp page.first if it's out of range for the current filtered total.
  // E.g., user deletes a row or loads a URL with page=9 on a small dataset.
  effect(() => {
    const total = applyAllResult().total;
    const p = page();
    if (total > 0 && p.first >= total) {
      const lastPageFirst = Math.max(0, Math.floor((total - 1) / p.rows) * p.rows);
      page.set({ first: lastPageFirst, rows: p.rows });
    }
  });

  // --- event handlers wired to p-table [lazy] -------------------------------
  function onLazyLoad(event: {
    first?: number;
    rows?: number;
    sortField?: string | string[] | null;
    sortOrder?: number | null;
    filters?: Record<string, { value: unknown; matchMode?: string }[] | { value: unknown; matchMode?: string }>;
  }): void {
    if (typeof event.first === 'number' && typeof event.rows === 'number') {
      page.set({ first: event.first, rows: event.rows });
    }
    if (typeof event.sortField === 'string' && event.sortOrder != null) {
      sort.set({ field: event.sortField, order: event.sortOrder >= 0 ? 1 : -1 });
    } else if (event.sortField === null) {
      sort.set(null);
    }
    if (event.filters) {
      const next: Record<string, FilterValue> = {};
      for (const [field, meta] of Object.entries(event.filters)) {
        const metaArr = Array.isArray(meta) ? meta[0] : meta;
        if (!metaArr || metaArr.value == null || metaArr.value === '') continue;
        const col = config.columns.find((c) => c.field === field);
        if (!col?.filter) continue;
        const parsed = primengToFilterValue(col.filter.kind, metaArr);
        if (parsed) next[field] = parsed;
      }
      filters.set(next);
      // Any filter change resets page.
      page.update((p) => ({ first: 0, rows: p.rows }));
    }
  }

  function clearAll(): void {
    globalSearch.set('');
    debouncedGlobalSearch.set('');
    filters.set({});
    page.update((p) => ({ first: 0, rows: p.rows }));
  }

  function clearFilter(field: string): void {
    if (field === '__q__') {
      globalSearch.set('');
      debouncedGlobalSearch.set('');
      return;
    }
    filters.update((f) => {
      const next = { ...f };
      delete next[field];
      return next;
    });
    page.update((p) => ({ first: 0, rows: p.rows }));
  }

  return {
    globalSearch,
    filters,
    sort,
    page,
    activeFilters,
    isFiltered,
    totalRecords,
    filteredRows,
    onLazyLoad,
    onGlobalSearchInput,
    primengFilters,
    clearAll,
    clearFilter,
  };
}

function paramsMapFromSnapshot(map: import('@angular/router').ParamMap): Map<string, string | string[]> {
  const out = new Map<string, string | string[]>();
  for (const key of map.keys) {
    const all = map.getAll(key);
    out.set(key, all.length > 1 ? all : (all[0] ?? ''));
  }
  return out;
}

function sameParams(a: Record<string, string>, b: Map<string, string | string[]>): boolean {
  const aKeys = Object.keys(a).sort();
  const bKeys = Array.from(b.keys()).sort();
  if (aKeys.length !== bKeys.length) return false;
  for (let i = 0; i < aKeys.length; i++) {
    if (aKeys[i] !== bKeys[i]) return false;
    const bv = b.get(aKeys[i]);
    const bStr = Array.isArray(bv) ? bv.join(',') : bv;
    if (a[aKeys[i]] !== bStr) return false;
  }
  return true;
}

function formatFilterLabel<T>(col: ColumnDef<T>, value: FilterValue): string {
  switch (value.kind) {
    case 'text':
      return `contains "${value.contains}"`;
    case 'select': {
      if (col.filter?.kind !== 'select') return value.values.join(', ');
      const options = col.filter.options();
      const labels = value.values.map((v) => {
        const opt = options.find((o) => o.value === v);
        return opt ? opt.label : `<${String(v)}>`;
      });
      return labels.join(', ');
    }
    case 'numeric':
      return value.op === 'eq' ? String(value.value) : `${value.op} ${value.value}`;
    case 'date':
      return `${value.from ?? ''} – ${value.to ?? ''}`;
  }
}

function primengToFilterValue(
  kind: 'text' | 'select' | 'numeric' | 'date',
  meta: { value: unknown; matchMode?: string }
): FilterValue | null {
  switch (kind) {
    case 'text':
      return typeof meta.value === 'string' && meta.value
        ? { kind: 'text', contains: meta.value }
        : null;
    case 'select': {
      const arr = Array.isArray(meta.value) ? meta.value : [meta.value];
      return arr.length > 0 && arr[0] != null ? { kind: 'select', values: arr } : null;
    }
    case 'numeric': {
      if (typeof meta.value !== 'number' || !Number.isFinite(meta.value)) return null;
      const op = (meta.matchMode ?? 'eq') as 'eq' | 'gte' | 'lte' | 'gt' | 'lt';
      return { kind: 'numeric', op, value: meta.value };
    }
    case 'date': {
      if (!Array.isArray(meta.value) || meta.value.length !== 2) return null;
      const [from, to] = meta.value as [string | null, string | null];
      return { kind: 'date', from, to };
    }
  }
}
```

- [ ] **Step 2: Create the barrel export**

Create `src/client/src/app/shared/grids/index.ts`:

```ts
export { createGridState } from './create-grid-state';
export { buildFilterQueryParams } from './url-codec';
export type { ColumnDef, GridConfig, GridState, FilterValue, FilterState } from './filter-types';
```

- [ ] **Step 3: Confirm compilation**

Run: `cd src/client && npx ng lint && npx tsc --noEmit -p tsconfig.json`
Expected: no errors. Fix any lint/type issues inline before committing.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/grids/create-grid-state.ts src/client/src/app/shared/grids/index.ts
git commit -m "feat(grids): add createGridState factory with URL sync"
```

---

## Task 7: GridToolbar component

**Files:**
- Create: `src/client/src/app/shared/components/grid-toolbar.component.ts`

- [ ] **Step 1: Write the component**

Create `src/client/src/app/shared/components/grid-toolbar.component.ts`:

```ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputTextModule } from 'primeng/inputtext';

import type { GridState } from '../grids/filter-types';

@Component({
  selector: 'app-grid-toolbar',
  standalone: true,
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [FormsModule, ButtonModule, InputTextModule],
  template: `
    <div class="grid-toolbar mb-3">
      <div class="flex items-center justify-between gap-3">
        <span class="relative">
          <i
            class="fa-solid fa-magnifying-glass absolute left-3 top-1/2 -translate-y-1/2 text-[11px] text-slate-400"
            aria-hidden="true"
          ></i>
          <input
            pInputText
            type="text"
            class="w-72 pl-8"
            [attr.aria-label]="searchPlaceholder()"
            [placeholder]="searchPlaceholder()"
            [ngModel]="state().globalSearch()"
            (ngModelChange)="onSearchInput($event)"
          />
        </span>

        <p-button
          label="Clear all"
          severity="secondary"
          [text]="true"
          size="small"
          [disabled]="!state().isFiltered()"
          (onClick)="state().clearAll()"
          [attr.aria-label]="'Clear all filters'"
        />
      </div>

      @if (state().activeFilters().length > 0) {
        <div class="mt-2 flex flex-wrap items-center gap-2" role="list" aria-label="Active filters">
          @for (chip of state().activeFilters(); track chip.field) {
            <span
              role="listitem"
              class="inline-flex items-center gap-1.5 rounded bg-slate-100 px-2 py-0.5 text-[11px] font-medium text-slate-700"
            >
              <span class="text-slate-500">{{ chip.header }}:</span>
              <span>{{ chip.label }}</span>
              <button
                type="button"
                class="-mr-0.5 ml-0.5 rounded text-slate-400 hover:text-slate-700 focus:outline-none focus:ring-1 focus:ring-teal-500"
                [attr.aria-label]="'Remove ' + chip.header + ' ' + chip.label + ' filter'"
                (click)="state().clearFilter(chip.field)"
              >
                <i class="fa-solid fa-xmark text-[10px]"></i>
              </button>
            </span>
          }
        </div>
      }
    </div>
  `,
})
// The toolbar never calls `filteredRows` (the only T-dependent method on
// GridState<T>), so the T parameter is effectively unused here. Using
// `GridState<any>` lets any concrete row type bind cleanly via structural
// assignment. GridState<ProductRow> is not assignable to GridState<unknown>
// because the generic is invariant through the filteredRows signature.
export class GridToolbarComponent {
  readonly state = input.required<GridState<any>>();
  readonly searchPlaceholder = input<string>('Search...');

  onSearchInput(value: string): void {
    this.state().onGlobalSearchInput(value);
  }
}
```

- [ ] **Step 2: Lint and typecheck**

Run: `cd src/client && npx ng lint && npx tsc --noEmit -p tsconfig.json`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/components/grid-toolbar.component.ts
git commit -m "feat(grids): add GridToolbar presenter component"
```

---

## Task 8: Pilot migration — product-list

This task is the longest because `product-list` is the hardest grid: it has a select filter against a related collection, the richest column set, and an outbound `openTrials()` callsite that must be updated to emit the unified URL shape. Getting this right proves the pattern.

**Files:**
- Modify: `src/client/src/app/features/manage/products/product-list.component.ts`
- Modify: `src/client/src/app/features/manage/products/product-list.component.html`

- [ ] **Step 1: Rewrite `product-list.component.ts`**

Replace the entire file with:

```ts
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { TrialService } from '../../../core/services/trial.service';
import { ProductFormComponent } from './product-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { buildFilterQueryParams, createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

interface ProductRow {
  readonly product: Product;
  readonly companyName: string;
  readonly trialCount: number;
}

@Component({
  selector: 'app-product-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    ProductFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    GridToolbarComponent,
  ],
  templateUrl: './product-list.component.html',
})
export class ProductListComponent implements OnInit {
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  trialCounts = signal<Record<string, number>>({});
  loading = signal(false);
  modalOpen = signal(false);
  editingProduct = signal<Product | null>(null);
  deleteError = signal<string | null>(null);

  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private trialService = inject(TrialService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);

  spaceId = '';
  tenantId = '';

  private readonly menuCache = new Map<string, MenuItem[]>();

  readonly rows = computed<ProductRow[]>(() => {
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    const counts = this.trialCounts();
    return this.products().map((product) => ({
      product,
      companyName: companyMap.get(product.company_id)?.name ?? '--',
      trialCount: counts[product.id] ?? 0,
    }));
  });

  readonly grid = createGridState<ProductRow>({
    columns: [
      { field: 'product.name', header: 'Name', filter: { kind: 'text' } },
      { field: 'product.generic_name', header: 'Generic', filter: { kind: 'text' } },
      {
        field: 'product.company_id',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companies().map((c) => ({ label: c.name, value: c.id })),
        },
      },
      { field: 'trialCount', header: 'Trials', filter: { kind: 'numeric' } },
      { field: 'product.display_order', header: 'Order' },
    ],
    globalSearchFields: ['product.name', 'product.generic_name', 'companyName'],
    defaultSort: { field: 'product.display_order', order: 1 },
  });

  readonly visibleRows = this.grid.filteredRows(this.rows);

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    await this.loadData();
  }

  rowMenu(row: ProductRow): MenuItem[] {
    const cached = this.menuCache.get(row.product.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'View trials',
        icon: 'fa-solid fa-flask',
        command: () => this.openTrials(row.product.id),
      },
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(row.product),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.confirmDelete(row.product),
      },
    ];
    this.menuCache.set(row.product.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingProduct.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(product: Product): void {
    this.editingProduct.set(product);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingProduct.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadData();
  }

  openTrials(productId: string): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials'], {
      queryParams: buildFilterQueryParams({
        'trial.product_id': { kind: 'select', values: [productId] },
      }),
    });
  }

  async confirmDelete(product: Product): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete product',
      message: `Delete "${product.name}"? This cannot be undone.`,
    });
    if (!ok) return;

    this.deleteError.set(null);
    try {
      await this.productService.delete(product.id);
      await this.loadData();
    } catch (err) {
      this.deleteError.set(
        err instanceof Error
          ? err.message
          : 'Could not delete product. It may have associated trials.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [products, companies, trials] = await Promise.all([
        this.productService.list(this.spaceId),
        this.companyService.list(this.spaceId),
        this.trialService.listBySpace(this.spaceId),
      ]);
      this.products.set(products);
      this.companies.set(companies);
      const counts: Record<string, number> = {};
      for (const trial of trials) {
        counts[trial.product_id] = (counts[trial.product_id] ?? 0) + 1;
      }
      this.trialCounts.set(counts);
      this.menuCache.clear();
    } catch {
      // Silently handle - empty list shown
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 2: Rewrite `product-list.component.html`**

Replace the entire file with:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Products"
  [count]="grid.totalRecords()"
  subtitle="Drug programs being tracked. Click a product to drill into its trials."
>
  <div actions>
    <p-button
      label="Add product"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
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
    [filters]="grid.primengFilters()"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="product.name">
          Name <p-sortIcon field="product.name" />
          <p-columnFilter type="text" field="product.name" display="menu" />
        </th>
        <th pSortableColumn="product.generic_name">
          Generic <p-sortIcon field="product.generic_name" />
          <p-columnFilter type="text" field="product.generic_name" display="menu" />
        </th>
        <th pSortableColumn="companyName">
          Company <p-sortIcon field="companyName" />
          <p-columnFilter field="product.company_id" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <select
                class="w-full border border-slate-300 px-2 py-1 text-sm"
                [value]="value ?? ''"
                (change)="filter($any($event.target).value || null)"
              >
                <option value="">All companies</option>
                @for (c of companies(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
            </ng-template>
          </p-columnFilter>
        </th>
        <th class="col-num" pSortableColumn="trialCount">
          Trials <p-sortIcon field="trialCount" />
          <p-columnFilter type="numeric" field="trialCount" display="menu" />
        </th>
        <th class="col-num" pSortableColumn="product.display_order">
          Order <p-sortIcon field="product.display_order" />
        </th>
        <th class="col-actions"></th>
      </tr>
    </ng-template>
    <ng-template #body let-row>
      <tr>
        <td>
          <button
            type="button"
            class="text-left text-teal-700 hover:text-teal-800 hover:underline focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="openTrials(row.product.id)"
          >
            {{ row.product.name }}
          </button>
        </td>
        <td class="col-identifier">{{ row.product.generic_name ?? '--' }}</td>
        <td class="col-secondary">{{ row.companyName }}</td>
        <td class="col-num">
          @if (row.trialCount > 0) {
            <button
              type="button"
              class="tabular-nums text-teal-700 hover:text-teal-800 hover:underline focus:outline-none focus:ring-1 focus:ring-teal-500"
              (click)="openTrials(row.product.id)"
            >
              {{ row.trialCount }}
              <i class="fa-solid fa-arrow-right text-[9px] ml-0.5 opacity-60"></i>
            </button>
          } @else {
            <span class="tabular-nums text-slate-300">0</span>
          }
        </td>
        <td class="col-num">{{ row.product.display_order }}</td>
        <td class="col-actions">
          <app-row-actions
            [items]="rowMenu(row)"
            [ariaLabel]="'Actions for ' + row.product.name"
          />
        </td>
      </tr>
    </ng-template>
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

  @if (deleteError()) {
    <p-message severity="error" [closable]="false" styleClass="mt-4">
      {{ deleteError() }}
    </p-message>
  }
</app-manage-page-shell>

<p-dialog
  [header]="editingProduct() ? 'Edit product' : 'Add product'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '32rem' }"
  (onHide)="closeModal()"
>
  <app-product-form [product]="editingProduct()" (saved)="onSaved()" (cancelled)="closeModal()" />
</p-dialog>
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean lint + successful build. Fix any TypeScript or template errors before proceeding.

- [ ] **Step 4: Smoke test manually**

Start Supabase + dev server in a separate terminal:
```bash
supabase start
cd src/client && npm run start
```

Open `http://localhost:8000/t/<tenantId>/s/<spaceId>/manage/products` (use any test tenant/space). Verify:
- Grid loads with the new toolbar visible above the table
- Typing in the toolbar search filters rows with a short debounce
- Clicking a column header sorts and the URL updates
- Opening the Company column filter and picking a value filters the grid and adds a chip
- Clicking the chip's × removes the filter and updates the URL
- The paginator is visible at the bottom with rows-per-page select
- Navigating back via browser back restores the previous state
- Visiting `/manage/products?filter.product.company_id=<some-id>` (the unified shape) loads with the company chip already applied

Fix any issues before committing.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/products/product-list.component.ts src/client/src/app/features/manage/products/product-list.component.html
git commit -m "feat(products): add in-place filtering, sorting, pagination"
```

---

## Task 9: Migrate company-list

**Files:**
- Modify: `src/client/src/app/features/manage/companies/company-list.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-list.component.html`

- [ ] **Step 1: Add the grid state to `company-list.component.ts`**

At the top of the file, add imports:

```ts
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { buildFilterQueryParams, createGridState } from '../../../shared/grids';
```

Add `GridToolbarComponent` to the component's `imports` array.

Inside the class body (after the `brokenLogos` signal), add:

```ts
readonly grid = createGridState<Company>({
  columns: [
    { field: 'name', header: 'Name', filter: { kind: 'text' } },
    { field: 'display_order', header: 'Order' },
  ],
  globalSearchFields: ['name'],
  defaultSort: { field: 'display_order', order: 1 },
});

readonly visibleCompanies = this.grid.filteredRows(this.companies);
```

Also replace the existing `openProducts` method so it emits the unified URL shape instead of the legacy `?company=<id>`:

```ts
openProducts(companyId: string): void {
  this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'products'], {
    queryParams: buildFilterQueryParams({
      'product.company_id': { kind: 'select', values: [companyId] },
    }),
  });
}
```

- [ ] **Step 2: Rewrite `company-list.component.html`**

Replace the file with:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Companies"
  [count]="grid.totalRecords()"
  subtitle="Drug program sponsors tracked in this space."
>
  <div actions>
    <p-button
      label="Add company"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>

  <app-grid-toolbar [state]="grid" searchPlaceholder="Search companies..." />

  <p-table
    styleClass="manage-table"
    [value]="visibleCompanies()"
    [loading]="loading()"
    [tableStyle]="{ 'min-width': '48rem' }"
    [lazy]="true"
    (onLazyLoad)="grid.onLazyLoad($event)"
    [paginator]="true"
    [rows]="grid.page().rows"
    [first]="grid.page().first"
    [totalRecords]="grid.totalRecords()"
    [rowsPerPageOptions]="[10, 25, 50, 100]"
    [filters]="grid.primengFilters()"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="name">
          Name <p-sortIcon field="name" />
          <p-columnFilter type="text" field="name" display="menu" />
        </th>
        <th style="width: 10rem">Logo</th>
        <th class="col-num" pSortableColumn="display_order">
          Order <p-sortIcon field="display_order" />
        </th>
        <th class="col-actions"></th>
      </tr>
    </ng-template>
    <ng-template #body let-company>
      <tr>
        <td>
          <button
            type="button"
            class="text-left text-teal-700 hover:text-teal-800 hover:underline focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="openProducts(company.id)"
          >
            {{ company.name }}
          </button>
        </td>
        <td>
          @if (company.logo_url && !brokenLogos().has(company.id)) {
            <img
              [src]="company.logo_url"
              [alt]="company.name + ' logo'"
              class="h-5 w-auto max-w-[8rem] object-contain"
              loading="lazy"
              (error)="onLogoError(company.id)"
            />
          } @else {
            <span class="text-slate-300">--</span>
          }
        </td>
        <td class="col-num">{{ company.display_order }}</td>
        <td class="col-actions">
          <app-row-actions
            [items]="rowMenu(company)"
            [ariaLabel]="'Actions for ' + company.name"
          />
        </td>
      </tr>
    </ng-template>
    <ng-template #emptymessage>
      <tr>
        <td colspan="4">
          @if (grid.isFiltered()) {
            No companies match your filters.
          } @else {
            No companies yet. Add one to get started.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>

  @if (deleteError()) {
    <p-message severity="error" [closable]="false" styleClass="mt-4">
      {{ deleteError() }}
    </p-message>
  }
</app-manage-page-shell>

<p-dialog
  [header]="editingCompany() ? 'Edit company' : 'Add company'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '32rem' }"
  (onHide)="closeModal()"
>
  <app-company-form [company]="editingCompany()" (saved)="onSaved()" (cancelled)="closeModal()" />
</p-dialog>
```

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-list.component.ts src/client/src/app/features/manage/companies/company-list.component.html
git commit -m "feat(companies): add in-place filtering, sorting, pagination"
```

---

## Task 10: Migrate trial-list

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`

- [ ] **Step 1: Rewrite `trial-list.component.ts`**

Replace the file with:

```ts
import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { ActivatedRoute, Router } from '@angular/router';
import { ConfirmationService, MenuItem } from 'primeng/api';
import { TableModule } from 'primeng/table';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';

import { Trial } from '../../../core/models/trial.model';
import { Product } from '../../../core/models/product.model';
import { Company } from '../../../core/models/company.model';
import { TrialService } from '../../../core/services/trial.service';
import { ProductService } from '../../../core/services/product.service';
import { CompanyService } from '../../../core/services/company.service';
import { TrialFormComponent } from './trial-form.component';
import { ManagePageShellComponent } from '../../../shared/components/manage-page-shell.component';
import { RowActionsComponent } from '../../../shared/components/row-actions.component';
import { StatusTagComponent } from '../../../shared/components/status-tag.component';
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { createGridState } from '../../../shared/grids';
import { confirmDelete } from '../../../shared/utils/confirm-delete';

interface TrialRow {
  readonly trial: Trial;
  readonly productName: string;
  readonly companyName: string;
  readonly companyId: string;
  readonly phaseCount: number;
  readonly markerCount: number;
}

@Component({
  selector: 'app-trial-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    TrialFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
    StatusTagComponent,
    GridToolbarComponent,
  ],
  templateUrl: './trial-list.component.html',
})
export class TrialListComponent implements OnInit {
  private trialService = inject(TrialService);
  private productService = inject(ProductService);
  private companyService = inject(CompanyService);
  private route = inject(ActivatedRoute);
  private router = inject(Router);
  private confirmation = inject(ConfirmationService);

  spaceId = '';
  tenantId = '';

  private readonly menuCache = new Map<string, MenuItem[]>();

  trials = signal<Trial[]>([]);
  products = signal<Product[]>([]);
  companies = signal<Company[]>([]);
  loading = signal(false);
  error = signal<string | null>(null);

  modalOpen = signal(false);
  editingTrial = signal<Trial | null>(null);

  readonly rows = computed<TrialRow[]>(() => {
    const productMap = new Map(this.products().map((p) => [p.id, p]));
    const companyMap = new Map(this.companies().map((c) => [c.id, c]));
    return this.trials().map((trial) => {
      const product = productMap.get(trial.product_id);
      const company = product ? companyMap.get(product.company_id) : undefined;
      return {
        trial,
        productName: product?.name ?? '--',
        companyName: company?.name ?? '--',
        companyId: company?.id ?? '',
        phaseCount: trial.trial_phases?.length ?? 0,
        markerCount: trial.trial_markers?.length ?? 0,
      };
    });
  });

  readonly grid = createGridState<TrialRow>({
    columns: [
      { field: 'trial.name', header: 'Trial', filter: { kind: 'text' } },
      { field: 'trial.identifier', header: 'NCT ID', filter: { kind: 'text' } },
      {
        field: 'trial.product_id',
        header: 'Product',
        filter: {
          kind: 'select',
          options: () => this.products().map((p) => ({ label: p.name, value: p.id })),
        },
      },
      {
        field: 'companyId',
        header: 'Company',
        filter: {
          kind: 'select',
          options: () => this.companies().map((c) => ({ label: c.name, value: c.id })),
        },
      },
      {
        field: 'trial.status',
        header: 'Status',
        filter: {
          kind: 'select',
          options: () => {
            const seen = new Set<string>();
            for (const t of this.trials()) if (t.status) seen.add(t.status);
            return Array.from(seen).sort().map((s) => ({ label: s, value: s }));
          },
        },
      },
      { field: 'phaseCount', header: 'Phases', filter: { kind: 'numeric' } },
      { field: 'markerCount', header: 'Markers', filter: { kind: 'numeric' } },
    ],
    globalSearchFields: [
      'trial.name',
      'trial.identifier',
      'productName',
      'companyName',
      'trial.status',
    ],
    defaultSort: { field: 'trial.name', order: 1 },
  });

  readonly visibleRows = this.grid.filteredRows(this.rows);

  async ngOnInit(): Promise<void> {
    this.spaceId = this.route.snapshot.paramMap.get('spaceId')!;
    this.tenantId = this.route.snapshot.paramMap.get('tenantId')!;
    await this.loadData();
  }

  rowMenu(row: TrialRow): MenuItem[] {
    const cached = this.menuCache.get(row.trial.id);
    if (cached) return cached;
    const items: MenuItem[] = [
      {
        label: 'Open detail',
        icon: 'fa-solid fa-arrow-up-right-from-square',
        command: () => this.openDetail(row.trial),
      },
      {
        label: 'Edit',
        icon: 'fa-solid fa-pen',
        command: () => this.openEditModal(row.trial),
      },
      { separator: true },
      {
        label: 'Delete',
        icon: 'fa-solid fa-trash',
        styleClass: 'row-actions-danger',
        command: () => this.confirmDelete(row.trial),
      },
    ];
    this.menuCache.set(row.trial.id, items);
    return items;
  }

  openCreateModal(): void {
    this.editingTrial.set(null);
    this.modalOpen.set(true);
  }

  openEditModal(trial: Trial): void {
    this.editingTrial.set(trial);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editingTrial.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.loadData();
  }

  openDetail(trial: Trial): void {
    this.router.navigate(['/t', this.tenantId, 's', this.spaceId, 'manage', 'trials', trial.id]);
  }

  async confirmDelete(trial: Trial): Promise<void> {
    const ok = await confirmDelete(this.confirmation, {
      header: 'Delete trial',
      message: `Delete "${trial.name}"? This cannot be undone.`,
    });
    if (!ok) return;
    this.error.set(null);
    try {
      await this.trialService.delete(trial.id);
      await this.loadData();
    } catch (err) {
      this.error.set(
        err instanceof Error
          ? err.message
          : 'Could not delete trial. Check your connection and try again.'
      );
    }
  }

  private async loadData(): Promise<void> {
    this.loading.set(true);
    try {
      const [trials, products, companies] = await Promise.all([
        this.trialService.listBySpace(this.spaceId),
        this.productService.list(this.spaceId),
        this.companyService.list(this.spaceId),
      ]);
      this.trials.set(trials);
      this.products.set(products);
      this.companies.set(companies);
      this.menuCache.clear();
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load trials');
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 2: Rewrite `trial-list.component.html`**

Replace the file with:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Trials"
  [count]="grid.totalRecords()"
  subtitle="Every trial tracked in this space."
>
  <div actions>
    <p-button
      label="Add trial"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>

  @if (error()) {
    <p-message severity="error" [closable]="false" styleClass="mb-4">{{ error() }}</p-message>
  }

  <app-grid-toolbar [state]="grid" searchPlaceholder="Search trials..." />

  <p-table
    styleClass="manage-table"
    [value]="visibleRows()"
    [loading]="loading()"
    [tableStyle]="{ 'min-width': '72rem' }"
    [lazy]="true"
    (onLazyLoad)="grid.onLazyLoad($event)"
    [paginator]="true"
    [rows]="grid.page().rows"
    [first]="grid.page().first"
    [totalRecords]="grid.totalRecords()"
    [rowsPerPageOptions]="[10, 25, 50, 100]"
    [filters]="grid.primengFilters()"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="trial.name">
          Trial <p-sortIcon field="trial.name" />
          <p-columnFilter type="text" field="trial.name" display="menu" />
        </th>
        <th pSortableColumn="trial.identifier">
          NCT ID <p-sortIcon field="trial.identifier" />
          <p-columnFilter type="text" field="trial.identifier" display="menu" />
        </th>
        <th pSortableColumn="productName">
          Product <p-sortIcon field="productName" />
          <p-columnFilter field="trial.product_id" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <select
                class="w-full border border-slate-300 px-2 py-1 text-sm"
                [value]="value ?? ''"
                (change)="filter($any($event.target).value || null)"
              >
                <option value="">All products</option>
                @for (p of products(); track p.id) {
                  <option [value]="p.id">{{ p.name }}</option>
                }
              </select>
            </ng-template>
          </p-columnFilter>
        </th>
        <th pSortableColumn="companyName">
          Company <p-sortIcon field="companyName" />
          <p-columnFilter field="companyId" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <select
                class="w-full border border-slate-300 px-2 py-1 text-sm"
                [value]="value ?? ''"
                (change)="filter($any($event.target).value || null)"
              >
                <option value="">All companies</option>
                @for (c of companies(); track c.id) {
                  <option [value]="c.id">{{ c.name }}</option>
                }
              </select>
            </ng-template>
          </p-columnFilter>
        </th>
        <th pSortableColumn="trial.status">
          Status <p-sortIcon field="trial.status" />
          <p-columnFilter field="trial.status" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <input
                pInputText
                type="text"
                class="w-full"
                [value]="value ?? ''"
                (input)="filter($any($event.target).value || null)"
                placeholder="Status..."
              />
            </ng-template>
          </p-columnFilter>
        </th>
        <th class="col-num" pSortableColumn="phaseCount">
          Phases <p-sortIcon field="phaseCount" />
          <p-columnFilter type="numeric" field="phaseCount" display="menu" />
        </th>
        <th class="col-num" pSortableColumn="markerCount">
          Markers <p-sortIcon field="markerCount" />
          <p-columnFilter type="numeric" field="markerCount" display="menu" />
        </th>
        <th class="col-actions"></th>
      </tr>
    </ng-template>
    <ng-template #body let-row>
      <tr>
        <td>
          <button
            type="button"
            class="text-left text-teal-700 hover:text-teal-800 hover:underline focus:outline-none focus:ring-1 focus:ring-teal-500"
            (click)="openDetail(row.trial)"
          >
            {{ row.trial.name }}
          </button>
        </td>
        <td class="col-identifier">{{ row.trial.identifier ?? '--' }}</td>
        <td class="col-secondary">{{ row.productName }}</td>
        <td class="col-secondary">{{ row.companyName }}</td>
        <td>
          <app-status-tag [label]="row.trial.status" />
        </td>
        <td class="col-num">{{ row.phaseCount }}</td>
        <td class="col-num">{{ row.markerCount }}</td>
        <td class="col-actions">
          <app-row-actions
            [items]="rowMenu(row)"
            [ariaLabel]="'Actions for ' + row.trial.name"
          />
        </td>
      </tr>
    </ng-template>
    <ng-template #emptymessage>
      <tr>
        <td colspan="8">
          @if (grid.isFiltered()) {
            No trials match your filters.
          } @else {
            No trials tracked yet. Add one to get started.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>
</app-manage-page-shell>

<p-dialog
  [header]="editingTrial() ? 'Edit trial' : 'Add trial'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '40rem' }"
  (onHide)="closeModal()"
>
  <app-trial-form
    [trial]="editingTrial()"
    (saved)="onSaved()"
    (cancelled)="closeModal()"
  />
</p-dialog>
```

Note: the `preselectedProductId` binding on `<app-trial-form>` previously came from `productFilter()`. Since we no longer track product filter as a standalone signal, the form no longer receives a preselection from a deep-link. If the plan executor encounters a failing test that depends on this preselection, either (a) re-add a computed signal that pulls the current `product_id` filter value out of `grid.filters()` and pass it as `[preselectedProductId]`, or (b) remove the input binding. The design defers this — prefer option (a) and call it out in the PR description.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean. If the `preselectedProductId` input is a compile error, apply option (a) from Step 2's note.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-list.component.ts src/client/src/app/features/manage/trials/trial-list.component.html
git commit -m "feat(trials): add in-place filtering, sorting, pagination"
```

---

## Task 11: Migrate therapeutic-area-list

**Files:**
- Modify: `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts`
- Modify: `src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html`

- [ ] **Step 1: Add grid state to the TypeScript**

At the top of `therapeutic-area-list.component.ts` add imports:

```ts
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { createGridState } from '../../../shared/grids';
```

Add `GridToolbarComponent` to the `imports` array.

Inside the class body, after the `menuCache` field, add:

```ts
readonly grid = createGridState<TherapeuticArea>({
  columns: [
    { field: 'name', header: 'Name', filter: { kind: 'text' } },
    { field: 'abbreviation', header: 'Abbreviation', filter: { kind: 'text' } },
  ],
  globalSearchFields: ['name', 'abbreviation'],
  defaultSort: { field: 'name', order: 1 },
});

readonly visibleAreas = this.grid.filteredRows(this.areas);
```

- [ ] **Step 2: Rewrite the HTML template**

Replace `therapeutic-area-list.component.html` with:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Therapeutic areas"
  [count]="grid.totalRecords()"
  subtitle="Disease areas used to tag trials and products."
>
  <div actions>
    <p-button
      label="Add therapeutic area"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>

  <app-grid-toolbar [state]="grid" searchPlaceholder="Search therapeutic areas..." />

  <p-table
    styleClass="manage-table"
    [value]="visibleAreas()"
    [loading]="loading()"
    [tableStyle]="{ 'min-width': '40rem' }"
    [lazy]="true"
    (onLazyLoad)="grid.onLazyLoad($event)"
    [paginator]="true"
    [rows]="grid.page().rows"
    [first]="grid.page().first"
    [totalRecords]="grid.totalRecords()"
    [rowsPerPageOptions]="[10, 25, 50, 100]"
    [filters]="grid.primengFilters()"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="name">
          Name <p-sortIcon field="name" />
          <p-columnFilter type="text" field="name" display="menu" />
        </th>
        <th pSortableColumn="abbreviation">
          Abbreviation <p-sortIcon field="abbreviation" />
          <p-columnFilter type="text" field="abbreviation" display="menu" />
        </th>
        <th class="col-actions"></th>
      </tr>
    </ng-template>
    <ng-template #body let-area>
      <tr>
        <td>{{ area.name }}</td>
        <td class="col-identifier">{{ area.abbreviation ?? '--' }}</td>
        <td class="col-actions">
          <app-row-actions
            [items]="rowMenu(area)"
            [ariaLabel]="'Actions for ' + area.name"
          />
        </td>
      </tr>
    </ng-template>
    <ng-template #emptymessage>
      <tr>
        <td colspan="3">
          @if (grid.isFiltered()) {
            No therapeutic areas match your filters.
          } @else {
            No therapeutic areas yet. Add one to get started.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>

  @if (deleteError()) {
    <p-message severity="error" [closable]="false" styleClass="mt-4">
      {{ deleteError() }}
    </p-message>
  }
</app-manage-page-shell>

<p-dialog
  [header]="editingArea() ? 'Edit therapeutic area' : 'Add therapeutic area'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '32rem' }"
  (onHide)="closeModal()"
>
  <app-therapeutic-area-form
    [therapeuticArea]="editingArea()"
    (saved)="onSaved()"
    (cancelled)="closeModal()"
  />
</p-dialog>
```

Note: if the existing template uses a different `[therapeuticArea]` or subtitle wording, preserve the pre-existing strings rather than the ones in this snippet — the plan only guarantees the table markup and grid wiring are correct, not that unrelated copy is verbatim.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.ts src/client/src/app/features/manage/therapeutic-areas/therapeutic-area-list.component.html
git commit -m "feat(therapeutic-areas): add in-place filtering, sorting, pagination"
```

---

## Task 12: Migrate marker-type-list

**Files:**
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.ts`
- Modify: `src/client/src/app/features/manage/marker-types/marker-type-list.component.html`

- [ ] **Step 1: Add grid state to the TypeScript**

Add imports at the top:

```ts
import { GridToolbarComponent } from '../../../shared/components/grid-toolbar.component';
import { createGridState } from '../../../shared/grids';
```

Add `GridToolbarComponent` to the `imports` array.

Inside the class body, after the `menuCache` field, add:

```ts
readonly grid = createGridState<MarkerType>({
  columns: [
    { field: 'name', header: 'Name', filter: { kind: 'text' } },
    {
      field: 'shape',
      header: 'Shape',
      filter: {
        kind: 'select',
        options: () => {
          const seen = new Set<string>();
          for (const mt of this.markerTypes()) if (mt.shape) seen.add(mt.shape);
          return Array.from(seen).sort().map((s) => ({ label: s, value: s }));
        },
      },
    },
    {
      field: 'fill_style',
      header: 'Fill',
      filter: {
        kind: 'select',
        options: () => {
          const seen = new Set<string>();
          for (const mt of this.markerTypes()) if (mt.fill_style) seen.add(mt.fill_style);
          return Array.from(seen).sort().map((s) => ({ label: s, value: s }));
        },
      },
    },
    {
      field: 'origin',
      header: 'Origin',
      filter: {
        kind: 'select',
        options: () => {
          const seen = new Set<string>();
          for (const mt of this.markerTypes()) if (mt.origin) seen.add(mt.origin);
          return Array.from(seen).sort().map((s) => ({ label: s, value: s }));
        },
      },
    },
  ],
  globalSearchFields: ['name', 'shape', 'fill_style', 'origin'],
  defaultSort: { field: 'name', order: 1 },
});

readonly visibleTypes = this.grid.filteredRows(this.markerTypes);
```

- [ ] **Step 2: Rewrite `marker-type-list.component.html`**

Replace the existing table markup inside `<app-manage-page-shell>` with the toolbar + table pattern used in prior tasks. Preserve the existing body rendering (shape, fill, color swatch, origin, actions) exactly — only the headers get sort + filter additions, the shell's `[count]` binds to `grid.totalRecords()`, and the `<p-table>` gets the `[lazy]`, `[paginator]`, `[filters]` bindings. Concrete template:

```html
<app-manage-page-shell
  eyebrow="Manage"
  title="Marker types"
  [count]="grid.totalRecords()"
  subtitle="Event categories used to plot milestones on trial timelines."
>
  <div actions>
    <p-button
      label="Add marker type"
      icon="fa-solid fa-plus"
      severity="secondary"
      [outlined]="true"
      size="small"
      (onClick)="openCreateModal()"
    />
  </div>

  @if (error()) {
    <p-message severity="error" [closable]="false" styleClass="mb-4">{{ error() }}</p-message>
  }

  <app-grid-toolbar [state]="grid" searchPlaceholder="Search marker types..." />

  <p-table
    styleClass="manage-table"
    [value]="visibleTypes()"
    [loading]="loading()"
    [tableStyle]="{ 'min-width': '56rem' }"
    [lazy]="true"
    (onLazyLoad)="grid.onLazyLoad($event)"
    [paginator]="true"
    [rows]="grid.page().rows"
    [first]="grid.page().first"
    [totalRecords]="grid.totalRecords()"
    [rowsPerPageOptions]="[10, 25, 50, 100]"
    [filters]="grid.primengFilters()"
  >
    <ng-template #header>
      <tr>
        <th pSortableColumn="name">
          Name <p-sortIcon field="name" />
          <p-columnFilter type="text" field="name" display="menu" />
        </th>
        <th pSortableColumn="shape">
          Shape <p-sortIcon field="shape" />
          <p-columnFilter field="shape" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <input
                pInputText
                type="text"
                class="w-full"
                [value]="value ?? ''"
                (input)="filter($any($event.target).value || null)"
                placeholder="Shape..."
              />
            </ng-template>
          </p-columnFilter>
        </th>
        <th pSortableColumn="fill_style">
          Fill <p-sortIcon field="fill_style" />
          <p-columnFilter field="fill_style" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <input
                pInputText
                type="text"
                class="w-full"
                [value]="value ?? ''"
                (input)="filter($any($event.target).value || null)"
                placeholder="Fill..."
              />
            </ng-template>
          </p-columnFilter>
        </th>
        <th>Color</th>
        <th pSortableColumn="origin">
          Origin <p-sortIcon field="origin" />
          <p-columnFilter field="origin" display="menu" matchMode="in">
            <ng-template #filter let-value let-filter="filterCallback">
              <input
                pInputText
                type="text"
                class="w-full"
                [value]="value ?? ''"
                (input)="filter($any($event.target).value || null)"
                placeholder="Origin..."
              />
            </ng-template>
          </p-columnFilter>
        </th>
        <th class="col-actions"></th>
      </tr>
    </ng-template>
    <ng-template #body let-mt>
      <tr>
        <td>{{ mt.name }}</td>
        <td class="col-secondary">{{ mt.shape }}</td>
        <td class="col-secondary">{{ mt.fill_style }}</td>
        <td>
          <app-color-swatch [color]="mt.color" />
        </td>
        <td>
          <app-status-tag [label]="mt.origin" />
        </td>
        <td class="col-actions">
          <app-row-actions
            [items]="rowMenu(mt)"
            [ariaLabel]="'Actions for ' + mt.name"
          />
        </td>
      </tr>
    </ng-template>
    <ng-template #emptymessage>
      <tr>
        <td colspan="6">
          @if (grid.isFiltered()) {
            No marker types match your filters.
          } @else {
            No marker types yet. Add one to get started.
          }
        </td>
      </tr>
    </ng-template>
  </p-table>
</app-manage-page-shell>

<p-dialog
  [header]="editingType() ? 'Edit marker type' : 'Add marker type'"
  [(visible)]="modalOpen"
  [modal]="true"
  [style]="{ width: '32rem' }"
  (onHide)="closeModal()"
>
  <app-marker-type-form
    [markerType]="editingType()"
    (saved)="onTypeSaved()"
    (cancelled)="closeModal()"
  />
</p-dialog>
```

Note: before writing, read the existing template once and preserve any body-cell rendering (color swatch, status tag, copy wording) that differs from the above — the plan's body template is the pattern, not the literal truth for this specific component.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/marker-types/marker-type-list.component.ts src/client/src/app/features/manage/marker-types/marker-type-list.component.html
git commit -m "feat(marker-types): add in-place filtering, sorting, pagination"
```

---

## Task 13: Playwright integration test — products grid

**Files:**
- Create: `src/client/e2e/tests/grid-filtering-products.spec.ts`

- [ ] **Step 1: Write the integration test**

Create `src/client/e2e/tests/grid-filtering-products.spec.ts`:

```ts
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
} from '../helpers/test-data.helper';

test.describe.configure({ mode: 'serial' });

test.describe('Products grid — filtering, sorting, pagination', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let pfizerId: string;
  let mercknId: string;
  const productsUrl = () => `/t/${tenantId}/s/${spaceId}/manage/products`;

  test.beforeAll(async ({ browser }) => {
    tenantId = await createTestTenant('Grid Filter Org');
    spaceId = await createTestSpace(tenantId, 'Grid Filter Space');
    pfizerId = await createTestCompany(spaceId, 'Pfizer');
    mercknId = await createTestCompany(spaceId, 'Merck');
    // Seed enough products to exercise pagination.
    for (let i = 0; i < 12; i++) {
      await createTestProduct(spaceId, pfizerId, `PfizerProduct${i}`);
    }
    for (let i = 0; i < 8; i++) {
      await createTestProduct(spaceId, mercknId, `MerckProduct${i}`);
    }
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => {
    await page.close();
  });

  test('grid loads with toolbar and paginator', async () => {
    await page.goto(productsUrl(), { waitUntil: 'networkidle' });
    await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();
    await expect(page.getByPlaceholder('Search products...')).toBeVisible();
    await expect(page.locator('.p-paginator')).toBeVisible();
  });

  test('global search filters rows and updates URL', async () => {
    await page.getByPlaceholder('Search products...').fill('Pfizer');
    await expect(page).toHaveURL(/q=Pfizer/, { timeout: 2000 });
    // All visible rows should be PfizerProduct*
    const rows = await page.locator('table tbody tr').all();
    for (const row of rows) {
      await expect(row).toContainText(/PfizerProduct/);
    }
  });

  test('clear all resets the toolbar and URL', async () => {
    await page.getByRole('button', { name: 'Clear all filters' }).click();
    await expect(page).not.toHaveURL(/q=/);
    await expect(page.getByPlaceholder('Search products...')).toHaveValue('');
  });

  test('sort by Name ascending updates URL and orders rows', async () => {
    await page.getByRole('columnheader', { name: /Name/ }).click();
    await expect(page).toHaveURL(/sort=product\.name/, { timeout: 2000 });
    const firstRowName = await page.locator('table tbody tr:first-child td:first-child').innerText();
    expect(firstRowName).toMatch(/^Merck|^Pfizer/);
  });

  test('pagination goes to page 2', async () => {
    await page.locator('.p-paginator-next').click();
    await expect(page).toHaveURL(/page=2/, { timeout: 2000 });
  });

  test('browser back restores previous state', async () => {
    await page.goBack();
    await expect(page).not.toHaveURL(/page=2/);
  });

  test('inbound deep-link via company click lands pre-filtered', async () => {
    // Simulate the company-list "View products" click: navigate directly to the
    // URL the updated openProducts() callsite will emit.
    const companiesUrl = `/t/${tenantId}/s/${spaceId}/manage/companies`;
    await page.goto(companiesUrl, { waitUntil: 'networkidle' });

    // Click the Pfizer row's name link, which calls openProducts(pfizerId)
    // and navigates with queryParams from buildFilterQueryParams.
    await page.getByRole('button', { name: 'Pfizer', exact: false }).first().click();

    // Landed on products page with the filter already applied via the unified URL shape.
    await expect(page).toHaveURL(new RegExp(`filter\\.product\\.company_id=${pfizerId}`));
    await expect(page.getByRole('list', { name: 'Active filters' })).toContainText('Pfizer');

    // All visible rows are Pfizer products.
    const rows = await page.locator('table tbody tr').all();
    for (const row of rows) {
      await expect(row).toContainText(/PfizerProduct/);
    }
  });
});
```

- [ ] **Step 2: Run the test**

Ensure Supabase + dev server are running, then:

Run: `cd src/client && npm run test:e2e:fast -- e2e/tests/grid-filtering-products.spec.ts`
Expected: all 7 tests pass. If any fail, fix the implementation (not the test) unless the failure exposes a real test bug.

- [ ] **Step 3: Run the full e2e suite to confirm no regressions in existing grid tests**

Run: `cd src/client && npm run test:e2e:fast`
Expected: no regressions in `product-management.spec.ts`, `company-management.spec.ts`, `trial-management.spec.ts`, `therapeutic-areas.spec.ts`, `marker-types.spec.ts`, or `dashboard.spec.ts`. If any existing test breaks because it assumes the "Filtered to X" subtitle or the old "Clear filter" button, update that test to use the new chip row and `Clear all filters` button.

- [ ] **Step 4: Commit**

```bash
git add src/client/e2e/tests/grid-filtering-products.spec.ts
git commit -m "test(e2e): cover grid filtering, sort, paginate on products page"
```

If any existing e2e tests required updates in Step 3, stage and commit them separately:

```bash
git add -p src/client/e2e/tests
git commit -m "test(e2e): update existing tests for new grid chip row and clear-all button"
```

---

## Task 14: Runbook update

**Files:**
- Modify: `docs/runbook/05-frontend-architecture.md`

- [ ] **Step 1: Add a "Grids" section documenting the new pattern**

Read the existing file first: `docs/runbook/05-frontend-architecture.md`. Find an appropriate insertion point (after the "Component patterns" or "Shared components" section). Add:

```markdown
## Grids and list pages

All five manage-section list pages (companies, products, trials, therapeutic-areas, marker-types) share a single filtering, sorting, and pagination pattern built on PrimeNG `p-table`. Do not add new grids without following this pattern.

**Three units:**

- `src/client/src/app/shared/grids/create-grid-state.ts` — a factory called from inside a component that owns filter/sort/page signals, encodes and decodes URL query params, and exposes `filteredRows(raw)` as a projection. Must be called in an Angular injection context (component field initializer or constructor). Uses `inject(ActivatedRoute, Router)` internally.
- `src/client/src/app/shared/grids/url-codec.ts` and `filter-algebra.ts` — pure modules (no Angular imports) that the factory composes. Fully tested in `e2e/tests/grid-url-codec.spec.ts` and `e2e/tests/grid-filter-algebra.spec.ts` as Playwright pure-function specs.
- `src/client/src/app/shared/components/grid-toolbar.component.ts` — presenter that renders the slim toolbar (global search + active-filter chips + clear-all). Takes the grid state as its only required input.

**Wiring a new grid:**

1. Declare a view-model interface for the row (decorated with any join data the grid displays).
2. Build a `rows` computed signal that produces the decorated view-models — no filtering, sorting, or paging in here.
3. Call `createGridState<RowType>({ columns, globalSearchFields, defaultSort? })` as a component field. Declare filterable columns via `ColumnDef`, specifying filter kind (`text`, `select`, `numeric`, `date`) per column.
4. Create `visibleRows = this.grid.filteredRows(this.rows)` and bind it to `<p-table [value]="visibleRows()">`.
5. On `<p-table>`, set `[lazy]="true"`, `(onLazyLoad)="grid.onLazyLoad($event)"`, `[paginator]="true"`, `[rows]="grid.page().rows"`, `[first]="grid.page().first"`, `[totalRecords]="grid.totalRecords()"`, `[rowsPerPageOptions]="[10, 25, 50, 100]"`, `[filters]="grid.primengFilters()"`.
6. Add `<app-grid-toolbar [state]="grid" searchPlaceholder="..." />` above the table inside `<app-manage-page-shell>`.
7. On each sortable column header add `pSortableColumn="<field>"` and `<p-sortIcon field="<field>" />`; on each filterable header add `<p-columnFilter field="<field>" display="menu" type="text|numeric">`. For select filters, provide a custom `<ng-template #filter>` with a `<select>` element that calls the `filterCallback`.
8. Update the `<ng-template #emptymessage>` to distinguish "no matches" (`grid.isFiltered()`) from "no data".
9. Set the `<app-manage-page-shell [count]>` to `grid.totalRecords()` so the header reflects the filtered count.

**URL schema:** `?q=<text>&filter.<field>=<value>&sort=[-]<field>&page=<n>&pageSize=<n>`. See the design spec at `docs/superpowers/specs/2026-04-11-grid-filtering-design.md` for the full encoding rules, numeric operator syntax, and date range syntax.

**Deep-linking into a filtered grid:** consumers that navigate *into* a grid with specific filters pre-applied (e.g., `company-list::openProducts(id)` landing on a pre-filtered products grid) use `buildFilterQueryParams` from `shared/grids`. Do not hand-roll query params. The helper accepts a `Record<string, FilterValue>` and returns the query-param object to pass to `router.navigate(..., { queryParams })`. Consumers must know the target grid's filterable field names (e.g., `product.company_id`, `trial.product_id`) — see the per-grid column list in the spec for the public deep-link fields.
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbook/05-frontend-architecture.md
git commit -m "docs(runbook): document grid filtering pattern"
```

---

## Task 15: Final verification

- [ ] **Step 1: Run the full verification suite**

Run: `cd src/client && npx ng lint && npx ng build`
Expected: clean lint, successful build with no type errors.

- [ ] **Step 2: Run the full e2e suite**

Run: `cd src/client && npm run test:e2e:fast`
Expected: all tests pass, including the two new pure-function specs (`grid-url-codec.spec.ts`, `grid-filter-algebra.spec.ts`) and the new integration spec (`grid-filtering-products.spec.ts`).

- [ ] **Step 3: Manual smoke test across all five grids**

With the dev server running, visit each grid and verify the toolbar, paginator, and at least one column filter work:

- `/t/<id>/s/<id>/manage/companies` — type in search, sort by Name, confirm chip + URL update; click a company's "View products" row action and verify it lands on a pre-filtered products page with `filter.product.company_id` in the URL
- `/t/<id>/s/<id>/manage/products` — search, sort, column filter, paginator, back button; click a product row's "View trials" action and verify it lands on a pre-filtered trials page with `filter.trial.product_id` in the URL
- `/t/<id>/s/<id>/manage/trials` — search, sort, select filter on Product, select filter on Status
- `/t/<id>/s/<id>/manage/therapeutic-areas` — search + name filter
- `/t/<id>/s/<id>/manage/marker-types` — search + shape filter

- [ ] **Step 4: Review commit log**

Run: `git log --oneline main..HEAD`
Expected: one commit per task (14 commits total), clean messages, no fixups or WIPs. If any commits are unclean, decide whether to interactively rebase before opening the PR — keep rebases to a minimum unless the log is genuinely messy.
