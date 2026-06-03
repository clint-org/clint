---
id: spec-2026-competitive-density-matrix
title: Competitive Density Matrix
slug: competitive-density-matrix
status: completed
created: 2026-05-27
updated: 2026-05-27
depends-on: spec-2026-bullseye-spoke-redesign
---

# Competitive Density Matrix

## Summary

Replace the positioning scatter chart with a heatmap table. Rows are the grouping dimension (MOA, indication, MOA+indication, company, ROA), columns are the 7 development phases (Preclin through Launched), and cells are heat-colored by asset count. Clicking a row opens the existing detail panel with phase breakdown bars and an asset list. A left-sidebar controls panel (modeled on `BullseyeControlsPanelComponent`) provides GROUP BY, COUNT toggle, READ summary, STATS, and LEGEND sections. A freshness indicator shows when the data was last updated.

Interactive prototype: `docs/prototypes/competitive-density-matrix.html`

## Motivation

### The scatter chart does not fit the data shape

Both axes of the positioning scatter are near-discrete: phases are 7 fixed rows, competitor counts are small integers. Bubbles stack at the same grid cell and require jitter to separate, which undermines positional accuracy. The heatmap table handles discrete axes natively with no overlap.

### Color was redundant with position

The scatter's teal-to-red gradient encoded (x + y) / 2, restating what the axes already showed. In the density matrix, color encodes cell density (how many assets at a given phase within a given grouping), while row and column position encode the grouping dimension and phase. Two channels, two data dimensions.

### A table is faster for the CI analyst's real question

The core question is "where is the white space vs. competitive saturation?" A table sorted by total count, filterable to late-stage phases, answers that in seconds. The scatter required hovering individual bubbles to read truncated labels.

### The bullseye already covers the deep dive

Once a user identifies an interesting row, they click through to the bullseye for the cross-positional view. The scatter was an intermediate step that the matrix replaces with a more scannable surface.

## Goals

- Heatmap table replacing the SVG scatter chart. Rows = grouping dimension, columns = 7 phases, cells = heat-colored counts.
- Sortable by total count, latest phase, or name.
- Left-sidebar controls panel following the `BullseyeControlsPanelComponent` pattern (GROUP BY, COUNT, READ, STATS, LEGEND).
- READ section auto-generates competitive insight: most crowded group + best sparse opportunity.
- Density color scale in LEGEND: brand-50 through red-200 (8 levels, quantile-distributed).
- Freshness indicator ("Updated Xh ago") in the matrix header.
- Phase distribution bars and asset list in the detail panel (reuse existing `PositioningDetailPanelComponent`).
- `phase_counts` and `latest_event_date` added to the RPC response.
- Delete the old scatter chart code (`positioning-chart.component.ts`).

## Non-Goals

- Opportunity zone highlighting on cells (decided: skip for now, keep density colors pure).
- Group-level annotations (MOA groupings are transient aggregation results, not stable entities; intelligence attaches to assets and trials, which are already surfaceable per-asset in the detail panel).
- Export to PNG/slide (follow timeline export pattern, separate spec).
- Changes to the bullseye or timeline views.
- New routes or URL structure (positioning routes carry over unchanged).
- Saved/named views or historical snapshot comparison.

## Design

### RPC extension: phase_counts and latest_event_date

Extend `get_positioning_data` to include two new fields on each bubble:

**phase_counts:** A JSONB object mapping each phase to the count of distinct assets whose `highest_phase` matches that phase within the group. This count always reflects assets regardless of `p_count_unit`. The `unit_count` field and Total column continue to reflect the selected count unit (products/trials/companies), but `phase_counts` is always asset-based because it drives the heatmap cell coloring and the "how many drugs are at P3" question.

```json
{
  "phase_counts": {
    "PRECLIN": 3, "P1": 4, "P2": 6, "P3": 8,
    "P4": 1, "APPROVED": 5, "LAUNCHED": 4
  }
}
```

SQL addition in the `bubble_agg` CTE, via a sub-aggregate that groups `asset_groups.highest_phase`:

```sql
(select jsonb_object_agg(hp, cnt)
 from (
   select ag2.highest_phase as hp, count(distinct ag2.asset_id) as cnt
   from asset_groups ag2
   where ag2.group_key = ag.group_key
   group by ag2.highest_phase
 ) sub
) as phase_counts
```

**latest_event_date:** A top-level field on the RPC response (not per-bubble) representing the most recent `updated_at` timestamp across all assets in the result set. Used for the freshness indicator.

```json
{
  "grouping": "moa",
  "count_unit": "products",
  "latest_event_date": "2026-05-27T14:30:00Z",
  "bubbles": [...]
}
```

### Model changes

