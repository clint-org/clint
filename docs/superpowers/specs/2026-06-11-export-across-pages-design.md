# Export Across Visualization and Grid Pages

**Date:** 2026-06-11
**Status:** Draft for review

## Problem

The timeline view has a full export stack (PNG, PPTX, XLSX) but no other page does.
Analysts want to pull the same artifacts off the other visualizations and the data
grids. The timeline export is bespoke end to end; extending it page-by-page would
duplicate the capture, branding, and Excel machinery five-plus times.

This effort factors the reusable mechanics out of the timeline stack and adds thin
per-page wiring so the remaining high-value pages can export.

## Scope

In scope:

- **Bullseye** visualization: PNG (branded frame) + Excel (underlying rows).
- **Heatmap** visualization: PNG (branded frame) + Excel (matrix + cell detail).
- **Grids** — Catalysts, Events, Manage > Trials, Manage > Companies, Manage > Assets:
  Excel of the current view.

Out of scope (explicitly deferred):

- PPTX for the new visualization pages. Decided image-only for Bullseye/Heatmap; native
  vector PPTX per chart is high-effort and not wanted now.
- Settings/taxonomy grids (marker types, taxonomies) and admin/audit grids
  (agency, super-admin, member lists, audit logs). Lower analyst value.
- Any change to the timeline's own export behavior or its format-picker dialog, beyond
  extracting the shared footer it already renders.

## Format matrix

| Page | PNG | Excel |
|---|---|---|
| Bullseye | branded frame | bubble / asset rows |
| Heatmap | branded frame | matrix + cell detail |
| Catalysts | — | current view |
| Events | — | current view |
| Manage > Trials | — | current view |
| Manage > Companies | — | current view |
| Manage > Assets | — | current view |

## Decisions (from brainstorming)

- **Viz PPTX:** none. Image-only for the visualization pages.
- **PNG content:** branded frame — title header (page name + active grouping/axis) plus the
  same branded footer the timeline uses (product mark + agency/tenant logos + date), not a
  raw element screenshot.
- **Excel content for grids:** current view — respects active global search, column filters,
  and sort order (WYSIWYG), not the full dataset.
- **Viz also get Excel:** yes — both visualizations have tabular data underneath.
- **Trigger UI:** a shared export control. One format renders a single direct button; two
  formats (the viz pages) render a small menu/split button. The control owns its loading and
  inline-error state. The timeline keeps its existing dialog and is not changed.

## Architecture

### Shared building blocks (`src/app/shared/export/`)

**1. `<app-export-footer>` (`export-footer.component.ts`)**
Extract the footer currently inline in
`features/dashboard/export/export-snapshot-host.component.ts` (the `<footer>` block) into a
standalone, OnPush component.

Inputs:
- `artifactLabel: string` — "Timeline" | "Bullseye" | "Heatmap" (the label that today is the
  hard-coded "Timeline").
- `agencyLogoUrl: string | null`, `tenantLogoUrl: string | null` — pre-rasterized PNG data
  URIs supplied by the caller (CORS-safe for capture).
- `tenantName: string`.

It reads `BrandContextService` for the agency name fallback and renders the product mark, the
"DELIVERED BY" and "PREPARED FOR" segments (hidden when absent), and the export date.

The timeline `ExportSnapshotHostComponent` is migrated to consume this component with
`artifactLabel="Timeline"`. No visual change; this is the only edit to existing timeline
export code.

**2. `BrandedPngExportService` (`branded-png-export.service.ts`)**
Generalize the mechanics in `features/dashboard/export/png-export.service.ts` into a
content-agnostic capture service. It keeps, unchanged in behavior:
- logo pre-rasterization via `logoToPngDataUrl`,
- off-viewport mount (`position: fixed; left: -100000px`),
- `waitForReady` (fonts, `[data-export-waiting]` polling with timeout, lazy→eager image decode,
  double rAF),
- `clampExportScale` at 2x,
- Safari canvas backing-store release,
- download via `saveBlob`.

API shape:

```ts
captureBrandedPng<C>(opts: {
  component: Type<C>;
  setInputs: (ref: ComponentRef<C>) => void; // caller sets host inputs
  elementInjector: Injector;                  // caller's injector (state resolution)
  filename: string;
}): Promise<void>
```

The host component the caller passes is responsible for composing its chart + title +
`<app-export-footer>`. Logo rasterization stays in the service: the caller provides raw logo
URLs through a small `branding` field and the service resolves them to data URIs before mount,
mirroring today's flow.

The timeline's `PngExportService` is refactored to call this shared core (passing
`ExportSnapshotHostComponent`). If refactoring the timeline path proves risky, the shared core
is extracted as a standalone function the timeline service also calls; the timeline's observable
behavior must not change either way. Verified by the existing manual Playwright export check.

**3. Generic Excel builder (`xlsx-sheet.util.ts`)**
A pure builder that the new pages share:

```ts
interface SheetColumn { header: string; key: string; width?: number; numFmt?: string }
interface SheetSpec { name: string; columns: SheetColumn[]; rows: Record<string, unknown>[] }

function buildSheetWorkbook(sheets: SheetSpec[], meta: XlsxMeta): ExcelJS.Workbook
```

Reuses the existing `XlsxMeta`, `styleHeaderRow`, frozen-header view, and `autoFilter`
conventions from `core/services/xlsx-export.util.ts`. Date cells are passed as JS `Date`
(UTC-normalized, reusing the existing `isoToDate` helper, lifted to the shared util). The
timeline's `buildXlsxWorkbook` is left untouched.

