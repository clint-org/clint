# Competitive Positioning Scatter

## Overview

A scatter chart visualization that plots competitive landscape data as bubbles on fixed axes: **X = competitor count** (how many companies are active in that space) and **Y = highest development phase reached** (maturity). The user picks what defines a bubble via a grouping dimension selector (MOA, Therapeutic Area, MOA+TA pair, Company, or ROA).

This view answers three questions at a glance:
1. **Competitive density** -- crowded upper-right means many companies in late-stage development.
2. **White space** -- sparse lower-left means few competitors in early stages: potential opportunity.
3. **Company positioning** -- clicking a bubble reveals which companies occupy that intersection.

The chart lives as a third ViewMode alongside Timeline and Bullseye in the landscape shell, sharing the same filter bar and state service.

## Design Decisions

| Decision | Choice | Rationale |
|---|---|---|
| Axes | Fixed: X = competitor count, Y = highest phase | Built-in strategic narrative; no cognitive overhead choosing axes |
| Bubble definition | User-selectable grouping dimension | Flexible without being overwhelming |
| Bubble size | Uniform (no size encoding) | Keeps chart clean; count shown as label |
| Bubble color | Red/blue ocean zone gradient | Reinforces strategic read through position-based color |
| Quadrant labels | None | Authority through restraint; color gradient speaks for itself |
| Interaction | Hover tooltip + click detail panel | Consistent with bullseye interaction pattern |
| Counting unit | Flexible (products default, switch to trials/companies) | Supports different analytical perspectives |
| Data aggregation | New Supabase RPC | Follows codebase convention; keeps client lean |

## Data Layer

### New RPC: `get_positioning_data()`

```sql
create or replace function public.get_positioning_data(
  p_space_id                    uuid,
  p_grouping                    text default 'moa',
  p_count_unit                  text default 'products',
  p_company_ids                 uuid[] default null,
  p_product_ids                 uuid[] default null,
  p_therapeutic_area_ids        uuid[] default null,
  p_mechanism_of_action_ids     uuid[] default null,
  p_route_of_administration_ids uuid[] default null,
  p_phases                      text[] default null,
  p_recruitment_statuses        text[] default null,
  p_study_types                 text[] default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
```

**Parameters:**

- `p_space_id` -- required, scopes to tenant workspace
- `p_grouping` -- one of: `'moa'`, `'therapeutic-area'`, `'moa+therapeutic-area'`, `'company'`, `'roa'`
- `p_count_unit` -- one of: `'products'`, `'trials'`, `'companies'`
- All filter parameters match the existing `get_dashboard_data()` signature

**Return shape:**

```json
{
  "grouping": "moa+therapeutic-area",
  "count_unit": "products",
  "bubbles": [
    {
      "label": "PD-1 Inhibitors + NSCLC",
      "group_keys": {
        "moa_id": "uuid",
        "moa_name": "PD-1 Inhibitors",
        "therapeutic_area_id": "uuid",
        "therapeutic_area_name": "NSCLC"
      },
      "competitor_count": 7,
      "highest_phase": "APPROVED",
      "highest_phase_rank": 5,
      "unit_count": 12,
      "products": [
        {
          "id": "uuid",
          "name": "Keytruda",
          "company_id": "uuid",
          "company_name": "Merck",
          "highest_phase": "LAUNCHED",
          "highest_phase_rank": 6,
          "trial_count": 4
        }
      ]
    }
  ]
}
```

**SQL logic by grouping type:**

| Grouping | JOIN path | GROUP BY |
|---|---|---|
| `moa` | products -> product_mechanisms_of_action -> mechanisms_of_action | moa.id |
| `therapeutic-area` | products -> trials -> therapeutic_areas | ta.id |
| `moa+therapeutic-area` | products -> product_moa + trials -> ta | (moa.id, ta.id) |
| `company` | products -> companies | company.id |
| `roa` | products -> product_routes_of_administration -> routes_of_administration | roa.id |

**Computed columns:**

- `competitor_count` = `COUNT(DISTINCT c.id)` -- distinct companies in the group
- `highest_phase` = phase with `MAX(phase_rank)` across all trial_phases in the group
- `highest_phase_rank` = the numeric rank (0-6, PRECLIN-LAUNCHED)
- `unit_count` = count of the selected unit:
  - `products`: `COUNT(DISTINCT p.id)`
  - `trials`: `COUNT(DISTINCT t.id)`
  - `companies`: same as `competitor_count`
- `products` = JSON array of products in the group, each with company info and trial count

**Filters:** Applied as `WHERE` clauses identical to the pattern in `get_dashboard_data()`. Products must have at least one trial with a non-OBS phase to appear (OBS-only products are excluded from the scatter since they have no meaningful phase position).

**Exclusion rules by grouping:**
- `moa`: products without any MOA assignment are excluded
- `therapeutic-area`: products without any trial linked to a therapeutic area are excluded
- `moa+therapeutic-area`: products must have both an MOA assignment AND at least one trial with a therapeutic area. Each (MOA, TA) pair the product participates in generates a separate bubble. A product with 2 MOAs and 1 TA contributes to 2 bubbles.
- `company`: all products are included (every product has a company)
- `roa`: products without any ROA assignment are excluded

