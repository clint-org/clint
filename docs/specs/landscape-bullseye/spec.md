---
id: spec-2026-002
title: Landscape Bullseye Chart
slug: landscape-bullseye
status: draft
created: 2026-04-11
updated: 2026-04-11
---

# Landscape Bullseye Chart

## Summary

A new feature that displays a competitive landscape view of all products in a selected therapeutic area (TA), arranged as a bullseye of concentric development-phase rings with companies radiating outward as spokes. Each dot is a product; its position on the ring matches the highest phase it has reached for that TA. An integrated right-side detail panel shows product details, trials in the TA, and recent markers. Complements the existing horizontal timeline dashboard by offering a phase-state snapshot instead of a time-based view.

Visual reference: PatSnap Synapse bullseye chart.

## Goals

- Give pharma executives and BD teams an at-a-glance competitive read for any TA in their space
- Surface "who is where" across the development pipeline in a single screen
- Reuse existing Clint data (companies, products, trials, trial_phases, trial_markers) without requiring new user-entered metadata beyond three new phase values
- Link back to existing trial and product detail pages so the bullseye is an entry point, not a silo
- Maintain the brand's information-first, data-dense aesthetic (Bloomberg Terminal, Evaluate Pharma)

## Non-Goals (v1)

- Export to PNG, PDF, or PowerPoint
- Chem/bio/other product-type filtering (would require a new `product_type` field)
- Marker-badge indicators directly on dots (e.g., a small flag if the product has a recent regulatory filing)
- Ring-change animations when switching TA
- Dimming non-matching companies on an in-view company filter
- Keyboard arrow-key navigation between adjacent dots (Tab-order navigation only)
- Showing OBS (observational) trials in their own dashed ring band
- A dedicated "competitive landscape" entry point from the trial-detail or product-list pages (follow-up)

---

## Architecture Overview

```
┌─────────────────────────┐    ┌────────────────────────────────┐
│  Angular 19 SPA         │    │  Supabase                      │
│  features/landscape/    │───▶│                                │
│                         │◀───│  RPC get_landscape_index       │
│  - LandscapeIndex       │    │  RPC get_bullseye_data         │
│  - Landscape            │    │                                │
│  - BullseyeChart (SVG)  │    │  Tables used (read-only):      │
│  - BullseyeDetailPanel  │    │    companies, products,        │
│  - TaSelector           │    │    trials, trial_phases,       │
│                         │    │    trial_markers, marker_types,│
│  core/services/         │    │    therapeutic_areas           │
│  - LandscapeService     │    │                                │
└─────────────────────────┘    └────────────────────────────────┘
```

**Rendering:** custom inline SVG inside Angular standalone components. No new rendering dependencies. Matches the existing pattern used by `features/dashboard/grid/phase-bar.component.ts` and `features/dashboard/grid/marker.component.ts`.

**Data flow:** component → `LandscapeService` → `supabase.rpc(...)` → Postgres function (security invoker, RLS-enforced). No direct table queries for the chart data.

**State:** Angular 19 signals and `resource()` for fetching. URL route + query params are the source of truth for TA and selected product, so state survives reload and deep-linking works.

---

## Data Model

### Migration 1 — extend `phase_type` values

Current valid values (per the clinical-trial-dashboard spec): `P1 | P2 | P3 | P4 | OBS`.

Add: `PRECLIN | APPROVED | LAUNCHED`.

Implementation: update the check constraint on `trial_phases.phase_type`. New accepted set:

```sql
alter table public.trial_phases
  drop constraint if exists trial_phases_phase_type_check;

alter table public.trial_phases
  add constraint trial_phases_phase_type_check
  check (phase_type in ('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED','OBS'));
```

Semantically:

| phase_type | Meaning                                   | Ring position (dev rank) |
|------------|-------------------------------------------|--------------------------|
| PRECLIN    | Research stage, before first-in-human     | 0 (outer rim)            |
| P1         | First-in-human, safety                    | 1                        |
| P2         | Efficacy / dose-finding                   | 2                        |
| P3         | Pivotal                                   | 3                        |
| P4         | Post-marketing trials                     | 4                        |
| APPROVED   | Regulatory approval received              | 5                        |
| LAUNCHED   | Commercial launch                         | 6 (center)               |
| OBS        | Observational (excluded from bullseye)    | n/a                      |

