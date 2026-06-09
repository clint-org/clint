# PPTX Export Fidelity Pass

Date: 2026-06-07
Status: Approved (design)
Scope: Spec 1 of 2. Multi-format output (PDF / image) is deferred to a follow-on spec.

## Problem

The PowerPoint export of the clinical-trial timeline looks materially weaker than
the on-screen timeline it is meant to represent. Concrete gaps:

- The column header row is plain white with faint gray labels; the app uses a
  filled dark-slate band with light labels.
- The export shows only Company / Asset / Trial columns. The app shows Company
  (logo) / Asset / MOA / ROA / Trial and respects user column-visibility toggles
  (MOA, ROA, Notes).
- The export omits the NCT id; the app shows acronym + NCT id.
- Phase bars render at 25-60% transparency, so they read washed out. The app uses
  solid, saturated phase colors.
- The legend is a flat list sorted by each marker type's `display_order`, which is
  not category-contiguous, so it wraps mid-group ("Regulatory Filing" orphans the
  start of row two).
- There is no detail view of the markers themselves.

## Goal

Make the native-PPTX export read like the on-screen timeline, respect the
dashboard's visible-column choices, fix the legend wrapping, and add a markers
detail table. Output stays an editable PPT built from native pptxgenjs shapes.

## Non-goals

- PDF and image output formats (deferred to Spec 2).
- Timeline pagination across multiple slides (rows still scale to one slide).
- An executive-summary / STATS strip on the data slide.
- Rendering full note text inline on the timeline slide.

## Affected code

- `src/client/src/app/core/services/pptx-export.service.ts` - orchestration +
  pptxgenjs calls (existing).
- `src/client/src/app/core/services/pptx-export.util.ts` - NEW. Pure helpers,
  unit-tested.
- `src/client/src/app/core/services/pptx-export.util.spec.ts` - NEW. Vitest suite.
- `src/client/src/app/features/dashboard/export-dialog/export-dialog.component.ts`
  - thread column-visibility flags into `ExportOptions`.
- `src/client/src/app/features/landscape/timeline-view.component.html` - pass
  `showMoaColumn` / `showRoaColumn` / `showNotesColumn` from `LandscapeStateService`.

## Data availability (verified)

The `companies: Company[]` payload the export already receives carries everything
needed:

- Asset `mechanisms_of_action: {id,name}[]` and
  `routes_of_administration: {id,name,abbreviation}[]` (populated by
  `get_dashboard_data`).
- Trial `identifier` (NCT id) and `acronym`.
- Company and Asset `logo_url`.
- Marker `marker_types` with `marker_categories: {id, name}` (no category
  `display_order` in the dashboard payload).
- `space_id` on every entity (derive export `spaceId` from `companies[0].space_id`).

Category `display_order` is NOT in the dashboard payload, so legend ordering pulls
the authoritative marker-type list (with `marker_categories.display_order`) via
`MarkerTypeService.list(spaceId)`, the same source the on-screen legend uses. This
keeps the export legend from drifting from the live legend.

Column-visibility state lives in `LandscapeStateService`
(`showMoaColumn` / `showRoaColumn` / `showNotesColumn`, each a `signal(true)`).
The export dialog is instantiated in `timeline-view.component.html`; that component
can read the state service and bind the three flags.

## Design

### 1. Visibility-aware left columns

Replace the fixed `COMPANY_X/PRODUCT_X/TRIAL_X` constants with a computed column
layout. Columns, in order, with target widths (inches):

| Column  | Width | Shown when            |
|---------|-------|-----------------------|
| Company | 1.00  | always                |
| Asset   | 0.85  | always                |
| MOA     | 0.80  | `showMoaColumn`       |
| ROA     | 0.45  | `showRoaColumn`       |
| Trial   | 1.05  | always                |
| Notes   | 0.22  | `showNotesColumn`     |

`LABEL_COL_W` = sum of active column widths; `TIMELINE_X = LABEL_COL_W`;
`TIMELINE_W = SLIDE_W - LABEL_COL_W`. All-on => 4.37" left / ~8.96" timeline;
all-off => 2.90" left / ~10.43" timeline.

Column content:
- **Company:** small logo glyph (0.18 x 0.18) from `company.logo_url`, fetched and
  base64-encoded best-effort (reuse `loadLogoAsBase64`), cached per company.
  Fallback: a brand-primary-color rounded chip with the company initial. Uppercase
  company name beside the glyph, brand color, on the company's first row only.