### Migration

Single migration file: `YYYYMMDDHHMMSS_create_positioning_data_function.sql`

## Component Architecture

### Integration with Landscape Shell

**Model changes** (`landscape.model.ts`):

```typescript
// Extend ViewMode
export type ViewMode = 'timeline' | 'bullseye' | 'positioning';

// Add to VIEW_MODE_OPTIONS
{ label: 'Positioning', value: 'positioning' }

// New types
export type PositioningGrouping =
  | 'moa'
  | 'therapeutic-area'
  | 'moa+therapeutic-area'
  | 'company'
  | 'roa';

export type CountUnit = 'products' | 'trials' | 'companies';

export interface PositioningBubble {
  label: string;
  group_keys: Record<string, string>;
  competitor_count: number;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  unit_count: number;
  products: PositioningProduct[];
}

export interface PositioningProduct {
  id: string;
  name: string;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
}

export interface PositioningData {
  grouping: PositioningGrouping;
  count_unit: CountUnit;
  bubbles: PositioningBubble[];
}

export const POSITIONING_GROUPING_OPTIONS: { label: string; value: PositioningGrouping }[] = [
  { label: 'Mechanism of Action', value: 'moa' },
  { label: 'Therapy Area', value: 'therapeutic-area' },
  { label: 'MOA + Therapy Area', value: 'moa+therapeutic-area' },
  { label: 'Company', value: 'company' },
  { label: 'Route of Administration', value: 'roa' },
];

export const COUNT_UNIT_OPTIONS: { label: string; value: CountUnit }[] = [
  { label: 'Products', value: 'products' },
  { label: 'Trials', value: 'trials' },
  { label: 'Companies', value: 'companies' },
];
```

**State service** (`landscape-state.service.ts`):

Add two new signals:
```typescript
readonly positioningGrouping = signal<PositioningGrouping>('moa+therapeutic-area');
readonly countUnit = signal<CountUnit>('products');
```

**Landscape service** (`landscape.service.ts`):

Add method:
```typescript
async getPositioningData(
  spaceId: string,
  grouping: PositioningGrouping,
  countUnit: CountUnit,
  filters: LandscapeFilters
): Promise<PositioningData> {
  const { data, error } = await this.supabase.client.rpc('get_positioning_data', {
    p_space_id: spaceId,
    p_grouping: grouping,
    p_count_unit: countUnit,
    p_company_ids: filters.companyIds.length ? filters.companyIds : null,
    p_product_ids: filters.productIds.length ? filters.productIds : null,
    p_therapeutic_area_ids: filters.therapeuticAreaIds.length ? filters.therapeuticAreaIds : null,
    p_mechanism_of_action_ids: filters.mechanismOfActionIds.length ? filters.mechanismOfActionIds : null,
    p_route_of_administration_ids: filters.routeOfAdministrationIds.length ? filters.routeOfAdministrationIds : null,
    p_phases: filters.phases.length ? filters.phases : null,
    p_recruitment_statuses: filters.recruitmentStatuses.length ? filters.recruitmentStatuses : null,
    p_study_types: filters.studyTypes.length ? filters.studyTypes : null,
  });
  if (error) throw error;
  return data as PositioningData;
}
```

### Shell changes (`landscape-shell.component.ts`):

- `onViewModeChange()`: add `'positioning'` case that navigates to `[...spaceBase(), 'positioning']`
- `syncStateFromUrl()`: detect `positioning` segment and set `viewMode` accordingly
- Show grouping and count-unit dropdowns when `viewMode() === 'positioning'` (in the header row, same pattern as the bullseye dimension selector)

### Routing (`app.routes.ts`):

Add under the landscape shell children:
```typescript
{
  path: 'positioning',
  loadComponent: () =>
    import('./features/landscape/positioning-view.component').then(
      (m) => m.PositioningViewComponent,
    ),
},
```

### New Components

**`positioning-view.component.ts`** -- page component

- Injects `LandscapeStateService`, `LandscapeService`, route params
- Uses `resource()` to fetch `getPositioningData()` with reactive inputs (spaceId, grouping, countUnit, filters)
- Manages selected bubble state for detail panel
- Layout: scatter chart on the left, detail panel on the right (same grid as bullseye)

**`positioning-chart.component.ts`** -- SVG scatter chart (presenter)

Inputs:
- `bubbles: PositioningBubble[]`
- `width: number`, `height: number`

Outputs:
- `bubbleHover: PositioningBubble | null`
- `bubbleClick: PositioningBubble`

Rendering:
- Y-axis: fixed phase ticks (PRECLIN, P1, P2, P3, P4, APPROVED, LAUNCHED) -- evenly spaced, labeled on the left
- X-axis: competitor count (1, 2, 3, ... max) -- linear scale, labeled at the bottom
- Each bubble: `<circle>` at the computed (x, y) position
  - Uniform radius (e.g., 20px)
  - `<text>` label centered inside or offset if too long (truncate with tooltip for full name)
  - Color: interpolated from teal (low competitor + low phase) to warm red (high competitor + high phase) based on normalized position. Use a 2D color gradient:
    - Bottom-left (low X, low Y): `#0d9488` (teal-600, brand color)
    - Top-right (high X, high Y): `#dc2626` (red-600)
    - Interpolation: blend both axes into a single hue shift
