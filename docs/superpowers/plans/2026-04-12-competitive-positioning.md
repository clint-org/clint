# Competitive Positioning Scatter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a "Positioning" scatter chart as a third ViewMode in the landscape shell that plots competitive landscape bubbles on fixed axes (X = competitor count, Y = highest phase) with user-selectable grouping dimension.

**Architecture:** New Supabase RPC `get_positioning_data()` aggregates products into bubbles by grouping dimension, returning competitor counts and phase maturity. A new Angular page component (`positioning-view`) hosts an SVG scatter chart and a detail panel, integrated into the existing landscape shell alongside Timeline and Bullseye views. Shared filters and state service are reused.

**Tech Stack:** PostgreSQL/Supabase RPC, Angular 19 (standalone components, signals, resource()), PrimeNG 19, Tailwind CSS v4, inline SVG rendering.

**Spec:** `docs/specs/competitive-positioning/spec.md`

**Verification:** `cd src/client && ng lint && ng build`

---

### Task 1: Supabase RPC Migration

**Files:**
- Create: `supabase/migrations/20260412130000_create_positioning_data_function.sql`

- [ ] **Step 1: Create the migration file**

Create the RPC function. It handles 5 grouping modes (`moa`, `therapeutic-area`, `moa+therapeutic-area`, `company`, `roa`) and 3 count units (`products`, `trials`, `companies`). Filters match the existing `get_dashboard_data()` pattern.