- **Asset:** name, bold slate, on the asset's first row only.
- **MOA:** first mechanism name (joined with ", " if multiple), shrink-to-fit.
- **ROA:** route abbreviation (fallback name), centered.
- **Trial:** acronym (or name) bold; NCT id (`identifier`) small slate below/beside.
- **Notes:** a small note glyph when `trial.notes` or `trial.trial_notes?.length`;
  otherwise empty.

### 2. Visual treatment

- **Header band:** one filled rect (`1e293b`) spanning full slide width at the
  header row. Column labels in `e2e8f0`, bold; year labels white, mono (Consolas).
  Keep the bottom rule.
- **Phase bars:** solid fill at full opacity (remove `transparency`), keep rounded
  corners and white bold phase label. `PHASE_COLORS` unchanged.
- **Marker date labels:** keep below the marker; raise the collision threshold and
  clamp label width so adjacent dates stop overlapping.

### 3. Legend (flat, category-ordered, break after Regulatory)

- Fetch `MarkerTypeService.list(spaceId)` for authoritative category names +
  `display_order` and per-type `display_order`.
- Build the ordered list: categories ascending by category `display_order`; within
  a category, types ascending by type `display_order`; filtered to the marker
  types actually present in the export data (preserves current "present only"
  behavior).
- Render as a flat row-wrapping list (no section-header chrome). Insert a forced
  row break at the boundary where the category transitions out of Regulatory (the
  last Regulatory item ends a row; the next category starts a fresh row).
- `LEGEND_H` grows to accommodate up to two rows.
- If `MarkerTypeService.list` fails, fall back to the current flat
  `display_order` ordering (no break) so export never hard-fails.

### 4. Markers detail table slide(s)

A new slide (or slides) after the timeline slide, titled "Catalyst & Milestone
Detail".

- **Columns:** Company | Asset | Trial | Marker | Date | Status | Notes.
  - Marker = `marker_types.name`.
  - Date = formatted `event_date`; if `end_date`, render a range.
  - Status = `NLE` if `no_longer_expected`; else `Projected` if `is_projected` or
    `projection !== 'actual'`; else `Actual`.
  - Notes = `marker.title` or `description`, truncated.
- **Sort:** company display order -> asset -> trial -> `event_date`.
- **Pagination:** manual chunking at ~20 rows/page so page totals are
  deterministic. Each page: a native pptxgenjs table with a dark-slate header row
  and alternating row fill.
- Markers table always includes all markers, independent of column-visibility.

### 5. Footer / page numbering

Total pages becomes dynamic: `cover (1) + timeline (1) + ceil(markerCount /
rowsPerPage)`. `addFooter` already takes `pageNum` / `totalPages`; pass computed
values.

### 6. Structure & testability

Move pure logic into `pptx-export.util.ts`, imported by the service:

- `computeLeftColumns(visibility) -> { columns: ColumnDef[], labelColW }` where
  `ColumnDef = { key, x, width }`.
- `orderLegendItems(presentTypes, allTypesWithCategories) -> { items, breakIndex }`.
- `buildMarkerTableRows(companies) -> MarkerRow[]` (status derivation + sort +
  truncation).
- `paginate(rows, perPage) -> rows[][]`.
- `formatDateShort(dateStr)` (moved from the service).

Each helper gets a Vitest case in `pptx-export.util.spec.ts`:
- column omission + width sum for each visibility combination.
- legend ordering, present-only filtering, and break-index after Regulatory;
  fallback path.
- status derivation (NLE / Projected / Actual) and sort order.
- pagination chunking + total count.
- date formatting incl. ranges.

The service file keeps only pptxgenjs orchestration, which is exercised manually
in the browser (it writes a file; not unit-tested).

## Threading changes

1. `ExportOptions` gains `showMoaColumn`, `showRoaColumn`, `showNotesColumn`
   (booleans). `spaceId` derived inside the service from `companies[0]?.space_id`.
2. `ExportDialogComponent` gains three `input<boolean>(true)` flags and forwards
   them in `doExport()`.
3. `timeline-view.component.html` binds the three flags from
   `LandscapeStateService`.

## Verification

- `cd src/client && ng lint && ng build`
- `npm run test:units` (new util spec passes).
- Manual: export from the dashboard with various column-toggle states and confirm
  the slide matches the on-screen timeline, the legend breaks after Regulatory,
  and the markers table renders + paginates.

## Risks

- Per-company logo fetches can be slow or fail; mitigated by best-effort load +
  initial-chip fallback and parallel fetch.
- `MarkerTypeService.list` adds an async dependency to the export; mitigated by the
  fallback ordering.
- Dense slides (40+ trials) still scale rows small; acceptable for this spec,
  pagination is a future enhancement.
