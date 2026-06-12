# Timeline Image (PNG) and Excel (XLSX) Export Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add PNG and XLSX export to the timeline alongside the existing PPTX export, behind a split export menu in the topbar.

**Architecture:** The PNG export is a third data-driven renderer (after screen SVG and PPTX shapes): a pure canvas renderer that mirrors the PPTX data slide using the shared `MarkerVisual`/`GLYPH_RATIOS` geometry and `TimelineService` date math. The XLSX export is data sheets only (Trials + Markers) built with ExcelJS in a lazily imported module. Format-agnostic helpers move from `pptx-export.util.ts` to `export-common.util.ts`.

**Tech Stack:** Angular 19 (standalone, signals, OnPush), PrimeNG 21 (Menu, Dialog), ExcelJS (new dep, dynamic import), Canvas 2D, Vitest (node env, pure-function specs), Playwright e2e.

**Spec:** `docs/superpowers/specs/2026-06-10-timeline-image-excel-export-design.md`

**Branch/worktree:** Branch `feat/timeline-image-excel-export` off `develop` (never main; see repo memory). If using a worktree, note Task 6 runs `npm install` (adds `exceljs`); prefer a real `npm install` in the worktree over the node_modules symlink trick, or accept that a symlinked install also lands in the main checkout's node_modules (additive, harmless).

**Conventions that apply to every task:**
- No em dashes anywhere (code, comments, UI copy, commits).
- No emoji. No Claude attribution in commit messages.
- All commands run from `src/client/` unless stated.
- Unit tests: `npm run test:units` (vitest, node environment, pure helpers only; no DOM, no TestBed component rendering).
- Lint/build gate: `ng lint && ng build`.

---

## File Map

| File | Action | Responsibility |
|---|---|---|
| `src/app/core/services/export-common.util.ts` | rename from `pptx-export.util.ts`, extend | Format-agnostic export helpers: column layout, legend groups, marker rows, trial rows, flatten, dates, pagination, `ExportOptions`, `ExportFormat` |
| `src/app/core/services/export-common.util.spec.ts` | rename from `pptx-export.util.spec.ts`, extend | Tests for the above |
| `src/app/core/services/canvas-marker-glyph.ts` | create | Marker glyph renderer for Canvas 2D from `MarkerVisual` + `GLYPH_RATIOS` |
| `src/app/core/services/canvas-marker-glyph.spec.ts` | create | Recording-context tests for every shape/fill/inner-mark/NLE |
| `src/app/core/services/png-export-renderer.ts` | create | Pure canvas renderer for the full timeline image (header, rows, bars, markers, legend, footer) |
| `src/app/core/services/png-export-renderer.spec.ts` | create | Recording-context layout tests |
| `src/app/core/services/png-export.service.ts` | create | DI glue: brand/timeline/marker-type inputs, logo loading, offscreen canvas at 2x, toBlob, download |
| `src/app/core/services/download.util.ts` | create | `saveBlob(blob, fileName)` anchor-click download |
| `src/app/core/services/xlsx-export.util.ts` | create | Pure `buildXlsxWorkbook(companies, meta)` with Trials + Markers sheets (ExcelJS) |
| `src/app/core/services/xlsx-export.util.spec.ts` | create | In-memory workbook assertions (sheets, headers, Date cells, status labels) |
| `src/app/core/services/xlsx-export.service.ts` | create | DI glue + dynamic import of the util + download |
| `src/app/core/services/topbar-state.service.ts` | modify | `TopbarAction` gains optional `items?: MenuItem[]`, `callback` becomes optional |
| `src/app/core/layout/contextual-topbar.component.ts` | modify | Render a popup `p-menu` for actions with `items` |
| `src/app/features/landscape/landscape-shell.component.ts` | modify | Export button becomes a 3-item menu dispatching `landscape:export` with `detail.format` |
| `src/app/features/landscape/timeline-view.component.ts` | modify | Route formats: pptx/png open dialog, xlsx exports directly with toast on failure |
| `src/app/features/landscape/timeline-view.component.html` | modify | Pass `[format]` to the dialog |
| `src/app/features/dashboard/export-dialog/export-dialog.component.ts` | modify | `format` input; header/spinner/button adapt; png branch calls `PngExportService` |
| `src/app/core/services/pptx-export.service.ts` | modify | Import from `export-common.util`; use shared `flattenTrials`; `ExportOptions` moves out |
| `e2e/tests/export.spec.ts` | create | Blob-capture smoke for PNG and XLSX via the new menu |
| `package.json` | modify | add `exceljs` |

---

### Task 1: Rename `pptx-export.util` to `export-common.util`

Everything in `pptx-export.util.ts` is already format-agnostic; the whole file moves.

**Files:**
- Rename: `src/app/core/services/pptx-export.util.ts` -> `src/app/core/services/export-common.util.ts`
- Rename: `src/app/core/services/pptx-export.util.spec.ts` -> `src/app/core/services/export-common.util.spec.ts`
- Modify: `src/app/core/services/pptx-export.service.ts:19` (import path)

- [ ] **Step 1: git mv both files** (files are committed clean; `git mv` is safe here)

```bash
cd src/client/src/app/core/services
git mv pptx-export.util.ts export-common.util.ts
git mv pptx-export.util.spec.ts export-common.util.spec.ts
```

- [ ] **Step 2: Update import sites**

In `export-common.util.spec.ts`, change the import path `'./pptx-export.util'` to `'./export-common.util'`.

In `pptx-export.service.ts`, change:

```ts
} from './pptx-export.util';
```

to:

```ts
} from './export-common.util';
```

Then confirm nothing else references the old name:

```bash
grep -rn "pptx-export.util" src/ && echo "STILL REFERENCED" || echo "clean"
```

Expected: `clean`.

- [ ] **Step 3: Run tests and lint**

Run: `cd src/client && npm run test:units && ng lint`
Expected: all existing specs pass (including the renamed `export-common.util.spec.ts`).

- [ ] **Step 4: Commit**

```bash
git add -A src/client/src/app/core/services
git commit -m "refactor(export): move format-agnostic helpers to export-common.util"
```

---

### Task 2: Shared export row builders (`flattenTrials`, `buildTrialExportRows`, raw marker dates, `ExportOptions`, `ExportFormat`)

**Files:**
- Modify: `src/app/core/services/export-common.util.ts`
- Modify: `src/app/core/services/export-common.util.spec.ts`
- Modify: `src/app/core/services/pptx-export.service.ts` (delete private `flattenTrials` + `FlatRow` + `ExportOptions`, import shared)

- [ ] **Step 1: Write the failing tests**

Append to `export-common.util.spec.ts`:

```ts
import {
  buildTrialExportRows,
  flattenTrials,
  // ...existing imports stay
} from './export-common.util';

const fixtureCompanies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [{ name: 'GLP-1 agonist' }],
        routes_of_administration: [{ name: 'Subcutaneous', abbreviation: 'SC' }],
        trials: [
          {
            id: 't1',
            name: 'Acme Trial One',
            acronym: 'ACME-1',
            identifier: 'NCT00000001',
            notes: 'Pivotal readout expected H2.',
            trial_notes: [],
            phase_type: 'P3',
            phase_start_date: '2020-01-01',
            phase_end_date: '2022-06-30',
            markers: [
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: false,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Parameters<typeof flattenTrials>[0];

describe('flattenTrials', () => {
  it('flattens companies into one row per trial with first-in-group flags', () => {
    const rows = flattenTrials(fixtureCompanies);
    expect(rows).toHaveLength(1);
    expect(rows[0].companyName).toBe('Acme Pharma');
    expect(rows[0].trialName).toBe('ACME-1');
    expect(rows[0].nctId).toBe('NCT00000001');
    expect(rows[0].moa).toBe('GLP-1 agonist');
    expect(rows[0].roa).toBe('SC');
    expect(rows[0].isFirstInCompany).toBe(true);
    expect(rows[0].isFirstInAsset).toBe(true);
  });
});

describe('buildTrialExportRows', () => {
  it('produces flat trial rows with short phase label and raw ISO dates', () => {
    const rows = buildTrialExportRows(fixtureCompanies);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toEqual({
      company: 'Acme Pharma',
      asset: 'ACM-101',
      moa: 'GLP-1 agonist',
      roa: 'SC',
      trial: 'ACME-1',
      nctId: 'NCT00000001',
      phase: 'PH 3',
      phaseStart: '2020-01-01',
      phaseEnd: '2022-06-30',
      notes: 'Pivotal readout expected H2.',
    });
  });
});

describe('buildMarkerTableRows raw dates', () => {
  it('carries raw ISO event and end dates alongside the formatted date', () => {
    const rows = buildMarkerTableRows(fixtureCompanies);
    expect(rows[0].eventDate).toBe('2021-06-15');
    expect(rows[0].endDate).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:units -- export-common`
Expected: FAIL (`flattenTrials` / `buildTrialExportRows` not exported; `eventDate` undefined).

- [ ] **Step 3: Implement in `export-common.util.ts`**

Add imports at the top:

```ts
import type { Trial } from '../models/trial.model';
import { phaseShortLabel } from '../models/phase-colors';
import type { ZoomLevel } from '../models/dashboard.model';
```