**4. `<app-export-button>` (`export-button.component.ts`)**
Shared trigger. Input:

```ts
readonly actions = input.required<ExportAction[]>();
// ExportAction = { label: string; format: 'png' | 'xlsx'; run: () => Promise<void> }
```

- One action → a single direct button labeled "Export".
- Two-plus actions → a PrimeNG menu/split button ("Export ▾") listing each action.

Owns `loading` state (button disables while a `run()` promise is in flight) and surfaces
failures inline (message/toast). Uses PrimeNG components and brand tokens per the client
guardrails.

### Per-page wiring

**Bullseye** (`features/landscape/landscape.component.ts`, `BullseyeChartComponent`)
- `bullseye-export-host.component.ts`: title header (page name + active grouping, e.g.
  "Bullseye — by Company") + `<app-bullseye-chart>` (same inputs as the live view) +
  `<app-export-footer artifactLabel="Bullseye">`.
- PNG: pass the host to `BrandedPngExportService`.
- Excel: pure `buildBullseyeRows(data)` flattening company → asset → indication/ring into rows
  (Company, Asset, Indication, MOA, ROA, Ring/Phase, Latest event date). One sheet via
  `buildSheetWorkbook`.
- `<app-export-button [actions]="[pngAction, xlsxAction]">` in the page header.

**Heatmap** (`features/landscape/heatmap-view.component.ts`, `HeatmapComponent`)
- `heatmap-export-host.component.ts`: title (page name + axis, e.g. "Heatmap — MOA ×
  Indication") + `<app-heatmap>` + `<app-export-footer artifactLabel="Heatmap">`.
- PNG via the branded service.
- Excel: pure `buildHeatmapSheets(bubbles, axes)` producing two sheets:
  1. **Matrix** — row-axis labels down the side, cross-axis across the top, cell = count.
  2. **Cells** — one row per non-empty cell with row label, column label, count, latest event
     date (so dates survive the matrix flattening).
- `<app-export-button [actions]="[pngAction, xlsxAction]">` in the header.

**Grids — Catalysts, Events, Trials, Companies, Assets** (Excel only)
- Each page reads its PrimeNG table's current view: `table.filteredValue ?? table.value`
  (honors global filter, column filters, and sort).
- Each gets a pure `build<X>Sheet(rows)` mapping visible columns to Excel columns. Headers use
  domain vocabulary (Catalyst, Trial, Company, Asset…), never generic ones, per the client
  empty-state rules. Where a column renders a template (status chip, etc.), the cell uses the
  underlying value/label, not markup.
- `<app-export-button [actions]="[xlsxAction]">` renders as a single direct button in each
  page's existing header/toolbar.

## Data flow

PNG: page builds host inputs (live chart inputs + branding) → `BrandedPngExportService`
rasterizes logos, mounts the host off-viewport, waits for readiness, captures at 2x, downloads.

Excel: page collects current-view rows → pure `build*` function maps to `SheetSpec[]` →
`buildSheetWorkbook` → service lazy-loads ExcelJS, writes buffer → `saveBlob`.

## Error handling

- `<app-export-button>` catches `run()` rejections, restores the idle state, and surfaces an
  inline failure message; it never leaves the button stuck disabled.
- PNG capture failures (blob null, timeout) throw with a user-facing message, mirroring the
  current timeline path.
- Empty datasets: the export action is disabled (or no-ops with a message) when there are no
  rows / no companies, matching the timeline's early return.

## Testing

Per the per-task TDD rule, each pure function ships with its Vitest spec in the same task:

- `buildSheetWorkbook` — columns/rows/meta in → worksheet structure, header styling, autoFilter,
  date cells out.
- `buildBullseyeRows`, `buildHeatmapSheets`, and each grid `build<X>Sheet` — fixture rows in →
  expected sheet rows out, including current-view filtering and template-value extraction.
- `<app-export-button>` — renders direct vs menu by action count; loading and error states.
- Host components — light render/smoke test (title + footer present).

Full PNG visual fidelity stays manual via Playwright (local-auth + blob capture), per existing
export-verify practice.

## File layout

```
src/app/shared/export/
  export-footer.component.ts        (+ .spec)
  export-button.component.ts        (+ .spec)
  branded-png-export.service.ts
  xlsx-sheet.util.ts                (+ .spec)
features/landscape/
  bullseye-export-host.component.ts
  bullseye-export.util.ts           (buildBullseyeRows + .spec)
  heatmap-export-host.component.ts
  heatmap-export.util.ts            (buildHeatmapSheets + .spec)
features/catalysts/  catalysts-export.util.ts   (+ .spec)
features/events/     events-export.util.ts      (+ .spec)
features/manage/trials|companies|assets/  <x>-export.util.ts (+ .spec)
```

## Risks / open considerations

- **Timeline regression:** the only shared edit touching the timeline is the footer extraction
  and (optionally) routing `PngExportService` through the shared core. Both are behavior-
  preserving and covered by the manual export verification.
- **Bullseye/Heatmap off-screen render:** both chart components must instantiate standalone with
  the same inputs as the live view (the timeline grid already does this). If either depends on
  ambient layout/scroll state, the host must reproduce it — to confirm during implementation.
- **PrimeNG current-view access:** `filteredValue` is null until a filter runs; the
  `?? value` fallback covers the unfiltered case. Sort order is reflected in `value` after sort.
```