- Jitter: when multiple bubbles land at the same (X, Y) cell, offset them slightly to avoid overlap. Use a simple grid-snap with nudge algorithm (similar to bullseye's `jitterAngles`).
- Axis lines: thin slate-200, tick labels in slate-400 monospace. No grid lines (data density principle -- only draw what carries meaning).
- Empty state: if no bubbles, show centered "No data matches current filters" message.

**`positioning-detail-panel.component.ts`** -- side panel (presenter)

Inputs:
- `bubble: PositioningBubble | null`

Displays when a bubble is clicked:
- Header: bubble label, competitor count, highest phase badge, unit count
- Product list: sorted by highest_phase_rank descending, each row shows product name, company name, phase badge, trial count
- Close button (X) to deselect

Style: matches the existing `bullseye-detail-panel` layout conventions (same padding, typography, and structure).

**`positioning-tooltip.component.ts`** -- hover tooltip (presenter)

Inputs:
- `bubble: PositioningBubble`
- `x: number`, `y: number` (screen coordinates)

Shows on hover:
- Bubble label (bold)
- "{N} competitors, highest phase: {PHASE}"
- "{unit_count} {count_unit}"
- Top 3 company names if the product list is available
- "Click for details"

Positioned near the cursor, avoids viewport edges.

### Filter Bar Changes

The filter bar already renders view-specific controls via `@if (viewMode() === '...')`. Add a block for positioning mode:

- Show **Grouping** dropdown (the `POSITIONING_GROUPING_OPTIONS`)
- Show **Count Unit** toggle (SelectButton with Products / Trials / Companies)
- Hide the zoom-level and spoke-mode controls (those are timeline/bullseye-specific)
- All existing dimension filters (company, product, TA, MOA, ROA, phase, recruitment status, study type) remain visible and functional

## Color Algorithm

The bubble color encodes the "ocean" zone as a 2D gradient based on normalized position:

```typescript
function bubbleColor(competitorCount: number, phaseRank: number, maxCompetitors: number): string {
  const xNorm = competitorCount / maxCompetitors;  // 0..1
  const yNorm = phaseRank / 6;                     // 0..1 (PRECLIN=0, LAUNCHED=6)
  const intensity = (xNorm + yNorm) / 2;           // 0..1 combined

  // Interpolate hue from teal (168) to red (0) through amber
  const hue = 168 - (intensity * 168);
  const saturation = 60 + (intensity * 15);        // 60-75%
  const lightness = 45 - (intensity * 10);         // 45-35%

  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}
```

This produces:
- **Bottom-left (sparse, early):** teal/cyan tones -- brand color, opportunity signal
- **Middle zone:** amber/yellow -- transitional
- **Top-right (crowded, mature):** warm red -- competitive saturation signal
- All colors meet WCAG AA contrast against white background for the label text (white text inside bubbles, verified at each lightness level)

## Accessibility

- All bubbles are keyboard-focusable (`tabindex="0"`) and navigate via arrow keys
- Focus ring matches the bubble's color for visibility
- `aria-label` on each bubble: "{label}: {competitor_count} competitors, highest phase {phase}, {unit_count} {count_unit}"
- `role="img"` on the SVG container with `aria-label` describing the chart
- Axis labels use `<text>` elements with `role="presentation"` (decorative, the data is in the bubbles)
- Detail panel receives focus when opened, Escape to close
- Tooltip shows on focus as well as hover
- Color is never the sole information channel -- position encodes the same data that color reinforces

## File Summary

| File | Type | Purpose |
|---|---|---|
| `supabase/migrations/YYYYMMDDHHMMSS_create_positioning_data_function.sql` | Migration | New RPC function |
| `src/client/src/app/core/models/landscape.model.ts` | Model | Add types, extend ViewMode |
| `src/client/src/app/core/services/landscape.service.ts` | Service | Add `getPositioningData()` |
| `src/client/src/app/features/landscape/landscape-state.service.ts` | Service | Add grouping + countUnit signals |
| `src/client/src/app/features/landscape/landscape-shell.component.ts` | Component | Add positioning view mode handling |
| `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` | Component | Add positioning-specific controls |
| `src/client/src/app/features/landscape/landscape-filter-bar.component.html` | Template | Add grouping/count-unit dropdowns |
| `src/client/src/app/features/landscape/positioning-view.component.ts` | Component | Page component (new) |
| `src/client/src/app/features/landscape/positioning-chart.component.ts` | Component | SVG scatter chart (new) |
| `src/client/src/app/features/landscape/positioning-detail-panel.component.ts` | Component | Side panel (new) |
| `src/client/src/app/features/landscape/positioning-tooltip.component.ts` | Component | Hover tooltip (new) |
| `src/client/src/app/app.routes.ts` | Routes | Add positioning route |
