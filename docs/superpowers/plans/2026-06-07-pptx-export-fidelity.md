# PPTX Export Fidelity Pass Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the native-PPTX timeline export read like the on-screen timeline (dark header band, visibility-aware MOA/ROA/Notes columns, NCT ids, solid phase bars, category-ordered legend that breaks after Regulatory) and add a markers detail table slide.

**Architecture:** Pure layout/ordering/data logic moves into a new `pptx-export.util.ts` covered by Vitest; `pptx-export.service.ts` keeps only pptxgenjs orchestration. Column visibility flows from `LandscapeStateService` through the export dialog into `ExportOptions`. Legend category ordering is sourced from `MarkerTypeService.list()` (same source as the on-screen legend) with a safe fallback.

**Tech Stack:** Angular 19 (signals, standalone), pptxgenjs ^4.0.1, Vitest, Supabase (`get_dashboard_data`, `marker_types`).

---

## File Structure

- `src/client/src/app/core/services/pptx-export.util.ts` — NEW. Pure helpers: `computeLeftColumns`, `orderLegendItems`, `buildMarkerTableRows`, `paginate`, `formatDateShort`, `formatMarkerDate`. No Angular/pptxgenjs imports.
- `src/client/src/app/core/services/pptx-export.util.spec.ts` — NEW. Vitest suite for the helpers.
- `src/client/src/app/core/services/pptx-export.service.ts` — MODIFY. Consume helpers; new header band, column-aware rows, legend, marker-table slide, dynamic footer.
- `src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts` — MODIFY. Add visibility inputs; forward into `exportDashboard`.
- `src/client/src/app/features/landscape/timeline-view.component.html` — MODIFY. Bind visibility flags from `LandscapeStateService`.

Run all commands from `src/client/`. Unit test runner: `npm run test:units` (per project memory; never `vitest run` bare). A single file: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`.

---

## Task 1: Column layout helper

**Files:**
- Create: `src/client/src/app/core/services/pptx-export.util.ts`
- Test: `src/client/src/app/core/services/pptx-export.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/core/services/pptx-export.util.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import { computeLeftColumns } from './pptx-export.util';

