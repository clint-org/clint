# Detail Pane Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Restructure the Timeline, Bullseye, and Positioning detail panes for better information hierarchy, show missing data points, and add cross-navigation from Positioning.

**Architecture:** Pure frontend template/logic changes for Timeline and Bullseye. Positioning gets new outputs + parent wiring for cross-navigation. One backend migration adds `generic_name` to the positioning RPC.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG, Tailwind CSS v4, Supabase PostgreSQL RPC

---

### Task 1: Backend -- add `generic_name` to positioning RPC

**Files:**
- Create: `supabase/migrations/20260415170000_positioning_add_generic_name.sql`

- [ ] **Step 1: Create migration file**

```sql
-- migration: 20260415170000_positioning_add_generic_name
-- purpose: include product generic_name in get_positioning_data RPC output
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
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_product_ids = '{}' then p_product_ids := null; end if;
  if p_therapeutic_area_ids = '{}' then p_therapeutic_area_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  with phase_rank_map(phase_name, phase_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  eligible_products as (
    select distinct p.id as product_id, p.name as product_name,
           p.generic_name as product_generic_name,
           p.company_id, c.name as company_name
    from public.products p
    join public.companies c on c.id = p.company_id
    join public.trials t on t.product_id = p.id
    join public.trial_phases tp on tp.trial_id = t.id
    join phase_rank_map prm on prm.phase_name = tp.phase_type
    where p.space_id = p_space_id
      and tp.phase_type <> 'OBS'
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

  product_highest_phase as (
    select ep.product_id, ep.product_name, ep.product_generic_name,
           ep.company_id, ep.company_name,
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
    group by ep.product_id, ep.product_name, ep.product_generic_name, ep.company_id, ep.company_name
  ),

  product_groups as (
    select
      php.product_id, php.product_name, php.product_generic_name,
      php.company_id, php.company_name,
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
    left join public.product_mechanisms_of_action pm
      on pm.product_id = php.product_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
    left join public.mechanisms_of_action m
      on m.id = pm.moa_id
      and p_grouping in ('moa', 'moa+therapeutic-area')
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
    left join public.product_routes_of_administration pr
      on pr.product_id = php.product_id
      and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = pr.roa_id
      and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa' then m.id is not null
        when 'therapeutic-area' then ta.id is not null
        when 'moa+therapeutic-area' then m.id is not null and ta.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

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
        'generic_name', pg.product_generic_name,
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

- [ ] **Step 2: Commit**

```bash
git add supabase/migrations/20260415170000_positioning_add_generic_name.sql
git commit -m "feat: add generic_name to positioning RPC output"
```

---

### Task 2: Model -- add `generic_name` to `PositioningProduct`

**Files:**
- Modify: `src/client/src/app/core/models/landscape.model.ts:204-212`

- [ ] **Step 1: Add `generic_name` field to `PositioningProduct`**

In `landscape.model.ts`, add `generic_name: string | null;` after the `name` field in the `PositioningProduct` interface:

```typescript
export interface PositioningProduct {
  id: string;
  name: string;
  generic_name: string | null;
  company_id: string;
  company_name: string;
  highest_phase: RingPhase;
  highest_phase_rank: number;
  trial_count: number;
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds (new optional field is additive)

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts
git commit -m "feat: add generic_name to PositioningProduct interface"
```

---

### Task 3: Timeline -- reorder marker detail content sections

**Files:**
- Modify: `src/client/src/app/shared/components/marker-detail-content.component.ts`

- [ ] **Step 1: Rewrite template with new section order + source URL fix + category contrast fix**

Replace the entire template content inside the `@if (detail(); as d)` block. New order: Title, Program, Trial, Date/Status, Description, Source (truncated), Upcoming, Related events (with `text-slate-500` on category).

The full template becomes:

```typescript
  template: `
    @if (detail(); as d) {
      <!-- Title -->
      <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">
        {{ d.catalyst.title }}
      </h2>

      <!-- Program -->
      @if (d.catalyst.company_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Program
          </p>
          <p class="text-xs text-slate-900">
            <span class="font-semibold uppercase">{{ d.catalyst.company_name }}</span>
            @if (d.catalyst.product_name) {
              &middot; {{ d.catalyst.product_name }}
            }
          </p>
        </div>
      }

      <!-- Trial -->
      @if (d.catalyst.trial_name) {
        <div class="mb-3 border-b border-slate-100 pb-2">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Trial
          </p>
          <p class="text-xs font-medium text-slate-900">
            {{ d.catalyst.trial_name }}
          </p>
          <p class="text-[11px] text-slate-500">
            {{ d.catalyst.trial_phase }}
            @if (d.catalyst.recruitment_status) {
              &middot; {{ d.catalyst.recruitment_status }}
            }
          </p>
        </div>
      }

      <!-- Date & Status -->
      <div class="mb-4 flex items-center gap-4 text-xs text-slate-500">
        <div>
          <span class="font-semibold">Date</span><br />
          {{ d.catalyst.event_date | date: 'mediumDate' }}
        </div>
        <div>
          <span class="font-semibold">Status</span><br />
          @if (d.catalyst.is_projected) {
            <span class="text-amber-600">Projected</span>
          } @else {
            <span class="text-green-600">Confirmed</span>
          }
        </div>
      </div>

      <!-- Description -->
      @if (d.catalyst.description) {
        <div class="mb-4">
          <p class="mb-1 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Description
          </p>
          <p class="text-xs leading-relaxed text-slate-600">
            {{ d.catalyst.description }}
          </p>
        </div>
      }

      <!-- Source -->
      @if (d.catalyst.source_url) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Source
          </p>
          <a
            [href]="d.catalyst.source_url"
            target="_blank"
            rel="noopener noreferrer"
            class="inline-flex items-center gap-1 text-xs text-teal-700 hover:text-teal-800 hover:underline"
          >
            {{ extractDomain(d.catalyst.source_url) }}
            <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
          </a>
        </div>
      }

      <!-- Upcoming for this trial -->
      @if (d.upcoming_markers.length > 0) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Upcoming for this trial
          </p>
          <ul class="space-y-1">
            @for (um of d.upcoming_markers; track um.marker_id) {
              <li
                class="cursor-pointer border-b border-slate-100 py-1.5 text-[11px] text-slate-600 hover:text-teal-700"
                (click)="markerClick.emit(um.marker_id)"
                (keydown.enter)="markerClick.emit(um.marker_id)"
                tabindex="0"
                role="button"
              >
                {{ um.event_date | date: 'MMM yyyy' }} &middot;
                {{ um.marker_type_name }}
                @if (um.is_projected) {
                  <span class="text-amber-500">(projected)</span>
                }
              </li>
            }
          </ul>
        </div>
      }

      <!-- Related events -->
      @if (d.related_events.length > 0) {
        <div class="mb-4">
          <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
            Related events
          </p>
          <ul class="space-y-1">
            @for (re of d.related_events; track re.event_id) {
              <li class="text-[11px] text-slate-500">
                {{ re.event_date | date: 'mediumDate' }} &mdash; {{ re.title }}
                <span class="text-slate-500">({{ re.category_name }})</span>
              </li>
            }
          </ul>
        </div>
      }
    }
  `,
```

- [ ] **Step 2: Add `extractDomain` method to the component class**

After the `markerClick` output declaration, add:

```typescript
  protected extractDomain(url: string): string {
    try {
      return new URL(url).hostname.replace(/^www\./, '');
    } catch {
      return url;
    }
  }
```

- [ ] **Step 3: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/marker-detail-content.component.ts
git commit -m "feat: reorder timeline detail sections, truncate source URL, fix category contrast"
```

---

### Task 4: Timeline -- add color dot to marker detail drawer header

**Files:**
- Modify: `src/client/src/app/features/landscape/marker-detail-drawer.component.ts:27-33`

- [ ] **Step 1: Add color dot before the category/type label in the header**

Replace the header `<div class="min-w-0 flex-1">` block (lines 27-33):

From:
```html
          <div class="min-w-0 flex-1">
            @if (detail(); as d) {
              <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
                {{ d.catalyst.category_name }} &middot;
                {{ d.catalyst.marker_type_name }}
              </p>
            }
          </div>
```

To:
```html
          <div class="flex min-w-0 flex-1 items-center gap-1.5">
            @if (detail(); as d) {
              <span
                class="inline-block h-2 w-2 shrink-0 rounded-full"
                [style.background-color]="d.catalyst.marker_type_color"
                aria-hidden="true"
              ></span>
              <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
                {{ d.catalyst.category_name }} &middot;
                {{ d.catalyst.marker_type_name }}
              </p>
            }
          </div>
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/marker-detail-drawer.component.ts
git commit -m "feat: add color dot to timeline marker detail drawer header"
```

---

### Task 5: Bullseye -- add recruitment status and format marker dates

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html:96-106`
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html:135`
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts:1-2,22`

- [ ] **Step 1: Add DatePipe import to component**

In `bullseye-detail-panel.component.ts`, add `DatePipe` to imports:

```typescript
import { DatePipe } from '@angular/common';
```

Update the `imports` array in the `@Component` decorator:

```typescript
  imports: [ButtonModule, DatePipe, DetailPanelShellComponent],
```

- [ ] **Step 2: Add recruitment status to trial rows in the template**

In `bullseye-detail-panel.component.html`, replace the trial metadata `<span>` block (lines 96-106):

From:
```html
                  <span class="flex gap-2 font-mono text-[11px] text-slate-400">
                    @if (trial.identifier) {
                      <span>{{ trial.identifier }}</span>
                    }
                    @if (trial.sample_size) {
                      <span>n={{ trial.sample_size }}</span>
                    }
                    @if (trial.phase) {
                      <span>{{ trial.phase }}</span>
                    }
                  </span>
```

To:
```html
                  <span class="flex gap-2 font-mono text-[11px] text-slate-400">
                    @if (trial.identifier) {
                      <span>{{ trial.identifier }}</span>
                    }
                    @if (trial.sample_size) {
                      <span>n={{ trial.sample_size }}</span>
                    }
                    @if (trial.phase) {
                      <span>{{ trial.phase }}</span>
                    }
                    @if (trial.recruitment_status) {
                      <span class="text-teal-600">{{ trial.recruitment_status }}</span>
                    }
                  </span>
```

- [ ] **Step 3: Format marker dates with DatePipe**

In `bullseye-detail-panel.component.html`, replace the raw date display (line 135):

From:
```html
                <span class="font-mono text-[11px] text-slate-500">{{ marker.event_date }}</span>
```

To:
```html
                <span class="font-mono text-[11px] text-slate-500">{{ marker.event_date | date: 'mediumDate' }}</span>
```

- [ ] **Step 4: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.ts src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "feat: add recruitment status to bullseye trial rows, format marker dates"
```

---

### Task 6: Positioning -- redesign detail panel

**Files:**
- Modify: `src/client/src/app/features/landscape/positioning-detail-panel.component.ts`

This is the largest change. The entire component template and class are rewritten.

- [ ] **Step 1: Rewrite the positioning detail panel component**

Replace the full file content:

```typescript
import { Component, computed, input, output } from '@angular/core';
import { ButtonModule } from 'primeng/button';

import {
  PHASE_COLOR,
  RING_ORDER,
  PositioningBubble,
  PositioningProduct,
  RingPhase,
} from '../../core/models/landscape.model';
import { DetailPanelShellComponent } from '../../shared/components/detail-panel-shell.component';

interface PhaseCount {
  phase: RingPhase;
  count: number;
}

@Component({
  selector: 'app-positioning-detail-panel',
  standalone: true,
  imports: [ButtonModule, DetailPanelShellComponent],
  template: `
    <app-detail-panel-shell
      [label]="'COMPETITIVE GROUP'"
      [showHeader]="!!bubble()"
      [showClose]="!!bubble()"
      (closed)="clearSelection.emit()"
    >
      @if (bubble()) {
        @let b = bubble()!;

        <div class="flex flex-col gap-3">
          <h2 class="text-xl font-bold leading-tight text-slate-900">{{ fullLabel() }}</h2>

          <!-- Summary stats (stacked) -->
          <section class="flex flex-col gap-0.5 border-t border-slate-50 pt-2 text-sm text-slate-600">
            <div><strong class="text-slate-800">{{ b.competitor_count }}</strong> {{ b.competitor_count === 1 ? 'competitor' : 'competitors' }}</div>
            <div><strong class="text-slate-800">{{ b.unit_count }}</strong> {{ countUnit() }}</div>
          </section>

          <!-- Phase breakdown -->
          @if (phaseBreakdown().length > 0) {
            <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
              <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">PHASE BREAKDOWN</div>
              <div class="mt-0.5 flex flex-wrap gap-1">
                @for (entry of phaseBreakdown(); track entry.phase) {
                  <span
                    class="inline-block rounded-sm px-1.5 py-0.5 font-mono text-[10px] font-semibold"
                    [style.background-color]="phaseColor(entry.phase) + '18'"
                    [style.color]="phaseColor(entry.phase)"
                  >{{ entry.phase }} {{ entry.count }}</span>
                }
              </div>
            </section>
          }

          <!-- Products -->
          <section class="flex flex-col gap-1 border-t border-slate-50 pt-2">
            <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">PRODUCTS ({{ b.products.length }})</div>
            <ul class="mt-1 flex flex-col gap-0.5 p-0">
              @for (product of sortedProducts(); track product.id) {
                <li class="list-none">
                  <button
                    type="button"
                    class="flex w-full cursor-pointer flex-col gap-0.5 rounded-sm border-none bg-transparent px-2 py-1.5 text-left hover:bg-slate-50"
                    (click)="openProduct.emit(product.id)"
                  >
                    <span class="text-[13px] font-medium text-slate-900">
                      {{ product.name }}
                      @if (product.generic_name) {
                        <span class="font-normal italic text-slate-400">({{ product.generic_name }})</span>
                      }
                    </span>
                    <span class="flex items-center gap-2 font-mono text-[11px] text-slate-400">
                      <span class="text-slate-500">{{ product.company_name }}</span>
                      <span
                        class="inline-block rounded-sm px-1.5 py-0.5 text-[10px] font-semibold"
                        [style.background-color]="phaseColor(product.highest_phase) + '18'"
                        [style.color]="phaseColor(product.highest_phase)"
                      >{{ product.highest_phase }}</span>
                      <span class="text-slate-400">{{ product.trial_count }} {{ product.trial_count === 1 ? 'trial' : 'trials' }}</span>
                      <span class="ml-auto text-slate-300">&rarr;</span>
                    </span>
                  </button>
                </li>
              }
            </ul>
          </section>
        </div>
      } @else {
        <!-- Empty state -->
        <div class="flex flex-col gap-3">
          <div class="text-[10px] font-semibold uppercase tracking-[0.1em] text-slate-400">CLICK A BUBBLE TO SEE DETAILS</div>
          <p class="text-[13px] text-slate-700">
            {{ totalBubbles() }} {{ totalBubbles() === 1 ? 'group' : 'groups' }} plotted
          </p>
        </div>
      }

