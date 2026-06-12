# Export Across Visualization and Grid Pages — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add export to the Bullseye and Heatmap visualizations (PNG + Excel) and to the five user-facing data grids (Catalysts, Events, Trials, Companies, Assets — Excel of the current view), reusing the timeline's export mechanics.

**Architecture:** Factor the timeline's bespoke export into a small shared toolkit under `src/app/shared/export/` (branded footer, content-agnostic PNG capture, generic Excel-workbook builder, a shared export button). Grid Excel collapses to one generic util driven by the existing `GridState<T>` column defs plus a one-line button drop-in per page. Each visualization gets a thin off-screen "export host" (chart + title + branded footer) for PNG and a pure data mapper for Excel.

**Tech Stack:** Angular 21 (standalone, signals, OnPush), PrimeNG 21, `modern-screenshot` (PNG), `exceljs` (XLSX), Vitest (unit tests).

**Spec:** `docs/superpowers/specs/2026-06-11-export-across-pages-design.md`

---

## File Structure

**Shared toolkit (new) — `src/client/src/app/shared/export/`**
- `export-footer.component.ts` — branded footer extracted from the timeline snapshot host.
- `export-button.component.ts` — shared trigger (direct button for 1 format, menu for 2+).
- `branded-png-export.service.ts` — content-agnostic off-screen capture (generalizes `png-export.service.ts`).
- `xlsx-sheet.util.ts` — generic `buildSheetWorkbook(sheets, meta)` + shared `isoToDate`.
- `grid-sheet.util.ts` — `buildGridSheet(columns, rows)` mapping `ColumnDef<T>` to a `SheetSpec`.
- `grid-excel-export.service.ts` — wires a grid's columns + current rows to a download.

**Modified shared**
- `features/dashboard/export/export-snapshot-host.component.ts` — consume `<app-export-footer>`.
- `features/dashboard/export/png-export.service.ts` — route capture through the shared service.
- `shared/grids/filter-types.ts` + `create-grid-state.ts` — expose `columns` on `GridState<T>`.

**Per-page (new + small edits)**
- `features/landscape/bullseye-export.util.ts`, `bullseye-export-host.component.ts`, edit `landscape.component.{ts,html}`.
- `features/landscape/heatmap-export.util.ts`, `heatmap-export-host.component.ts`, edit `heatmap-view.component.ts`.
- Edits to `catalysts-page`, `events-page`, `trial-list`, `company-list`, `asset-list` (button + export columns).

**Test command (all Vitest tasks):** from `src/client/`, `npm run test:units -- <path>`.
**Verify command (build tasks):** from `src/client/`, `ng lint && ng build`.

---

## Phase A — Shared toolkit

### Task 1: Extract `<app-export-footer>`

**Files:**
- Create: `src/client/src/app/shared/export/export-footer.component.ts`
- Modify: `src/client/src/app/features/dashboard/export/export-snapshot-host.component.ts`

- [ ] **Step 1: Create the footer component**

Move the `<footer>` markup (currently `export-snapshot-host.component.ts:39-95`) verbatim into a standalone component, parameterizing the hard-coded `"Timeline"` label as `artifactLabel`.

```ts
// src/client/src/app/shared/export/export-footer.component.ts
import { ChangeDetectionStrategy, Component, computed, inject, input } from '@angular/core';

import { BrandContextService } from '../../core/services/brand-context.service';
import {
  CLINT_MARK_POINTS,
  CLINT_MARK_VIEWBOX,
  clintMarkStrokes,
} from '../components/clint-mark';

/**
 * Branded export footer shared by every export host (timeline, bullseye,
 * heatmap). Product mark + DELIVERED BY (agency) + PREPARED FOR (tenant) +
 * date. Logos arrive as pre-rasterized PNG data URIs (CORS-safe for capture);
 * plain <img> because NgOptimizedImage rejects base64 sources.
 */
@Component({
  selector: 'app-export-footer',
  host: { class: 'block' },
  template: `
    <footer class="flex items-center gap-2 border-t border-slate-200 bg-white px-4 py-2">
      <svg width="16" height="16" [attr.viewBox]="markViewBox" fill="none" aria-hidden="true">
        <polyline [attr.points]="mark.outer" stroke="#cbd5e1" [attr.stroke-width]="markStrokes.outer" stroke-linecap="round" stroke-linejoin="round" />
        <polyline [attr.points]="mark.middle" stroke="#94a3b8" [attr.stroke-width]="markStrokes.middle" stroke-linecap="round" stroke-linejoin="round" />
        <polyline [attr.points]="mark.inner" stroke="var(--brand-600)" [attr.stroke-width]="markStrokes.inner" stroke-linecap="round" stroke-linejoin="round" />
      </svg>
      <span class="text-xs font-bold text-slate-600">{{ artifactLabel() }}</span>
      @if (agencyName(); as agency) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">Delivered by</span>
        @if (agencyLogoUrl(); as alogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="alogo" alt="" class="h-4 w-auto max-w-[80px] object-contain" />
        } @else {
          <span class="text-[11px] font-semibold text-slate-600">{{ agency }}</span>
        }
      }
      @if (tenantName(); as tname) {
        <span class="h-3.5 w-px bg-slate-200" aria-hidden="true"></span>
        <span class="text-[8px] font-semibold uppercase tracking-[0.18em] text-slate-400">Prepared for</span>
        @if (tenantLogoUrl(); as tlogo) {
          <!-- eslint-disable-next-line @angular-eslint/template/prefer-ngsrc -->
          <img [src]="tlogo" alt="" class="h-4 w-4 rounded object-contain" />
        }
        <span class="max-w-[160px] truncate text-[11px] font-semibold text-slate-600">{{ tname }}</span>
      }
      <span class="ml-auto text-[11px] text-slate-400">{{ exportDate }}</span>
    </footer>
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportFooterComponent {
  private readonly brand = inject(BrandContextService);

  readonly artifactLabel = input.required<string>();
  readonly tenantName = input('');
  /** Pre-rasterized PNG data URIs (or null), supplied by the caller. */
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);

  protected readonly agencyName = computed(() => this.brand.agency()?.name ?? null);

  protected readonly mark = CLINT_MARK_POINTS;
  protected readonly markViewBox = CLINT_MARK_VIEWBOX;
  protected readonly markStrokes = clintMarkStrokes(16);

  protected readonly exportDate = new Date().toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}
```

- [ ] **Step 2: Point the timeline snapshot host at the shared footer**

In `export-snapshot-host.component.ts`: add `ExportFooterComponent` to `imports`, replace the inline `<footer>...</footer>` block in the template with:

```html
<app-export-footer
  artifactLabel="Timeline"
  [tenantName]="tenantName()"
  [tenantLogoUrl]="tenantLogoUrl()"
  [agencyLogoUrl]="agencyLogoUrl()"
