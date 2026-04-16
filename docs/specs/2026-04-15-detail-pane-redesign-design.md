# Detail Pane Redesign

**Date:** 2026-04-15
**Status:** Approved

## Problem

The detail panes across Timeline, Bullseye, and Positioning views have information hierarchy issues, missing data points, and inconsistent cross-navigation. From the perspective of a pharma executive or CI analyst:

- **Timeline:** Company/Product ("Program") and Trial are buried below Description and Source URL. The first question when clicking a marker is "Whose drug? What trial?" -- not "What's the description?"
- **Bullseye:** Trial recruitment status exists in the data model (`BullseyeTrial.recruitment_status`) but is not rendered. "Recruiting" vs "Completed" vs "Terminated" radically changes the competitive read.
- **Positioning:** The product list is a dead end -- no clickable products, no cross-navigation to other views, no phase distribution summary. This is the most significant functional gap.

## Changes by View

### 1. Timeline -- Marker Detail Drawer

**File:** `src/client/src/app/shared/components/marker-detail-content.component.ts`

Reorder the sections so the competitive identity comes first:

| Position | Before | After |
|----------|--------|-------|
| 1 | Title | Title |
| 2 | Date + Status | **Program (Company / Product)** |
| 3 | Description | **Trial (name, phase, recruitment)** |
| 4 | Source URL | Date + Status |
| 5 | Trial | Description |
| 6 | Program | Source URL |
| 7 | Upcoming markers | Upcoming markers |
| 8 | Related events | Related events |

Additional fixes:
- **Source URL:** Truncate to domain name only (e.g., `sec.gov`) with external-link icon. Full URL remains as the `href`. Extract domain via `new URL(url).hostname.replace('www.', '')`.
- **Header marker icon:** Replace the plain colored dot with the actual marker shape SVG (circle, diamond, triangle, square, flag) matching `marker_type_shape` and `marker_type_color`. Outline style for projected markers, filled for actual -- same rendering as the tooltip. Applied to both the landscape drawer header and the catalysts detail panel header.
- **Projection type badge:** Show the specific projection type ("Stout estimate", "Company guidance", "Primary source estimate") as an amber badge below the title. Replaces the binary Projected/Confirmed with granular detail matching the tooltip. The Date & Status section still shows Projected/Confirmed as a secondary indicator.
- **No longer expected badge:** Show a slate badge when `no_longer_expected` is true.
- **Company logo:** Display the company logo (20x20, rounded) next to the company name in the Program section, consistent with the timeline grid's company column.
- **Related events category:** Change from `text-slate-300` to `text-slate-500` for readable contrast.

**Superset rule:** The detail pane must display every field the tooltip shows. The tooltip is a quick-glance summary; the detail pane is the expanded view. Any field added to the tooltip in the future must also be added to the detail pane.

### 2. Bullseye -- Product Detail Panel

**Files:**
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.html`
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts`

Changes:
- **Recruitment status on trial rows:** Append `trial.recruitment_status` to each trial's metadata line (after phase). Use teal-600 for active statuses, slate-400 for terminal ones. The field already exists on `BullseyeTrial` -- just not rendered.
- **Format marker dates:** Pipe `marker.event_date` through Angular `DatePipe` with `'mediumDate'` format instead of displaying the raw API string. Requires adding `DatePipe` to imports.

### 3. Positioning -- Competitive Group Detail Panel

**File:** `src/client/src/app/features/landscape/positioning-detail-panel.component.ts`

This view gets the most changes:

**Header:** Change label from `"SELECTED"` to `"COMPETITIVE GROUP"`.

**Label separator:** Change `parts.join(' + ')` to `parts.join(' / ')` in the `fullLabel` computed signal. The " + " reads as combination therapy; " / " reads as grouping intersection.

**Summary stats:** Stack vertically instead of inline with 1px dividers:
```
12 competitors
18 products
```
Remove the "Highest phase" stat line entirely.

**Phase breakdown (new section):** Add a compact inline phase distribution below summary stats. Compute from `bubble.products` grouped by `highest_phase`. Render as small tinted chips: `LAUNCHED 2  P3 3  P2 5  P1 4  PRE 3`. Reuse `PHASE_COLOR` from landscape model. Skip phases with 0 count.

**Generic names on products:** Show INN/generic name in parentheses after the product name. This requires adding `generic_name` to the `PositioningProduct` interface and the backend query that builds positioning bubbles.