**APPROVED and LAUNCHED as phases, not a separate product-status column.** Rationale: (a) approval and launch have dates, and `trial_phases` already handles date ranges; (b) the existing horizontal timeline renders phases as colored bars out of the box with no new code; (c) "the state of a product in a TA" stays in one place. Trade-off: semantically a "trial phase" is stretched a bit — approval and launch are product states that only loosely belong to a single trial. In practice users will record them on the pivotal trial that caused the approval.

### Migration 2 — `get_bullseye_data` RPC

```sql
create or replace function public.get_bullseye_data(
  p_space_id uuid,
  p_therapeutic_area_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
  -- Returns:
  -- {
  --   therapeutic_area: { id, name, abbreviation },
  --   ring_order: ['PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'],
  --   companies: [
  --     { id, name, display_order, highest_phase_rank,
  --       products: [
  --         { id, name, generic_name, logo_url, company_id, company_name,
  --           highest_phase, highest_phase_rank,
  --           trials: [ { id, name, identifier, sample_size, status, phase } ],
  --           recent_markers: [ { id, event_date, marker_type_name, icon, shape, color } ]
  --         }
  --       ]
  --     }
  --   ]
  -- }
  --
  -- Filtering rules:
  -- - Only include products that have at least one trial in the given TA
  --   with a non-OBS, non-null trial_phases row.
  -- - highest_phase is the max non-OBS phase_type (by rank) across that
  --   product's TA-relevant trials.
  -- - recent_markers is the three most recent trial_markers joined via
  --   trials.product_id, scoped to trials in the given TA.
  -- - Companies with zero qualifying products are omitted.
  -- - Companies are sorted by highest_phase_rank desc, then name asc.
  -- - security invoker ensures RLS constrains rows to the caller's space.
$$;
```

The function returns a single `jsonb` so the Angular app can hydrate in one round trip.

### Migration 3 — `get_landscape_index` RPC

```sql
create or replace function public.get_landscape_index(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
  -- Returns:
  -- [
  --   { therapeutic_area: { id, name, abbreviation },
  --     product_count,          -- products in this TA with phase data
  --     company_count,          -- distinct companies in this TA
  --     highest_phase_present,  -- e.g. "LAUNCHED" | "P3" | null
  --     products_missing_phase  -- count of products with trials but no phase rows
  --   }
  -- ]
  --
  -- Returns every TA in the space, including TAs with zero products
  -- (product_count = 0, company_count = 0, highest_phase_present = null).
  -- The index grid renders all of them so users can see the full set
  -- of tracked TAs, including empty ones. Sorted alphabetically by
  -- therapeutic_area.name.
$$;
```

Used by the landscape index grid so we don't have to call `get_bullseye_data` once per TA.

### Migration 4 — index for highest-phase rollup

```sql
create index if not exists idx_trial_phases_trial_phase
  on public.trial_phases (trial_id, phase_type);
```

Keeps the rollup cheap as a space grows. Existing FK indexes cover the other joins.

---

## Frontend Design

### Routes

Added as children of the existing `t/:tenantId/s/:spaceId` block:

| Path                                              | Component                  |
|---------------------------------------------------|----------------------------|
| `/t/:tenantId/s/:spaceId/landscape`               | `LandscapeIndexComponent`  |
| `/t/:tenantId/s/:spaceId/landscape/:therapeuticAreaId` | `LandscapeComponent`  |
| `/t/:tenantId/s/:spaceId/landscape/:therapeuticAreaId?product=<id>` | `LandscapeComponent` (selection via query param) |

Both routes are behind `authGuard` like the rest of the space routes.

A "Landscape" link is added next to the existing "Dashboard" link in the header component.

### Feature module layout

```
src/client/src/app/features/landscape/
  landscape-index.component.ts       # TA grid at /landscape
  landscape-index.component.html
  landscape.component.ts             # bullseye page at /landscape/:therapeuticAreaId
  landscape.component.html
  bullseye-chart.component.ts        # pure SVG chart
  bullseye-chart.component.html
  bullseye-detail-panel.component.ts # right-side panel
  bullseye-detail-panel.component.html
  ta-selector.component.ts           # dropdown at top of bullseye page
```

### Service