/>
```

Then delete the now-unused `mark`/`markViewBox`/`markStrokes`/`exportDate`/`agencyName` members and the `clint-mark` + `BrandContextService` imports from the host (the footer owns them now). Keep all grid/legend inputs untouched.

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng lint && ng build`
Expected: PASS, no new warnings. (No unit test: this is a pure markup move covered by the manual export verification in Task 17.)

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/export/export-footer.component.ts src/client/src/app/features/dashboard/export/export-snapshot-host.component.ts
git commit -m "refactor(export): extract shared branded export footer"
```

---

### Task 2: `BrandedPngExportService` (content-agnostic capture)

**Files:**
- Create: `src/client/src/app/shared/export/branded-png-export.service.ts`
- Modify: `src/client/src/app/features/dashboard/export/png-export.service.ts`

- [ ] **Step 1: Create the generalized capture service**

Lift the mechanics from `png-export.service.ts` (logo rasterization, off-viewport mount, `waitForReady`, scale clamp, Safari cleanup, download) into a content-agnostic service. The caller supplies the host component type, an input setter, its injector, raw logo URLs, and a filename.

```ts
// src/client/src/app/shared/export/branded-png-export.service.ts
import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injectable,
  Injector,
  Type,
} from '@angular/core';
import { domToCanvas } from 'modern-screenshot';

import { saveBlob } from '../../core/services/download.util';
import { logoToPngDataUrl } from '../../core/services/load-image.util';
import { clampExportScale } from '../../core/services/export-scale.util';
import {
  EXPORT_WAITING_SELECTOR,
  includeInCapture,
} from '../../features/dashboard/export/export-capture.util';

const TARGET_SCALE = 2;
const READY_TIMEOUT_MS = 5000;

export interface BrandedPngOptions<C> {
  /** Off-screen host component that renders chart + title + <app-export-footer>. */
  component: Type<C>;
  /**
   * Sets host inputs. Receives the resolved logo data URIs so the host can pass
   * them straight to <app-export-footer> without re-fetching.
   */
  setInputs: (ref: ComponentRef<C>, logos: { agencyLogoUrl: string | null; tenantLogoUrl: string | null }) => void;
  /** Caller's Injector so the host resolves providedIn:'any'/route-scoped state. */
  elementInjector: Injector;
  /** Raw (un-rasterized) logo URLs; resolved to CORS-safe data URIs before mount. */
  agencyLogoUrl: string | null;
  tenantLogoUrl: string | null;
  filename: string;
}

/**
 * PNG export as an off-screen DOM capture, generalized from the timeline's
 * PngExportService. The host component decides what is captured; this service
 * owns logo rasterization, mounting, readiness waiting, rasterization at 2x,
 * and download. See docs/superpowers/specs/2026-06-11-export-across-pages-design.md.
 */
@Injectable({ providedIn: 'root' })
export class BrandedPngExportService {
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);

  async capture<C>(opts: BrandedPngOptions<C>): Promise<void> {
    const [agencyLogoUrl, tenantLogoUrl] = await Promise.all([
      logoToPngDataUrl(opts.agencyLogoUrl),
      logoToPngDataUrl(opts.tenantLogoUrl),
    ]);

    const ref = createComponent(opts.component, {
      environmentInjector: this.envInjector,
      elementInjector: opts.elementInjector,
    });
    opts.setInputs(ref, { agencyLogoUrl, tenantLogoUrl });

    const el = ref.location.nativeElement as HTMLElement;
    el.style.position = 'fixed';
    el.style.left = '-100000px';
    el.style.top = '0';
    document.body.appendChild(el);
    this.appRef.attachView(ref.hostView);

    let canvas: HTMLCanvasElement | null = null;
    try {
      await waitForReady(el);
      const scale = clampExportScale(el.offsetWidth, el.offsetHeight, TARGET_SCALE);
      canvas = await domToCanvas(el, { scale, filter: includeInCapture });
      const blob = await new Promise<Blob | null>((resolve) => canvas!.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not generate the image.');
      saveBlob(blob, opts.filename);
    } finally {
      if (canvas) {
        canvas.width = 0;
        canvas.height = 0;
      }
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      el.remove();
    }
  }
}

/** See png-export.service.ts: waits on fonts, [data-export-waiting], image decode, double rAF. */
async function waitForReady(el: HTMLElement): Promise<void> {
  await document.fonts?.ready;
  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (el.querySelector(EXPORT_WAITING_SELECTOR) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }
  const imgs = Array.from(el.querySelectorAll('img'));
  for (const img of imgs) img.loading = 'eager';
  await Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))
  );
  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
```

- [ ] **Step 2: Route the timeline PngExportService through the shared service**

Replace the body of `PngExportService.exportDashboard` so it delegates capture, keeping its `PngExportSnapshot` input contract unchanged. Inject the shared service and pass the host inputs via `setInputs`:

```ts
// png-export.service.ts — replace the manual createComponent/mount/capture block.
// Keep the PngExportSnapshot interface and the method signature.
import { BrandedPngExportService } from '../../../shared/export/branded-png-export.service';
// ...
@Injectable({ providedIn: 'root' })
export class PngExportService {
  private readonly brand = inject(BrandContextService);
  private readonly png = inject(BrandedPngExportService);

  async exportDashboard(snapshot: PngExportSnapshot, elementInjector: Injector): Promise<void> {
    if (snapshot.companies.length === 0) return;
    await this.png.capture({
      component: ExportSnapshotHostComponent,
      elementInjector,
      agencyLogoUrl: this.brand.agency()?.logo_url ?? null,
      tenantLogoUrl: snapshot.tenantLogoUrl,
      filename: 'clinical-trial-dashboard.png',
      setInputs: (ref, logos) => {
        ref.setInput('companies', snapshot.companies);
        ref.setInput('zoomLevel', snapshot.zoomLevel);
        ref.setInput('startYear', snapshot.startYear);
        ref.setInput('endYear', snapshot.endYear);
        ref.setInput('hideCompanyColumn', snapshot.hideCompanyColumn);
        ref.setInput('hideAssetColumn', snapshot.hideAssetColumn);
        ref.setInput('hideTrialColumn', snapshot.hideTrialColumn);
        ref.setInput('hideMoaColumn', snapshot.hideMoaColumn);
        ref.setInput('hideRoaColumn', snapshot.hideRoaColumn);
        ref.setInput('hideNotesColumn', snapshot.hideNotesColumn);
        ref.setInput('spaceId', snapshot.spaceId);
        ref.setInput('tenantName', snapshot.tenantName);
        ref.setInput('tenantLogoUrl', logos.tenantLogoUrl);
        ref.setInput('agencyLogoUrl', logos.agencyLogoUrl);
      },
    });
  }
}
```

Remove the now-unused imports from `png-export.service.ts` (`ApplicationRef`, `createComponent`, `EnvironmentInjector`, `domToCanvas`, `saveBlob`, `logoToPngDataUrl`, `clampExportScale`, capture-util, the local `waitForReady`, `TARGET_SCALE`, `LEGEND_TIMEOUT_MS`).

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng lint && ng build`
Expected: PASS. Timeline PNG behavior is unchanged (verified manually in Task 17).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/export/branded-png-export.service.ts src/client/src/app/features/dashboard/export/png-export.service.ts
git commit -m "refactor(export): content-agnostic branded PNG capture service"
```

---

### Task 3: Generic Excel-workbook builder

**Files:**
- Create: `src/client/src/app/shared/export/xlsx-sheet.util.ts`
- Test: `src/client/src/app/shared/export/xlsx-sheet.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// xlsx-sheet.util.spec.ts
import { describe, expect, it } from 'vitest';
import { buildSheetWorkbook } from './xlsx-sheet.util';