```sql
-- migration: 20260412130000_create_positioning_data_function
-- purpose: create get_positioning_data() RPC for the competitive positioning scatter view.
--          aggregates products into bubbles by a user-selected grouping dimension,
--          returning competitor count, highest phase, and embedded product list.
-- affected objects: public.get_positioning_data (function)

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
as $$
declare
  v_bubbles jsonb;
begin
  -- normalize empty arrays to null
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_product_ids = '{}' then p_product_ids := null; end if;
  if p_therapeutic_area_ids = '{}' then p_therapeutic_area_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  -- phase rank lookup
  -- PRECLIN=0, P1=1, P2=2, P3=3, P4=4, APPROVED=5, LAUNCHED=6

  with phase_rank_map(phase_name, phase_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  -- base product set: products in this space with at least one non-OBS trial phase
  eligible_products as (
    select distinct p.id as product_id, p.name as product_name,
           p.company_id, c.name as company_name
    from public.products p
    join public.companies c on c.id = p.company_id
    join public.trials t on t.product_id = p.id
    join public.trial_phases tp on tp.trial_id = t.id
    join phase_rank_map prm on prm.phase_name = tp.phase_type
    where p.space_id = p_space_id
      and tp.phase_type <> 'OBS'
      -- apply filters
      and (p_company_ids is null or p.company_id = any(p_company_ids))
      and (p_product_ids is null or p.id = any(p_product_ids))
      and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
      and (p_mechanism_of_action_ids is null or exists (
        select 1 from public.product_mechanisms_of_action pm
        where pm.product_id = p.id and pm.moa_id = any(p_mechanism_of_action_ids)
      ))
      and (p_route_of_administration_ids is null or exists (
        select 1 from public.product_routes_of_administration pr
        where pr.product_id = p.id and pr.roa_id = any(p_route_of_administration_ids)
      ))
      and (p_phases is null or tp.phase_type = any(p_phases))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
  ),

  -- per-product highest phase
  product_highest_phase as (
    select ep.product_id, ep.product_name, ep.company_id, ep.company_name,
           max(prm.phase_rank) as highest_phase_rank,
           (array_agg(prm.phase_name order by prm.phase_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count
    from eligible_products ep
    join public.trials t on t.product_id = ep.product_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.phase_type <> 'OBS'
    join phase_rank_map prm on prm.phase_name = tp.phase_type
    where t.product_id = ep.product_id
      and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
      and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
      and (p_study_types is null or t.study_type = any(p_study_types))
    group by ep.product_id, ep.product_name, ep.company_id, ep.company_name
  ),

  -- grouping keys per product (depends on p_grouping)
  product_groups as (
    select
      php.product_id, php.product_name, php.company_id, php.company_name,
      php.highest_phase_rank, php.highest_phase, php.trial_count,
      case p_grouping
        when 'moa' then m.id::text
        when 'therapeutic-area' then ta.id::text
        when 'moa+therapeutic-area' then m.id::text || '|' || ta.id::text
        when 'company' then php.company_id::text
        when 'roa' then r.id::text
      end as group_key,
      case p_grouping
        when 'moa' then m.name
        when 'therapeutic-area' then ta.name
        when 'moa+therapeutic-area' then m.name || ' + ' || ta.name
        when 'company' then php.company_name
        when 'roa' then r.name
      end as group_label,
      case p_grouping
        when 'moa' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'therapeutic-area' then jsonb_build_object('therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'moa+therapeutic-area' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'therapeutic_area_id', ta.id, 'therapeutic_area_name', ta.name)
        when 'company' then jsonb_build_object('company_id', php.company_id, 'company_name', php.company_name)
        when 'roa' then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
      end as group_keys
    from product_highest_phase php
    -- MOA join (for moa and moa+therapeutic-area groupings)
    left join public.product_mechanisms_of_action pm
      on pm.product_id = php.product_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
    left join public.mechanisms_of_action m
      on m.id = pm.moa_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
    -- TA join (for therapeutic-area and moa+therapeutic-area groupings)
    left join lateral (
      select distinct t2.therapeutic_area_id
      from public.trials t2
      where t2.product_id = php.product_id
        and t2.therapeutic_area_id is not null
        and p_grouping in ('therapeutic-area', 'moa+therapeutic-area')
    ) trial_tas on true
    left join public.therapeutic_areas ta
      on ta.id = trial_tas.therapeutic_area_id
      and p_grouping in ('therapeutic-area', 'moa+therapeutic-area')
    -- ROA join
    left join public.product_routes_of_administration pr
      on pr.product_id = php.product_id
      and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = pr.roa_id
      and p_grouping = 'roa'
    where
      -- enforce exclusion rules: filter out rows where grouping key is null
      case p_grouping
        when 'moa' then m.id is not null
        when 'therapeutic-area' then ta.id is not null
        when 'moa+therapeutic-area' then m.id is not null and ta.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

  -- aggregate into bubbles
  bubble_agg as (
    select
      pg.group_key,
      pg.group_label,
      pg.group_keys,
      count(distinct pg.company_id) as competitor_count,
      max(pg.highest_phase_rank) as highest_phase_rank,
      (array_agg(pg.highest_phase order by pg.highest_phase_rank desc))[1] as highest_phase,
      case p_count_unit
        when 'products' then count(distinct pg.product_id)
        when 'trials' then sum(pg.trial_count)
        when 'companies' then count(distinct pg.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', pg.product_id,
        'name', pg.product_name,
        'company_id', pg.company_id,
        'company_name', pg.company_name,
        'highest_phase', pg.highest_phase,
        'highest_phase_rank', pg.highest_phase_rank,
        'trial_count', pg.trial_count
      )) as products
    from product_groups pg
    group by pg.group_key, pg.group_label, pg.group_keys
  )

  select coalesce(jsonb_agg(
    jsonb_build_object(
      'label', ba.group_label,
      'group_keys', ba.group_keys,
      'competitor_count', ba.competitor_count,
      'highest_phase', ba.highest_phase,
      'highest_phase_rank', ba.highest_phase_rank,
      'unit_count', ba.unit_count,
      'products', ba.products
    )
    order by ba.competitor_count desc, ba.highest_phase_rank desc
  ), '[]'::jsonb)
  into v_bubbles
  from bubble_agg ba;

  return jsonb_build_object(
    'grouping', p_grouping,
    'count_unit', p_count_unit,
    'bubbles', v_bubbles
  );
end;
$$;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `supabase db reset`
Expected: All migrations apply without errors, seed data loads.

- [ ] **Step 3: Smoke-test the RPC**

Run: `supabase db reset` (if not already done), then via psql or supabase studio:
```sql
select get_positioning_data(
  p_space_id := (select id from spaces limit 1),
  p_grouping := 'moa+therapeutic-area'
);
```
Expected: Returns JSON with `grouping`, `count_unit`, and `bubbles` array. Bubbles should have `label`, `competitor_count`, `highest_phase`, `products[]`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260412130000_create_positioning_data_function.sql
git commit -m "feat(db): add get_positioning_data() RPC for competitive positioning scatter"
```

---

### Task 2: TypeScript Types and Model Extensions

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts`

- [ ] **Step 1: Add positioning types to landscape.model.ts**

Add at the end of the file (before the closing content), after the existing `DIMENSION_OPTIONS`:

```typescript
// --- Competitive Positioning types ---

export type PositioningGrouping =
  | 'moa'
  | 'therapeutic-area'
  | 'moa+therapeutic-area'
  | 'company'
  | 'roa';

export type CountUnit = 'products' | 'trials' | 'companies';

export interface PositioningProduct {
  id: string;
  name: string;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
}