```
src/client/src/app/core/services/landscape.service.ts
  getLandscapeIndex(spaceId: string): Promise<LandscapeIndexEntry[]>
    -> supabase.rpc('get_landscape_index', { p_space_id: spaceId })

  getBullseyeData(spaceId: string, therapeuticAreaId: string): Promise<BullseyeData>
    -> supabase.rpc('get_bullseye_data', { p_space_id: spaceId, p_therapeutic_area_id: therapeuticAreaId })
```

Follows the existing `DashboardService` pattern: destructures `{ data, error }`, throws on error, returns a typed promise.

### Models

`src/client/src/app/core/models/landscape.model.ts`:

```ts
export type RingPhase =
  | 'PRECLIN' | 'P1' | 'P2' | 'P3' | 'P4' | 'APPROVED' | 'LAUNCHED';

export const RING_ORDER: RingPhase[] = [
  'PRECLIN', 'P1', 'P2', 'P3', 'P4', 'APPROVED', 'LAUNCHED',
];

export const RING_DEV_RANK: Record<RingPhase, number> = {
  PRECLIN: 0, P1: 1, P2: 2, P3: 3, P4: 4, APPROVED: 5, LAUNCHED: 6,
};

export interface BullseyeCompany {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}

export interface BullseyeProduct {
  id: string;
  name: string;
  generic_name: string | null;
  logo_url: string | null;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trials: BullseyeTrial[];
  recent_markers: BullseyeMarker[];
}

export interface BullseyeTrial {
  id: string;
  name: string;
  identifier: string | null;
  sample_size: number | null;
  status: string | null;
  phase: RingPhase | 'OBS' | null;
}

export interface BullseyeMarker {
  id: string;
  event_date: string;
  marker_type_name: string;
  icon: string | null;
  shape: string;
  color: string;
}

export interface BullseyeData {
  therapeutic_area: { id: string; name: string; abbreviation: string | null };
  ring_order: RingPhase[];
  companies: BullseyeCompany[];
}

export interface LandscapeIndexEntry {
  therapeutic_area: { id: string; name: string; abbreviation: string | null };
  product_count: number;
  company_count: number;
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}
```

### State (inside `LandscapeComponent`)

```ts
readonly spaceId = signal('');
readonly taId = signal('');                                 // route param
readonly selectedProductId = signal<string | null>(null);   // ?product=<id>
readonly hoveredProductId = signal<string | null>(null);    // transient

readonly data = resource({
  request: () => ({ spaceId: this.spaceId(), taId: this.taId() }),
  loader: async ({ request }) =>
    this.landscapeService.getBullseyeData(request.spaceId, request.taId),
});

readonly allProducts = computed(() =>
  this.data.value()?.companies.flatMap(c => c.products) ?? []
);

readonly selectedProduct = computed(() => {
  const id = this.selectedProductId();
  if (!id) return null;
  return this.allProducts().find(p => p.id === id) ?? null;
});
```

Effects keep `selectedProductId` in sync with the `?product=` query param in both directions. Changing the `:therapeuticAreaId` route param clears the product selection (because the product may not exist in the new TA).

### Component boundaries

| Component | Inputs | Outputs | Responsibility |
|-----------|--------|---------|----------------|
| `LandscapeIndexComponent` | — | — | Fetch index via service, render grid of TA cards with product/company counts and phase badge; route to bullseye on click. |
| `LandscapeComponent` | — | — | Own TA + selection state, compose chart + detail panel, sync URL. |
| `BullseyeChartComponent` | `data: BullseyeData`, `selectedProductId: string \| null` | `productHover(id \| null)`, `productClick(id)`, `backgroundClick()` | Pure SVG rendering. No data fetching. No routing. |
| `BullseyeDetailPanelComponent` | `data: BullseyeData`, `selectedProduct: BullseyeProduct \| null` | `openTrial(id)`, `openCompany(id)`, `openInTimeline(productId, taId)` | Pure presentation. Parent handles navigation. |
| `TaSelectorComponent` | `therapeuticAreas: TherapeuticArea[]`, `selectedId: string` | `select(taId)` | PrimeNG `p-select` dropdown. |

### Chart geometry

All coordinates are SVG user space. `viewBox="0 0 1000 1000"`.

**Constants:**

```ts
const CX = 500, CY = 500;
const INNER_RADIUS = 60;           // center disc (holds TA name + summary)
const OUTER_RADIUS = 420;          // outermost data ring
const LABEL_MARGIN = 40;           // reserved for company labels outside outer ring
const RINGS = 7;
```