```typescript
// Update PositioningBubble in landscape.model.ts
export interface PositioningBubble {
  // ... existing fields ...
  phase_counts: Partial<Record<RingPhase, number>>;
}

// Update PositioningData in landscape.model.ts
export interface PositioningData {
  // ... existing fields ...
  latest_event_date: string | null;
}
```

`phase_counts` is `Partial<Record>` because phases with zero assets are omitted from the JSONB object. The component treats missing keys as 0.

### Shell integration: removing redundant controls

**Remove dimension sub-tabs from top bar in positioning mode.** The landscape shell currently renders 5 positioning sub-tabs (MOA, Indication, MOA+Ind, Company, ROA) in the top bar. These duplicate the sidebar GROUP BY buttons and serve no additional purpose. In the `subTabEffect`, skip pushing sub-tabs when `viewMode === 'positioning'`. The sidebar GROUP BY buttons navigate to the correct URL segment (same as the sub-tabs did), keeping URL-driven state intact.

**Hide filter-bar count unit toggle in positioning mode.** The filter bar currently shows a count unit toggle for positioning. The sidebar COUNT section replaces it. In `landscape-filter-bar.component.html`, hide the count unit controls when `viewMode() === 'positioning'`.

### Component architecture

```
PositioningViewComponent (existing, updated)
  ├── DensityControlsPanelComponent (new, left sidebar)
  │     ├── GROUP BY section (positioningGrouping signal, navigates to URL segment)
  │     ├── COUNT section (countUnit signal)
  │     ├── READ section (computed from bubbles)
  │     ├── STATS section (group count, asset count)
  │     └── LEGEND section (phase dots + density scale)
  ├── DensityMatrixComponent (new, replaces PositioningChartComponent)
  │     └── <table> with heat-colored cells
  └── PositioningDetailPanelComponent (existing, unchanged)
```

### DensityMatrixComponent

Inputs:
- `bubbles: PositioningBubble[]`
- `countUnit: CountUnit`
- `selectedBubble: PositioningBubble | null`
- `sortField: 'total' | 'phase' | 'name'`
- `sortDir: 'asc' | 'desc'`
- `latestEventDate: string | null`

Outputs:
- `rowClick: PositioningBubble`
- `sortChange: { field: string; dir: 'asc' | 'desc' }`

Template: HTML `<table>` with `role="grid"`. One `<tr>` per bubble. Phase columns render `<td>` cells with heat-colored backgrounds. A Total column sums across phases. A header row above the table shows the matrix title, subtitle, and freshness indicator.

**Heat intensity (8 levels, quantile-distributed):**

Compute intensity from non-zero cell values across the entire matrix:
1. Collect all non-zero `phase_counts` values into a flat array.
2. Sort ascending.
3. Divide into 8 equal quantile buckets.
4. Each bucket maps to an intensity level with its own background/text color pair.

Color ramp:
- Levels 1-3: brand-50, brand-100, brand-200 (teal family, sparse)
- Levels 4-5: amber-50, amber-100 (transitional)
- Levels 6-8: red-50, red-100, red-200 (saturated)

Text colors follow the background for AA contrast: brand-700/800/900 for levels 1-3, amber-600 for 4-5, red-600/700 for 6-8.

Fallback: when fewer than 8 distinct values exist, use linear mapping (value / max * 8, clamped to 1-8).

Empty cells show a 3px slate-200 dot (centered, no text).

Selected row: brand-50 background, 3px brand-600 left border (same pattern as bullseye dot selection).

**Sorting:**
- **Total** (default): sum of phase_counts values, descending.
- **Latest phase**: highest_phase_rank descending, then total descending.
- **Name**: alphabetical by label, ascending.

Column headers show phase dots matching `PHASE_COLOR` and abbreviated labels (Pre, P1, P2, P3, P4, App, Lnch).

Row label: group name (full text, ellipsis overflow at 180px) with a subtitle showing company count (`competitor_count`).

**Freshness indicator:** Rendered in the matrix header row. Computes relative time from `latestEventDate` input.
- < 1 hour: "Updated just now"
- 1-23 hours: "Updated Xh ago"
- 1-6 days: "Updated Xd ago"
- 7+ days: "Updated [date]"

### DensityControlsPanelComponent

Modeled on `BullseyeControlsPanelComponent`. 260px left sidebar, white background, 1px right border.

**GROUP BY section:**
- Uses `POSITIONING_GROUPING_OPTIONS` from landscape.model.ts.
- On click, navigates to the corresponding URL segment (e.g., `/positioning/by-moa`) via `Router.navigate`, which triggers the shell's URL sync to update the `positioningGrouping` signal. This keeps URL and state in sync, matching how the old top-bar sub-tabs worked.
- Active button: brand-50 background, brand-600 border, brand-700 text.