export interface PositioningBubble {
  label: string;
  group_keys: Record<string, string>;
  competitor_count: number;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  unit_count: number;
  products: PositioningProduct[];
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

- [ ] **Step 2: Extend ViewMode and VIEW_MODE_OPTIONS**

Change the existing `ViewMode` type (line 156) from:
```typescript
export type ViewMode = 'timeline' | 'bullseye';
```
to:
```typescript
export type ViewMode = 'timeline' | 'bullseye' | 'positioning';
```

Change `VIEW_MODE_OPTIONS` (lines 158-161) from:
```typescript
export const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Bullseye', value: 'bullseye' },
];
```
to:
```typescript
export const VIEW_MODE_OPTIONS: { label: string; value: ViewMode }[] = [
  { label: 'Timeline', value: 'timeline' },
  { label: 'Bullseye', value: 'bullseye' },
  { label: 'Positioning', value: 'positioning' },
];
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds (no consumers of the new types yet, and ViewMode extension is backward-compatible since the shell already handles unknown modes by defaulting to timeline).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts
git commit -m "feat(models): add positioning types and extend ViewMode"
```

---

### Task 3: Landscape Service and State Service

**Files:**
- Modify: `src/client/src/app/core/services/landscape.service.ts`
- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts`

- [ ] **Step 1: Add getPositioningData() to LandscapeService**

In `src/client/src/app/core/services/landscape.service.ts`, add the import and new method.

Add to imports at top:
```typescript
import { BullseyeData, BullseyeDimension, LandscapeFilters, LandscapeIndexEntry, PositioningData, PositioningGrouping, CountUnit } from '../models/landscape.model';
```

(Replace the existing import line that imports `BullseyeData, BullseyeDimension, LandscapeIndexEntry`.)

Add after `getBullseyeData()`:
```typescript
  async getPositioningData(
    spaceId: string,
    grouping: PositioningGrouping,
    countUnit: CountUnit,
    filters: LandscapeFilters,
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

- [ ] **Step 2: Add positioning signals to LandscapeStateService**

In `src/client/src/app/features/landscape/landscape-state.service.ts`, add the import and new signals.

Update the import to include the new types:
```typescript
import {
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  SpokeMode,
  PositioningGrouping,
  CountUnit,
} from '../../core/models/landscape.model';
```

Add two new signals inside the class:
```typescript
  /** Positioning-specific: bubble grouping dimension. */
  readonly positioningGrouping = signal<PositioningGrouping>('moa+therapeutic-area');

  /** Positioning-specific: counting unit (products/trials/companies). */
  readonly countUnit = signal<CountUnit>('products');
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/landscape.service.ts src/client/src/app/features/landscape/landscape-state.service.ts
git commit -m "feat(services): add getPositioningData() and positioning state signals"
```

---

### Task 4: Positioning Chart Component (SVG)

**Files:**
- Create: `src/client/src/app/features/landscape/positioning-chart.component.ts`

This is the core SVG scatter chart presenter. It receives bubbles and renders them on fixed axes.

- [ ] **Step 1: Create the positioning chart component**

```typescript
import { Component, computed, input, output } from '@angular/core';

import { PositioningBubble, RING_ORDER, RingPhase } from '../../core/models/landscape.model';

/** Y-axis phases in display order (bottom to top). */
const Y_PHASES: readonly RingPhase[] = RING_ORDER; // PRECLIN at bottom, LAUNCHED at top

/** Phase rank for y-positioning. */
const PHASE_Y_RANK: Record<RingPhase, number> = {
  PRECLIN: 0, P1: 1, P2: 2, P3: 3, P4: 4, APPROVED: 5, LAUNCHED: 6,
};

function bubbleColor(competitorCount: number, phaseRank: number, maxCompetitors: number): string {
  const xNorm = maxCompetitors > 1 ? (competitorCount - 1) / (maxCompetitors - 1) : 0;
  const yNorm = phaseRank / 6;
  const intensity = (xNorm + yNorm) / 2;
  const hue = 168 - intensity * 168;
  const saturation = 60 + intensity * 15;
  const lightness = 45 - intensity * 10;
  return `hsl(${hue}, ${saturation}%, ${lightness}%)`;
}

interface PlottedBubble {
  bubble: PositioningBubble;
  cx: number;
  cy: number;
  color: string;
  truncatedLabel: string;
}

@Component({
  selector: 'app-positioning-chart',
  standalone: true,
  template: `
    <svg
      [attr.viewBox]="'0 0 ' + width() + ' ' + height()"
      class="w-full h-full"
      role="img"
      [attr.aria-label]="'Competitive positioning scatter chart with ' + bubbles().length + ' bubbles'"
      (click)="onBackgroundClick($event)"
    >
      <!-- Y-axis line -->
      <line
        [attr.x1]="margin.left"
        [attr.y1]="margin.top"
        [attr.x2]="margin.left"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1"
      />
      <!-- X-axis line -->
      <line
        [attr.x1]="margin.left"
        [attr.y1]="height() - margin.bottom"
        [attr.x2]="width() - margin.right"
        [attr.y2]="height() - margin.bottom"
        stroke="#e2e8f0"
        stroke-width="1"
      />

      <!-- Y-axis labels (phases) -->
      @for (phase of yPhases; track phase) {
        <text
          [attr.x]="margin.left - 8"
          [attr.y]="phaseY(phase) + 4"
          text-anchor="end"
          class="fill-slate-400"
          style="font-size: 11px; font-family: ui-monospace, monospace;"
        >{{ phase }}</text>
      }

      <!-- X-axis labels (competitor counts) -->
      @for (tick of xTicks(); track tick) {
        <text
          [attr.x]="competitorX(tick)"
          [attr.y]="height() - margin.bottom + 18"
          text-anchor="middle"
          class="fill-slate-400"
          style="font-size: 11px; font-family: ui-monospace, monospace;"
        >{{ tick }}</text>
      }

      <!-- Axis titles -->
      <text
        [attr.x]="(margin.left + width() - margin.right) / 2"
        [attr.y]="height() - 4"
        text-anchor="middle"
        class="fill-slate-500"
        style="font-size: 12px; font-weight: 600;"
      >Competitors</text>

      <text
        [attr.x]="14"
        [attr.y]="(margin.top + height() - margin.bottom) / 2"
        text-anchor="middle"
        class="fill-slate-500"
        style="font-size: 12px; font-weight: 600;"
        [attr.transform]="'rotate(-90, 14, ' + ((margin.top + height() - margin.bottom) / 2) + ')'"
      >Highest Phase</text>

      <!-- Bubbles -->
      @for (pb of plottedBubbles(); track pb.bubble.label) {
        <g
          class="cursor-pointer outline-none"
          [class.opacity-30]="selectedBubble() !== null && selectedBubble() !== pb.bubble"
          tabindex="0"
          [attr.aria-label]="pb.bubble.label + ': ' + pb.bubble.competitor_count + ' competitors, highest phase ' + pb.bubble.highest_phase + ', ' + pb.bubble.unit_count + ' ' + countUnit()"
          (click)="onBubbleClick($event, pb.bubble)"
          (mouseenter)="bubbleHover.emit(pb.bubble)"
          (mouseleave)="bubbleHover.emit(null)"
          (focus)="bubbleHover.emit(pb.bubble)"
          (blur)="bubbleHover.emit(null)"
          (keydown.enter)="onBubbleClick($event, pb.bubble)"
          (keydown.space)="onBubbleClick($event, pb.bubble)"
        >
          <circle
            [attr.cx]="pb.cx"
            [attr.cy]="pb.cy"
            [attr.r]="bubbleRadius"
            [attr.fill]="pb.color"
            [attr.stroke]="selectedBubble() === pb.bubble ? '#0f172a' : 'white'"
            [attr.stroke-width]="selectedBubble() === pb.bubble ? 2.5 : 1.5"
            opacity="0.85"
          />
          <text
            [attr.x]="pb.cx"
            [attr.y]="pb.cy + 4"
            text-anchor="middle"
            fill="white"
            style="font-size: 10px; font-weight: 600; pointer-events: none;"
          >{{ pb.truncatedLabel }}</text>
        </g>
      }

      <!-- Empty state -->
      @if (bubbles().length === 0) {
        <text
          [attr.x]="width() / 2"
          [attr.y]="height() / 2"
          text-anchor="middle"
          class="fill-slate-400"
          style="font-size: 14px;"
        >No data matches current filters</text>
      }
    </svg>
  `,
})
export class PositioningChartComponent {
  readonly bubbles = input.required<PositioningBubble[]>();
  readonly width = input<number>(900);
  readonly height = input<number>(600);
  readonly countUnit = input<string>('products');
  readonly selectedBubble = input<PositioningBubble | null>(null);

  readonly bubbleHover = output<PositioningBubble | null>();
  readonly bubbleClick = output<PositioningBubble>();

  readonly yPhases = Y_PHASES;
  readonly bubbleRadius = 22;

  readonly margin = { top: 30, right: 30, bottom: 40, left: 80 };

  readonly maxCompetitors = computed(() => {
    const max = Math.max(...this.bubbles().map((b) => b.competitor_count), 1);
    return Math.max(max, 2); // at least 2 so axis is meaningful
  });

  readonly xTicks = computed(() => {
    const max = this.maxCompetitors();
    const ticks: number[] = [];
    for (let i = 1; i <= max; i++) ticks.push(i);
    return ticks;
  });

  readonly plottedBubbles = computed<PlottedBubble[]>(() => {
    const bubbles = this.bubbles();
    const maxComp = this.maxCompetitors();

    // First pass: compute raw positions
    const raw = bubbles.map((b) => ({
      bubble: b,
      cx: this.competitorX(b.competitor_count),
      cy: this.phaseY(b.highest_phase),
      color: bubbleColor(b.competitor_count, b.highest_phase_rank, maxComp),
      truncatedLabel: b.label.length > 6 ? b.label.slice(0, 5) + '\u2026' : b.label,
    }));

    // Jitter pass: nudge overlapping bubbles
    const radius = this.bubbleRadius;
    for (let i = 0; i < raw.length; i++) {
      for (let j = i + 1; j < raw.length; j++) {
        const dx = raw[j].cx - raw[i].cx;
        const dy = raw[j].cy - raw[i].cy;
        const dist = Math.sqrt(dx * dx + dy * dy);
        const minDist = radius * 2.2;
        if (dist < minDist) {
          const nudge = (minDist - dist) / 2 + 1;
          const angle = dist > 0 ? Math.atan2(dy, dx) : (j * Math.PI) / 4;
          raw[i].cx -= Math.cos(angle) * nudge;
          raw[i].cy -= Math.sin(angle) * nudge;
          raw[j].cx += Math.cos(angle) * nudge;
          raw[j].cy += Math.sin(angle) * nudge;
        }
      }
    }

    return raw;
  });

  phaseY(phase: RingPhase): number {
    const rank = PHASE_Y_RANK[phase] ?? 0;
    const plotH = this.height() - this.margin.top - this.margin.bottom;
    // LAUNCHED (rank 6) at top, PRECLIN (rank 0) at bottom
    return this.margin.top + plotH - (rank / 6) * plotH;
  }

  competitorX(count: number): number {
    const plotW = this.width() - this.margin.left - this.margin.right;
    const max = this.maxCompetitors();
    // count 1 at left edge, max at right edge
    const ratio = max > 1 ? (count - 1) / (max - 1) : 0.5;
    return this.margin.left + ratio * plotW;
  }

  onBubbleClick(event: Event, bubble: PositioningBubble): void {
    event.stopPropagation();
    this.bubbleClick.emit(bubble);
  }

  onBackgroundClick(event: Event): void {
    // Only reset if clicking the SVG background, not a bubble
    if ((event.target as Element).tagName === 'svg') {
      this.bubbleClick.emit(undefined as unknown as PositioningBubble);
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds (component is not routed yet, but must compile).

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-chart.component.ts
git commit -m "feat(positioning): add SVG scatter chart component"
```

---

### Task 5: Positioning Detail Panel Component

**Files:**
- Create: `src/client/src/app/features/landscape/positioning-detail-panel.component.ts`

- [ ] **Step 1: Create the detail panel component**

```typescript
import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import {
  PHASE_COLOR,
  PositioningBubble,
  PositioningProduct,
  RingPhase,
} from '../../core/models/landscape.model';

@Component({
  selector: 'app-positioning-detail-panel',
  standalone: true,
  imports: [ButtonModule],
  template: `
    <aside class="landscape-detail-panel" aria-live="polite">
      @if (bubble()) {
        @let b = bubble()!;
        <div class="landscape-detail-header">
          <div class="landscape-detail-label">SELECTED</div>
          <button
            type="button"
            class="landscape-detail-clear"
            (click)="clearSelection.emit()"
            aria-label="Clear selection"
          >&times;</button>
        </div>

        <h2 class="landscape-detail-name">{{ b.label }}</h2>

        <section class="landscape-detail-section">
          <div class="flex items-center gap-3 text-sm text-slate-600">
            <span><strong class="text-slate-800">{{ b.competitor_count }}</strong> {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}</span>
            <span class="w-px h-3.5 bg-slate-200"></span>
            <span>
              <span
                class="inline-block w-2 h-2 rounded-full mr-1"
                [style.background-color]="phaseColor(b.highest_phase)"
              ></span>
              {{ b.highest_phase }}
            </span>
            <span class="w-px h-3.5 bg-slate-200"></span>
            <span><strong class="text-slate-800">{{ b.unit_count }}</strong> {{ countUnit() }}</span>
          </div>
        </section>

        <section class="landscape-detail-section">
          <div class="landscape-detail-label">PRODUCTS ({{ b.products.length }})</div>
          <ul class="landscape-detail-trial-list">
            @for (product of sortedProducts(); track product.id) {
              <li class="landscape-detail-trial-row">
                <div class="landscape-detail-trial-link" style="cursor: default;">
                  <span class="landscape-detail-trial-name">{{ product.name }}</span>
                  <span class="landscape-detail-trial-meta">
                    <span class="text-slate-500">{{ product.company_name }}</span>
                    <span
                      class="inline-block rounded-sm text-[10px] px-1.5 py-0.5 font-semibold"
                      [style.background-color]="phaseColor(product.highest_phase) + '18'"
                      [style.color]="phaseColor(product.highest_phase)"
                    >{{ product.highest_phase }}</span>
                    <span class="text-slate-400">{{ product.trial_count }} {{ product.trial_count === 1 ? 'trial' : 'trials' }}</span>
                  </span>
                </div>
              </li>
            }
          </ul>
        </section>
      } @else {
        <div class="landscape-detail-empty">
          <div class="landscape-detail-label">CLICK A BUBBLE TO SEE DETAILS</div>
          <p class="landscape-detail-summary">
            {{ totalBubbles() }} {{ totalBubbles() === 1 ? 'group' : 'groups' }} plotted
          </p>
        </div>
      }
    </aside>
  `,
})
export class PositioningDetailPanelComponent {
  readonly bubble = input<PositioningBubble | null>(null);
  readonly countUnit = input<string>('products');
  readonly totalBubbles = input<number>(0);

  readonly clearSelection = output<void>();

  readonly sortedProducts = computed<PositioningProduct[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    return [...b.products].sort((a, b2) => b2.highest_phase_rank - a.highest_phase_rank);
  });

  phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-detail-panel.component.ts
git commit -m "feat(positioning): add detail panel component"
```

---

### Task 6: Positioning Tooltip Component

**Files:**
- Create: `src/client/src/app/features/landscape/positioning-tooltip.component.ts`

- [ ] **Step 1: Create the tooltip component**

```typescript
import { Component, computed, input } from '@angular/core';

import { PositioningBubble } from '../../core/models/landscape.model';

@Component({
  selector: 'app-positioning-tooltip',
  standalone: true,
  template: `
    @if (bubble()) {
      @let b = bubble()!;
      <div
        class="fixed z-50 pointer-events-none bg-slate-800 text-white text-xs rounded-md px-3 py-2 shadow-lg max-w-56"
        [style.left.px]="x()"
        [style.top.px]="y()"
        [style.transform]="'translate(-50%, -100%) translateY(-10px)'"
        role="tooltip"
      >
        <div class="font-semibold mb-0.5">{{ b.label }}</div>
        <div class="text-slate-300">
          {{ b.competitor_count }} {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }},
          highest phase: {{ b.highest_phase }}
        </div>
        <div class="text-slate-300">{{ b.unit_count }} {{ countUnit() }}</div>
        @if (topCompanies().length > 0) {
          <div class="text-slate-400 mt-1 border-t border-slate-600 pt-1">
            {{ topCompanies().join(', ') }}{{ b.products.length > 3 ? ', ...' : '' }}
          </div>
        }
        <div class="text-slate-500 mt-0.5">Click for details</div>
      </div>
    }
  `,
})
export class PositioningTooltipComponent {
  readonly bubble = input<PositioningBubble | null>(null);
  readonly x = input<number>(0);
  readonly y = input<number>(0);
  readonly countUnit = input<string>('products');

  readonly topCompanies = computed<string[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    const unique = [...new Set(b.products.map((p) => p.company_name))];
    return unique.slice(0, 3);
  });
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-tooltip.component.ts
git commit -m "feat(positioning): add hover tooltip component"
```

---

### Task 7: Positioning View Page Component

**Files:**
- Create: `src/client/src/app/features/landscape/positioning-view.component.ts`

This is the page-level component that wires data fetching, the chart, the detail panel, and the tooltip together.

- [ ] **Step 1: Create the positioning view component**

```typescript
import { Component, computed, ElementRef, inject, OnInit, resource, signal, viewChild } from '@angular/core';
import { ActivatedRoute } from '@angular/router';
import { ProgressSpinner } from 'primeng/progressspinner';
import { MessageModule } from 'primeng/message';
import { ButtonModule } from 'primeng/button';

import { PositioningBubble } from '../../core/models/landscape.model';
import { LandscapeService } from '../../core/services/landscape.service';
import { LandscapeStateService } from './landscape-state.service';
import { PositioningChartComponent } from './positioning-chart.component';
import { PositioningDetailPanelComponent } from './positioning-detail-panel.component';
import { PositioningTooltipComponent } from './positioning-tooltip.component';

@Component({
  selector: 'app-positioning-view',
  standalone: true,
  imports: [
    PositioningChartComponent,
    PositioningDetailPanelComponent,
    PositioningTooltipComponent,
    ProgressSpinner,
    MessageModule,
    ButtonModule,
  ],
  template: `
    @if (positioningData.isLoading()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3">
          <p-progressspinner
            strokeWidth="4"
            [style]="{ width: '2rem', height: '2rem' }"
            aria-label="Loading positioning data"
          />
          <span class="text-sm text-slate-500">Loading positioning data...</span>
        </div>
      </div>
    } @else if (positioningData.error()) {
      <div class="flex items-center justify-center h-full">
        <div class="flex flex-col items-center gap-3 text-center max-w-md">
          <p-message severity="error" [closable]="false">
            Failed to load positioning data. Please try again.
          </p-message>
          <p-button label="Retry" severity="primary" size="small" (onClick)="positioningData.reload()" />
        </div>
      </div>
    } @else {
      @let data = positioningData.value();
      @if (data && data.bubbles.length > 0) {
        <div class="landscape-layout">
          <div class="landscape-chart-wrap" #chartWrap>
            <app-positioning-chart
              [bubbles]="data.bubbles"
              [width]="900"
              [height]="600"
              [countUnit]="state.countUnit()"
              [selectedBubble]="selectedBubble()"
              (bubbleHover)="onBubbleHover($event)"
              (bubbleClick)="onBubbleClick($event)"
            />
          </div>
          <div class="landscape-panel-wrap">
            <app-positioning-detail-panel
              [bubble]="selectedBubble()"
              [countUnit]="state.countUnit()"
              [totalBubbles]="data.bubbles.length"
              (clearSelection)="selectedBubble.set(null)"
            />
          </div>
        </div>
      } @else if (data) {
        <div class="flex items-center justify-center h-full">
          <p-message severity="info" [closable]="false">
            No data matches the current filters. Try adjusting your selections.
          </p-message>
        </div>
      }
    }

