# Timeline Image (PNG) and Excel (XLSX) Export

- **Status:** Design approved, pending spec review
- **Date:** 2026-06-10
- **Related:** `docs/specs/export-to-powerpoint/spec.md`, `docs/superpowers/specs/2026-06-08-pptx-export-marker-fidelity-design.md`

## Problem

The timeline exports to PowerPoint only. Users also need a one-image snapshot (paste into email, chat, other decks) and a data export they can sort, filter, and pivot in Excel. The bullseye and density-matrix specs already reference "follow timeline export pattern" for PNG export, so the image renderer should be built as a reusable pattern, not a one-off.

## Decisions (from brainstorming)

1. **Excel contains data sheets only.** No gantt-style colored-cell timeline. Excel is the analysis surface; the visual timeline lives in PPTX and PNG.
2. **PNG is drawn from data onto an offscreen canvas.** Not a DOM screenshot, not an SVG composition. Third renderer of the same data alongside the screen SVGs and the PPTX shapes, sharing `MarkerVisual`, `GLYPH_RATIOS`, phase colors, and the timeline date math.
3. **Entry point is a split menu on the export button.** PowerPoint and Image open the export dialog (zoom choice); Excel downloads immediately with no dialog.
4. **PNG mirrors the PPTX data slide.** Header band with time axis, left label columns per current toggles, phase bars, markers, legend, branded footer. No cover-slide equivalent.

## Architecture

### Entry points and UX

- The export button in `landscape-shell.component.ts` becomes a menu with three items: PowerPoint, Image (PNG), Excel (XLSX).
- The `landscape:export` CustomEvent gains `detail: { format: 'pptx' | 'png' | 'xlsx' }`.
- `timeline-view.component.ts` handles the event:
  - `pptx` / `png`: open `export-dialog` with the format preset. The dialog keeps the zoom selector for both formats; its title and submit-button label reflect the format.
  - `xlsx`: invoke the Excel export service directly. No dialog.
- Existing dialog inputs (companies, year range, column toggles) are unchanged.

### PNG renderer (canvas from data)

New files under `src/client/src/app/core/services/`:

- `png-export.service.ts`: orchestrates layout and drawing, mirrors the PPTX data-slide structure:
  - header band with year/quarter/month/day labels per selected zoom
  - left label columns (company, asset, MOA, ROA, trial, notes) honoring the dashboard toggles via the shared `computeLeftColumns`
  - timeline area with grid lines, alternating row backgrounds, phase bars (12% tint plus border, short label when width permits), markers with date labels
  - legend grouped by marker category, branded footer
- `canvas-marker-glyph.ts`: draws a marker glyph on a `CanvasRenderingContext2D` from a `MarkerVisual` descriptor using `GLYPH_RATIOS`. Counterpart to `pptx-marker-glyph.ts`; covers all shapes, fill styles, inner marks, and NLE dimming.

Render parameters:

- Logical canvas 1920x1080, drawn at 2x scale for a 3840x2160 output.
- White background, app font stack (already loaded in the document).
- Output via `canvas.toBlob('image/png')`, downloaded as `clinical-trial-dashboard.png`.
- Independent of on-screen scroll/viewport state; consumes the same `Company[]` input as the PPTX export.

### Excel exporter (data sheets)

- New `xlsx-export.service.ts` using **ExcelJS** (MIT, actively maintained). Loaded with a dynamic `import()` so it stays out of the main bundle, same as the export path pattern for pptxgenjs.
- Two sheets:
  - **Trials:** Company, Asset, MOA, ROA, Trial, Phase, Phase Start, Phase End, Notes.
  - **Markers:** Company, Asset, Trial, Marker, Category, Date, Status (Actual / Projected / No longer expected), Detail. Reuses the marker table row-building logic the PPTX detail slides use.
- Dates are real Excel date cells (sortable, pivotable), not strings.
- Header rows: bold, brand-colored fill, frozen panes, autofilter. Sensible fixed column widths.
- Filename `clinical-trial-dashboard.xlsx`.
- SheetJS was rejected: its npm distribution is stale and license/registry posture is worse than ExcelJS.

### Shared code reshuffle

- Format-agnostic helpers currently in `pptx-export.util.ts` (column layout, legend grouping, marker table rows, date formatting) move to a new `export-common.util.ts`.
- PPTX-specific helpers stay in `pptx-export.util.ts`.
- Existing tests move with the code.

## Error handling

- Dialog-based exports (PPTX, PNG) keep the existing loading-spinner and inline error pattern in `export-dialog.component.ts`.
- The Excel path has no dialog; failures surface via the app's toast pattern, successes just download.

## Testing

Tests are paired with each implementation task, never deferred to a trailing phase.

- `export-common.util.spec.ts`: moved existing coverage plus any new shared helpers.
- `xlsx-export.service.spec.ts`: build the workbook in memory, assert sheet names, header rows, cell values, and that date cells are Date-typed.
- `canvas-marker-glyph.spec.ts`: recording mock 2D context; assert path commands and fill/stroke styles per shape, fill style, inner mark, and NLE variant.
- `png-export` layout: unit-test geometry (column x-positions, row heights, marker x from dates) the same way the PPTX layout is tested.
- Playwright: extend the existing export verification pattern (inject local-Supabase session, hook `URL.createObjectURL`, capture blob) to assert the PNG and XLSX blobs are produced with the right MIME types and non-trivial size.

## Non-goals

- No gantt-style visual sheet in Excel.
- No DOM screenshotting and no html2canvas dependency.
- No per-export "include legend" toggle; PNG always includes the legend and branding.
- No changes to the PPTX export's content or layout (beyond the helper file move).
- No server-side rendering.