**Ring radii** — innermost is LAUNCHED (dev rank 6), outermost is PRECLIN (dev rank 0). This matches the PatSnap reference ("winner at the bullseye"):

```ts
function ringRadius(devRank: number): number {
  const ringRank = (RINGS - 1) - devRank;  // LAUNCHED (6) -> 0, PRECLIN (0) -> 6
  const step = (OUTER_RADIUS - INNER_RADIUS) / (RINGS - 1);
  return INNER_RADIUS + step * ringRank;
}
```

**Company angle assignment** — companies laid out clockwise from 12 o'clock, ordered by `highest_phase_rank` descending (most-advanced companies at the top), then alphabetical:

```ts
function companyAngle(index: number, total: number): number {
  const deg = -90 + (360 / total) * index;
  return deg * Math.PI / 180;
}
```

Each company occupies a sector of angular width `2π / total`. The spoke is drawn at the sector center.

**Dot positioning** (single product on a spoke):

```ts
function dotXY(companyIndex: number, totalCompanies: number, devRank: number) {
  const a = companyAngle(companyIndex, totalCompanies);
  const r = ringRadius(devRank);
  return { x: CX + r * Math.cos(a), y: CY + r * Math.sin(a) };
}
```

**Overlap jitter** — multiple products at the same ring on the same spoke get angular jitter within the company's sector, up to 4 dots. Beyond 4, collapse to 3 dots + a "+N" pill.

```ts
function jitterAngles(centerAngle: number, sectorWidth: number, k: number): number[] {
  if (k === 1) return [centerAngle];
  const maxOffset = Math.min(sectorWidth * 0.35, 0.25);  // cap ~14°
  return Array.from({ length: k }, (_, i) =>
    centerAngle + maxOffset * (2 * i / (k - 1) - 1)
  );
}
```

**Company label transform** — labels sit just outside `OUTER_RADIUS + 24`, rotated to follow the spoke angle, flipped so text never reads upside-down:

```ts
function companyLabelTransform(angleRad: number) {
  const x = CX + (OUTER_RADIUS + 24) * Math.cos(angleRad);
  const y = CY + (OUTER_RADIUS + 24) * Math.sin(angleRad);
  const deg = angleRad * 180 / Math.PI;
  const flip = deg > 90 || deg < -90;
  const rotate = flip ? deg + 180 : deg;
  const anchor = flip ? 'end' : 'start';
  return { x, y, rotate, anchor };
}
```

**Ring labels** — stacked at the 12 o'clock gutter (`x = CX + 6`), reading outward `LAUNCHED → APPROVED → P4 → P3 → P2 → P1 → PRECLIN`. Small uppercase mono text, slate-500. Drawn under dots so dots always read on top.

**Styling:**

- Dot fill: `primary-500` (`#0d9488`). Single uniform color — position is the signal.
- Dot stroke: 1.5px white for separation against rings.
- Dot radius: 8 default, 11 hover, 12 + halo selected. Halo is a second concentric circle at r+6, 2px `primary-600` stroke.
- Ring stroke: `#cbd5e1` (slate-300), 1.5px, no fill.
- Outermost ring: `#94a3b8` (slate-400), 2px (acts as an anchor).
- Innermost disc: no stroke; the TA name and count summary sit inside it.
- Selected state: non-selected dots fade to `opacity: 0.55` so focus stays on the selection.

**Responsive sizing:** wrap the SVG in a square container with `aspect-ratio: 1/1; width: 100%; max-width: 720px;`. SVG uses `width="100%" height="100%" preserveAspectRatio="xMidYMid meet"`. No JS resize math.

**Render order (by draw sequence):**

1. Rings
2. Spokes
3. Ring labels
4. Company labels
5. Dots (unselected → hovered → selected) so selected always reads on top

### Page layout

```
┌ header ─────────────────────────────────────────────────────┐
├ breadcrumb: Landscape > [TA Selector ▾]                    ┤
├───────────────────────────────────┬────────────────────────┤
│                                   │ SELECTED / empty state │
│   bullseye chart                  │                        │
│   (square, responsive, max 720px) │ Farxiga                │
│                                   │ dapagliflozin          │
│                                   │                        │
│                                   │ COMPANY                │
│                                   │ AstraZeneca →          │
│                                   │                        │
│                                   │ HIGHEST PHASE IN HFPEF │
│                                   │ P3 ●                   │
│                                   │                        │
│                                   │ TRIALS IN THIS TA (3)  │
│                                   │ • DAPA-HF ...          │
│                                   │ • DELIVER ...          │
│                                   │ ...                    │
│                                   │                        │
│                                   │ RECENT MARKERS         │
│                                   │ ◇ 2026-02-14 ...       │
│                                   │                        │
│                                   │ [ Open in timeline → ] │
└───────────────────────────────────┴────────────────────────┘
```