**COUNT section:**
- Three-way toggle: Assets | Trials | Companies.
- Sets `state.countUnit` signal.
- Segmented button style (connected, no gap between buttons).

**READ section:**
- Computed from the bubbles array.
- Format: `**PD-1/PD-L1** most crowded (31 assets) | **KRAS G12C** sparse at P3`
- Logic:
  1. Most crowded: bubble with highest unit_count. Show name + count.
  2. Sparse opportunity: bubble with lowest non-zero unit_count and highest_phase_rank >= P2. Show name + phase.
- Falls back to empty if fewer than 2 bubbles.

**STATS section:**
- Two stat boxes in a 2-column grid.
- Left: group count (bubbles.length) labeled "groups".
- Right: total asset count (sum of unit_counts) labeled by countUnit.

**LEGEND section:**
- Phase dots with labels (same as bullseye legend: Preclinical through Launched).
- Divider.
- Density color scale strip (8 swatches from brand-50 to red-200) with "1" and "max" end labels.
- Dot indicator for empty cells.

### PositioningViewComponent changes

- Remove `PositioningChartComponent` and `PositioningTooltipComponent` from imports.
- Add `DensityMatrixComponent` and `DensityControlsPanelComponent`.
- Layout: wrap in a flex container with the controls panel on the left (same pattern as `landscape.component.html` wraps `BullseyeControlsPanelComponent`).
- Remove `hoveredBubble`, `tooltipX`, `tooltipY` signals (no tooltip in table view).
- Add `sortField` and `sortDir` signals for table sorting.
- Keep `selectedBubble` signal (row click sets it, same as bubble click did).
- Remove the `chartBubbles` computed that replaced competitor_count for company grouping (the matrix reads phase_counts directly).
- Remove `xAxisLabel` computed (not used in matrix view).

### Files deleted

| File | Reason |
|------|--------|
| `positioning-chart.component.ts` | SVG scatter chart replaced by density matrix |
| `positioning-tooltip.component.ts` | Hover tooltip not needed for table rows |

### Files created

| File | Purpose |
|------|---------|
| `density-matrix.component.ts` | Heatmap table component |
| `density-matrix.component.spec.ts` | Tests for heatmap table |
| `density-controls-panel.component.ts` | Left sidebar (GROUP BY, COUNT, READ, STATS, LEGEND) |
| `density-controls-panel.component.spec.ts` | Tests for controls panel |

### Files modified

| File | Change |
|------|--------|
| `supabase/migrations/YYYYMMDD_positioning_phase_counts.sql` | Add phase_counts + latest_event_date to RPC |
| `src/client/src/app/core/models/landscape.model.ts` | Add `phase_counts` to `PositioningBubble`, `latest_event_date` to `PositioningData` |
| `src/client/src/app/core/services/landscape.service.ts` | Pass through new fields from RPC response |
| `src/client/src/app/features/landscape/positioning-view.component.ts` | Swap chart for matrix, add controls panel, update layout |
| `src/client/src/app/features/landscape/landscape-shell.component.ts` | Remove positioning sub-tabs from top bar |
| `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` | Hide count unit toggle in positioning mode |

### Routing

No routing changes. The existing `/positioning/by-moa`, `/positioning/by-indication`, etc. routes continue to work. The sidebar GROUP BY buttons navigate to the same URL segments the top-bar sub-tabs used. The URL segment drives the grouping signal via the shell's URL sync effect.

### Accessibility

- `role="grid"` on the `<table>` element.
- `aria-label` on the table describing the visualization.
- Each row is keyboard-focusable (`tabindex="0"`), navigable with arrow keys.
- Enter/Space on a row selects it (equivalent to click).
- Escape deselects the current row.
- Column headers use `role="columnheader"` with sort state announced via `aria-sort`.
- Heat cell values are always present in the DOM as text content (not visually hidden), so screen readers announce the count.
- Empty cells: the dot is decorative (`aria-hidden="true"`), the cell has `aria-label="0"`.
- Selected row: `aria-selected="true"`.
- Color is never the sole information channel: the numeric count in each cell conveys the same data the heat color reinforces.

## Related capabilities

- **Bullseye view**: detail panel footer links to bullseye; grouping dimensions overlap.
- **Timeline export**: export pattern to follow for future density matrix export (separate spec).
- **Asset-level intelligence in detail panel**: the density detail panel shows assets per group. Each asset already has `intelligence_count` in the bullseye flow. A follow-up can wire `get_intelligence_notes_for_asset` into the positioning detail panel so clicking an asset shows its intelligence notes inline, matching bullseye. This does not require new entity types or tables. Primary intelligence attaches to assets and trials (stable entities), not to MOA/indication grouping keys (transient aggregation results).

## Phased roadmap

This spec is the first of three that bring the positioning view to parity with the bullseye:

1. **Competitive Density Matrix** (this spec): replace scatter with heatmap, add controls panel, freshness indicator.
2. **Positioning detail panel intelligence**: wire asset-level intelligence into the positioning detail panel (small, no schema changes, follow bullseye pattern).
3. **Density matrix export**: PNG/slide export with title, legend, branding (follow timeline export pattern).

## Tasks

```yaml
tasks:
  - id: rpc
    title: Add phase_counts and latest_event_date to get_positioning_data RPC
    domain: database
    description: |
      New migration extending the get_positioning_data RPC to include:
      1. phase_counts: a JSONB object on each bubble mapping each phase
         (PRECLIN through LAUNCHED) to the count of distinct assets whose
         highest_phase matches. Always counts assets regardless of
         p_count_unit (the count unit only affects unit_count / Total).
      2. latest_event_date: a top-level field on the response with the
         most recent updated_at across all assets in the result set.
      Computed via sub-aggregates in the bubble_agg CTE.
    files:
      - supabase/migrations/YYYYMMDDHHMMSS_positioning_phase_counts.sql
    estimate: medium
    depends_on: []
    verify: |
      supabase db reset && supabase db advisors --local --type all

  - id: model
    title: Update models and service for new RPC fields
    domain: frontend
    description: |
      Add phase_counts: Partial<Record<RingPhase, number>> to
      PositioningBubble. Add latest_event_date: string | null to
      PositioningData. Update LandscapeService.getPositioningData to
      pass through both fields from the RPC response.
    files:
      - src/client/src/app/core/models/landscape.model.ts
      - src/client/src/app/core/services/landscape.service.ts
    estimate: small
    depends_on: [rpc]
    verify: |
      cd src/client && ng lint && ng build

  - id: matrix
    title: Create DensityMatrixComponent with tests
    domain: frontend
    description: |
      New component rendering the heatmap table. Inputs: bubbles,
      countUnit, selectedBubble, sortField, sortDir, latestEventDate.
      Outputs: rowClick, sortChange. HTML table with role="grid". Phase
      columns with heat-colored cells (8 intensity levels, quantile-
      distributed). Total column. Sortable headers. Empty cell dot
      markers. Selected row with brand-600 left border. Full keyboard
      navigation. Matrix header with title, subtitle, freshness
      indicator. Vitest spec covering: row rendering, intensity class
      computation, sort behavior, row selection, keyboard nav, empty
      state, freshness text formatting.
    files:
      - src/client/src/app/features/landscape/density-matrix.component.ts
      - src/client/src/app/features/landscape/density-matrix.component.spec.ts
    estimate: large
    depends_on: [model]
    verify: |
      cd src/client && ng lint && ng build && npx vitest run density-matrix --reporter=verbose

  - id: controls
    title: Create DensityControlsPanelComponent with tests
    domain: frontend
    description: |
      New component modeled on BullseyeControlsPanelComponent. 260px left
      sidebar with GROUP BY (navigates to URL segment via Router),
      COUNT toggle (countUnit signal), READ (computed crowding +
      opportunity summary), STATS (group count + asset count), LEGEND
      (phase dots + density color scale). Inputs: bubbles, grouping,
      countUnit. Vitest spec covering: GROUP BY button active state,
      COUNT toggle signal update, READ text generation logic, STATS
      display with various bubble counts.
    files:
      - src/client/src/app/features/landscape/density-controls-panel.component.ts
      - src/client/src/app/features/landscape/density-controls-panel.component.spec.ts
    estimate: medium
    depends_on: [model]
    verify: |
      cd src/client && ng lint && ng build && npx vitest run density-controls --reporter=verbose

  - id: view
    title: Update PositioningViewComponent, shell, filter bar, and delete old chart
    domain: frontend
    description: |
      1. PositioningViewComponent: replace chart + tooltip with matrix +
         controls panel. Update layout to flex with controls on left.
         Remove hover signals, add sort signals. Delete
         positioning-chart.component.ts and positioning-tooltip.component.ts.
      2. LandscapeShellComponent: skip pushing positioning sub-tabs to
         top bar (sidebar GROUP BY replaces them).
      3. LandscapeFilterBarComponent: hide count unit toggle when
         viewMode === 'positioning' (sidebar COUNT replaces it).
    files:
      - src/client/src/app/features/landscape/positioning-view.component.ts
      - src/client/src/app/features/landscape/landscape-shell.component.ts
      - src/client/src/app/features/landscape/landscape-filter-bar.component.ts
      - src/client/src/app/features/landscape/positioning-chart.component.ts (delete)
      - src/client/src/app/features/landscape/positioning-tooltip.component.ts (delete)
    estimate: medium
    depends_on: [matrix, controls]
    verify: |
      cd src/client && ng lint && ng build
```