      <!-- Actions slot -->
      @if (bubble()) {
        <div actions class="mt-auto border-t border-slate-100 px-5 py-3">
          <p-button
            label="Open in bullseye &rarr;"
            severity="secondary"
            styleClass="w-full"
            (onClick)="openInBullseye.emit()"
          />
        </div>
      }
    </app-detail-panel-shell>
  `,
})
export class PositioningDetailPanelComponent {
  readonly bubble = input<PositioningBubble | null>(null);
  readonly countUnit = input<string>('products');
  readonly totalBubbles = input<number>(0);

  readonly clearSelection = output<void>();
  readonly openProduct = output<string>();
  readonly openInBullseye = output<void>();

  readonly fullLabel = computed(() => {
    const b = this.bubble();
    if (!b) return '';
    const k = b.group_keys;
    const parts = [
      k['moa_name'],
      k['therapeutic_area_name'],
      k['company_name'],
      k['roa_name'],
    ].filter(Boolean);
    return parts.length > 0 ? parts.join(' / ') : b.label;
  });

  readonly sortedProducts = computed<PositioningProduct[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    return [...b.products].sort((a, b2) => b2.highest_phase_rank - a.highest_phase_rank);
  });

  readonly phaseBreakdown = computed<PhaseCount[]>(() => {
    const b = this.bubble();
    if (!b) return [];
    const counts = new Map<RingPhase, number>();
    for (const p of b.products) {
      counts.set(p.highest_phase, (counts.get(p.highest_phase) ?? 0) + 1);
    }
    return [...RING_ORDER]
      .reverse()
      .filter((phase) => (counts.get(phase) ?? 0) > 0)
      .map((phase) => ({ phase, count: counts.get(phase)! }));
  });

  phaseColor(phase: RingPhase): string {
    return PHASE_COLOR[phase] ?? '#64748b';
  }
}
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-detail-panel.component.ts
git commit -m "feat: redesign positioning detail panel with phase breakdown, clickable products, cross-nav"
```

---

### Task 7: Positioning -- wire up new outputs in parent view

**Files:**
- Modify: `src/client/src/app/features/landscape/positioning-view.component.ts`

- [ ] **Step 1: Add Router import and inject it**

Add `Router` to the imports at the top of the file and inject it:

```typescript
import { ActivatedRoute, Router } from '@angular/router';
```

Add to the class after the existing injects:

```typescript
  private readonly router = inject(Router);
```

- [ ] **Step 2: Add tenantId signal and extract it in ngOnInit**

Add a `tenantId` signal alongside `spaceId`:

```typescript
  readonly tenantId = signal('');
```

In `ngOnInit()`, extract `tenantId` from the route alongside `spaceId`:

```typescript
  ngOnInit(): void {
    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('spaceId')) {
        this.spaceId.set(snap.paramMap.get('spaceId')!);
      }
      if (snap.paramMap.has('tenantId')) {
        this.tenantId.set(snap.paramMap.get('tenantId')!);
      }
      snap = snap.parent;
    }
  }
```

- [ ] **Step 3: Add handler methods for the new outputs**

Add these methods to the class:

```typescript
  onOpenProduct(productId: string): void {
    this.router.navigate(
      ['/t', this.tenantId(), 's', this.spaceId(), 'bullseye', 'by-therapy-area'],
      { queryParams: { product: productId } },
    );
  }

  onOpenInBullseye(): void {
    this.router.navigate(['/t', this.tenantId(), 's', this.spaceId(), 'bullseye', 'by-therapy-area']);
  }
```

- [ ] **Step 4: Wire the new outputs in the template**

In the template, update the `<app-positioning-detail-panel>` tag to bind the new outputs:

From:
```html
              <app-positioning-detail-panel
                [bubble]="selectedBubble()"
                [countUnit]="state.countUnit()"
                [totalBubbles]="data.bubbles.length"
                (clearSelection)="selectedBubble.set(null)"
              />
```

To:
```html
              <app-positioning-detail-panel
                [bubble]="selectedBubble()"
                [countUnit]="state.countUnit()"
                [totalBubbles]="data.bubbles.length"
                (clearSelection)="selectedBubble.set(null)"
                (openProduct)="onOpenProduct($event)"
                (openInBullseye)="onOpenInBullseye()"
              />
```

- [ ] **Step 5: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-view.component.ts
git commit -m "feat: wire positioning detail panel cross-navigation to bullseye"
```

---

### Task 8: Positioning tooltip -- fix separator

**Files:**
- Modify: `src/client/src/app/features/landscape/positioning-tooltip.component.ts:53`

- [ ] **Step 1: Change separator from " + " to " / "**

In `positioning-tooltip.component.ts` line 53, change:

```typescript
    return parts.length > 0 ? parts.join(' + ') : b.label;
```

To:

```typescript
    return parts.length > 0 ? parts.join(' / ') : b.label;
```

- [ ] **Step 2: Verify build**

Run: `cd src/client && npx ng build --configuration=development 2>&1 | tail -5`
Expected: Build succeeds

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/landscape/positioning-tooltip.component.ts
git commit -m "feat: use slash separator in positioning tooltip labels"
```

---

### Task 9: Final verification

- [ ] **Step 1: Run lint**

Run: `cd src/client && npx ng lint 2>&1 | tail -10`
Expected: No lint errors

- [ ] **Step 2: Run full build**

Run: `cd src/client && npx ng build 2>&1 | tail -10`
Expected: Build succeeds with no errors

- [ ] **Step 3: Fix any issues found, then commit fixes if needed**