CSS grid: `grid-template-columns: minmax(0, 1fr) 320px;` at desktop, stacked at narrower widths.

### Interactions

**Hover:**

- Chart emits `productHover(id)` on dot `mouseenter` / `focus` and `productHover(null)` on `mouseleave` / `blur`.
- PrimeNG `p-tooltip` bound to each dot. Content: `{productName} ({genericName}) — {highestPhase}`.
- Hovered dot nudges from radius 8 to 11.
- Hover does not touch the side panel or URL.

**Click / keyboard select:**

- `productClick(id)` → parent calls `selectedProductId.set(id)`.
- Selection syncs to URL via an effect calling `router.navigate([], { queryParams: { product: id }, queryParamsHandling: 'merge' })`.
- Each dot is a `<circle tabindex="0" role="button" aria-label="{productName}, {companyName}, {phase}">`. Enter / Space → select. Escape on the page → clear selection.
- Clicking the chart background (not a dot) → clear selection.
- Selected dot: radius 12, halo ring at r+6, fill `primary-600`. Other dots fade to `opacity: 0.55`.

**URL sync (deterministic):**

- Route: `/t/:tenantId/s/:spaceId/landscape/:therapeuticAreaId?product=<id>`
- On mount, if `?product` is in the URL and the product exists in the loaded data, set `selectedProductId()`. If the product isn't present, clear the query param.

**TA selector:**

- PrimeNG `p-select` single-select. Options populated from `TherapeuticAreaService` (which already exists).
- On change, `router.navigate(['../', newTaId], { queryParamsHandling: '' })` — drops `?product` because the selected product may not exist in the new TA.
- The TA name is also rendered inside the chart's inner disc as a visual anchor.

### Side panel states

**Loading:** skeleton placeholders — grey bar for name, grey block for company, bars for trials.

**Empty (data loaded, nothing selected):**

```
CLICK A DRUG TO SEE DETAILS

13 products across 8 companies
──────────────────────────────
LAUNCHED        2
APPROVED        1
P4              0
P3              5
P2              3
P1              2
PRECLIN         0
```

Clicking a ring row in this histogram highlights that ring in the chart (pulses the ring stroke to `primary-500` for 1.5s, dims dots not on that ring).

**Selected:** full detail, as the page layout sketch above shows. The trials list in the panel shows up to 8 trials by default; if the product has more, the list truncates with a "Show all N trials" toggle that expands the list in place. Recent markers are capped at 3 (enforced by the RPC).

**No data (zero companies in TA):**

```
No products tracked in {TA name} yet.
Add products and trials to see them here.
[ Manage products → ]
```

### Link destinations from the panel

| Click target | Destination |
|--------------|-------------|
| Company name | `/t/:tenantId/s/:spaceId/manage/companies` |
| Trial row    | `/t/:tenantId/s/:spaceId/manage/trials/:trialId` |
| "Open in timeline →" | `/t/:tenantId/s/:spaceId?productIds=<id>&therapeuticAreaIds=<taId>` |

### Index page layout

The `/landscape` index shows a grid of TA cards, one per row in `getLandscapeIndex`:

```
┌──────────────────────────┐  ┌──────────────────────────┐
│ Heart Failure HFpEF      │  │ Chronic Kidney Disease   │
│ HFpEF                    │  │ CKD                      │
│                          │  │                          │
│ 13 products · 8 companies│  │  9 products · 5 companies│
│ Highest phase: LAUNCHED  │  │ Highest phase: APPROVED  │
│                          │  │                          │
│ 2 products missing phase │  │                          │
└──────────────────────────┘  └──────────────────────────┘
```

Cards route to `/landscape/:taId` on click. Card styling matches the existing manage-page shells for visual consistency.

### Edge cases