describe('computeLeftColumns', () => {
  it('includes only company/asset/trial when all toggles off', () => {
    const layout = computeLeftColumns({ showMoa: false, showRoa: false, showNotes: false });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'trial']);
    expect(layout.labelColW).toBeCloseTo(2.9, 5);
  });

  it('includes all columns in order when all toggles on', () => {
    const layout = computeLeftColumns({ showMoa: true, showRoa: true, showNotes: true });
    expect(layout.columns.map((c) => c.key)).toEqual([
      'company', 'asset', 'moa', 'roa', 'trial', 'notes',
    ]);
    expect(layout.labelColW).toBeCloseTo(4.37, 5);
  });

  it('lays out x positions cumulatively and matches labelColW', () => {
    const layout = computeLeftColumns({ showMoa: true, showRoa: false, showNotes: false });
    expect(layout.columns.map((c) => c.key)).toEqual(['company', 'asset', 'moa', 'trial']);
    const company = layout.columns[0];
    const asset = layout.columns[1];
    const moa = layout.columns[2];
    const trial = layout.columns[3];
    expect(company.x).toBeCloseTo(0, 5);
    expect(asset.x).toBeCloseTo(1.0, 5);
    expect(moa.x).toBeCloseTo(1.85, 5);
    expect(trial.x).toBeCloseTo(2.65, 5);
    const last = layout.columns[layout.columns.length - 1];
    expect(last.x + last.width).toBeCloseTo(layout.labelColW, 5);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: FAIL — cannot resolve `./pptx-export.util`.

- [ ] **Step 3: Write minimal implementation**

Create `src/client/src/app/core/services/pptx-export.util.ts`:

```ts
export interface ColumnVisibility {
  showMoa: boolean;
  showRoa: boolean;
  showNotes: boolean;
}

export type ColumnKey = 'company' | 'asset' | 'moa' | 'roa' | 'trial' | 'notes';

export interface ColumnDef {
  key: ColumnKey;
  x: number;
  width: number;
}

export interface ColumnLayout {
  columns: ColumnDef[];
  labelColW: number;
}

const COLUMN_WIDTHS: Record<ColumnKey, number> = {
  company: 1.0,
  asset: 0.85,
  moa: 0.8,
  roa: 0.45,
  trial: 1.05,
  notes: 0.22,
};

export function computeLeftColumns(v: ColumnVisibility): ColumnLayout {
  const keys: ColumnKey[] = ['company', 'asset'];
  if (v.showMoa) keys.push('moa');
  if (v.showRoa) keys.push('roa');
  keys.push('trial');
  if (v.showNotes) keys.push('notes');

  const columns: ColumnDef[] = [];
  let x = 0;
  for (const key of keys) {
    const width = COLUMN_WIDTHS[key];
    columns.push({ key, x, width });
    x += width;
  }
  return { columns, labelColW: x };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: PASS (3 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.util.ts src/app/core/services/pptx-export.util.spec.ts
git commit -m "Add column-layout helper for PPTX export"
```

---

## Task 2: Legend ordering helper

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.util.ts`
- Test: `src/client/src/app/core/services/pptx-export.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `pptx-export.util.spec.ts`:

```ts
import { orderLegendItems, type PresentMarkerType } from './pptx-export.util';
import type { MarkerType } from '../models/marker.model';

function present(id: string, order: number): PresentMarkerType {
  return { id, name: id, color: '#000000', shape: 'circle', fill_style: 'filled', display_order: order };
}

function fullType(id: string, typeOrder: number, catName: string, catOrder: number): MarkerType {
  return {
    id,
    space_id: null,
    created_by: null,
    category_id: 'cat-' + catName,
    name: id,
    shape: 'circle',
    fill_style: 'filled',
    color: '#000000',
    inner_mark: 'none',
    is_system: true,
    display_order: typeOrder,
    created_at: '2026-01-01',
    marker_categories: {
      id: 'cat-' + catName,
      space_id: null,
      name: catName,
      display_order: catOrder,
      is_system: true,
      created_by: null,
      created_at: '2026-01-01',
      updated_at: '2026-01-01',
    },
  };
}

describe('orderLegendItems', () => {
  const allTypes: MarkerType[] = [
    fullType('Submission', 1, 'Regulatory', 3),
    fullType('Approval', 1, 'Approval', 4),
    fullType('Trial Start', 1, 'Clinical Trial', 1),
    fullType('Full Data', 1, 'Data', 2),
    fullType('Regulatory Filing', 2, 'Regulatory', 3),
    fullType('LOE Date', 1, 'Loss of Exclusivity', 5),
  ];

  it('orders present items by category then type order', () => {
    const result = orderLegendItems(
      [present('Submission', 1), present('Approval', 1), present('Trial Start', 1),
       present('Full Data', 1), present('Regulatory Filing', 2), present('LOE Date', 1)],
      allTypes
    );
    expect(result.items.map((i) => i.name)).toEqual([
      'Trial Start', 'Full Data', 'Submission', 'Regulatory Filing', 'Approval', 'LOE Date',
    ]);
  });

  it('sets breakIndex to the first item after the Regulatory group', () => {
    const result = orderLegendItems(
      [present('Submission', 1), present('Approval', 1), present('Trial Start', 1),
       present('Regulatory Filing', 2), present('LOE Date', 1)],
      allTypes
    );
    // ordered: Trial Start, Submission, Regulatory Filing, Approval, LOE Date
    expect(result.breakIndex).toBe(3);
  });

  it('returns breakIndex -1 when no Regulatory item is present', () => {
    const result = orderLegendItems(
      [present('Trial Start', 1), present('Approval', 1)],
      allTypes
    );
    expect(result.breakIndex).toBe(-1);
  });

  it('falls back to display_order with no break when allTypes is empty', () => {
    const result = orderLegendItems(
      [present('B', 2), present('A', 1)],
      []
    );
    expect(result.items.map((i) => i.name)).toEqual(['A', 'B']);
    expect(result.breakIndex).toBe(-1);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: FAIL — `orderLegendItems` is not exported.

- [ ] **Step 3: Write minimal implementation**

Add this import at the TOP of `pptx-export.util.ts` (with the other imports — not mid-file, or `import/first` lint fails):

```ts
import type { MarkerType } from '../models/marker.model';
```

Then append the rest to `pptx-export.util.ts`:

```ts
export interface PresentMarkerType {
  id: string;
  name: string;
  color: string;
  shape: string;
  fill_style: string;
  display_order: number;
}

export interface LegendItem {
  name: string;
  color: string;
  shape: string;
  fill_style: string;
}

export interface LegendLayout {
  items: LegendItem[];
  /** Index of the first item AFTER the Regulatory group, or -1 if none / no break. */
  breakIndex: number;
}

const REGULATORY_CATEGORY = 'regulatory';

export function orderLegendItems(
  present: PresentMarkerType[],
  allTypes: MarkerType[]
): LegendLayout {
  const toItem = (p: PresentMarkerType): LegendItem => ({
    name: p.name,
    color: p.color,
    shape: p.shape,
    fill_style: p.fill_style,
  });

  // Fallback: no authoritative ordering available -> flat by type display_order.
  if (!allTypes.length) {
    const items = [...present].sort((a, b) => a.display_order - b.display_order).map(toItem);
    return { items, breakIndex: -1 };
  }

  const meta = new Map<string, { catOrder: number; typeOrder: number; catName: string }>();
  for (const t of allTypes) {
    meta.set(t.id, {
      catOrder: t.marker_categories?.display_order ?? 999,
      typeOrder: t.display_order,
      catName: (t.marker_categories?.name ?? '').toLowerCase(),
    });
  }

  const sorted = [...present].sort((a, b) => {
    const ma = meta.get(a.id);
    const mb = meta.get(b.id);
    const ca = ma?.catOrder ?? 999;
    const cb = mb?.catOrder ?? 999;
    if (ca !== cb) return ca - cb;
    return (ma?.typeOrder ?? a.display_order) - (mb?.typeOrder ?? b.display_order);
  });

  let lastRegIndex = -1;
  sorted.forEach((p, i) => {
    if (meta.get(p.id)?.catName === REGULATORY_CATEGORY) lastRegIndex = i;
  });
  const breakIndex = lastRegIndex >= 0 && lastRegIndex + 1 < sorted.length ? lastRegIndex + 1 : -1;

  return { items: sorted.map(toItem), breakIndex };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: PASS (all Task 1 + Task 2 tests).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.util.ts src/app/core/services/pptx-export.util.spec.ts
git commit -m "Add category-ordered legend helper with break-after-Regulatory"
```

---

## Task 3: Marker table rows + date helpers

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.util.ts`
- Test: `src/client/src/app/core/services/pptx-export.util.spec.ts`

- [ ] **Step 1: Write the failing test**

Append to `pptx-export.util.spec.ts`:

```ts
import {
  buildMarkerTableRows,
  paginate,
  formatDateShort,
  formatMarkerDate,
} from './pptx-export.util';
import type { Company } from '../models/company.model';

function companyWithMarkers(): Company[] {
  return [
    {
      id: 'c1', space_id: 's1', created_by: 'u', name: 'Eli Lilly', logo_url: null,
      display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
      assets: [
        {
          id: 'a1', space_id: 's1', created_by: 'u', company_id: 'c1', name: 'Mounjaro',
          generic_name: null, logo_url: null, display_order: 0,
          created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
          trials: [
            {
              id: 't1', space_id: 's1', created_by: 'u', asset_id: 'a1', name: 'SURPASS-2',
              acronym: 'SURPASS-2', identifier: 'NCT01', status: null, notes: null,
              display_order: 0, created_at: '2026-01-01', updated_at: '2026-01-01',
              updated_by: null, phase_type: null, phase_start_date: null, phase_end_date: null,
              markers: [
                {
                  id: 'm2', space_id: 's1', created_by: 'u', marker_type_id: 'mt1',
                  title: 'Approved by FDA', projection: 'actual', event_date: '2022-05-13',
                  end_date: null, description: null, source_url: null, metadata: null,
                  is_projected: false, no_longer_expected: false,
                  created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
                  marker_types: { id: 'mt1', name: 'Approval' } as never,
                },
                {
                  id: 'm1', space_id: 's1', created_by: 'u', marker_type_id: 'mt2',
                  title: 'Topline expected', projection: 'company', event_date: '2021-10-01',
                  end_date: null, description: null, source_url: null, metadata: null,
                  is_projected: true, no_longer_expected: false,
                  created_at: '2026-01-01', updated_at: '2026-01-01', updated_by: null,
                  marker_types: { id: 'mt2', name: 'Topline Data' } as never,
                },
              ],
            },
          ],
        },
      ],
    } as never,
  ];
}

describe('buildMarkerTableRows', () => {
  it('flattens, sorts markers within a trial by date, and derives status', () => {
    const rows = buildMarkerTableRows(companyWithMarkers());
    expect(rows).toHaveLength(2);
    expect(rows[0].marker).toBe('Topline Data');
    expect(rows[0].status).toBe('Projected');
    expect(rows[0].company).toBe('Eli Lilly');
    expect(rows[0].asset).toBe('Mounjaro');
    expect(rows[0].trial).toBe('SURPASS-2');
    expect(rows[1].marker).toBe('Approval');
    expect(rows[1].status).toBe('Actual');
  });

  it('marks no_longer_expected markers as NLE', () => {
    const companies = companyWithMarkers();
    companies[0].assets![0].trials![0].markers![0].no_longer_expected = true;
    const rows = buildMarkerTableRows(companies);
    const approval = rows.find((r) => r.marker === 'Approval');
    expect(approval?.status).toBe('NLE');
  });
});

describe('paginate', () => {
  it('chunks rows into pages of the given size', () => {
    expect(paginate([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns an empty array for no rows', () => {
    expect(paginate([], 20)).toEqual([]);
  });
});

describe('date formatting', () => {
  it('formats a single date as Mon ’YY', () => {
    expect(formatDateShort('2021-10-01')).toBe("Oct '21");
  });
  it('formats a range with a hyphen', () => {
    expect(formatMarkerDate('2021-10-01', '2021-12-01')).toBe("Oct '21-Dec '21");
  });
  it('formats a single event when end_date is null', () => {
    expect(formatMarkerDate('2021-10-01', null)).toBe("Oct '21");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: FAIL — `buildMarkerTableRows`/`paginate`/`formatMarkerDate` not exported.

- [ ] **Step 3: Write minimal implementation**

Add this import at the TOP of `pptx-export.util.ts` (with the other imports):

```ts
import type { Company } from '../models/company.model';
```

Then append the rest to `pptx-export.util.ts`:

```ts
export type MarkerStatus = 'Actual' | 'Projected' | 'NLE';

export interface MarkerRow {
  company: string;
  asset: string;
  trial: string;
  marker: string;
  date: string;
  status: MarkerStatus;
  notes: string;
}

const NOTE_MAX = 80;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export function formatDateShort(dateStr: string): string {
  const d = new Date(dateStr);
  return `${MONTHS[d.getMonth()]} '${String(d.getFullYear()).slice(2)}`;
}

export function formatMarkerDate(eventDate: string, endDate: string | null): string {
  if (endDate) return `${formatDateShort(eventDate)}-${formatDateShort(endDate)}`;
  return formatDateShort(eventDate);
}

function truncate(value: string, max: number): string {
  return value.length > max ? value.slice(0, max - 1).trimEnd() + '…' : value;
}

export function buildMarkerTableRows(companies: Company[]): MarkerRow[] {
  const rows: MarkerRow[] = [];
  for (const company of companies) {
    for (const asset of company.assets ?? []) {
      for (const trial of asset.trials ?? []) {
        const markers = [...(trial.markers ?? [])]
          .filter((m) => m.event_date && m.marker_types)
          .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());
        for (const m of markers) {
          const status: MarkerStatus = m.no_longer_expected
            ? 'NLE'
            : m.is_projected || m.projection !== 'actual'
              ? 'Projected'
              : 'Actual';
          rows.push({
            company: company.name,
            asset: asset.name,
            trial: trial.acronym ?? trial.name,
            marker: m.marker_types!.name,
            date: formatMarkerDate(m.event_date, m.end_date),
            status,
            notes: truncate(m.title ?? m.description ?? '', NOTE_MAX),
          });
        }
      }
    }
  }
  return rows;
}

export function paginate<T>(rows: T[], perPage: number): T[][] {
  const pages: T[][] = [];
  for (let i = 0; i < rows.length; i += perPage) {
    pages.push(rows.slice(i, i + perPage));
  }
  return pages;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: PASS (all suites).

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.util.ts src/app/core/services/pptx-export.util.spec.ts
git commit -m "Add marker-table row builder, pagination, and date helpers"
```

---

## Task 4: Thread column visibility through the dialog and template

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts:10-14` (ExportOptions)
- Modify: `src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts`
- Modify: `src/client/src/app/features/landscape/timeline-view.component.html:84-90`

- [ ] **Step 1: Extend `ExportOptions`**

In `pptx-export.service.ts`, replace the `ExportOptions` interface:

```ts
export interface ExportOptions {
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
  showMoaColumn: boolean;
  showRoaColumn: boolean;
  showNotesColumn: boolean;
}
```

- [ ] **Step 2: Add inputs to the export dialog**

In `export-dialog.component.ts`, add three inputs after the existing `endYear` input (around line 94):

```ts
  readonly showMoaColumn = input(true);
  readonly showRoaColumn = input(true);
  readonly showNotesColumn = input(true);
```

Then update the `exportDashboard` call inside `doExport()` to pass them:

```ts
      await this.pptxService.exportDashboard(this.companies(), {
        zoomLevel: this.selectedZoom(),
        startYear: this.startYear(),
        endYear: this.endYear(),
        showMoaColumn: this.showMoaColumn(),
        showRoaColumn: this.showRoaColumn(),
        showNotesColumn: this.showNotesColumn(),
      });
```

- [ ] **Step 3: Bind the flags from `timeline-view.component.html`**

The parent `TimelineViewComponent` already injects `LandscapeStateService` (confirm it is exposed to the template as `state`; if it is injected privately, expose a `protected readonly state = inject(LandscapeStateService);` member). Update the `<app-export-dialog>` instance (lines 84-90) to:

```html
        <app-export-dialog
          [companies]="companies()"
          [startYear]="resolvedStartYear()"
          [endYear]="resolvedEndYear()"
          [showMoaColumn]="state.showMoaColumn()"
          [showRoaColumn]="state.showRoaColumn()"
          [showNotesColumn]="state.showNotesColumn()"
          [open]="exportDialogOpen()"
          (closed)="exportDialogOpen.set(false)"
        />
```

If `TimelineViewComponent` does not already have a `state` accessor, add to the class:

```ts
  protected readonly state = inject(LandscapeStateService);
```

and import it:

```ts
import { LandscapeStateService } from './landscape-state.service';
```

- [ ] **Step 4: Verify build**

Run: `ng build`
Expected: build succeeds. (No behavior change yet — the service does not read the new flags until Task 5.)

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.service.ts \
  src/app/features/dashboard/export-dialog/export-dialog.component.ts \
  src/app/features/landscape/timeline-view.component.html \
  src/app/features/landscape/timeline-view.component.ts
git commit -m "Thread column-visibility flags into PPTX export options"
```

---

## Task 5: Visibility-aware columns, header band, NCT id, solid bars

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts`

This task rewrites the column constants, header, and row rendering to use `computeLeftColumns` and adds the dark header band, MOA/ROA/Notes columns, company logo, NCT id, and solid phase bars.

- [ ] **Step 1: Import helpers and replace fixed column constants**

At the top of `pptx-export.service.ts`, add to the imports:

```ts
import {
  computeLeftColumns,
  type ColumnLayout,
  formatDateShort,
} from './pptx-export.util';
```

Tasks 6 and 7 add more named imports from `./pptx-export.util`. Keep them all in
this single import statement (merge as you go) to satisfy the `no-duplicate-imports`
lint rule. `Asset` does not need importing: `company.assets` is already typed
`Asset[]`.

Remove the now-unused fixed constants `COMPANY_X`, `COMPANY_W`, `PRODUCT_X`, `PRODUCT_W`, `TRIAL_X`, `TRIAL_W`, `LABEL_COL_W`, `TIMELINE_X`, `TIMELINE_W` (lines 38-48). Keep `SLIDE_W`, `SLIDE_H`, `TITLE_H`, `HEADER_H`, `DATA_Y`, `FALLBACK_PRIMARY`. Increase the header band height and add a band color constant:

```ts
const HEADER_H = 0.28;
const HEADER_BAND = '1e293b';
const LEGEND_H = 0.7;
```

`DATA_Y` stays `TITLE_H + HEADER_H`.

- [ ] **Step 2: Compute layout once in `exportDashboard` and pass it down**

In `exportDashboard`, after `const { startYear, endYear, zoomLevel } = options;`, add:

```ts
    const layout = computeLeftColumns({
      showMoa: options.showMoaColumn,
      showRoa: options.showRoaColumn,
      showNotes: options.showNotesColumn,
    });
    const logoByCompany = await this.loadCompanyLogos(companies);
```

Update the render calls to pass `layout` (and logos where needed):

```ts
    this.renderTitle(slide, appDisplayName, primaryColorHex);
    this.renderHeader(slide, layout, startYear, endYear, zoomLevel);
    this.renderGridLines(slide, layout, startYear, endYear, zoomLevel, rows.length, rowH);
    this.renderRows(slide, rows, layout, logoByCompany, rowH, startYear, endYear, primaryColorHex);
    this.renderLegend(slide, companies);
    this.addFooter(slide, appDisplayName, 2, totalPages);
```

(`renderLegend` and footer change in Tasks 6-7; leave the calls as-is for now — they still compile because the old signatures remain until those tasks.)

Add `TIMELINE_X` / `TIMELINE_W` as locals derived from `layout` inside each render method that needs them, e.g. `const timelineX = layout.labelColW; const timelineW = SLIDE_W - layout.labelColW;`.

- [ ] **Step 3: Add the company-logo loader**

Add this method to the service (reuses `loadLogoAsBase64`):

```ts
  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, string>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await this.loadLogoAsBase64(c.logo_url!)] as const)
    );
    const map = new Map<string, string>();
    for (const [id, data] of entries) {
      if (data) map.set(id, data);
    }
    return map;
  }
```

- [ ] **Step 4: Rewrite `renderHeader` with the dark band and dynamic columns**

Replace `renderHeader` with:

```ts
  private renderHeader(
    slide: PptxGenJS.Slide,
    layout: ColumnLayout,
    startYear: number,
    endYear: number,
    zoom: ZoomLevel
  ): void {
    const headerY = TITLE_H;
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;

    // Dark band across the full header row.
    slide.addShape('rect', {
      x: 0,
      y: headerY,
      w: SLIDE_W,
      h: HEADER_H,
      fill: { color: HEADER_BAND },
    });

    const hStyle = { fontSize: 6, fontFace: 'Arial' as const, bold: true, color: 'e2e8f0' };
    const labels: Record<string, string> = {
      company: 'Company',
      asset: 'Asset',
      moa: 'MOA',
      roa: 'ROA',
      trial: 'Trial',
      notes: 'Notes',
    };
    for (const col of layout.columns) {
      slide.addText(labels[col.key], {
        x: col.x + 0.05,
        y: headerY,
        w: col.width - 0.05,
        h: HEADER_H,
        valign: 'middle',
        ...hStyle,
      });
    }

    const columns = this.timeline.getColumns(startYear, endYear, zoom);
    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoom);
    for (const col of columns) {
      const x = timelineX + (col.startX / totalPx) * timelineW;
      const w = (col.width / totalPx) * timelineW;
      slide.addText(col.label, {
        x,
        y: headerY,
        w,
        h: HEADER_H,
        fontSize: 7,
        fontFace: 'Consolas',
        color: 'ffffff',
        align: 'center',
        valign: 'middle',
      });
    }

    slide.addShape('line', {
      x: 0,
      y: headerY + HEADER_H,
      w: SLIDE_W,
      h: 0,
      line: { color: 'cbd5e1', width: 0.5 },
    });
  }
```

- [ ] **Step 5: Update `renderGridLines` to take `layout`**

Change the signature to `renderGridLines(slide, layout: ColumnLayout, startYear, endYear, zoom, rowCount, rowH)` and replace the internal `TIMELINE_X`/`TIMELINE_W` with:

```ts
    const timelineX = layout.labelColW;
    const timelineW = SLIDE_W - layout.labelColW;
```

and use `timelineX`/`timelineW` in the `x` calc.

- [ ] **Step 6: Rewrite `renderRows` for dynamic columns**

Replace `renderRows` with a version that looks up each column by key and renders company logo + name, asset, MOA, ROA, trial (acronym + NCT id), and a notes glyph. Add a `colX(key)` helper:

```ts
  private renderRows(
    slide: PptxGenJS.Slide,
    rows: FlatRow[],
    layout: ColumnLayout,
    logoByCompany: Map<string, string>,
    rowH: number,
    startYear: number,
    endYear: number,
    primaryColorHex: string
  ): void {
    const fontSize = Math.max(5, Math.min(7, rowH * 28));
    const col = (key: string) => layout.columns.find((c) => c.key === key);

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      const y = DATA_Y + i * rowH;

      if (i % 2 !== 0) {
        slide.addShape('rect', { x: 0, y, w: SLIDE_W, h: rowH, fill: { color: 'f8fafc' } });
      }

      const companyCol = col('company')!;
      if (row.isFirstInCompany) {
        const logo = logoByCompany.get(row.companyId);
        const glyph = 0.16;
        const textX = companyCol.x + (logo ? glyph + 0.07 : 0.05);
        if (logo) {
          slide.addImage({
            data: logo,
            x: companyCol.x + 0.04,
            y: y + (rowH - glyph) / 2,
            w: glyph,
            h: glyph,
            sizing: { type: 'contain', w: glyph, h: glyph },
          });
        }
        slide.addText(row.companyName.toUpperCase(), {
          x: textX,
          y,
          w: companyCol.x + companyCol.width - textX,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          bold: true,
          color: primaryColorHex,
          valign: 'middle',
          shrinkText: true,
        });
      }

      const assetCol = col('asset')!;
      if (row.isFirstInAsset) {
        slide.addText(row.assetName, {
          x: assetCol.x + 0.05,
          y,
          w: assetCol.width - 0.05,
          h: rowH,
          fontSize,
          fontFace: 'Arial',
          bold: true,
          color: '475569',
          valign: 'middle',
          shrinkText: true,
        });
      }

      const moaCol = col('moa');
      if (moaCol && row.isFirstInAsset && row.moa) {
        slide.addText(row.moa, {
          x: moaCol.x + 0.05,
          y,
          w: moaCol.width - 0.05,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          color: '64748b',
          valign: 'middle',
          shrinkText: true,
        });
      }

      const roaCol = col('roa');
      if (roaCol && row.isFirstInAsset && row.roa) {
        slide.addText(row.roa, {
          x: roaCol.x + 0.05,
          y,
          w: roaCol.width - 0.05,
          h: rowH,
          fontSize: Math.max(4, fontSize - 1),
          fontFace: 'Arial',
          color: '64748b',
          valign: 'middle',
        });
      }

      const trialCol = col('trial')!;
      slide.addText(
        [
          { text: row.trialName, options: { bold: true, color: '334155' } },
          ...(row.nctId
            ? [{ text: `  ${row.nctId}`, options: { color: '94a3b8', fontSize: Math.max(4, fontSize - 2) } }]
            : []),
        ],
        {
          x: trialCol.x + 0.05,
          y,
          w: trialCol.width - 0.05,
          h: rowH,
          fontSize,
          fontFace: 'Arial',
          valign: 'middle',
          shrinkText: true,
        }
      );

      const notesCol = col('notes');
      if (notesCol && row.hasNotes) {
        slide.addShape('ellipse', {
          x: notesCol.x + notesCol.width / 2 - 0.03,
          y: y + rowH / 2 - 0.03,
          w: 0.06,
          h: 0.06,
          fill: { color: '94a3b8' },
        });
      }

      this.renderPhaseBars(slide, row.trial, layout, y, rowH, startYear, endYear, fontSize);
      this.renderMarkers(slide, row.trial, layout, y, rowH, startYear, endYear, fontSize);
    }
  }
```

- [ ] **Step 7: Extend `FlatRow` and `flattenTrials` to carry the new fields**

Replace the `FlatRow` interface (lines 16-23) with:

```ts
interface FlatRow {
  companyName: string;
  companyId: string;
  assetName: string;
  trialName: string;
  nctId: string | null;
  moa: string;
  roa: string;
  hasNotes: boolean;
  trial: Trial;
  isFirstInCompany: boolean;
  isFirstInAsset: boolean;
}
```

Update `flattenTrials` to populate them:

```ts
  private flattenTrials(companies: Company[]): FlatRow[] {
    const rows: FlatRow[] = [];
    for (const company of companies) {
      let isFirstInCompany = true;
      for (const asset of company.assets ?? []) {
        let isFirstInAsset = true;
        const moa = (asset.mechanisms_of_action ?? []).map((m) => m.name).join(', ');
        const roa = (asset.routes_of_administration ?? [])
          .map((r) => r.abbreviation ?? r.name)
          .join(', ');
        for (const trial of asset.trials ?? []) {
          rows.push({
            companyName: company.name,
            companyId: company.id,
            assetName: asset.name,
            trialName: trial.acronym ?? trial.name,
            nctId: trial.identifier ?? null,
            moa,
            roa,
            hasNotes: !!(trial.notes || (trial.trial_notes?.length ?? 0) > 0),
            trial,
            isFirstInCompany,
            isFirstInAsset,
          });
          isFirstInCompany = false;
          isFirstInAsset = false;
        }
      }
    }
    return rows;
  }
```

- [ ] **Step 8: Make `renderPhaseBars` / `renderMarkers` take `layout` and solidify bars**

Change both signatures to accept `layout: ColumnLayout` after `trial`, and inside replace `TIMELINE_X`/`TIMELINE_W` with `const timelineX = layout.labelColW; const timelineW = SLIDE_W - layout.labelColW;`. In `renderPhaseBars`, change the bar fill from `fill: { color, transparency: 25 }` to `fill: { color }` and the line from `line: { color, width: 0.5, transparency: 60 }` to `line: { color, width: 0.5 }`.

In `renderMarkers`, the `formatDateShort` call now resolves to the util import (the private method is deleted in Step 9) and raise the collision threshold: change `if (centerX - lastLabelX > 0.3)` to `if (centerX - lastLabelX > 0.4)`.

`renderMarkerShape` uses `TIMELINE_X`/`TIMELINE_W` for the `bar` shape, so add two parameters to it. Change its signature from:

```ts
  private renderMarkerShape(
    slide: PptxGenJS.Slide,
    shape: string,
    isFilled: boolean,
    x: number,
    y: number,
    size: number,
    color: string,
    endDate: string | null,
    startYear: number,
    endYear: number,
    totalPx: number
  ): void {
```

to add `timelineX: number, timelineW: number` after `totalPx`, and inside the `bar` branch replace `TIMELINE_X` with `timelineX` and `TIMELINE_W` with `timelineW`. Update the call site inside `renderMarkers` to pass `timelineX, timelineW` (computed there from `layout`) as the final two arguments.

- [ ] **Step 9: Delete the now-duplicated private `formatDateShort`**

Remove the private `formatDateShort` method (lines 694-711) since it is imported from `pptx-export.util.ts`.

- [ ] **Step 10: Verify lint, build, units**

Run: `ng lint && ng build && npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: all pass.

- [ ] **Step 11: Commit**

```bash
git add src/app/core/services/pptx-export.service.ts
git commit -m "Render visibility-aware columns, header band, NCT id, solid bars in PPTX export"
```

---

## Task 6: Category-ordered legend with break after Regulatory

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts`

- [ ] **Step 1: Inject `MarkerTypeService` and import the legend helper**

Add to imports:

```ts
import { MarkerTypeService } from './marker-type.service';
import { orderLegendItems, type PresentMarkerType } from './pptx-export.util';
```

Add the injection near the other `inject()` calls:

```ts
  private markerTypeService = inject(MarkerTypeService);
```

- [ ] **Step 2: Make `renderLegend` async and category-ordered**

Replace `renderLegend` with:

```ts
  private async renderLegend(slide: PptxGenJS.Slide, companies: Company[]): Promise<void> {
    const legendY = SLIDE_H - LEGEND_H;

    slide.addShape('rect', {
      x: 0,
      y: legendY,
      w: SLIDE_W,
      h: LEGEND_H,
      fill: { color: 'f8fafc' },
      line: { color: 'e2e8f0', width: 0.5 },
    });

    // Collect unique present marker types.
    const presentMap = new Map<string, PresentMarkerType>();
    for (const company of companies) {
      for (const asset of company.assets ?? []) {
        for (const trial of asset.trials ?? []) {
          for (const marker of trial.markers ?? []) {
            const mt = marker.marker_types;
            if (mt && !presentMap.has(mt.id)) {
              presentMap.set(mt.id, {
                id: mt.id,
                name: mt.name,
                color: mt.color,
                shape: mt.shape,
                fill_style: mt.fill_style,
                display_order: mt.display_order,
              });
            }
          }
        }
      }
    }

    // Authoritative category ordering (same source as the on-screen legend).
    let allTypes: Awaited<ReturnType<MarkerTypeService['list']>> = [];
    try {
      allTypes = await this.markerTypeService.list(companies[0]?.space_id);
    } catch {
      allTypes = [];
    }

    const { items, breakIndex } = orderLegendItems([...presentMap.values()], allTypes);

    const dotSize = 0.08;
    const itemW = 1.5;
    const itemsPerRow = Math.floor((SLIDE_W - 0.4) / itemW);
    const rowH = 0.2;

    let col = 0;
    let rowIdx = 0;
    for (let i = 0; i < items.length; i++) {
      if (i === breakIndex || col >= itemsPerRow) {
        col = 0;
        rowIdx++;
      }
      const mt = items[i];
      const x = 0.3 + col * itemW;
      const itemY = legendY + 0.08 + rowIdx * rowH;
      const color = mt.color.replace('#', '');
      const isFilled = mt.fill_style === 'filled';

      if (mt.shape === 'circle') {
        slide.addShape('ellipse', { x, y: itemY, w: dotSize, h: dotSize, fill: isFilled ? { color } : undefined, line: { color, width: 0.5 } });
      } else if (mt.shape === 'diamond') {
        slide.addShape('diamond', { x, y: itemY, w: dotSize, h: dotSize, fill: isFilled ? { color } : undefined, line: { color, width: 0.5 } });
      } else {
        slide.addShape('rect', { x, y: itemY, w: dotSize, h: dotSize, fill: isFilled ? { color } : undefined, line: { color, width: 0.5 } });
      }

      slide.addText(mt.name, {
        x: x + dotSize + 0.04,
        y: itemY - 0.03,
        w: itemW - dotSize - 0.15,
        h: 0.14,
        fontSize: 5,
        fontFace: 'Arial',
        color: '64748b',
        valign: 'middle',
        shrinkText: true,
      });
      col++;
    }
  }
```

- [ ] **Step 3: Await `renderLegend` in `exportDashboard`**

Change `this.renderLegend(slide, companies);` to `await this.renderLegend(slide, companies);`.

- [ ] **Step 4: Verify lint and build**

Run: `ng lint && ng build`
Expected: pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.service.ts
git commit -m "Order PPTX legend by category and break after Regulatory"
```

---

## Task 7: Markers detail table slide(s) + dynamic footer

**Files:**
- Modify: `src/client/src/app/core/services/pptx-export.service.ts`

- [ ] **Step 1: Import the table helpers**

Add to the util import:

```ts
import {
  buildMarkerTableRows,
  paginate,
  type MarkerRow,
} from './pptx-export.util';
```

- [ ] **Step 2: Build the table slides in `exportDashboard`**

Replace the fixed `const totalPages = 2;` and the slide-building block so the markers table is generated and the page total is dynamic. After `const rows = this.flattenTrials(companies);` add:

```ts
    const markerRows = buildMarkerTableRows(companies);
    const ROWS_PER_TABLE_PAGE = 20;
    const tablePages = paginate(markerRows, ROWS_PER_TABLE_PAGE);
    const totalPages = 2 + tablePages.length;
```

After the data slide (`await this.renderLegend(...)` / `this.addFooter(slide, appDisplayName, 2, totalPages);`), add:

```ts
    for (let p = 0; p < tablePages.length; p++) {
      const tableSlide = pptx.addSlide();
      this.renderMarkerTable(tableSlide, tablePages[p], primaryColorHex);
      this.addFooter(tableSlide, appDisplayName, 3 + p, totalPages);
    }
```

- [ ] **Step 3: Add the `renderMarkerTable` method**

```ts
  private renderMarkerTable(
    slide: PptxGenJS.Slide,
    rows: MarkerRow[],
    primaryColorHex: string
  ): void {
    slide.addText('Catalyst & Milestone Detail', {
      x: 0.3,
      y: 0.2,
      w: SLIDE_W - 0.6,
      h: 0.35,
      fontSize: 14,
      fontFace: 'Arial',
      bold: true,
      color: primaryColorHex,
    });

    const header = ['Company', 'Asset', 'Trial', 'Marker', 'Date', 'Status', 'Notes'];
    const headerRow = header.map((text) => ({
      text,
      options: { bold: true, color: 'ffffff', fill: { color: HEADER_BAND } },
    }));

    const body = rows.map((r, i) => {
      const fill = i % 2 === 0 ? 'ffffff' : 'f8fafc';
      const cells = [r.company, r.asset, r.trial, r.marker, r.date, r.status, r.notes];
      return cells.map((text) => ({ text, options: { fill: { color: fill }, color: '334155' } }));
    });

    slide.addTable([headerRow, ...body], {
      x: 0.3,
      y: 0.7,
      w: SLIDE_W - 0.6,
      colW: [1.6, 1.5, 1.6, 1.4, 1.1, 0.9, 4.63],
      fontSize: 8,
      fontFace: 'Arial',
      border: { type: 'solid', color: 'e2e8f0', pt: 0.5 },
      valign: 'middle',
      rowH: 0.26,
    });
  }
```

- [ ] **Step 4: Verify lint, build, units**

Run: `ng lint && ng build && npm run test:units -- src/app/core/services/pptx-export.util.spec.ts`
Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/app/core/services/pptx-export.service.ts
git commit -m "Add markers detail table slide with dynamic page numbering"
```

---

## Task 8: Manual verification

**Files:** none (verification only)

- [ ] **Step 1: Full verification suite**

Run: `ng lint && ng build && npm run test:units`
Expected: lint clean, build succeeds, all unit tests pass.

- [ ] **Step 2: Manual export check**

Start the app locally, open the dashboard timeline with seeded data, and export to PowerPoint three times with different column-toggle states:
1. All of MOA / ROA / Notes on.
2. MOA on, ROA off, Notes off.
3. All off.

In the generated `.pptx`, confirm for each:
- Header row is a dark-slate band with light labels and white mono year labels.
- Only the toggled columns appear; the timeline widens as columns are hidden.
- Trial cells show acronym + NCT id; company rows show a logo + name (just the name when the company has no logo_url).
- Phase bars are solid/saturated (not washed out).
- Legend reads Clinical Trial -> Data -> Regulatory, then a clean row break, then Approval -> Loss of Exclusivity. "Regulatory Filing" no longer orphans a row.
- A "Catalyst & Milestone Detail" slide (or slides) lists all markers with correct Status (Actual / Projected / NLE), sorted by company -> asset -> trial -> date, and the footer page count matches the actual number of slides.

- [ ] **Step 3: Mark complete**

No commit (verification only). If any check fails, return to the owning task.

---

## Notes for the implementer

- Run everything from `src/client/`. Use `npm run test:units` (never bare `vitest run`).
- pptxgenjs `addTable` cell `text` arrays accept per-cell `options.fill`; the table-level `fill` is overridden per cell here for the header band and zebra striping.
- `MarkerTypeService.list` is cached (30-min TTL) and selects `*, marker_categories(*)`, so `marker_categories.display_order` is available for ordering. The try/catch fallback keeps export working offline.
- Do not commit the loose screenshot PNGs in the repo root or other unrelated working-tree changes; stage only the files named in each task.
```