    <app-positioning-tooltip
      [bubble]="hoveredBubble()"
      [x]="tooltipX()"
      [y]="tooltipY()"
      [countUnit]="state.countUnit()"
    />
  `,
})
export class PositioningViewComponent implements OnInit {
  private readonly landscapeService = inject(LandscapeService);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  readonly spaceId = signal('');
  readonly selectedBubble = signal<PositioningBubble | null>(null);
  readonly hoveredBubble = signal<PositioningBubble | null>(null);
  readonly tooltipX = signal(0);
  readonly tooltipY = signal(0);

  readonly positioningData = resource({
    request: () => ({
      spaceId: this.spaceId(),
      grouping: this.state.positioningGrouping(),
      countUnit: this.state.countUnit(),
      filters: this.state.filters(),
    }),
    loader: async ({ request }) => {
      if (!request.spaceId) return null;
      return this.landscapeService.getPositioningData(
        request.spaceId,
        request.grouping,
        request.countUnit,
        request.filters,
      );
    },
  });

  ngOnInit(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('spaceId')) {
        this.spaceId.set(snap.paramMap.get('spaceId')!);
        break;
      }
      snap = snap.parent;
    }
  }

  onBubbleHover(bubble: PositioningBubble | null): void {
    this.hoveredBubble.set(bubble);
    // Position tooltip near cursor via last known mouse position
    if (bubble) {
      const handler = (e: MouseEvent) => {
        this.tooltipX.set(e.clientX);
        this.tooltipY.set(e.clientY);
        document.removeEventListener('mousemove', handler);
      };
      document.addEventListener('mousemove', handler);
    }
  }

  onBubbleClick(bubble: PositioningBubble): void {
    if (!bubble || this.selectedBubble() === bubble) {
      this.selectedBubble.set(null);
    } else {
      this.selectedBubble.set(bubble);
    }
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && ng build`
Expected: Build succeeds.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-view.component.ts
git commit -m "feat(positioning): add positioning view page component"
```

---

### Task 8: Routing, Shell Integration, and Filter Bar

**Files:**
- Modify: `src/client/src/app/app.routes.ts`
- Modify: `src/client/src/app/features/landscape/landscape-shell.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

- [ ] **Step 1: Add the positioning route**

In `src/client/src/app/app.routes.ts`, add a new child route inside the landscape shell children array, after the `bullseye` block (after line 118, before the closing `],`):

```typescript
              {
                path: 'positioning',
                loadComponent: () =>
                  import('./features/landscape/positioning-view.component').then(
                    (m) => m.PositioningViewComponent,
                  ),
              },
```

- [ ] **Step 2: Update the landscape shell component**

In `src/client/src/app/features/landscape/landscape-shell.component.ts`:

**Add imports** for the new types at the top (update the existing import from `landscape.model`):

```typescript
import {
  BullseyeDimension,
  CountUnit,
  COUNT_UNIT_OPTIONS,
  DIMENSION_OPTIONS,
  dimensionToSegment,
  LandscapeIndexEntry,
  PositioningGrouping,
  POSITIONING_GROUPING_OPTIONS,
  segmentToDimension,
  ViewMode,
  VIEW_MODE_OPTIONS,
} from '../../core/models/landscape.model';
```

**Add to the imports array** in the `@Component` decorator: `Select` is already imported. No new component imports needed.

**Add template sections** for positioning mode. In the template, after the bullseye entity dropdown block (after line 81, `}`), add:

```html
        @if (viewMode() === 'positioning') {
          <div class="h-4 w-px bg-slate-200 mx-0.5"></div>
          <p-select
            [options]="groupingOptions"
            [ngModel]="state.positioningGrouping()"
            (ngModelChange)="state.positioningGrouping.set($event)"
            optionLabel="label"
            optionValue="value"
            [style]="{ minWidth: '14rem' }"
            size="small"
          />
          <p-selectbutton
            [options]="countUnitOptions"
            [ngModel]="state.countUnit()"
            (ngModelChange)="state.countUnit.set($event)"
            optionLabel="label"
            optionValue="value"
            [allowEmpty]="false"
            size="small"
          />
        }
```

**Add class properties** for the new options:

```typescript
  readonly groupingOptions = POSITIONING_GROUPING_OPTIONS;
  readonly countUnitOptions = COUNT_UNIT_OPTIONS;
```

**Update `onViewModeChange()`** (around line 171). Change from:

```typescript
  onViewModeChange(mode: ViewMode): void {
    if (mode === 'timeline') {
      this.router.navigate(this.spaceBase());
    } else {
      this.router.navigate([...this.spaceBase(), 'bullseye']);
    }
  }
```

to:

```typescript
  onViewModeChange(mode: ViewMode): void {
    if (mode === 'timeline') {
      this.router.navigate(this.spaceBase());
    } else if (mode === 'positioning') {
      this.router.navigate([...this.spaceBase(), 'positioning']);
    } else {
      this.router.navigate([...this.spaceBase(), 'bullseye']);
    }
  }
```

**Update `syncStateFromUrl()`** (around line 217). In the method body, before the `if (dimSegment)` block (line 235), add a check for the positioning segment:

Change:

```typescript
    if (dimSegment) {
```

to:

```typescript
    if (allSegments.includes('positioning')) {
      this.viewMode.set('positioning');
      this.entityId.set(null);
    } else if (dimSegment) {
```

- [ ] **Step 3: Update the filter bar component TS**

In `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`, add the imports for the new types:

Update the import from `landscape.model` to include:

```typescript
import {
  BullseyeDimension,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  RingPhase,
  ViewMode,
} from '../../core/models/landscape.model';
```

(No new types needed in the TS file -- the grouping and count unit controls are handled in the shell, not the filter bar. The filter bar just needs to know the `viewMode` to conditionally show/hide view-specific controls, which it already does.)

- [ ] **Step 4: Update the filter bar template**

In `src/client/src/app/features/landscape/landscape-filter-bar.component.html`, no changes needed. The existing filter bar already shows all common filters regardless of view mode. The zoom and spoke mode controls are already gated behind `viewMode() === 'timeline'` and `viewMode() === 'bullseye'` respectively, so they won't show in positioning mode. All common filters (company, product, TA, MOA, ROA, phase, status, study type) will remain visible.

- [ ] **Step 5: Verify build**

Run: `cd src/client && ng lint && ng build`
Expected: Lint passes, build succeeds.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/app.routes.ts src/client/src/app/features/landscape/landscape-shell.component.ts src/client/src/app/features/landscape/landscape-filter-bar.component.ts src/client/src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "feat(positioning): integrate into landscape shell with routing and filter bar"
```

---

### Task 9: End-to-End Verification

**Files:** None (verification only)

- [ ] **Step 1: Reset database and verify RPC**

Run: `supabase db reset`
Expected: All migrations apply, seed data loads.

- [ ] **Step 2: Run full lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: Both pass with zero errors.

- [ ] **Step 3: Start dev server and test in browser**

Run: `cd src/client && ng serve`

Test the following in the browser:
1. Navigate to a space. The SelectButton should show three options: Timeline, Bullseye, Positioning.
2. Click "Positioning." The URL should change to `/t/:tid/s/:sid/positioning`. The grouping dropdown and count unit toggle should appear in the header.
3. With the default "MOA + Therapy Area" grouping, bubbles should appear on the scatter chart.
4. Hover a bubble -- tooltip should appear with label, competitor count, phase, top companies.
5. Click a bubble -- the detail panel on the right should show the bubble's label, stats, and product list sorted by phase.
6. Click the same bubble again or click the X -- selection should clear.
7. Change the grouping dropdown to "Company" -- bubbles should update (each bubble = one company).
8. Change count unit to "Trials" -- the unit_count values on bubbles should change.
9. Apply a filter (e.g., select a specific company) -- the chart should re-render with filtered data.
10. Switch to Timeline or Bullseye and back -- filters should persist, positioning controls should reappear.

- [ ] **Step 4: Commit (if any fixes were needed)**

```bash
git add -u
git commit -m "fix(positioning): address issues found during end-to-end testing"
```