**Clickable products:** Each product row becomes a button that emits a new `openProduct` output with the product ID. The parent component navigates to the bullseye view filtered to that product (same pattern the bullseye uses for "Open in timeline").

**Cross-navigation action:** Add an "Open in bullseye" button at the panel bottom, matching the bullseye panel's "Open in timeline" pattern. Emits a new `openInBullseye` output. The parent navigates to the bullseye view scoped to the relevant dimension.

## Data Model Changes

### `CatalystDetail` (catalyst.model.ts)

Add `projection`, `no_longer_expected`, and `company_logo_url` to the `CatalystDetail.catalyst` intersection type (not the base `Catalyst` interface, since `get_key_catalysts` list RPC does not return these fields):
```typescript
export interface CatalystDetail {
  catalyst: Catalyst & {
    recruitment_status: string | null;
    projection: string;             // NEW -- 'stout' | 'company' | 'primary' | 'actual'
    no_longer_expected: boolean;     // NEW
    company_logo_url: string | null; // NEW
  };
  upcoming_markers: UpcomingMarker[];
  related_events: RelatedEvent[];
}
```

### `get_catalyst_detail` (Supabase RPC function)

Add three fields to the `jsonb_build_object` in the main query:
1. `'projection', m.projection`
2. `'no_longer_expected', m.no_longer_expected`
3. `'company_logo_url', co.logo_url`

Migration: `supabase/migrations/20260415180000_catalyst_detail_add_projection_logo.sql`

### `PositioningProduct` (landscape.model.ts)

Add `generic_name`:
```typescript
export interface PositioningProduct {
  id: string;
  name: string;
  generic_name: string | null;  // NEW
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
}
```

### Backend (Supabase RPC function)

The `get_positioning_data` function (created in `supabase/migrations/20260412130000_create_positioning_data_function.sql`) needs `p.generic_name` added in two places:
1. The `eligible_products` CTE: add `p.generic_name` to the SELECT
2. The `jsonb_build_object` in the final aggregation: add `'generic_name', pg.generic_name`

This is a SELECT change in a new migration, not a schema change.

### `CatalystDetail` -- no changes needed

The `marker_type_color` for the header dot is already available on the `Catalyst` interface as `marker_type_color`.

## Scope Boundaries

**In scope:**
- Section reordering (timeline)
- Rendering existing but unused data (bullseye recruitment status)
- New computed views (positioning phase breakdown)
- Cross-navigation (positioning to bullseye, product click-through)
- Label/separator/formatting fixes
- One model field addition (`generic_name` on `PositioningProduct`)
- Marker shape icon in drawer/panel headers (replacing plain colored dot)
- Projection type badges, no-longer-expected badge, company logo in detail pane
- Detail pane as superset of tooltip data

**Out of scope:**
- Therapeutic area/indication display (requires deeper data model work)
- Bullseye empty state (already solid, no changes)
- Tooltip changes (tooltips are fine as-is)
- New backend endpoints or schema migrations beyond SELECT changes

## Files Affected

| File | Change Type |
|------|-------------|
| `shared/components/marker-detail-content.component.ts` | Reorder template sections, truncate source URL, fix category contrast, projection badges, no-longer-expected badge, company logo |
| `features/landscape/marker-detail-drawer.component.ts` | Replace colored dot with marker shape SVG icon in header |
| `features/catalysts/catalyst-detail-panel.component.ts` | Replace colored dot with marker shape SVG icon in header |
| `features/landscape/bullseye-detail-panel.component.html` | Add recruitment status to trial rows |
| `features/landscape/bullseye-detail-panel.component.ts` | Add DatePipe import |
| `features/landscape/positioning-detail-panel.component.ts` | Header label, separator, stacked stats, phase breakdown, generic names, clickable products, cross-nav action |
| `core/models/catalyst.model.ts` | Add `projection`, `no_longer_expected`, `company_logo_url` to `CatalystDetail` |
| `core/models/landscape.model.ts` | Add `generic_name` to `PositioningProduct` |
| `supabase/migrations/20260415170000_...` | Add `generic_name` to `get_positioning_data` RPC |
| `supabase/migrations/20260415180000_...` | Add `projection`, `no_longer_expected`, `company_logo_url` to `get_catalyst_detail` RPC |
| `core/services/landscape.service.ts` | No change needed (passes through RPC response) |