describe('buildSheetWorkbook', () => {
  it('creates one worksheet per spec with headers and rows', async () => {
    const wb = buildSheetWorkbook(
      [
        {
          name: 'Catalysts',
          columns: [
            { header: 'Company', key: 'company', width: 20 },
            { header: 'Catalyst', key: 'title' },
          ],
          rows: [{ company: 'Pfizer', title: 'PDUFA' }],
        },
      ],
      { appDisplayName: 'Clint', primaryColorHex: '0d9488' }
    );

    const sheet = wb.getWorksheet('Catalysts')!;
    expect(sheet.getRow(1).getCell(1).value).toBe('Company');
    expect(sheet.getRow(2).getCell(1).value).toBe('Pfizer');
    expect(sheet.getRow(2).getCell(2).value).toBe('PDUFA');
    // Header is styled with the brand fill.
    expect((sheet.getRow(1).getCell(1).fill as { fgColor: { argb: string } }).fgColor.argb).toBe('FF0D9488');
    // Frozen header row.
    expect(sheet.views[0].ySplit).toBe(1);
  });

  it('writes Date cells with a yyyy-mm-dd number format', async () => {
    const wb = buildSheetWorkbook(
      [
        {
          name: 'Dates',
          columns: [{ header: 'When', key: 'when', numFmt: 'yyyy-mm-dd' }],
          rows: [{ when: new Date(Date.UTC(2026, 5, 11)) }],
        },
      ],
      { appDisplayName: 'Clint', primaryColorHex: '0d9488' }
    );
    const cell = wb.getWorksheet('Dates')!.getRow(2).getCell(1);
    expect(cell.value).toBeInstanceOf(Date);
    expect(cell.numFmt).toBe('yyyy-mm-dd');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- src/app/shared/export/xlsx-sheet.util.spec.ts`
Expected: FAIL — `buildSheetWorkbook` is not defined.

- [ ] **Step 3: Implement the builder**

```ts
// xlsx-sheet.util.ts
import ExcelJS from 'exceljs';

export interface XlsxMeta {
  appDisplayName: string;
  /** Brand primary color, hex without '#', for the header row fill. */
  primaryColorHex: string;
}

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** ExcelJS number format, e.g. 'yyyy-mm-dd' for Date cells. */
  numFmt?: string;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
}

/** Parse yyyy-mm-dd into a UTC Date so the cell shows the same calendar day in any timezone. */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, primaryColorHex: string): void {
  const header = sheet.getRow(1);
  const fill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${primaryColorHex.toUpperCase()}` },
  };
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill;
  });
}

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Build a multi-sheet workbook from declarative specs. Pure (no DI) so it
 * unit-tests in node; services handle dynamic import + download. Mirrors the
 * conventions in core/services/xlsx-export.util.ts (frozen header, brand fill,
 * autofilter) but is content-agnostic.
 */
export function buildSheetWorkbook(sheets: SheetSpec[], meta: XlsxMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.appDisplayName;

  for (const spec of sheets) {
    const sheet = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
      style: c.numFmt ? { numFmt: c.numFmt } : undefined,
    }));
    for (const row of spec.rows) sheet.addRow(row);
    styleHeaderRow(sheet, meta.primaryColorHex);
    if (spec.columns.length > 0) {
      const lastCol = COL_LETTERS[spec.columns.length - 1] ?? 'Z';
      sheet.autoFilter = `A1:${lastCol}${sheet.rowCount}`;
    }
  }

  return wb;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- src/app/shared/export/xlsx-sheet.util.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/export/xlsx-sheet.util.ts src/client/src/app/shared/export/xlsx-sheet.util.spec.ts
git commit -m "feat(export): generic multi-sheet xlsx workbook builder"
```

---

### Task 4: `<app-export-button>` shared trigger

**Files:**
- Create: `src/client/src/app/shared/export/export-button.component.ts`
- Test: `src/client/src/app/shared/export/export-button.component.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// export-button.component.spec.ts
import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { ExportButtonComponent, type ExportAction } from './export-button.component';

function setup(actions: ExportAction[]) {
  const fixture = TestBed.createComponent(ExportButtonComponent);
  fixture.componentRef.setInput('actions', actions);
  fixture.detectChanges();
  return fixture;
}

describe('ExportButtonComponent', () => {
  it('runs the single action and toggles loading', async () => {
    let resolve!: () => void;
    const action: ExportAction = {
      label: 'Excel',
      format: 'xlsx',
      run: () => new Promise<void>((r) => (resolve = r)),
    };
    const fixture = setup([action]);
    const cmp = fixture.componentInstance;

    const p = cmp.runAction(action);
    expect(cmp.loading()).toBe(true);
    resolve();
    await p;
    expect(cmp.loading()).toBe(false);
    expect(cmp.error()).toBeNull();
  });

  it('surfaces an inline error when an action rejects', async () => {
    const action: ExportAction = {
      label: 'Excel',
      format: 'xlsx',
      run: () => Promise.reject(new Error('boom')),
    };
    const fixture = setup([action]);
    const cmp = fixture.componentInstance;

    await cmp.runAction(action);
    expect(cmp.loading()).toBe(false);
    expect(cmp.error()).toBe('Export failed. Please try again.');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- src/app/shared/export/export-button.component.spec.ts`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement the component**

```ts
// export-button.component.ts
import { ChangeDetectionStrategy, Component, computed, input, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { Menu } from 'primeng/menu';
import { Tooltip } from 'primeng/tooltip';
import type { MenuItem } from 'primeng/api';

export interface ExportAction {
  label: string;
  format: 'png' | 'xlsx';
  run: () => Promise<void>;
}

/**
 * Shared export trigger. One action renders a direct button; two or more render
 * a menu. Owns loading (button disabled while a run() is in flight) and inline
 * error state. The host decides the format(s); this component is format-blind.
 */
@Component({
  selector: 'app-export-button',
  imports: [ButtonModule, Menu, Tooltip],
  template: `
    @if (actions().length === 1) {
      <p-button
        [label]="loading() ? 'Exporting…' : 'Export'"
        icon="fa-solid fa-file-arrow-down"
        severity="secondary"
        size="small"
        [text]="true"
        [loading]="loading()"
        [disabled]="loading()"
        (onClick)="runAction(actions()[0])"
        [attr.aria-label]="'Export ' + actions()[0].label"
      />
    } @else {
      <p-button
        [label]="loading() ? 'Exporting…' : 'Export'"
        icon="fa-solid fa-file-arrow-down"
        severity="secondary"
        size="small"
        [text]="true"
        [loading]="loading()"
        [disabled]="loading()"
        (onClick)="menu.toggle($event)"
        aria-haspopup="true"
        aria-label="Export options"
      />
      <p-menu #menu [model]="menuItems()" [popup]="true" />
    }
    @if (error(); as e) {
      <span class="ml-2 text-[11px] text-red-600" role="alert">{{ e }}</span>
    }
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ExportButtonComponent {
  readonly actions = input.required<ExportAction[]>();

  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  protected readonly menuItems = computed<MenuItem[]>(() =>
    this.actions().map((a) => ({
      label: a.label,
      command: () => void this.runAction(a),
    }))
  );

  async runAction(action: ExportAction): Promise<void> {
    if (this.loading()) return;
    this.error.set(null);
    this.loading.set(true);
    try {
      await action.run();
    } catch {
      this.error.set('Export failed. Please try again.');
    } finally {
      this.loading.set(false);
    }
  }
}
```

(If `Menu`/`Tooltip` import paths differ in this PrimeNG version, confirm via the `primeng` MCP `get_component_import` for `menu`. Drop `Tooltip` from imports if unused after final markup.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- src/app/shared/export/export-button.component.spec.ts`
Expected: PASS (both tests).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/export/export-button.component.ts src/client/src/app/shared/export/export-button.component.spec.ts
git commit -m "feat(export): shared export button with loading + error state"
```

---

## Phase B — Grid Excel export

### Task 5: Generic grid-to-sheet util + expose grid columns

**Files:**
- Modify: `src/client/src/app/shared/grids/filter-types.ts`
- Modify: `src/client/src/app/shared/grids/create-grid-state.ts`
- Create: `src/client/src/app/shared/export/grid-sheet.util.ts`
- Test: `src/client/src/app/shared/export/grid-sheet.util.spec.ts`

- [ ] **Step 1: Expose `columns` on `GridState<T>`**

In `filter-types.ts`, add to the `GridState<T>` interface (near `filteredRows`):

```ts
  /** The column defs this grid was created with — reused by Excel export. */
  readonly columns: ColumnDef<T>[];
```

In `create-grid-state.ts`, add `columns: config.columns,` to the returned `GridState<T>` object literal (the `return { ... }` near the end of `createGridState`).

- [ ] **Step 2: Write the failing test**

```ts
// grid-sheet.util.spec.ts
import { describe, expect, it } from 'vitest';
import type { ColumnDef } from '../grids/filter-types';
import { buildGridSheet } from './grid-sheet.util';

interface Row {
  name: string;
  nested: { id: string };
  count: number;
}

const columns: ColumnDef<Row>[] = [
  { field: 'name', header: 'Name' },
  { field: 'nested.id', header: 'Identifier' },
  { field: 'count', header: 'Trials' },
];

describe('buildGridSheet', () => {
  it('maps dotted-path fields to a SheetSpec preserving header + order', () => {
    const spec = buildGridSheet('Companies', columns, [
      { name: 'Pfizer', nested: { id: 'c1' }, count: 3 },
    ]);
    expect(spec.name).toBe('Companies');
    expect(spec.columns.map((c) => c.header)).toEqual(['Name', 'Identifier', 'Trials']);
    expect(spec.rows[0]).toEqual({ c0: 'Pfizer', c1: 'c1', c2: 3 });
  });

  it('prefers a column getValue over the dotted path', () => {
    const withGetter: ColumnDef<Row>[] = [
      { field: 'name', header: 'Name', getValue: (r) => r.name.toUpperCase() },
    ];
    const spec = buildGridSheet('X', withGetter, [{ name: 'pfizer', nested: { id: 'c1' }, count: 0 }]);
    expect(spec.rows[0]).toEqual({ c0: 'PFIZER' });
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- src/app/shared/export/grid-sheet.util.spec.ts`
Expected: FAIL — `buildGridSheet` not defined.

- [ ] **Step 4: Implement the util**

```ts
// grid-sheet.util.ts
import type { ColumnDef } from '../grids/filter-types';
import type { SheetSpec } from './xlsx-sheet.util';

/** Resolve a dotted path ('trial.identifier') against a row; returns '' for null/undefined. */
function resolvePath(row: unknown, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cellValue<T>(row: T, col: ColumnDef<T>): string | number {
  const raw = col.getValue ? col.getValue(row) : resolvePath(row, col.field);
  if (raw == null) return '';
  if (typeof raw === 'number') return raw;
  return String(raw);
}

/**
 * Map a grid's column defs + current rows into a SheetSpec for buildSheetWorkbook.
 * Synthetic stable keys (c0, c1, …) sidestep duplicate/dotted field names.
 * Values come from each column's getValue or its dotted path, so the sheet
 * mirrors the on-screen columns (current view). Template-only display (chips,
 * logos) collapses to its underlying value/label here.
 */
export function buildGridSheet<T>(
  sheetName: string,
  columns: ColumnDef<T>[],
  rows: T[]
): SheetSpec {
  const keyed = columns.map((col, i) => ({ col, key: `c${i}` }));
  return {
    name: sheetName,
    columns: keyed.map(({ col, key }) => ({ header: col.header, key, width: 22 })),
    rows: rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const { col, key } of keyed) out[key] = cellValue(row, col);
      return out;
    }),
  };
}
```

- [ ] **Step 5: Run test + verify build**

Run: `cd src/client && npm run test:units -- src/app/shared/export/grid-sheet.util.spec.ts && ng build`
Expected: PASS, build clean.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/shared/grids/filter-types.ts src/client/src/app/shared/grids/create-grid-state.ts src/client/src/app/shared/export/grid-sheet.util.ts src/client/src/app/shared/export/grid-sheet.util.spec.ts
git commit -m "feat(export): generic grid-to-sheet mapper + expose grid columns"
```

---

### Task 6: `GridExcelExportService`

**Files:**
- Create: `src/client/src/app/shared/export/grid-excel-export.service.ts`

- [ ] **Step 1: Implement the service**

No unit test (thin DI/IO orchestration over already-tested pure functions; exercised by the page wiring + manual verify).

```ts
// grid-excel-export.service.ts
import { inject, Injectable } from '@angular/core';

import type { ColumnDef } from '../grids/filter-types';
import { BrandContextService } from '../../core/services/brand-context.service';
import { saveBlob } from '../../core/services/download.util';
import { buildGridSheet } from './grid-sheet.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface GridExcelRequest<T> {
  /** Worksheet name, e.g. 'Catalysts'. */
  sheetName: string;
  /** Download filename without extension, e.g. 'catalysts'. */
  filename: string;
  columns: ColumnDef<T>[];
  /** Current-view rows (post filter/sort), captured at click time. */
  rows: T[];
}

/** Builds and downloads a single-sheet Excel workbook from a grid's current view. */
@Injectable({ providedIn: 'root' })
export class GridExcelExportService {
  private readonly brand = inject(BrandContextService);

  async export<T>(req: GridExcelRequest<T>): Promise<void> {
    if (req.rows.length === 0) return;
    const { buildSheetWorkbook } = await import('./xlsx-sheet.util');
    const wb = buildSheetWorkbook([buildGridSheet(req.sheetName, req.columns, req.rows)], {
      appDisplayName: this.brand.appDisplayName(),
      primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer as ArrayBuffer], { type: XLSX_MIME }), `${req.filename}.xlsx`);
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/export/grid-excel-export.service.ts
git commit -m "feat(export): grid excel export service"
```

---

### Task 7: Wire Excel export into the Catalysts grid

**Files:**
- Modify: `src/client/src/app/features/catalysts/catalysts-page.component.ts`
- Modify: `src/client/src/app/features/catalysts/catalysts-page.component.html`

- [ ] **Step 1: Add the export action in the component**

Inject the service, add an `exportActions` array that captures the current filtered rows at run time:

```ts
// catalysts-page.component.ts — add imports
import { ExportButtonComponent, type ExportAction } from '../../shared/export/export-button.component';
import { GridExcelExportService } from '../../shared/export/grid-excel-export.service';
// add to component imports: ExportButtonComponent
// add field:
  private readonly excel = inject(GridExcelExportService);

  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: () =>
        this.excel.export({
          sheetName: 'Catalysts',
          filename: 'catalysts',
          columns: this.grid.columns,
          rows: this.flatCatalysts(),
        }),
    },
  ];
```

- [ ] **Step 2: Drop the button into the toolbar slot**

In `catalysts-page.component.html`, find the `<app-grid-toolbar>` usage and add the button into its start slot:

```html
<app-export-button gridToolbarStart [actions]="exportActions" />
```

(`GridToolbarComponent` already projects `[gridToolbarStart]` — see `grid-toolbar.component.ts:31`.)

- [ ] **Step 3: Verify build + lint**

Run: `cd src/client && ng lint && ng build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/catalysts/catalysts-page.component.ts src/client/src/app/features/catalysts/catalysts-page.component.html
git commit -m "feat(export): excel export on catalysts grid"
```

---

### Task 8: Wire Excel export into Trials, Companies, Assets grids

These three mirror Task 7 exactly; only the imports path depth (`../../../`), sheet name, filename, columns source, and current-rows signal differ. Apply the same three edits (component field + `ExportButtonComponent` import + toolbar button) to each.

**Files:**
- Modify: `manage/trials/trial-list.component.ts` + `.html`
- Modify: `manage/companies/company-list.component.ts` + `.html`
- Modify: `manage/assets/asset-list.component.ts` + `.html`

- [ ] **Step 1: Trials**

Component field (rows signal is `visibleRows`, `trial-list.component.ts:213`):

```ts
import { ExportButtonComponent, type ExportAction } from '../../../shared/export/export-button.component';
import { GridExcelExportService } from '../../../shared/export/grid-excel-export.service';
// imports: add ExportButtonComponent
  private readonly excel = inject(GridExcelExportService);
  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: () =>
        this.excel.export({
          sheetName: 'Trials',
          filename: 'trials',
          columns: this.grid.columns,
          rows: this.visibleRows(),
        }),
    },
  ];
```

`trial-list.component.html`: add `<app-export-button gridToolbarStart [actions]="exportActions" />` into the `<app-grid-toolbar>` slot.

- [ ] **Step 2: Companies**

Rows signal is `visibleCompanies` (`company-list.component.ts:94`):

```ts
import { ExportButtonComponent, type ExportAction } from '../../../shared/export/export-button.component';
import { GridExcelExportService } from '../../../shared/export/grid-excel-export.service';
// imports: add ExportButtonComponent
  private readonly excel = inject(GridExcelExportService);
  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: () =>
        this.excel.export({
          sheetName: 'Companies',
          filename: 'companies',
          columns: this.grid.columns,
          rows: this.visibleCompanies(),
        }),
    },
  ];
```

`company-list.component.html`: add `<app-export-button gridToolbarStart [actions]="exportActions" />` into the toolbar slot.

- [ ] **Step 3: Assets**

Rows signal is `visibleRows` (`asset-list.component.ts:133`):

```ts
import { ExportButtonComponent, type ExportAction } from '../../../shared/export/export-button.component';
import { GridExcelExportService } from '../../../shared/export/grid-excel-export.service';
// imports: add ExportButtonComponent
  private readonly excel = inject(GridExcelExportService);
  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: () =>
        this.excel.export({
          sheetName: 'Assets',
          filename: 'assets',
          columns: this.grid.columns,
          rows: this.visibleRows(),
        }),
    },
  ];
```

`asset-list.component.html`: add `<app-export-button gridToolbarStart [actions]="exportActions" />` into the toolbar slot.

- [ ] **Step 4: Verify build + lint**

Run: `cd src/client && ng lint && ng build`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials src/client/src/app/features/manage/companies src/client/src/app/features/manage/assets
git commit -m "feat(export): excel export on trials, companies, assets grids"
```

---

### Task 9: Wire Excel export into the Events grid (current loaded view)

Events is server-lazy-loaded: `grid.filters/sort/page` feed a resource, so the visible rows are the currently loaded page, not a client `filteredRows`. Export the currently displayed `FeedItem[]` signal.

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.ts` + `.html`

- [ ] **Step 1: Identify the displayed-rows signal**

Open `events-page.component.ts` and find the signal bound to the `<p-table [value]>` (the loaded `FeedItem[]`, e.g. `feedItems` / `rows` / the resource value). Use that signal as `rows` below; do not invent a name — read the file and use the real one.

- [ ] **Step 2: Add the export action + button**

```ts
import { ExportButtonComponent, type ExportAction } from '../../shared/export/export-button.component';
import { GridExcelExportService } from '../../shared/export/grid-excel-export.service';
// imports: add ExportButtonComponent
  private readonly excel = inject(GridExcelExportService);
  readonly exportActions: ExportAction[] = [
    {
      label: 'Excel',
      format: 'xlsx',
      run: () =>
        this.excel.export({
          sheetName: 'Events',
          filename: 'events',
          columns: this.grid.columns,
          rows: this.<displayedFeedItemsSignal>(),
        }),
    },
  ];
```

`events-page.component.html`: add `<app-export-button gridToolbarStart [actions]="exportActions" />` into the `<app-grid-toolbar>` slot.

- [ ] **Step 3: Sanity-check the Events columns export cleanly**

The Events grid has `date` and `select` columns whose `getValue`/dotted paths resolve to primitive values; confirm no column relies solely on a template for its value. If a column's display value isn't reachable via `field`/`getValue` (e.g. a composed summary string), add a `getValue` to that `ColumnDef` so the Excel cell matches the screen. Make this the same change in the grid config so the column stays the single source of truth.

- [ ] **Step 4: Verify + commit**

Run: `cd src/client && ng lint && ng build`
Expected: PASS.

```bash
git add src/client/src/app/features/events/events-page.component.ts src/client/src/app/features/events/events-page.component.html
git commit -m "feat(export): excel export on events grid"
```

---

## Phase C — Bullseye export

### Task 10: Bullseye Excel row mapper

**Files:**
- Create: `src/client/src/app/features/landscape/bullseye-export.util.ts`
- Test: `src/client/src/app/features/landscape/bullseye-export.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// bullseye-export.util.spec.ts
import { describe, expect, it } from 'vitest';
import type { BullseyeData } from '../../core/models/landscape.model';
import { buildBullseyeRows } from './bullseye-export.util';

const data = {
  dimension: 'company',
  scope: { id: 'scope', name: 'Filtered' },
  ring_order: ['P3'],
  spoke_label: 'Company',
  spokes: [
    {
      id: 's1',
      name: 'Pfizer',
      display_order: 0,
      highest_phase_rank: 3,
      products: [
        {
          id: 'a1',
          name: 'Drug A',
          generic_name: 'genA',
          company_name: 'Pfizer',
          highest_phase: 'P3',
          moas: [{ id: 'm1', name: 'PD-1' }],
          roas: [{ id: 'r1', name: 'IV', abbreviation: 'IV' }],
          indications: [{ id: 'i1', name: 'NSCLC', abbreviation: null }],
        },
      ],
    },
  ],
} as unknown as BullseyeData;

describe('buildBullseyeRows', () => {
  it('flattens spokes → assets with grouping, phase, moa/roa/indication joined', () => {
    const rows = buildBullseyeRows(data);
    expect(rows).toEqual([
      {
        spoke: 'Pfizer',
        company: 'Pfizer',
        asset: 'Drug A',
        generic: 'genA',
        phase: 'Ph 3',
        moa: 'PD-1',
        roa: 'IV',
        indication: 'NSCLC',
      },
    ]);
  });
});
```

(Adjust the expected `phase` string to whatever `phaseShortLabel('P3')` returns — read `core/models/phase-colors.ts` and match it exactly.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- src/app/features/landscape/bullseye-export.util.spec.ts`
Expected: FAIL — not defined.

- [ ] **Step 3: Implement the mapper**

```ts
// bullseye-export.util.ts
import type { BullseyeData } from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';

export interface BullseyeExportRow {
  spoke: string;
  company: string;
  asset: string;
  generic: string;
  phase: string;
  moa: string;
  roa: string;
  indication: string;
}

/**
 * Flatten the bullseye spoke→asset structure into one row per asset occurrence,
 * mirroring what the chart shows (an asset on N spokes yields N rows). MOA/ROA/
 * indication are joined to single cells.
 */
export function buildBullseyeRows(data: BullseyeData): BullseyeExportRow[] {
  const rows: BullseyeExportRow[] = [];
  for (const spoke of data.spokes) {
    for (const a of spoke.products) {
      rows.push({
        spoke: spoke.name,
        company: a.company_name,
        asset: a.name,
        generic: a.generic_name ?? '',
        phase: a.highest_phase ? phaseShortLabel(a.highest_phase) : '',
        moa: a.moas.map((m) => m.name).join(', '),
        roa: a.roas.map((r) => r.abbreviation ?? r.name).join(', '),
        indication: a.indications.map((i) => i.name).join(', '),
      });
    }
  }
  return rows;
}

export const BULLSEYE_EXPORT_COLUMNS = [
  { header: 'Group', key: 'spoke', width: 22 },
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Asset', key: 'asset', width: 22 },
  { header: 'Generic', key: 'generic', width: 20 },
  { header: 'Phase', key: 'phase', width: 10 },
  { header: 'MOA', key: 'moa', width: 26 },
  { header: 'ROA', key: 'roa', width: 12 },
  { header: 'Indication', key: 'indication', width: 26 },
];
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- src/app/features/landscape/bullseye-export.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-export.util.ts src/client/src/app/features/landscape/bullseye-export.util.spec.ts
git commit -m "feat(export): bullseye excel row mapper"
```

---

### Task 11: Bullseye PNG export host

**Files:**
- Create: `src/client/src/app/features/landscape/bullseye-export-host.component.ts`

- [ ] **Step 1: Implement the off-screen host**

Renders a title header + the real `<app-bullseye-chart>` (display-only inputs; selection/hover off) + the branded footer. `w-max` so the host sizes to the chart, matching the timeline host's pattern.

```ts
// bullseye-export-host.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { BullseyeData } from '../../core/models/landscape.model';
import { ExportFooterComponent } from '../../shared/export/export-footer.component';
import { BullseyeChartComponent } from './bullseye-chart.component';

/**
 * Off-screen capture root for the bullseye PNG export: title + the real chart +
 * branded footer. Never routed; BrandedPngExportService creates it, parks it
 * off-viewport, rasterizes, and destroys it.
 */
@Component({
  selector: 'app-bullseye-export-host',
  imports: [BullseyeChartComponent, ExportFooterComponent],
  host: { class: 'block w-max bg-white' },
  template: `
    <header class="px-6 pt-5 pb-2">
      <h2 class="text-sm font-bold tracking-tight text-slate-800">{{ title() }}</h2>
    </header>
    <div class="px-6 pb-4">
      <app-bullseye-chart [data]="data()" />
    </div>
    <app-export-footer
      artifactLabel="Bullseye"
      [tenantName]="tenantName()"
      [tenantLogoUrl]="tenantLogoUrl()"
      [agencyLogoUrl]="agencyLogoUrl()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class BullseyeExportHostComponent {
  readonly title = input.required<string>();
  readonly data = input.required<BullseyeData>();
  readonly tenantName = input('');
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);
}
```

Note: `<app-bullseye-chart>` requires whichever inputs the live `landscape.component.html` binds. Open that template, copy the chart's required inputs (e.g. `[data]`, and any `[duplicatedAssetIds]`/display flags), and add matching `input()`s to this host so the off-screen render is identical to the live one minus interaction. Bind no event outputs.

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-export-host.component.ts
git commit -m "feat(export): bullseye png export host"
```

---

### Task 12: Wire export buttons into the Bullseye page

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.html`

- [ ] **Step 1: Add PNG + Excel actions**

Resolve the active grouping label (already on `chartData().spoke_label`) for the title, capture `chartData()` for both actions, and resolve the tenant for the footer (the timeline reads it from a tenant service; reuse the same source `landscape.component` already has access to via the route — if none, pass `tenantName=''` and `tenantLogoUrl=null`, the footer hides the segment).

```ts
// landscape.component.ts — add imports
import { ExportButtonComponent, type ExportAction } from '../../shared/export/export-button.component';
import { GridExcelExportService } from '../../shared/export/grid-excel-export.service';
import { BrandedPngExportService } from '../../shared/export/branded-png-export.service';
import { BullseyeExportHostComponent } from './bullseye-export-host.component';
import { buildBullseyeRows, BULLSEYE_EXPORT_COLUMNS } from './bullseye-export.util';
import { buildSheetWorkbook } from ... // NO — go through a service; see below
```

For Excel, add a small `exportExcel()` that uses `buildBullseyeRows` + the generic workbook builder via a tiny inline call to `GridExcelExportService` is grid-shaped; instead use the workbook builder directly through a new private helper. Simplest: reuse the same lazy pattern as `GridExcelExportService` but with `BULLSEYE_EXPORT_COLUMNS` keyed rows. Implement on the component:

```ts
  private readonly png = inject(BrandedPngExportService);
  private readonly injector = inject(Injector); // add Injector to imports from '@angular/core'
  private readonly brand = inject(BrandContextService); // add import

  readonly exportActions = computed<ExportAction[]>(() => {
    const data = this.chartData();
    if (!data || data.spokes.length === 0) return [];
    const title = `Bullseye — ${data.spoke_label}`;
    return [
      {
        label: 'PNG',
        format: 'png',
        run: () =>
          this.png.capture({
            component: BullseyeExportHostComponent,
            elementInjector: this.injector,
            agencyLogoUrl: this.brand.agency()?.logo_url ?? null,
            tenantLogoUrl: null,
            filename: 'bullseye.png',
            setInputs: (ref, logos) => {
              ref.setInput('title', title);
              ref.setInput('data', data);
              ref.setInput('tenantLogoUrl', logos.tenantLogoUrl);
              ref.setInput('agencyLogoUrl', logos.agencyLogoUrl);
            },
          }),
      },
      {
        label: 'Excel',
        format: 'xlsx',
        run: async () => {
          const { buildSheetWorkbook } = await import('../../shared/export/xlsx-sheet.util');
          const rows = buildBullseyeRows(data);
          const wb = buildSheetWorkbook(
            [{ name: 'Bullseye', columns: BULLSEYE_EXPORT_COLUMNS, rows }],
            {
              appDisplayName: this.brand.appDisplayName(),
              primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
            }
          );
          const buffer = await wb.xlsx.writeBuffer();
          const { saveBlob } = await import('../../core/services/download.util');
          saveBlob(
            new Blob([buffer as ArrayBuffer], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
            'bullseye.xlsx'
          );
        },
      },
    ];
  });
```

Add `ExportButtonComponent` to the component `imports`.

- [ ] **Step 2: Place the button in the page header**

In `landscape.component.html`, find the page/controls header region (where the bullseye controls panel or title sits) and add:

```html
@if (exportActions().length > 0) {
  <app-export-button [actions]="exportActions()" />
}
```

Choose a header location consistent with the page's existing toolbar; do not overlap the chart.

- [ ] **Step 3: Verify build + lint**

Run: `cd src/client && ng lint && ng build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/landscape.component.ts src/client/src/app/features/landscape/landscape.component.html
git commit -m "feat(export): png + excel export on bullseye page"
```

---

## Phase D — Heatmap export

### Task 13: Heatmap Excel sheet mapper (matrix + cells)

**Files:**
- Create: `src/client/src/app/features/landscape/heatmap-export.util.ts`
- Test: `src/client/src/app/features/landscape/heatmap-export.util.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
// heatmap-export.util.spec.ts
import { describe, expect, it } from 'vitest';
import type { HeatmapBubble } from '../../core/models/landscape.model';
import { buildHeatmapSheets } from './heatmap-export.util';

const bubbles = [
  {
    label: 'PD-1',
    competitor_count: 4,
    unit_count: 4,
    highest_phase: 'P3',
    phase_counts: { P2: 1, P3: 3 },
    products: [],
  },
] as unknown as HeatmapBubble[];

describe('buildHeatmapSheets', () => {
  it('produces a Matrix sheet (row label + phase columns) and a Cells sheet', () => {
    const specs = buildHeatmapSheets(bubbles, 'unit_count');
    const matrix = specs.find((s) => s.name === 'Matrix')!;
    expect(matrix.rows[0]).toMatchObject({ label: 'PD-1', P2: 1, P3: 3, total: 4 });

    const cells = specs.find((s) => s.name === 'Cells')!;
    // One row per non-empty phase cell.
    expect(cells.rows).toEqual([
      { label: 'PD-1', phase: 'P2', count: 1 },
      { label: 'PD-1', phase: 'P3', count: 3 },
    ]);
  });
});
```

(Match the phase column ordering to `RING_ORDER` from `landscape.model.ts` and the count field to the requested `count_unit`. Adjust expectations to the real `RingPhase` set if the fixture needs more keys.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd src/client && npm run test:units -- src/app/features/landscape/heatmap-export.util.spec.ts`
Expected: FAIL — not defined.

- [ ] **Step 3: Implement the mapper**

```ts
// heatmap-export.util.ts
import { RING_ORDER, type HeatmapBubble, type RingPhase } from '../../core/models/landscape.model';
import type { SheetColumn, SheetSpec } from '../../shared/export/xlsx-sheet.util';

/**
 * Two sheets from the heatmap bubbles:
 *  - Matrix: one row per bubble, a column per phase (count), plus a total.
 *  - Cells:  one row per non-empty (bubble, phase) cell — keeps the data tidy
 *            for pivoting and survives the matrix flattening.
 */
export function buildHeatmapSheets(
  bubbles: HeatmapBubble[],
  countUnitLabel: string
): SheetSpec[] {
  const phases = RING_ORDER as readonly RingPhase[];

  const matrixColumns: SheetColumn[] = [
    { header: countUnitLabel ? 'Group' : 'Group', key: 'label', width: 28 },
    ...phases.map((p) => ({ header: p, key: p, width: 8 })),
    { header: 'Total', key: 'total', width: 10 },
  ];
  const matrixRows = bubbles.map((b) => {
    const row: Record<string, unknown> = { label: b.label, total: b.unit_count };
    for (const p of phases) row[p] = b.phase_counts[p] ?? 0;
    return row;
  });

  const cellsColumns: SheetColumn[] = [
    { header: 'Group', key: 'label', width: 28 },
    { header: 'Phase', key: 'phase', width: 10 },
    { header: 'Count', key: 'count', width: 10 },
  ];
  const cellsRows: Record<string, unknown>[] = [];
  for (const b of bubbles) {
    for (const p of phases) {
      const count = b.phase_counts[p];
      if (count) cellsRows.push({ label: b.label, phase: p, count });
    }
  }

  return [
    { name: 'Matrix', columns: matrixColumns, rows: matrixRows },
    { name: 'Cells', columns: cellsColumns, rows: cellsRows },
  ];
}
```

(If the test expects only phases present in the fixture, either include all `RING_ORDER` phase keys in the fixture's `phase_counts` expectations or assert with `toMatchObject` as shown. Keep `toMatchObject` for the matrix row to avoid pinning every phase key.)

- [ ] **Step 4: Run test to verify it passes**

Run: `cd src/client && npm run test:units -- src/app/features/landscape/heatmap-export.util.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/heatmap-export.util.ts src/client/src/app/features/landscape/heatmap-export.util.spec.ts
git commit -m "feat(export): heatmap excel matrix + cells mapper"
```

---

### Task 14: Heatmap PNG export host

**Files:**
- Create: `src/client/src/app/features/landscape/heatmap-export-host.component.ts`

- [ ] **Step 1: Implement the host**

```ts
// heatmap-export-host.component.ts
import { ChangeDetectionStrategy, Component, input } from '@angular/core';

import type { HeatmapBubble } from '../../core/models/landscape.model';
import { ExportFooterComponent } from '../../shared/export/export-footer.component';
import { HeatmapComponent } from './heatmap.component';

/**
 * Off-screen capture root for the heatmap PNG export: title + the real heatmap
 * matrix (no detail panel, no interaction) + branded footer.
 */
@Component({
  selector: 'app-heatmap-export-host',
  imports: [HeatmapComponent, ExportFooterComponent],
  host: { class: 'block w-max bg-white' },
  template: `
    <header class="px-6 pt-5 pb-2">
      <h2 class="text-sm font-bold tracking-tight text-slate-800">{{ title() }}</h2>
    </header>
    <div class="px-6 pb-4">
      <app-heatmap
        [bubbles]="bubbles()"
        [countUnit]="countUnit()"
        [selectedBubble]="null"
        [sortField]="sortField()"
        [sortDir]="sortDir()"
        [latestEventDate]="latestEventDate()"
        [showPreclinical]="showPreclinical()"
      />
    </div>
    <app-export-footer
      artifactLabel="Heatmap"
      [tenantName]="tenantName()"
      [tenantLogoUrl]="tenantLogoUrl()"
      [agencyLogoUrl]="agencyLogoUrl()"
    />
  `,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class HeatmapExportHostComponent {
  readonly title = input.required<string>();
  readonly bubbles = input.required<HeatmapBubble[]>();
  readonly countUnit = input.required<unknown>(); // match HeatmapComponent's countUnit type
  readonly sortField = input.required<unknown>(); // match SortField
  readonly sortDir = input.required<'asc' | 'desc'>();
  readonly latestEventDate = input<string | null>(null);
  readonly showPreclinical = input(false);
  readonly tenantName = input('');
  readonly tenantLogoUrl = input<string | null>(null);
  readonly agencyLogoUrl = input<string | null>(null);
}
```

Replace the `unknown` input types with the real `CountUnit` and `SortField` types imported from `landscape.model.ts` / `heatmap.component.ts` (see `heatmap-view.component.ts:20`). The `<app-heatmap>` bindings mirror `heatmap-view.component.ts:71-82` exactly, minus the `(rowClick)`/`(sortChange)` outputs.

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/heatmap-export-host.component.ts
git commit -m "feat(export): heatmap png export host"
```

---

### Task 15: Wire export buttons into the Heatmap page

**Files:**
- Modify: `src/client/src/app/features/landscape/heatmap-view.component.ts`

- [ ] **Step 1: Add PNG + Excel actions**

The heatmap data is `heatmapData.value()` (bubbles + `latest_event_date`); grouping label comes from `state.heatmapGrouping()`. Build a human title (e.g. `Heatmap — MOA` / `Heatmap — MOA × Indication`).

```ts
// heatmap-view.component.ts — add imports
import { computed, inject, Injector } from '@angular/core'; // (computed/inject already present; add Injector)
import { ExportButtonComponent, type ExportAction } from '../../shared/export/export-button.component';
import { BrandedPngExportService } from '../../shared/export/branded-png-export.service';
import { BrandContextService } from '../../core/services/brand-context.service';
import { HeatmapExportHostComponent } from './heatmap-export-host.component';
import { buildHeatmapSheets } from './heatmap-export.util';
// add ExportButtonComponent to component imports

  private readonly png = inject(BrandedPngExportService);
  private readonly injector = inject(Injector);
  private readonly brand = inject(BrandContextService);

  private heatmapTitle(): string {
    const labels: Record<string, string> = {
      moa: 'Heatmap — MOA',
      indication: 'Heatmap — Indication',
      'moa+indication': 'Heatmap — MOA × Indication',
      company: 'Heatmap — Company',
      roa: 'Heatmap — ROA',
    };
    return labels[this.state.heatmapGrouping()] ?? 'Heatmap';
  }

  readonly exportActions = computed<ExportAction[]>(() => {
    const data = this.heatmapData.value();
    if (!data || data.bubbles.length === 0) return [];
    const title = this.heatmapTitle();
    return [
      {
        label: 'PNG',
        format: 'png',
        run: () =>
          this.png.capture({
            component: HeatmapExportHostComponent,
            elementInjector: this.injector,
            agencyLogoUrl: this.brand.agency()?.logo_url ?? null,
            tenantLogoUrl: null,
            filename: 'heatmap.png',
            setInputs: (ref, logos) => {
              ref.setInput('title', title);
              ref.setInput('bubbles', data.bubbles);
              ref.setInput('countUnit', this.state.countUnit());
              ref.setInput('sortField', this.sortField());
              ref.setInput('sortDir', this.sortDir());
              ref.setInput('latestEventDate', data.latest_event_date ?? null);
              ref.setInput('showPreclinical', this.state.showPreclinical());
              ref.setInput('tenantLogoUrl', logos.tenantLogoUrl);
              ref.setInput('agencyLogoUrl', logos.agencyLogoUrl);
            },
          }),
      },
      {
        label: 'Excel',
        format: 'xlsx',
        run: async () => {
          const { buildSheetWorkbook } = await import('../../shared/export/xlsx-sheet.util');
          const wb = buildSheetWorkbook(buildHeatmapSheets(data.bubbles, String(this.state.countUnit())), {
            appDisplayName: this.brand.appDisplayName(),
            primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
          });
          const buffer = await wb.xlsx.writeBuffer();
          const { saveBlob } = await import('../../core/services/download.util');
          saveBlob(
            new Blob([buffer as ArrayBuffer], {
              type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
            }),
            'heatmap.xlsx'
          );
        },
      },
    ];
  });
```

- [ ] **Step 2: Place the button**

In the heatmap-view inline template, add to the controls/header area (near `<app-heatmap-controls-panel>` or above the matrix):

```html
@if (exportActions().length > 0) {
  <app-export-button [actions]="exportActions()" />
}
```

- [ ] **Step 3: Verify build + lint**

Run: `cd src/client && ng lint && ng build`
Expected: PASS.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/heatmap-view.component.ts
git commit -m "feat(export): png + excel export on heatmap page"
```

---

## Phase E — Consolidate and verify

### Task 16: Barrel export + lint sweep

**Files:**
- Optional create: `src/client/src/app/shared/export/index.ts`

- [ ] **Step 1: Add a barrel (optional, only if it reduces import noise)**

```ts
// src/client/src/app/shared/export/index.ts
export * from './export-button.component';
export * from './export-footer.component';
export * from './branded-png-export.service';
export * from './grid-excel-export.service';
export * from './xlsx-sheet.util';
export * from './grid-sheet.util';
```

Skip if the repo doesn't use barrels for shared modules (check `shared/grids/index.ts` for the convention — it exists, so a barrel is consistent here).

- [ ] **Step 2: Full unit run + lint + build**

Run: `cd src/client && npm run test:units && ng lint && ng build`
Expected: All unit specs PASS, lint clean, build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/shared/export/index.ts
git commit -m "chore(export): barrel for shared export toolkit"
```

---

### Task 17: Manual verification (browser)

Per the project's export-verify practice (Playwright with local-Supabase auth injection; see the `reference_playwright_local_auth_export_verify` memory). No code changes; this is a verification gate before opening the PR.

- [ ] **Step 1: Start the app and sign in locally**

Run: `cd src/client && ng serve -c local` (and `supabase start` if not running). Inject the local session per the export-verify memory.

- [ ] **Step 2: Verify each surface**

For each, click Export and confirm a file downloads and opens cleanly:
- Timeline PNG/PPTX/XLSX — **regression check**: unchanged from before (footer extraction + capture refactor).
- Bullseye: PNG (title + chart + branded footer) and Excel (one sheet, rows match the chart).
- Heatmap: PNG (title + matrix + footer) and Excel (Matrix + Cells sheets).
- Catalysts / Trials / Companies / Assets / Events: Excel reflects the **current filtered/sorted view** (apply a filter first, confirm the file honors it).

- [ ] **Step 3: Confirm empty-state behavior**

On a grid filtered to zero rows and a visualization with no data, the export action no-ops (service early-returns on empty) — confirm no crash and the button restores to idle.

- [ ] **Step 4: Record results**

Note pass/fail per surface in the PR description. If any fail, return to the relevant task before merging.

---

## Self-Review notes (addressed)

- **Spec coverage:** footer extraction (T1), generalized PNG (T2), generic XLSX (T3), export button (T4), grid generic + columns exposure (T5/T6), five grids (T7–T9), bullseye PNG+Excel (T10–T12), heatmap PNG+Excel (T13–T15), verification incl. timeline regression (T17). All spec sections map to a task.
- **Type consistency:** `SheetSpec`/`SheetColumn`/`XlsxMeta` defined once in T3 and reused in T5/T6/T10/T13. `ExportAction` defined in T4, reused everywhere. `buildGridSheet` signature `(sheetName, columns, rows)` consistent T5→T6/T7.
- **Known read-and-confirm points** (flagged inline, not placeholders): exact `<app-bullseye-chart>`/`<app-heatmap>` input lists (T11/T14), the Events displayed-rows signal name (T9), `phaseShortLabel` output strings in test expectations (T10), and `CountUnit`/`SortField` types (T14). Each names the file/line to read.