1. **Single company in the TA** — one spoke at 12 o'clock, sector width = full circle. Overlap jitter still works.
2. **Many companies (> 12)** — labels shrink from 11px → 9px and switch to abbreviations (first word, max 12 chars). Above 24 companies, sort by `product_count desc`, truncate to the top 24, and show a warning: "Showing 24 of N companies — narrow the TA to see the rest."
3. **Single product in the whole TA** — chart renders with one spoke, one dot; the center disc still reads "1 product, 1 company."
4. **Same product on two companies** — schema-prevented (product belongs to one company); no handling needed.
5. **Product has `trial_phases` but all are old** — rollup is "highest phase ever reached in this TA", not current phase. Matches the PatSnap reference's semantics.
6. **Product has trials but no phases** — excluded from the chart per Q6 default. The landscape index grid surfaces the count via `products_missing_phase` so the user sees the data gap.
7. **RPC latency > 1s** — skeletons render during load. No spinner.
8. **User prefers reduced motion** — skip the "fade unselected dots to 0.55" transition; selection still works, just snaps instead of fading.

### Accessibility

- Every dot is a focusable `<circle role="button" tabindex="0" aria-label="{productName}, {companyName}, {phase}">`.
- Tab order: companies in the clockwise order they appear, products within a company in ring order (most-advanced → least-advanced).
- Focus indicator: a sibling `<circle>` drawn behind the focused dot at r+4, 2px `primary-500` stroke. Does not rely on browser default outline (which is unreliable on SVG).
- Chart wrapping `<svg role="img" aria-label="Competitive landscape bullseye for {TA name}. {N} products across {M} companies.">`.
- `<desc>` element inside the `<svg>`: "Concentric rings represent development phases from Launched at the center to Preclinical at the outer edge. Companies are arranged clockwise from the top."
- Side panel has `aria-live="polite"` so screen readers announce selection changes.
- Color is never the sole signal — position carries the information, and ring / company labels are text.
- WCAG 2.1 AA contrast for all text (slate-500 or darker on white) and the dot fill (`#0d9488` on white) at the sizes used.
- Escape key clears selection from anywhere on the page.

### Adjacent changes required for "Open in timeline"

The "Open in timeline →" button navigates to the existing dashboard with `?productIds=` and `?therapeuticAreaIds=` query params. `DashboardComponent` currently does not parse query params for filters. A small addition (~15 lines) in its constructor: read `route.snapshot.queryParamMap`, seed `filters` accordingly, and leave the existing filter panel untouched. Scoped inside this spec.

### Adjacent changes to phase color map

`phase-bar.component.ts` has color mappings for `P1..P4 | OBS`. Add entries for `PRECLIN`, `APPROVED`, `LAUNCHED`:

- `PRECLIN` — slate-400 (`#94a3b8`): dimmer than P1 to signal "before trials"
- `APPROVED` — violet-500 (`#8b5cf6`): distinct from any existing phase color
- `LAUNCHED` — teal-600 (`#0d9488`): the brand hero color, reserved for the strongest state

Confirm exact hex against `docs/brand.md` and `primeng-theme.ts` during implementation — may need a shuffle if P4 currently occupies violet. Scoped inside this spec.

---

## Tasks