Add the shared types and `flattenTrials` (moved verbatim from `pptx-export.service.ts`, now exported):

```ts
export type ExportFormat = 'pptx' | 'png' | 'xlsx';

export interface ExportOptions {
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
  showMoaColumn: boolean;
  showRoaColumn: boolean;
  showNotesColumn: boolean;
}

export interface FlatRow {
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

export function flattenTrials(companies: Company[]): FlatRow[] {
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

export interface TrialExportRow {
  company: string;
  asset: string;
  moa: string;
  roa: string;
  trial: string;
  nctId: string;
  phase: string;
  phaseStart: string | null;
  phaseEnd: string | null;
  notes: string;
}

export function buildTrialExportRows(companies: Company[]): TrialExportRow[] {
  return flattenTrials(companies).map((r) => ({
    company: r.companyName,
    asset: r.assetName,
    moa: r.moa,
    roa: r.roa,
    trial: r.trialName,
    nctId: r.nctId ?? '',
    phase: r.trial.phase_type ? phaseShortLabel(r.trial.phase_type) : '',
    phaseStart: r.trial.phase_start_date ?? null,
    phaseEnd: r.trial.phase_end_date ?? null,
    notes: r.trial.notes ?? '',
  }));
}
```

Extend `MarkerRow` with raw dates and set them in `buildMarkerTableRows`:

```ts
export interface MarkerRow {
  company: string;
  asset: string;
  trial: string;
  marker: string;
  date: string;
  /** Raw ISO event date (yyyy-mm-dd), for renderers that need real dates (Excel). */
  eventDate: string;
  /** Raw ISO end date or null. */
  endDate: string | null;
  status: MarkerStatus;
  detail: string;
}
```

and inside the `rows.push({...})` in `buildMarkerTableRows`, add:

```ts
            eventDate: m.event_date,
            endDate: m.end_date ?? null,
```

- [ ] **Step 4: Update `pptx-export.service.ts` to use the shared code**

Delete the local `ExportOptions` interface, the local `FlatRow` interface, and the private `flattenTrials` method. Update the import block:

```ts
import {
  buildLegendGroups,
  buildMarkerTableRows,
  computeLeftColumns,
  type ColumnLayout,
  type ExportOptions,
  type FlatRow,
  flattenTrials,
  formatDateShort,
  type MarkerRow,
  paginate,
} from './export-common.util';
```

Re-export the type so existing imports keep compiling (the dialog component does not import it today, but keep the public surface stable):

```ts
export type { ExportOptions } from './export-common.util';
```

Replace `this.flattenTrials(companies)` with `flattenTrials(companies)`. Then verify no other file imported `ExportOptions` from the service:

```bash
grep -rn "from './pptx-export.service'\|pptx-export.service'" src/app --include="*.ts" | grep -v spec
```

Expected: only `export-dialog.component.ts` (imports `PptxExportService` only).

- [ ] **Step 5: Run tests, lint, build**

Run: `npm run test:units && ng lint && ng build`
Expected: PASS / clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/export-common.util.ts src/client/src/app/core/services/export-common.util.spec.ts src/client/src/app/core/services/pptx-export.service.ts
git commit -m "feat(export): shared trial/marker export row builders in export-common"
```

---

### Task 3: Canvas marker glyph renderer

Counterpart to `pptx-marker-glyph.ts` for Canvas 2D. Same `MarkerVisual` in, same `GLYPH_RATIOS` geometry, same flag/banner approximation as the deck (PNG mirrors the PPTX data slide).

**Files:**
- Create: `src/app/core/services/canvas-marker-glyph.ts`
- Create: `src/app/core/services/canvas-marker-glyph.spec.ts`

- [ ] **Step 1: Write the failing tests**

`canvas-marker-glyph.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { MarkerVisual } from '../models/marker-visual';
import { type CanvasGlyphSurface, drawMarkerGlyphCanvas } from './canvas-marker-glyph';

type Op = [string, ...unknown[]];

/** Records every method call and property set so geometry can be asserted. */
class RecordingCtx {
  ops: Op[] = [];

  private record(name: string, ...args: unknown[]): void {
    this.ops.push([name, ...args]);
  }

  set fillStyle(v: unknown) {
    this.record('set fillStyle', v);
  }
  set strokeStyle(v: unknown) {
    this.record('set strokeStyle', v);
  }
  set lineWidth(v: unknown) {
    this.record('set lineWidth', v);
  }
  set globalAlpha(v: unknown) {
    this.record('set globalAlpha', v);
  }

  beginPath(): void {
    this.record('beginPath');
  }
  closePath(): void {
    this.record('closePath');
  }
  arc(...args: unknown[]): void {
    this.record('arc', ...args);
  }
  moveTo(...args: unknown[]): void {
    this.record('moveTo', ...args);
  }
  lineTo(...args: unknown[]): void {
    this.record('lineTo', ...args);
  }
  rect(...args: unknown[]): void {
    this.record('rect', ...args);
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  setLineDash(...args: unknown[]): void {
    this.record('setLineDash', ...args);
  }
}

function surface(): { ctx: CanvasGlyphSurface; ops: Op[] } {
  const rec = new RecordingCtx();
  return { ctx: rec as unknown as CanvasGlyphSurface, ops: rec.ops };
}

function visual(overrides: Partial<MarkerVisual>): MarkerVisual {
  return {
    shape: 'circle',
    color: '#16a34a',
    fillStyle: 'filled',
    innerMark: 'none',
    isNle: false,
    ...overrides,
  };
}

const has = (ops: Op[], name: string): Op[] => ops.filter((o) => o[0] === name);

describe('drawMarkerGlyphCanvas', () => {
  it('draws a filled circle: fill color set to marker color, arc at center with r=size/2', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({}), 10, 20, 16);
    expect(ops).toContainEqual(['set fillStyle', '#16a34a']);
    expect(ops).toContainEqual(['arc', 18, 28, 8, 0, Math.PI * 2]);
    expect(has(ops, 'fill').length).toBeGreaterThan(0);
    expect(has(ops, 'stroke').length).toBeGreaterThan(0);
  });

  it('draws an outline circle with white fill', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ fillStyle: 'outline' }), 0, 0, 16);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
    expect(ops).toContainEqual(['set strokeStyle', '#16a34a']);
  });

  it('insets the square by GLYPH_RATIOS.squareInset', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'square' }), 0, 0, 10);
    // inset 0.1 of size 10 => rect(1, 1, 8, 8)
    expect(ops).toContainEqual(['rect', 1, 1, 8, 8]);
  });

  it('draws the diamond as a 4-point path', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'diamond' }), 0, 0, 10);
    expect(ops).toContainEqual(['moveTo', 5, 0]);
    expect(ops).toContainEqual(['lineTo', 10, 5]);
    expect(ops).toContainEqual(['lineTo', 5, 10]);
    expect(ops).toContainEqual(['lineTo', 0, 5]);
  });

  it('uses a dashed vertical line for dashed-line markers', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'dashed-line' }), 0, 0, 16);
    expect(has(ops, 'setLineDash').length).toBeGreaterThanOrEqual(2); // set + reset
    expect(ops).toContainEqual(['moveTo', 8, 0]);
    expect(ops).toContainEqual(['lineTo', 8, 16]);
  });

  it('renders inner dot in white on filled glyphs', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ innerMark: 'dot' }), 0, 0, 20);
    // innerDotR 0.15 of 20 => r=3 at center 10,10
    expect(ops).toContainEqual(['arc', 10, 10, 3, 0, Math.PI * 2]);
    expect(ops).toContainEqual(['set fillStyle', '#ffffff']);
  });

  it('renders the check inner mark as two segments', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ shape: 'diamond', innerMark: 'check' }), 0, 0, 100);
    // checkPoints [0.32,0.5, 0.45,0.65, 0.68,0.38] on size 100
    expect(ops).toContainEqual(['moveTo', 32, 50]);
    expect(ops).toContainEqual(['lineTo', 45, 65]);
    expect(ops).toContainEqual(['lineTo', 68, 38]);
  });

  it('dims NLE glyphs to 0.3 alpha and draws a full-alpha slate strike', () => {
    const { ctx, ops } = surface();
    drawMarkerGlyphCanvas(ctx, visual({ isNle: true }), 0, 0, 20);
    expect(ops).toContainEqual(['set globalAlpha', 0.3]);
    expect(ops).toContainEqual(['set strokeStyle', '#64748b']);
    // strike spans size*1.1 centered: from x-1 to x+21 at mid-height
    expect(ops).toContainEqual(['moveTo', -1, 10]);
    expect(ops).toContainEqual(['lineTo', 21, 10]);
    // glyph alpha is restored before the strike
    const restoreIdx = ops.findIndex((o) => o[0] === 'restore');
    const strikeIdx = ops.findIndex((o) => o[0] === 'moveTo' && o[1] === -1);
    expect(restoreIdx).toBeGreaterThan(-1);
    expect(strikeIdx).toBeGreaterThan(restoreIdx);
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:units -- canvas-marker-glyph`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `canvas-marker-glyph.ts`**

```ts
import { GLYPH_RATIOS, type MarkerVisual } from '../models/marker-visual';

/**
 * Minimal Canvas 2D surface the glyph needs. Structural so unit tests can pass
 * a recording fake in the node environment (no real canvas).
 */
export type CanvasGlyphSurface = Pick<
  CanvasRenderingContext2D,
  | 'beginPath'
  | 'closePath'
  | 'arc'
  | 'moveTo'
  | 'lineTo'
  | 'rect'
  | 'fill'
  | 'stroke'
  | 'save'
  | 'restore'
  | 'setLineDash'
  | 'fillStyle'
  | 'strokeStyle'
  | 'lineWidth'
  | 'globalAlpha'
>;

const NLE_ALPHA = 0.3;
const STRIKE_COLOR = '#64748b';
const WHITE = '#ffffff';

/**
 * Render a MarkerVisual on a Canvas 2D context. Canvas counterpart to
 * drawMarkerGlyph (pptx-marker-glyph.ts); geometry comes from GLYPH_RATIOS so
 * screen SVG, PPTX, and PNG all agree. The flag banner uses the same
 * rect approximation as the deck, since the PNG mirrors the PPTX data slide.
 */
export function drawMarkerGlyphCanvas(
  ctx: CanvasGlyphSurface,
  visual: MarkerVisual,
  x: number,
  y: number,
  size: number
): void {
  const filled = visual.fillStyle === 'filled';
  const color = visual.color;
  const cx = x + size / 2;
  const cy = y + size / 2;
  const markColor = filled ? WHITE : color;
  const r = GLYPH_RATIOS;

  ctx.save();
  if (visual.isNle) ctx.globalAlpha = NLE_ALPHA;
  ctx.lineWidth = 1;
  ctx.strokeStyle = color;
  ctx.fillStyle = filled ? color : WHITE;

  switch (visual.shape) {
    case 'dashed-line':
      ctx.beginPath();
      ctx.setLineDash([3, 2]);
      ctx.moveTo(cx, y);
      ctx.lineTo(cx, y + size);
      ctx.stroke();
      ctx.setLineDash([]);
      break;
    case 'flag': {
      const poleX = x + size * r.flagPoleX;
      ctx.beginPath();
      ctx.moveTo(poleX, y);
      ctx.lineTo(poleX, y + size);
      ctx.stroke();
      ctx.beginPath();
      ctx.rect(poleX, y, size * 0.7, size * 0.45);
      ctx.fill();
      ctx.stroke();
      break;
    }
    case 'diamond':
      ctx.beginPath();
      ctx.moveTo(cx, y);
      ctx.lineTo(x + size, cy);
      ctx.lineTo(cx, y + size);
      ctx.lineTo(x, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    case 'triangle': {
      const [x1, y1, x2, y2, x3, y3] = r.trianglePoints;
      ctx.beginPath();
      ctx.moveTo(x + size * x1, y + size * y1);
      ctx.lineTo(x + size * x2, y + size * y2);
      ctx.lineTo(x + size * x3, y + size * y3);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    }
    case 'square':
      ctx.beginPath();
      ctx.rect(
        x + size * r.squareInset,
        y + size * r.squareInset,
        size * (1 - 2 * r.squareInset),
        size * (1 - 2 * r.squareInset)
      );
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
    case 'circle':
    default:
      ctx.beginPath();
      ctx.arc(cx, cy, size / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
      drawInnerMark(ctx, visual, cx, cy, size, markColor);
      break;
  }

  ctx.restore();

  if (visual.isNle) {
    ctx.beginPath();
    ctx.strokeStyle = STRIKE_COLOR;
    ctx.lineWidth = 1;
    ctx.moveTo(x - size * 0.05, cy);
    ctx.lineTo(x + size * 1.05, cy);
    ctx.stroke();
  }
}

function drawInnerMark(
  ctx: CanvasGlyphSurface,
  visual: MarkerVisual,
  cx: number,
  cy: number,
  size: number,
  markColor: string
): void {
  const r = GLYPH_RATIOS;
  switch (visual.innerMark) {
    case 'dot':
      ctx.beginPath();
      ctx.fillStyle = markColor;
      ctx.arc(cx, cy, size * r.innerDotR, 0, Math.PI * 2);
      ctx.fill();
      break;
    case 'dash':
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = 1.5;
      ctx.moveTo(cx - size * (0.5 - r.circleDashX1), cy);
      ctx.lineTo(cx - size * (0.5 - r.circleDashX2), cy);
      ctx.stroke();
      break;
    case 'check': {
      const [x1, y1, x2, y2, x3, y3] = r.checkPoints;
      const ox = cx - size / 2;
      const oy = cy - size / 2;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = 1.25;
      ctx.moveTo(ox + size * x1, oy + size * y1);
      ctx.lineTo(ox + size * x2, oy + size * y2);
      ctx.lineTo(ox + size * x3, oy + size * y3);
      ctx.stroke();
      break;
    }
    case 'x': {
      const a = (size * (r.squareXMax - r.squareXMin)) / 2;
      ctx.beginPath();
      ctx.strokeStyle = markColor;
      ctx.lineWidth = 1.25;
      ctx.moveTo(cx - a, cy - a);
      ctx.lineTo(cx + a, cy + a);
      ctx.moveTo(cx + a, cy - a);
      ctx.lineTo(cx - a, cy + a);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:units -- canvas-marker-glyph`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/canvas-marker-glyph.ts src/client/src/app/core/services/canvas-marker-glyph.spec.ts
git commit -m "feat(export): canvas marker glyph renderer from MarkerVisual"
```

---

### Task 4: Pure PNG timeline renderer

Pure function painting the full image onto a Canvas-2D-like surface. Mirrors the PPTX data slide layout. All inch-based pptx constants map at 144 px/in (1920 / 13.33), and point font sizes map at 2 px/pt.

**Files:**
- Create: `src/app/core/services/png-export-renderer.ts`
- Create: `src/app/core/services/png-export-renderer.spec.ts`

- [ ] **Step 1: Write the failing tests**

`png-export-renderer.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';

import type { Company } from '../models/company.model';
import {
  PNG_H,
  PNG_W,
  type PngRenderContext,
  type PngSurface,
  renderTimelinePng,
} from './png-export-renderer';

type Op = [string, ...unknown[]];

class RecordingCtx {
  ops: Op[] = [];
  private record(name: string, ...args: unknown[]): void {
    this.ops.push([name, ...args]);
  }
  set fillStyle(v: unknown) {
    this.record('set fillStyle', v);
  }
  set strokeStyle(v: unknown) {
    this.record('set strokeStyle', v);
  }
  set lineWidth(v: unknown) {
    this.record('set lineWidth', v);
  }
  set globalAlpha(v: unknown) {
    this.record('set globalAlpha', v);
  }
  set font(v: unknown) {
    this.record('set font', v);
  }
  set textAlign(v: unknown) {
    this.record('set textAlign', v);
  }
  set textBaseline(v: unknown) {
    this.record('set textBaseline', v);
  }
  beginPath(): void {
    this.record('beginPath');
  }
  closePath(): void {
    this.record('closePath');
  }
  arc(...a: unknown[]): void {
    this.record('arc', ...a);
  }
  arcTo(...a: unknown[]): void {
    this.record('arcTo', ...a);
  }
  moveTo(...a: unknown[]): void {
    this.record('moveTo', ...a);
  }
  lineTo(...a: unknown[]): void {
    this.record('lineTo', ...a);
  }
  rect(...a: unknown[]): void {
    this.record('rect', ...a);
  }
  fill(): void {
    this.record('fill');
  }
  stroke(): void {
    this.record('stroke');
  }
  save(): void {
    this.record('save');
  }
  restore(): void {
    this.record('restore');
  }
  setLineDash(...a: unknown[]): void {
    this.record('setLineDash', ...a);
  }
  fillRect(...a: unknown[]): void {
    this.record('fillRect', ...a);
  }
  fillText(...a: unknown[]): void {
    this.record('fillText', ...a);
  }
  drawImage(...a: unknown[]): void {
    this.record('drawImage', ...a);
  }
  measureText(text: string): TextMetrics {
    return { width: text.length * 6 } as TextMetrics;
  }
}

const companies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [],
        routes_of_administration: [],
        trials: [
          {
            id: 't1',
            name: 'ACME-1',
            acronym: null,
            identifier: 'NCT00000001',
            notes: null,
            trial_notes: [],
            phase_type: 'P3',
            phase_start_date: '2020-01-01',
            phase_end_date: '2022-06-30',
            markers: [
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: false,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Company[];

function renderContext(): PngRenderContext {
  return {
    companies,
    options: {
      zoomLevel: 'yearly',
      startYear: 2019,
      endYear: 2023,
      showMoaColumn: true,
      showRoaColumn: true,
      showNotesColumn: true,
    },
    appDisplayName: 'Test App',
    primaryColor: '#0d9488',
    agencyName: 'Test Agency',
    dateStr: 'June 10, 2026',
    legendGroups: [
      {
        label: 'Clinical',
        items: [
          { name: 'Data readout', color: '#16a34a', shape: 'circle', fill_style: 'filled', inner_mark: 'none' },
        ],
      },
    ],
    columns: [2019, 2020, 2021, 2022, 2023].map((year, i) => ({
      label: `${year}`,
      startX: i * 200,
      width: 200,
    })),
    totalPx: 1000,
    dateToX: (date: string) => {
      const start = new Date(2019, 0, 1).getTime();
      const end = new Date(2024, 0, 1).getTime();
      return ((new Date(date).getTime() - start) / (end - start)) * 1000;
    },
  };
}

function render(): Op[] {
  const rec = new RecordingCtx();
  renderTimelinePng(rec as unknown as PngSurface, renderContext());
  return rec.ops;
}

describe('renderTimelinePng', () => {
  it('paints a white background across the full 1920x1080 frame', () => {
    const ops = render();
    expect(ops).toContainEqual(['fillRect', 0, 0, PNG_W, PNG_H]);
  });

  it('paints the dark header band across the full width', () => {
    const ops = render();
    const bandIdx = ops.findIndex(
      (o) => o[0] === 'fillRect' && o[1] === 0 && o[2] === 0 && o[3] === PNG_W && o[4] !== PNG_H
    );
    expect(bandIdx).toBeGreaterThan(-1);
    const priorFills = ops.slice(0, bandIdx).filter((o) => o[0] === 'set fillStyle');
    expect(priorFills.at(-1)).toEqual(['set fillStyle', '#1e293b']);
  });

  it('writes the left column headers and year labels', () => {
    const ops = render();
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('Company');
    expect(texts).toContain('Trial');
    expect(texts).toContain('2021');
  });

  it('washes the phase bar at 12% alpha', () => {
    const ops = render();
    expect(ops).toContainEqual(['set globalAlpha', 0.12]);
  });

  it('draws the marker glyph (circle arc) and the company name in brand color', () => {
    const ops = render();
    expect(ops.some((o) => o[0] === 'arc')).toBe(true);
    expect(ops).toContainEqual(['set fillStyle', '#0d9488']);
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('ACME PHARMA');
  });

  it('renders legend group header, status entries, and footer branding', () => {
    const ops = render();
    const texts = ops.filter((o) => o[0] === 'fillText').map((o) => o[1]);
    expect(texts).toContain('CLINICAL');
    expect(texts).toContain('Actual');
    expect(texts).toContain('Data readout');
    expect(texts).toContain('Test App');
    expect(texts).toContain('Intelligence delivered by Test Agency');
    expect(texts).toContain('June 10, 2026');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npm run test:units -- png-export-renderer`
Expected: FAIL (module not found).

- [ ] **Step 3: Implement `png-export-renderer.ts`**

```ts
import type { Company } from '../models/company.model';
import { PHASE_COLORS, PHASE_FALLBACK_COLOR, phaseShortLabel } from '../models/phase-colors';
import { resolveMarkerVisual } from '../models/marker-visual';
import { type CanvasGlyphSurface, drawMarkerGlyphCanvas } from './canvas-marker-glyph';
import {
  type ColumnLayout,
  computeLeftColumns,
  type ExportOptions,
  type FlatRow,
  flattenTrials,
  formatDateShort,
  type LegendGroup,
} from './export-common.util';
import type { TimelineColumn } from './timeline.service';

/** Logical frame size. The service renders at 2x for a 3840x2160 PNG. */
export const PNG_W = 1920;
export const PNG_H = 1080;

// The PPTX data slide is the layout reference: 13.33in wide -> 144 px/in,
// and point font sizes -> 2 px/pt. Constants below mirror pptx-export.service.
const IN = 144;
const PT = 2;
const HEADER_H = 0.28 * IN;
const DATA_Y = HEADER_H;
const LEGEND_H = 0.85 * IN;
const FOOTER_H = 0.26 * IN;
const HEADER_BAND = '#1e293b';
const SANS = 'Arial, sans-serif';
const MONO = 'Consolas, monospace';

export type PngSurface = CanvasGlyphSurface &
  Pick<
    CanvasRenderingContext2D,
    'fillRect' | 'fillText' | 'measureText' | 'drawImage' | 'arcTo' | 'font' | 'textAlign' | 'textBaseline'
  >;

export interface PngImages {
  tenantLogo?: CanvasImageSource | null;
  agencyLogo?: CanvasImageSource | null;
  companyLogos?: Map<string, CanvasImageSource>;
}

export interface PngRenderContext {
  companies: Company[];
  options: ExportOptions;
  appDisplayName: string;
  primaryColor: string;
  agencyName: string | null;
  dateStr: string;
  legendGroups: LegendGroup[];
  columns: TimelineColumn[];
  totalPx: number;
  /** Maps an ISO date to [0..totalPx] (TimelineService.dateToX bound to the window). */
  dateToX: (date: string) => number;
  images?: PngImages;
}

/** Render the full timeline image. Pure: all data and DI products come in via rc. */
export function renderTimelinePng(ctx: PngSurface, rc: PngRenderContext): void {
  const rows = flattenTrials(rc.companies);
  if (rows.length === 0) return;

  const inches = computeLeftColumns({
    showMoa: rc.options.showMoaColumn,
    showRoa: rc.options.showRoaColumn,
    showNotes: rc.options.showNotesColumn,
  });
  const layout: ColumnLayout = {
    labelColW: inches.labelColW * IN,
    columns: inches.columns.map((c) => ({ ...c, x: c.x * IN, width: c.width * IN })),
  };
  const rowH = Math.min(0.28 * IN, (PNG_H - DATA_Y - LEGEND_H) / rows.length);

  ctx.textBaseline = 'middle';
  ctx.textAlign = 'left';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, PNG_W, PNG_H);

  drawRowBackgrounds(ctx, rows.length, rowH);
  drawHeader(ctx, layout, rc);
  drawGridLines(ctx, layout, rc, rows.length, rowH);
  drawRows(ctx, rows, layout, rc, rowH);
  drawLegend(ctx, rc);
  drawFooter(ctx, rc);
}

function timelineX(layout: ColumnLayout, rc: PngRenderContext, px: number): number {
  return layout.labelColW + (px / rc.totalPx) * (PNG_W - layout.labelColW);
}

function drawRowBackgrounds(ctx: PngSurface, count: number, rowH: number): void {
  ctx.fillStyle = '#f8fafc';
  for (let i = 1; i < count; i += 2) {
    ctx.fillRect(0, DATA_Y + i * rowH, PNG_W, rowH);
  }
}

const COLUMN_LABELS: Record<string, string> = {
  company: 'Company',
  asset: 'Asset',
  moa: 'MOA',
  roa: 'ROA',
  trial: 'Trial',
  notes: 'Notes',
};

function drawHeader(ctx: PngSurface, layout: ColumnLayout, rc: PngRenderContext): void {
  ctx.fillStyle = HEADER_BAND;
  ctx.fillRect(0, 0, PNG_W, HEADER_H);

  ctx.font = `bold ${6 * PT}px ${SANS}`;
  ctx.fillStyle = '#e2e8f0';
  ctx.textAlign = 'left';
  for (const col of layout.columns) {
    ctx.fillText(COLUMN_LABELS[col.key], col.x + 0.05 * IN, HEADER_H / 2);
  }

  ctx.font = `${6 * PT}px ${MONO}`;
  ctx.fillStyle = '#ffffff';
  ctx.textAlign = 'center';
  for (const col of rc.columns) {
    const x = timelineX(layout, rc, col.startX);
    const w = (col.width / rc.totalPx) * (PNG_W - layout.labelColW);
    ctx.fillText(col.label, x + w / 2, HEADER_H / 2);
  }
  ctx.textAlign = 'left';

  ctx.fillStyle = '#cbd5e1';
  ctx.fillRect(0, HEADER_H - 1, PNG_W, 1);
}

function drawGridLines(
  ctx: PngSurface,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowCount: number,
  rowH: number
): void {
  ctx.fillStyle = '#e2e8f0';
  const gridH = rowCount * rowH;
  for (const col of rc.columns) {
    const x = timelineX(layout, rc, col.startX);
    ctx.fillRect(x, DATA_Y, 1, gridH);
  }
}

function fitText(ctx: PngSurface, text: string, maxW: number): string {
  if (ctx.measureText(text).width <= maxW) return text;
  let t = text;
  while (t.length > 1 && ctx.measureText(t + '…').width > maxW) {
    t = t.slice(0, -1);
  }
  return t + '…';
}

function colOf(layout: ColumnLayout, key: string): { x: number; width: number } | undefined {
  return layout.columns.find((c) => c.key === key);
}

function drawRows(
  ctx: PngSurface,
  rows: FlatRow[],
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowH: number
): void {
  const fontPt = Math.max(5, Math.min(7, (rowH / IN) * 28));
  const pad = 0.05 * IN;

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const y = DATA_Y + i * rowH;
    const midY = y + rowH / 2;

    const companyCol = colOf(layout, 'company')!;
    if (row.isFirstInCompany) {
      const logo = rc.images?.companyLogos?.get(row.companyId);
      const logoS = 0.16 * IN;
      let textX = companyCol.x + pad;
      if (logo) {
        ctx.drawImage(logo, companyCol.x + 0.04 * IN, y + (rowH - logoS) / 2, logoS, logoS);
        textX = companyCol.x + 0.04 * IN + logoS + 0.07 * IN;
      }
      ctx.font = `bold ${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = rc.primaryColor;
      ctx.fillText(
        fitText(ctx, row.companyName.toUpperCase(), companyCol.x + companyCol.width - textX),
        textX,
        midY
      );
    }

    const assetCol = colOf(layout, 'asset')!;
    if (row.isFirstInAsset) {
      ctx.font = `bold ${fontPt * PT}px ${SANS}`;
      ctx.fillStyle = '#475569';
      ctx.fillText(fitText(ctx, row.assetName, assetCol.width - pad), assetCol.x + pad, midY);
    }

    const moaCol = colOf(layout, 'moa');
    if (moaCol && row.isFirstInAsset && row.moa) {
      ctx.font = `${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(fitText(ctx, row.moa, moaCol.width - pad), moaCol.x + pad, midY);
    }

    const roaCol = colOf(layout, 'roa');
    if (roaCol && row.isFirstInAsset && row.roa) {
      ctx.font = `${Math.max(4, fontPt - 1) * PT}px ${SANS}`;
      ctx.fillStyle = '#64748b';
      ctx.fillText(fitText(ctx, row.roa, roaCol.width - pad), roaCol.x + pad, midY);
    }

    const trialCol = colOf(layout, 'trial')!;
    ctx.font = `bold ${fontPt * PT}px ${SANS}`;
    ctx.fillStyle = '#334155';
    const trialText = fitText(ctx, row.trialName, trialCol.width - pad);
    ctx.fillText(trialText, trialCol.x + pad, midY);
    if (row.nctId) {
      const used = ctx.measureText(trialText).width;
      ctx.font = `${Math.max(4, fontPt - 2) * PT}px ${SANS}`;
      ctx.fillStyle = '#94a3b8';
      const nctX = trialCol.x + pad + used + 6;
      const room = trialCol.x + trialCol.width - nctX;
      if (room > 20) ctx.fillText(fitText(ctx, row.nctId, room), nctX, midY);
    }

    const notesCol = colOf(layout, 'notes');
    if (notesCol && row.hasNotes) {
      ctx.beginPath();
      ctx.fillStyle = '#94a3b8';
      ctx.arc(notesCol.x + notesCol.width / 2, midY, 0.03 * IN, 0, Math.PI * 2);
      ctx.fill();
    }

    drawPhaseBar(ctx, row, layout, rc, y, rowH, fontPt);
    drawMarkers(ctx, row, layout, rc, y, rowH, fontPt);
  }
}

function drawPhaseBar(
  ctx: PngSurface,
  row: FlatRow,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowY: number,
  rowH: number,
  fontPt: number
): void {
  const trial = row.trial;
  if (!trial.phase_type || !trial.phase_start_date) return;

  const sx = rc.dateToX(trial.phase_start_date);
  const ex = rc.dateToX(trial.phase_end_date ?? trial.phase_start_date);
  const barX = timelineX(layout, rc, sx);
  const barW = Math.max(0.05 * IN, ((ex - sx) / rc.totalPx) * (PNG_W - layout.labelColW));
  const barH = rowH * 0.45;
  const barY = rowY + (rowH - barH) / 2;
  const color = PHASE_COLORS[trial.phase_type] ?? PHASE_FALLBACK_COLOR;

  roundRectPath(ctx, barX, barY, barW, barH, 0.02 * IN);
  ctx.save();
  ctx.globalAlpha = 0.12; // same wash as the web and the deck
  ctx.fillStyle = color;
  ctx.fill();
  ctx.restore();
  ctx.strokeStyle = color;
  ctx.lineWidth = 1;
  ctx.stroke();

  if (barW > 0.4 * IN) {
    ctx.font = `bold ${Math.max(4, fontPt - 2) * PT}px ${SANS}`;
    ctx.fillStyle = color;
    ctx.textAlign = 'center';
    ctx.fillText(phaseShortLabel(trial.phase_type), barX + barW / 2, barY + barH / 2);
    ctx.textAlign = 'left';
  }
}

function drawMarkers(
  ctx: PngSurface,
  row: FlatRow,
  layout: ColumnLayout,
  rc: PngRenderContext,
  rowY: number,
  rowH: number,
  fontPt: number
): void {
  const size = Math.min(0.12, (rowH / IN) * 0.35) * IN;
  const sorted = [...(row.trial.markers ?? [])]
    .filter((m) => m.event_date && m.marker_types)
    .sort((a, b) => new Date(a.event_date).getTime() - new Date(b.event_date).getTime());

  let lastLabelX = -Infinity;
  for (const marker of sorted) {
    const centerX = timelineX(layout, rc, rc.dateToX(marker.event_date));
    const x = centerX - size / 2;
    const y = rowY + rowH * 0.1;
    const visual = resolveMarkerVisual(marker);
    drawMarkerGlyphCanvas(ctx, visual, x, y, size);

    if (centerX - lastLabelX > 0.4 * IN) {
      ctx.font = `${Math.max(3, fontPt - 3) * PT}px ${MONO}`;
      ctx.fillStyle = visual.color;
      ctx.textAlign = 'center';
      ctx.fillText(formatDateShort(marker.event_date), centerX, y + size + 0.06 * IN);
      ctx.textAlign = 'left';
      lastLabelX = centerX;
    }
  }
}

function drawLegend(ctx: PngSurface, rc: PngRenderContext): void {
  const legendY = PNG_H - LEGEND_H;
  ctx.fillStyle = '#f8fafc';
  ctx.fillRect(0, legendY, PNG_W, LEGEND_H);
  ctx.fillStyle = '#e2e8f0';
  ctx.fillRect(0, legendY, PNG_W, 1);

  const xStart = 0.3 * IN;
  const xEnd = PNG_W - 0.3 * IN;
  const rowH = 0.16 * IN;
  const s = 0.09 * IN;
  const yTop = legendY + 0.07 * IN;

  let x = xStart;
  let row = 0;
  const place = (w: number): { px: number; py: number } => {
    if (x + w > xEnd) {
      x = xStart;
      row++;
    }
    const px = x;
    x += w;
    return { px, py: yTop + row * rowH };
  };
  const label = (text: string, px: number, py: number, bold: boolean): void => {
    ctx.font = `${bold ? 'bold ' : ''}${5 * PT}px ${SANS}`;
    ctx.fillStyle = bold ? '#475569' : '#64748b';
    ctx.fillText(text, px, py + s / 2);
  };
  const measure = (text: string, bold: boolean): number => {
    ctx.font = `${bold ? 'bold ' : ''}${5 * PT}px ${SANS}`;
    return ctx.measureText(text).width;
  };

  const statuses: { name: string; kind: 'actual' | 'projected' | 'nle' }[] = [
    { name: 'Actual', kind: 'actual' },
    { name: 'Projected', kind: 'projected' },
    { name: 'NLE', kind: 'nle' },
  ];
  for (const st of statuses) {
    const w = s + 6 + measure(st.name, false) + 22;
    const { px, py } = place(w);
    const cy = py + s / 2;
    ctx.beginPath();
    ctx.strokeStyle = '#64748b';
    ctx.lineWidth = 1;
    if (st.kind === 'actual') {
      ctx.fillStyle = '#64748b';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else if (st.kind === 'projected') {
      ctx.fillStyle = '#ffffff';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    } else {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.fillStyle = '#64748b';
      ctx.arc(px + s / 2, cy, s / 2, 0, Math.PI * 2);
      ctx.fill();
      ctx.restore();
      ctx.beginPath();
      ctx.strokeStyle = '#64748b';
      ctx.moveTo(px - 1, cy);
      ctx.lineTo(px + s + 1, cy);
      ctx.stroke();
    }
    label(st.name, px + s + 6, py, false);
  }

  for (const g of rc.legendGroups) {
    const head = g.label.toUpperCase();
    const h = place(measure(head, true) + 20);
    label(head, h.px, h.py, true);
    for (const it of g.items) {
      const w = s + 6 + measure(it.name, false) + 22;
      const { px, py } = place(w);
      drawMarkerGlyphCanvas(
        ctx,
        {
          shape: it.shape as MarkerVisual['shape'],
          color: it.color,
          fillStyle: it.fill_style as MarkerVisual['fillStyle'],
          innerMark: it.inner_mark as MarkerVisual['innerMark'],
          isNle: false,
        },
        px,
        py,
        s
      );
      label(it.name, px + s + 6, py, false);
    }
  }
}

function drawFooter(ctx: PngSurface, rc: PngRenderContext): void {
  const footerY = PNG_H - FOOTER_H;
  const midY = footerY + FOOTER_H / 2;
  const glyph = 0.18 * IN;

  let textX = 0.1 * IN;
  if (rc.images?.tenantLogo) {
    ctx.drawImage(rc.images.tenantLogo, 0.1 * IN, midY - glyph / 2, glyph, glyph);
    textX = 0.1 * IN + glyph + 0.07 * IN;
  }
  ctx.font = `bold ${8 * PT}px ${SANS}`;
  ctx.fillStyle = '#64748b';
  ctx.fillText(rc.appDisplayName, textX, midY);

  if (rc.agencyName) {
    let agencyX = textX + ctx.measureText(rc.appDisplayName).width + 0.3 * IN;
    if (rc.images?.agencyLogo) {
      ctx.drawImage(rc.images.agencyLogo, agencyX, midY - glyph / 2, glyph, glyph);
      agencyX += glyph + 0.07 * IN;
    }
    ctx.font = `italic ${8 * PT}px ${SANS}`;
    ctx.fillStyle = '#94a3b8';
    ctx.fillText(`Intelligence delivered by ${rc.agencyName}`, agencyX, midY);
  }

  ctx.font = `${8 * PT}px ${SANS}`;
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(rc.dateStr, PNG_W - 0.1 * IN, midY);
  ctx.textAlign = 'left';
}

function roundRectPath(
  ctx: PngSurface,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number
): void {
  const rr = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + rr, y);
  ctx.arcTo(x + w, y, x + w, y + h, rr);
  ctx.arcTo(x + w, y + h, x, y + h, rr);
  ctx.arcTo(x, y + h, x, y, rr);
  ctx.arcTo(x, y, x + w, y, rr);
  ctx.closePath();
}
```

Add this import at the top (used by the legend's glyph cast):

```ts
import type { MarkerVisual } from '../models/marker-visual';
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm run test:units -- png-export-renderer`
Expected: PASS.

- [ ] **Step 5: Lint and commit**

```bash
cd src/client && ng lint
git add src/client/src/app/core/services/png-export-renderer.ts src/client/src/app/core/services/png-export-renderer.spec.ts
git commit -m "feat(export): pure canvas renderer for timeline PNG"
```

---

### Task 5: PNG export service + download helper

Thin DI glue: gather brand/timeline/marker-type inputs, load logos as image elements, render offscreen at 2x, download. No unit spec for the service itself (it is DOM-bound and the units config runs in node; the renderer and glyph carry the logic and have specs; the service is covered by the e2e in Task 10).

**Files:**
- Create: `src/app/core/services/download.util.ts`
- Create: `src/app/core/services/png-export.service.ts`

- [ ] **Step 1: Create `download.util.ts`**

```ts
/** Trigger a browser download for a Blob via a temporary anchor element. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
```

- [ ] **Step 2: Create `png-export.service.ts`**

```ts
import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { resolveBrandLogoSrc } from '../../shared/components/brand-logo-url';
import { Company } from '../models/company.model';
import { BrandContextService } from './brand-context.service';
import { buildLegendGroups, type ExportOptions } from './export-common.util';
import { MarkerTypeService } from './marker-type.service';
import { PNG_H, PNG_W, type PngImages, type PngSurface, renderTimelinePng } from './png-export-renderer';
import { saveBlob } from './download.util';
import { TimelineService } from './timeline.service';

const SCALE = 2; // 2x for a crisp 3840x2160 output

@Injectable({ providedIn: 'root' })
export class PngExportService {
  private timeline = inject(TimelineService);
  private brand = inject(BrandContextService);
  private markerTypeService = inject(MarkerTypeService);

  async exportDashboard(companies: Company[], options: ExportOptions): Promise<void> {
    if (companies.length === 0) return;
    const { startYear, endYear, zoomLevel } = options;

    let allTypes: Awaited<ReturnType<MarkerTypeService['list']>> = [];
    try {
      allTypes = await this.markerTypeService.list(companies[0]?.space_id);
    } catch {
      allTypes = [];
    }

    const agency = this.brand.agency();
    const images: PngImages = {
      tenantLogo: await this.loadImage(this.brand.logoUrl()),
      agencyLogo: await this.loadImage(agency?.logo_url ?? null),
      companyLogos: await this.loadCompanyLogos(companies),
    };

    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoomLevel);
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W * SCALE;
    canvas.height = PNG_H * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context for the image.');
    ctx.scale(SCALE, SCALE);

    renderTimelinePng(ctx as PngSurface, {
      companies,
      options,
      appDisplayName: this.brand.appDisplayName(),
      primaryColor: this.brand.primaryColor() || '#0d9488',
      agencyName: agency?.name ?? null,
      dateStr: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      legendGroups: buildLegendGroups(allTypes),
      columns: this.timeline.getColumns(startYear, endYear, zoomLevel),
      totalPx,
      dateToX: (date) => this.timeline.dateToX(date, startYear, endYear, totalPx),
      images,
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('Could not generate the image.');
    saveBlob(blob, 'clinical-trial-dashboard.png');
  }

  /**
   * Load a logo URL as an image element for canvas drawImage. Brandfetch URLs
   * are enriched the same way the app renders them. Resolves null on any
   * failure (404, cross-origin block, timeout) so the image just omits the logo.
   */
  private loadImage(rawUrl: string | null | undefined): Promise<HTMLImageElement | null> {
    if (!rawUrl) return Promise.resolve(null);
    const url = resolveBrandLogoSrc(rawUrl, environment.brandfetchClientId) ?? rawUrl;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const finish = (v: HTMLImageElement | null): void => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const timer = setTimeout(() => finish(null), 8000);
      img.onload = (): void => {
        clearTimeout(timer);
        finish(img);
      };
      img.onerror = (): void => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = url;
    });
  }

  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, HTMLImageElement>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await this.loadImage(c.logo_url)] as const)
    );
    const map = new Map<string, HTMLImageElement>();
    for (const [id, img] of entries) {
      if (img) map.set(id, img);
    }
    return map;
  }
}
```

- [ ] **Step 3: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

```bash
git add src/client/src/app/core/services/png-export.service.ts src/client/src/app/core/services/download.util.ts
git commit -m "feat(export): PNG export service rendering offscreen canvas at 2x"
```

---

### Task 6: Excel export (ExcelJS util + service)

**Files:**
- Modify: `src/client/package.json` (add `exceljs`)
- Create: `src/app/core/services/xlsx-export.util.ts`
- Create: `src/app/core/services/xlsx-export.util.spec.ts`
- Create: `src/app/core/services/xlsx-export.service.ts`

- [ ] **Step 1: Install ExcelJS**

```bash
cd src/client && npm install exceljs
```

Expected: `exceljs` appears in `dependencies` (^4.x).

- [ ] **Step 2: Write the failing tests**

`xlsx-export.util.spec.ts` (reuse the `fixtureCompanies` shape from Task 2; redeclare it locally):

```ts
import { describe, expect, it } from 'vitest';

import type { Company } from '../models/company.model';
import { buildXlsxWorkbook } from './xlsx-export.util';

const fixtureCompanies = [
  {
    id: 'c1',
    name: 'Acme Pharma',
    space_id: 's1',
    assets: [
      {
        id: 'a1',
        name: 'ACM-101',
        mechanisms_of_action: [{ name: 'GLP-1 agonist' }],
        routes_of_administration: [{ name: 'Subcutaneous', abbreviation: 'SC' }],
        trials: [
          {
            id: 't1',
            name: 'Acme Trial One',
            acronym: 'ACME-1',
            identifier: 'NCT00000001',
            notes: 'Pivotal readout expected H2.',
            trial_notes: [],
            phase_type: 'P3',
            phase_start_date: '2020-01-01',
            phase_end_date: '2022-06-30',
            markers: [
              {
                id: 'm1',
                event_date: '2021-06-15',
                end_date: null,
                projection: 'actual',
                is_projected: false,
                no_longer_expected: true,
                title: 'Topline readout',
                description: null,
                marker_types: {
                  name: 'Data readout',
                  color: '#16a34a',
                  shape: 'circle',
                  fill_style: 'filled',
                  inner_mark: 'none',
                },
              },
            ],
          },
        ],
      },
    ],
  },
] as unknown as Company[];

const meta = {
  appDisplayName: 'Test App',
  primaryColorHex: '0d9488',
  dateStr: 'June 10, 2026',
};

describe('buildXlsxWorkbook', () => {
  it('creates Trials and Markers sheets', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    expect(wb.worksheets.map((w) => w.name)).toEqual(['Trials', 'Markers']);
  });

  it('writes trial rows with real Date cells for phase dates', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    const sheet = wb.getWorksheet('Trials')!;
    expect(sheet.getCell('A1').value).toBe('Company');
    expect(sheet.getCell('A2').value).toBe('Acme Pharma');
    expect(sheet.getCell('E2').value).toBe('ACME-1');
    expect(sheet.getCell('G2').value).toBe('PH 3');
    const start = sheet.getCell('H2').value;
    expect(start).toBeInstanceOf(Date);
    expect((start as Date).getUTCFullYear()).toBe(2020);
    expect(sheet.getCell('J2').value).toBe('Pivotal readout expected H2.');
  });

  it('writes marker rows with Date cells and a readable NLE status', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    const sheet = wb.getWorksheet('Markers')!;
    expect(sheet.getCell('D2').value).toBe('Data readout');
    expect(sheet.getCell('E2').value).toBeInstanceOf(Date);
    expect(sheet.getCell('F2').value).toBeNull();
    expect(sheet.getCell('G2').value).toBe('No longer expected');
    expect(sheet.getCell('H2').value).toBe('Topline readout');
  });

  it('freezes the header row and sets the autofilter on both sheets', () => {
    const wb = buildXlsxWorkbook(fixtureCompanies, meta);
    for (const name of ['Trials', 'Markers'] as const) {
      const sheet = wb.getWorksheet(name)!;
      expect(sheet.views[0]).toMatchObject({ state: 'frozen', ySplit: 1 });
      expect(sheet.autoFilter).toBeTruthy();
    }
  });
});
```

- [ ] **Step 3: Run tests to verify they fail**

Run: `npm run test:units -- xlsx-export`
Expected: FAIL (module not found).

- [ ] **Step 4: Implement `xlsx-export.util.ts`**

```ts
import ExcelJS from 'exceljs';

import type { Company } from '../models/company.model';
import { buildMarkerTableRows, buildTrialExportRows } from './export-common.util';

export interface XlsxMeta {
  appDisplayName: string;
  /** Brand primary color, hex without '#', for the header row fill. */
  primaryColorHex: string;
  dateStr: string;
}

const STATUS_LABELS: Record<string, string> = {
  Actual: 'Actual',
  Projected: 'Projected',
  NLE: 'No longer expected',
};

/** Parse yyyy-mm-dd into a UTC Date so the cell shows the same calendar day in any timezone. */
function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, primaryColorHex: string): void {
  const header = sheet.getRow(1);
  header.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  header.fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${primaryColorHex.toUpperCase()}` },
  };
}

/**
 * Build the data-sheets-only workbook (Trials + Markers). Pure so it can be
 * unit-tested in node; the service handles DI, dynamic import, and download.
 */
export function buildXlsxWorkbook(companies: Company[], meta: XlsxMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.appDisplayName;

  const trials = wb.addWorksheet('Trials', { views: [{ state: 'frozen', ySplit: 1 }] });
  trials.columns = [
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Asset', key: 'asset', width: 20 },
    { header: 'MOA', key: 'moa', width: 26 },
    { header: 'ROA', key: 'roa', width: 12 },
    { header: 'Trial', key: 'trial', width: 22 },
    { header: 'NCT ID', key: 'nctId', width: 14 },
    { header: 'Phase', key: 'phase', width: 10 },
    { header: 'Phase Start', key: 'phaseStart', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Phase End', key: 'phaseEnd', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Notes', key: 'notes', width: 60 },
  ];
  for (const r of buildTrialExportRows(companies)) {
    trials.addRow({
      ...r,
      phaseStart: r.phaseStart ? isoToDate(r.phaseStart) : null,
      phaseEnd: r.phaseEnd ? isoToDate(r.phaseEnd) : null,
    });
  }
  styleHeaderRow(trials, meta.primaryColorHex);
  trials.autoFilter = 'A1:J1';

  const markers = wb.addWorksheet('Markers', { views: [{ state: 'frozen', ySplit: 1 }] });
  markers.columns = [
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Asset', key: 'asset', width: 20 },
    { header: 'Trial', key: 'trial', width: 22 },
    { header: 'Marker', key: 'marker', width: 20 },
    { header: 'Date', key: 'date', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'End Date', key: 'endDate', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Detail', key: 'detail', width: 60 },
  ];
  for (const r of buildMarkerTableRows(companies)) {
    markers.addRow({
      company: r.company,
      asset: r.asset,
      trial: r.trial,
      marker: r.marker,
      date: isoToDate(r.eventDate),
      endDate: r.endDate ? isoToDate(r.endDate) : null,
      status: STATUS_LABELS[r.status] ?? r.status,
      detail: r.detail,
    });
  }
  styleHeaderRow(markers, meta.primaryColorHex);
  markers.autoFilter = 'A1:H1';

  return wb;
}
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `npm run test:units -- xlsx-export`
Expected: PASS.

- [ ] **Step 6: Implement `xlsx-export.service.ts`** (dynamic import keeps ExcelJS out of the eager bundle)

```ts
import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { BrandContextService } from './brand-context.service';
import { saveBlob } from './download.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable({ providedIn: 'root' })
export class XlsxExportService {
  private brand = inject(BrandContextService);

  async exportDashboard(companies: Company[]): Promise<void> {
    if (companies.length === 0) return;
    // Lazy: pulls ExcelJS into its own chunk, loaded only on first Excel export.
    const { buildXlsxWorkbook } = await import('./xlsx-export.util');
    const wb = buildXlsxWorkbook(companies, {
      appDisplayName: this.brand.appDisplayName(),
      primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
      dateStr: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer], { type: XLSX_MIME }), 'clinical-trial-dashboard.xlsx');
  }
}
```

- [ ] **Step 7: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`
Expected: clean; build output mentions a lazy chunk containing exceljs.

```bash
git add src/client/package.json src/client/package-lock.json src/client/src/app/core/services/xlsx-export.util.ts src/client/src/app/core/services/xlsx-export.util.spec.ts src/client/src/app/core/services/xlsx-export.service.ts
git commit -m "feat(export): Excel data-sheet export with ExcelJS"
```

---

### Task 7: Topbar menu actions

**Files:**
- Modify: `src/app/core/services/topbar-state.service.ts`
- Modify: `src/app/core/layout/contextual-topbar.component.ts`

- [ ] **Step 1: Extend `TopbarAction`**

In `topbar-state.service.ts`, change the interface:

```ts
export interface TopbarAction {
  label: string;
  icon: string;
  severity?: TopbarActionSeverity;
  outlined?: boolean;
  text?: boolean;
  /** Plain button click handler. Ignored when `items` is set. */
  callback?: () => void;
  /** When set, the action renders as a popup menu instead of a plain button. */
  items?: MenuItem[];
}
```

- [ ] **Step 2: Render menus in `contextual-topbar.component.ts`**

Add the import:

```ts
import { Menu } from 'primeng/menu';
```

Add `Menu` to the component `imports` array. Replace the actions loop in the template:

```html
@for (action of actionButtons(); track action.label) {
  @if (action.items) {
    <p-button
      [label]="action.label"
      [icon]="action.icon"
      [severity]="action.severity ?? null"
      [outlined]="action.outlined ?? false"
      [text]="action.text ?? false"
      size="small"
      aria-haspopup="menu"
      (click)="actionMenu.toggle($event)"
    />
    <p-menu #actionMenu [model]="action.items" [popup]="true" appendTo="body" />
  } @else {
    <p-button
      [label]="action.label"
      [icon]="action.icon"
      [severity]="action.severity ?? null"
      [outlined]="action.outlined ?? false"
      [text]="action.text ?? false"
      size="small"
      (click)="action.callback?.()"
    />
  }
}
```

- [ ] **Step 3: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`
Expected: clean.

```bash
git add src/client/src/app/core/services/topbar-state.service.ts src/client/src/app/core/layout/contextual-topbar.component.ts
git commit -m "feat(topbar): support popup menu actions"
```

---

### Task 8: Landscape shell export menu

**Files:**
- Modify: `src/app/features/landscape/landscape-shell.component.ts:84-98, 181-183`

- [ ] **Step 1: Replace the single export action with the menu**

Add the import:

```ts
import type { ExportFormat } from '../../core/services/export-common.util';
```

Replace the `exportEffect` body:

```ts
  private readonly exportEffect = effect(() => {
    if (this.viewMode() === 'timeline') {
      this.topbarState.actions.set([
        {
          label: 'Export',
          icon: 'fa-solid fa-file-export',
          text: true,
          severity: 'secondary',
          items: [
            {
              label: 'PowerPoint',
              icon: 'fa-solid fa-file-powerpoint',
              command: () => this.onExportClick('pptx'),
            },
            {
              label: 'Image (PNG)',
              icon: 'fa-solid fa-image',
              command: () => this.onExportClick('png'),
            },
            {
              label: 'Excel (XLSX)',
              icon: 'fa-solid fa-file-excel',
              command: () => this.onExportClick('xlsx'),
            },
          ],
        },
      ]);
    } else {
      this.topbarState.actions.set([]);
    }
  });
```

Replace `onExportClick`:

```ts
  onExportClick(format: ExportFormat): void {
    document.dispatchEvent(new CustomEvent('landscape:export', { detail: { format } }));
  }
```

- [ ] **Step 2: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`

```bash
git add src/client/src/app/features/landscape/landscape-shell.component.ts
git commit -m "feat(landscape): export button becomes a three-format menu"
```

---

### Task 9: Export dialog format support

**Files:**
- Modify: `src/app/features/dashboard/export-dialog/export-dialog.component.ts`

- [ ] **Step 1: Add the `format` input and adapt the template**

Add imports:

```ts
import { computed } from '@angular/core'; // extend the existing @angular/core import
import { PngExportService } from '../../../core/services/png-export.service';
```

Add to the class:

```ts
  private pngService = inject(PngExportService);

  /** Which renderer this dialog drives. Excel bypasses the dialog entirely. */
  readonly format = input<'pptx' | 'png'>('pptx');

  protected readonly headerLabel = computed(() =>
    this.format() === 'png' ? 'Export image' : 'Export to PowerPoint'
  );
  protected readonly generatingLabel = computed(() =>
    this.format() === 'png' ? 'Generating image' : 'Generating PowerPoint'
  );
  protected readonly exportIcon = computed(() =>
    this.format() === 'png' ? 'fa-solid fa-image' : 'fa-solid fa-file-powerpoint'
  );
```

Template changes:
- `header="Export to PowerPoint"` becomes `[header]="headerLabel()"`
- the spinner `aria-label="Exporting to PowerPoint"` becomes `[attr.aria-label]="generatingLabel()"`
- the spinner caption text `Generating PowerPoint` becomes `{{ generatingLabel() }}`
- the submit button `icon="fa-solid fa-file-powerpoint"` becomes `[icon]="exportIcon()"`

Update `doExport` to branch:

```ts
  async doExport(): Promise<void> {
    this.exporting.set(true);
    this.error.set(null);

    const options = {
      zoomLevel: this.selectedZoom(),
      startYear: this.startYear(),
      endYear: this.endYear(),
      showMoaColumn: this.showMoaColumn(),
      showRoaColumn: this.showRoaColumn(),
      showNotesColumn: this.showNotesColumn(),
    };

    try {
      if (this.format() === 'png') {
        await this.pngService.exportDashboard(this.companies(), options);
      } else {
        await this.pptxService.exportDashboard(this.companies(), options);
      }
      this.visible.set(false);
      this.closed.emit();
    } catch (e) {
      this.error.set(
        e instanceof Error
          ? e.message
          : 'Could not generate the export. Check your connection and try again.'
      );
    } finally {
      this.exporting.set(false);
    }
  }
```

- [ ] **Step 2: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`

```bash
git add src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts
git commit -m "feat(export): dialog drives PowerPoint or image export by format"
```

---

### Task 10: Timeline view routes the format

**Files:**
- Modify: `src/app/features/landscape/timeline-view.component.ts`
- Modify: `src/app/features/landscape/timeline-view.component.html` (the `<app-export-dialog>` block, lines 84-93)

- [ ] **Step 1: Handle the event detail and the Excel path**

Add imports to `timeline-view.component.ts`:

```ts
import { MessageService } from 'primeng/api';
import type { ExportFormat } from '../../core/services/export-common.util';
import { XlsxExportService } from '../../core/services/xlsx-export.service';
```

Add to the class:

```ts
  private readonly xlsxService = inject(XlsxExportService);
  private readonly messageService = inject(MessageService);

  readonly exportFormat = signal<'pptx' | 'png'>('pptx');
```

Replace the `exportHandler` in the constructor:

```ts
    const exportHandler = (e: Event): void => {
      if (this.companies().length === 0) return;
      const format = ((e as CustomEvent).detail?.format ?? 'pptx') as ExportFormat;
      if (format === 'xlsx') {
        void this.exportExcel();
        return;
      }
      this.exportFormat.set(format);
      this.exportDialogOpen.set(true);
    };
```

Add the method:

```ts
  private async exportExcel(): Promise<void> {
    try {
      await this.xlsxService.exportDashboard(this.companies());
    } catch {
      this.messageService.add({
        severity: 'error',
        summary: 'Export failed',
        detail: 'Could not generate the Excel file. Try again.',
      });
    }
  }
```

- [ ] **Step 2: Pass the format to the dialog**

In `timeline-view.component.html`, add to the `<app-export-dialog>` bindings:

```html
    [format]="exportFormat()"
```

- [ ] **Step 3: Lint, build, commit**

Run: `cd src/client && ng lint && ng build`

```bash
git add src/client/src/app/features/landscape/timeline-view.component.ts src/client/src/app/features/landscape/timeline-view.component.html
git commit -m "feat(landscape): route export formats; Excel exports without a dialog"
```

---

### Task 11: Playwright e2e smoke for PNG and XLSX

**Files:**
- Create: `e2e/tests/export.spec.ts`

- [ ] **Step 1: Write the e2e spec**

```ts
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant,
  createTestSpace,
  createTestCompany,
  createTestProduct,
  createTestTherapeuticArea,
  createTestTrial,
  createTestTrialPhase,
} from '../helpers/test-data.helper';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

interface CapturedBlob {
  type: string;
  size: number;
}

test.describe('Timeline export formats', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(120000);

    tenantId = await createTestTenant('Export Test Org');
    spaceId = await createTestSpace(tenantId, 'Export Test Space');
    const companyId = await createTestCompany(spaceId, 'Export Co');
    const assetId = await createTestProduct(spaceId, companyId, 'Export Asset');
    const taId = await createTestTherapeuticArea(spaceId, 'Export TA');
    const trialId = await createTestTrial(spaceId, assetId, taId, 'EXPORT-1');
    await createTestTrialPhase(spaceId, trialId, 'P3', '2022-01-01');

    page = await authenticatedPage(browser);
    await page.addInitScript(() => {
      const w = window as unknown as { __exportBlobs: CapturedBlob[] };
      w.__exportBlobs = [];
      const orig = URL.createObjectURL.bind(URL);
      URL.createObjectURL = (obj: Blob | MediaSource): string => {
        if (obj instanceof Blob) {
          w.__exportBlobs.push({ type: obj.type, size: obj.size });
        }
        return orig(obj);
      };
    });
    await page.goto(`/t/${tenantId}/s/${spaceId}/timeline`, { waitUntil: 'domcontentloaded' });
    await page.waitForSelector('app-dashboard-grid', { timeout: 30000 });
  });

  test.afterAll(async () => {
    await page.close();
  });

  async function lastBlob(): Promise<CapturedBlob | null> {
    return page.evaluate(
      () => (window as unknown as { __exportBlobs: CapturedBlob[] }).__exportBlobs.at(-1) ?? null
    );
  }

  test('export menu lists all three formats', async () => {
    await page.getByRole('button', { name: 'Export' }).click();
    await expect(page.getByRole('menuitem', { name: 'PowerPoint' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Image (PNG)' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Excel (XLSX)' })).toBeVisible();
    await page.keyboard.press('Escape');
  });

  test('PNG export produces an image blob via the dialog', async () => {
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Image (PNG)' }).click();
    const dialog = page.locator('p-dialog');
    await expect(dialog.getByText('Export image')).toBeVisible();
    await dialog.getByRole('button', { name: 'Export', exact: true }).click();
    await expect
      .poll(async () => (await lastBlob())?.type, { timeout: 30000 })
      .toBe('image/png');
    expect((await lastBlob())!.size).toBeGreaterThan(10000);
  });

  test('Excel export downloads immediately without a dialog', async () => {
    await page.getByRole('button', { name: 'Export' }).click();
    await page.getByRole('menuitem', { name: 'Excel (XLSX)' }).click();
    await expect.poll(async () => (await lastBlob())?.type, { timeout: 30000 }).toBe(XLSX_MIME);
    expect((await lastBlob())!.size).toBeGreaterThan(1000);
    await expect(page.locator('p-dialog')).toHaveCount(0);
  });
});
```

- [ ] **Step 2: Run the new spec only** (full local e2e is flaky on cold starts; CI is canonical)

Run: `cd src/client && ./e2e/run.sh tests/export.spec.ts`
Expected: 3 passed. If a `toBeVisible` flakes on cold start, re-run once before investigating.

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/export.spec.ts
git commit -m "test(e2e): timeline export menu, PNG and Excel blob smoke"
```

---

### Task 12: Docs, verification, finish

**Files:**
- Modify: runbook auto-gen blocks (regenerated; `package.json` changed)
- Modify: `docs/superpowers/specs/2026-06-10-timeline-image-excel-export-design.md` (status line)

- [ ] **Step 1: Regenerate runbook auto-gen blocks** (requires local Supabase)

```bash
supabase start   # if not already running, from repo root
cd src/client && npm run docs:arch
```

Commit whatever the regen changes (versions table picks up exceljs).

- [ ] **Step 2: Check the features map**

```bash
cd src/client && npm run features:check
```

If an export capability exists in the features map (search for `export-to-powerpoint` or similar under the features registry), add the new formats to its description in the same style; rerun the check.

- [ ] **Step 3: Update spec status**

In the spec file, change `- **Status:** Design approved, pending spec review` to `- **Status:** Implemented`.

- [ ] **Step 4: Full verification**

```bash
cd src/client && npm run test:units && ng lint && ng build
```

Expected: all pass.

- [ ] **Step 5: Manual smoke** (optional but recommended): run the app locally, open a space timeline, export each of the three formats, open the PNG and XLSX to eyeball fidelity.

- [ ] **Step 6: Commit docs and finish**

```bash
git add -A docs/ src/client
git commit -m "docs: runbook regen and spec status for timeline export formats"
```

Then merge `develop` into the branch, resolve conflicts, push, and open a PR against `develop` (repo conventions: fetch + merge target before `gh pr create`; no Claude attribution in the PR body).

---

## Self-Review Notes

- Spec coverage: entry-point menu (Tasks 7-8), PNG canvas renderer mirroring the data slide (Tasks 3-5), Excel data sheets with Date cells + frozen header + autofilter + brand header fill (Task 6), shared helper move (Tasks 1-2), dialog reuse with zoom for both visual formats (Task 9-10), error handling (dialog inline error for pptx/png, toast for xlsx in Task 10), tests paired per task, e2e blob smoke (Task 11), no html2canvas, no legend toggle, PPTX content untouched apart from the helper move.
- The zoom selector affects the PNG exactly as it affects the PPTX today (column labels/density via `TimelineService.getColumns`); both fit the fixed frame width by proportional mapping.
- Type consistency checked: `ExportOptions`, `ExportFormat`, `FlatRow`, `TrialExportRow`, `MarkerRow.eventDate/endDate`, `CanvasGlyphSurface`, `PngSurface`, `PngRenderContext` are each defined once and imported consistently across tasks.