```yaml
tasks:
  - id: L1
    title: "Database migration - extend phase_type check constraint"
    description: |
      Create a new Supabase migration that drops and recreates the check
      constraint on trial_phases.phase_type to add PRECLIN, APPROVED, and
      LAUNCHED alongside the existing P1-P4 and OBS values.
    files:
      - create: supabase/migrations/YYYYMMDDHHmmss_extend_phase_types.sql
    dependencies: []
    verification: "supabase db reset"

  - id: L2
    title: "Database migration - get_landscape_index RPC"
    description: |
      Create get_landscape_index(p_space_id uuid) returning jsonb with
      one entry per TA in the space: therapeutic_area, product_count,
      company_count, highest_phase_present, products_missing_phase.
      security invoker. Sorted alphabetically by TA name.
    files:
      - create: supabase/migrations/YYYYMMDDHHmmss_create_landscape_index_function.sql
    dependencies: [L1]
    verification: "supabase db reset && psql test query"

  - id: L3
    title: "Database migration - get_bullseye_data RPC"
    description: |
      Create get_bullseye_data(p_space_id, p_therapeutic_area_id)
      returning the hierarchical jsonb (companies > products with
      highest_phase rollup, trials, recent_markers). security invoker.
      Filtering rules per spec Data Model section.
    files:
      - create: supabase/migrations/YYYYMMDDHHmmss_create_bullseye_data_function.sql
    dependencies: [L1]
    verification: "supabase db reset && psql test query"

  - id: L4
    title: "Database migration - performance index for phase rollup"
    description: |
      Create idx_trial_phases_trial_phase on trial_phases (trial_id, phase_type).
    files:
      - create: supabase/migrations/YYYYMMDDHHmmss_add_trial_phase_index.sql
    dependencies: [L1]
    verification: "supabase db reset"

  - id: L5
    title: "LandscapeService and landscape models"
    description: |
      Create LandscapeService with getLandscapeIndex and getBullseyeData.
      Create landscape.model.ts with RingPhase, RING_ORDER, RING_DEV_RANK,
      BullseyeCompany, BullseyeProduct, BullseyeTrial, BullseyeMarker,
      BullseyeData, LandscapeIndexEntry interfaces.
      Follow the existing DashboardService pattern.
    files:
      - create: src/client/src/app/core/services/landscape.service.ts
      - create: src/client/src/app/core/models/landscape.model.ts
    dependencies: [L2, L3]
    verification: "cd src/client && ng lint && ng build"

  - id: L6
    title: "Chart geometry helpers (pure functions)"
    description: |
      Create pure functions for the bullseye math: ringRadius,
      companyAngle, dotXY, jitterAngles, companyLabelTransform.
      Export from a single geometry module with constants.
      Unit-testable; no Angular deps.
    files:
      - create: src/client/src/app/features/landscape/bullseye-geometry.ts
    dependencies: []
    verification: "cd src/client && ng lint && ng build"

  - id: L7
    title: "BullseyeChartComponent (pure SVG)"
    description: |
      Standalone component. Inputs: data (BullseyeData),
      selectedProductId (string | null). Outputs: productHover,
      productClick, backgroundClick. Renders rings, spokes, ring labels,
      company labels, dots. Uses geometry helpers from L6.
      PrimeNG p-tooltip for hover tooltips. Accessibility per spec.
    files:
      - create: src/client/src/app/features/landscape/bullseye-chart.component.ts
      - create: src/client/src/app/features/landscape/bullseye-chart.component.html
    dependencies: [L5, L6]
    verification: "cd src/client && ng lint && ng build"

  - id: L8
    title: "BullseyeDetailPanelComponent"
    description: |
      Standalone component. Inputs: data, selectedProduct.
      Outputs: openTrial, openCompany, openInTimeline.
      Loading, empty, selected, and no-data states per spec.
      Clickable ring histogram in empty state with ring-highlight event.
    files:
      - create: src/client/src/app/features/landscape/bullseye-detail-panel.component.ts
      - create: src/client/src/app/features/landscape/bullseye-detail-panel.component.html
    dependencies: [L5]
    verification: "cd src/client && ng lint && ng build"

  - id: L9
    title: "TaSelectorComponent"
    description: |
      Standalone component wrapping PrimeNG p-select, bound to the list
      of therapeutic areas in the space. Emits (select) on change.
    files:
      - create: src/client/src/app/features/landscape/ta-selector.component.ts
    dependencies: []
    verification: "cd src/client && ng lint && ng build"

  - id: L10
    title: "LandscapeComponent (bullseye page)"
    description: |
      Standalone page component. Reads route params (tenantId, spaceId,
      therapeuticAreaId) and query param (product). Uses resource() to
      fetch bullseye data via LandscapeService. Owns selection state,
      URL sync, keyboard Escape handler. Composes TaSelector, BullseyeChart,
      and BullseyeDetailPanel. Handles navigation events from the panel.
    files:
      - create: src/client/src/app/features/landscape/landscape.component.ts
      - create: src/client/src/app/features/landscape/landscape.component.html
    dependencies: [L7, L8, L9]
    verification: "cd src/client && ng lint && ng build"

  - id: L11
    title: "LandscapeIndexComponent (TA grid)"
    description: |
      Standalone page component. Fetches landscape index via resource().
      Renders a grid of TA cards showing product_count, company_count,
      highest_phase_present, and a subtle hint when products_missing_phase > 0.
      Card click routes to /landscape/:taId. Empty state when zero TAs.
    files:
      - create: src/client/src/app/features/landscape/landscape-index.component.ts
      - create: src/client/src/app/features/landscape/landscape-index.component.html
    dependencies: [L5]
    verification: "cd src/client && ng lint && ng build"

  - id: L12
    title: "Add landscape routes and header nav entry"
    description: |
      Register lazy-loaded routes for /landscape and /landscape/:therapeuticAreaId
      as children of t/:tenantId/s/:spaceId. Add a "Landscape" link in
      the header nav next to "Dashboard". Apply authGuard.
    files:
      - modify: src/client/src/app/app.routes.ts
      - modify: src/client/src/app/core/layout/header.component.ts (or equivalent nav component)
    dependencies: [L10, L11]
    verification: "cd src/client && ng lint && ng build"

  - id: L13
    title: "Extend trial-phase form and phase color map"
    description: |
      Add PRECLIN, APPROVED, LAUNCHED to the trial-phase form dropdown
      (in the existing phase form component). Extend phase-bar.component.ts
      color map with entries for the three new phases. Confirm hex values
      against docs/brand.md.
    files:
      - modify: src/client/src/app/features/manage/trials/phase-form.component.ts (or the actual form)
      - modify: src/client/src/app/features/dashboard/grid/phase-bar.component.ts
    dependencies: [L1]
    verification: "cd src/client && ng lint && ng build"

  - id: L14
    title: "Dashboard query-param filter reader"
    description: |
      Add URL query-param parsing to DashboardComponent for productIds
      and therapeuticAreaIds. On mount, read route.snapshot.queryParamMap
      and seed the filters signal. Enables the 'Open in timeline' button
      from the bullseye detail panel.
    files:
      - modify: src/client/src/app/features/dashboard/dashboard.component.ts
    dependencies: []
    verification: "cd src/client && ng lint && ng build"

  - id: L15
    title: "Geometry unit tests"
    description: |
      Unit tests for ringRadius, companyAngle, dotXY, jitterAngles,
      companyLabelTransform. Pure function tests with known inputs/outputs.
      Particular attention to edge cases: single company, single product,
      overlap of 4 products, label flip at bottom hemisphere.
    files:
      - create: src/client/src/app/features/landscape/bullseye-geometry.spec.ts
    dependencies: [L6]
    verification: "cd src/client && ng test --watch=false"

  - id: L16
    title: "RPC tests"
    description: |
      SQL-level tests for get_landscape_index and get_bullseye_data
      against the demo seed data: correct highest_phase rollup,
      OBS exclusion, products_missing_phase count, RLS enforcement
      (user in space A cannot see space B).
    files:
      - create: supabase/tests/landscape_rpc.test.sql
    dependencies: [L2, L3]
    verification: "supabase db reset && run tests"
```

---

## Open Questions

1. **Phase color shuffle.** `APPROVED` is proposed as violet-500 and `P4` is already mapped to violet in the brand guide. Need to pick a distinct color for one of them during implementation (L13). Options: move `APPROVED` to indigo-500 (but brand says "avoid generic indigo"), or move `P4` to a muted teal-slate blend.
2. **Single-abbreviation fallback** for > 12 companies may produce duplicate abbreviations (e.g., two companies starting with "Bio..."). Implementation should fall back to the full name with a shrunk font if abbreviations collide.
3. **Index grid card order.** Currently alphabetical by TA name. Consider a small badge or sort option ("most active first") if users ask.

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| 24+ company TAs overflow the label rim | Cap at 24 with a warning; sort by `product_count desc`. Follow-up: a full "dense mode" variant. |
| `get_bullseye_data` slow with large spaces | Index on `trial_phases(trial_id, phase_type)` (L4); RPC returns a single jsonb so only one round trip. |
| URL query-param sync fights with route param change | Single source of truth: route change clears `?product`, effect only writes back the param after data loads and the product is confirmed present. |
| Phase color reshuffle breaks existing dashboard | Keep the existing P1-P4 colors unchanged; only add the three new entries. Violet collision resolved in L13 before merge. |
| `APPROVED` / `LAUNCHED` as trial_phases is semantically loose | Document the convention in the trial-phase form helper text: "Use APPROVED on the pivotal trial that led to approval." Revisit as a product-status column if users push back. |
| OBS exclusion may surprise users with OBS-only products | The index grid's `products_missing_phase` counter catches this case when the only trial is OBS — surfacing "your only trial in this TA is OBS" as a data gap. |
