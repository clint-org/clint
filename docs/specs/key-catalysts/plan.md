# Key Catalysts Page Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a standalone Key Catalysts page that surfaces all upcoming markers in a dense table with adaptive time-bucket group headers and a detail panel.

**Architecture:** Two new RPC functions query the existing `markers` table (no schema changes). A new Angular feature module under `features/catalysts/` contains three components: a page component (smart), a table component (presenter), and a detail panel component (presenter). A pure utility function handles client-side time-bucket grouping. The page is lazy-loaded at `/t/:tenantId/s/:spaceId/catalysts`.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG 19 (p-table with row grouping), Tailwind CSS v4, Supabase RPC (PL/pgSQL)

---

### Task 1: Create TypeScript Interfaces

**Files:**
- Create: `src/client/src/app/core/models/catalyst.model.ts`

- [ ] **Step 1: Create the catalyst model file**

```typescript
// src/client/src/app/core/models/catalyst.model.ts

export interface Catalyst {
  marker_id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  category_name: string;
  category_id: string;
  marker_type_name: string;
  marker_type_icon: string | null;
  marker_type_color: string;
  marker_type_shape: string;
  is_projected: boolean;
  company_name: string | null;
  company_id: string | null;
  product_name: string | null;
  product_id: string | null;
  trial_name: string | null;
  trial_id: string | null;
  trial_phase: string | null;
  description: string | null;
  source_url: string | null;
}

export interface CatalystDetail {
  catalyst: Catalyst & {
    recruitment_status: string | null;
  };
  upcoming_markers: UpcomingMarker[];
  related_events: RelatedEvent[];
}

export interface UpcomingMarker {
  marker_id: string;
  title: string;
  event_date: string;
  marker_type_name: string;
  is_projected: boolean;
}

export interface RelatedEvent {
  event_id: string;
  title: string;
  event_date: string;
  category_name: string;
}

export interface CatalystFilters {
  category_ids?: string[];
  company_id?: string;
  product_id?: string;
}

export interface CatalystGroup {
  label: string;
  date_range: string;
  catalysts: Catalyst[];
}

/** Catalyst with computed time_bucket field for p-table row grouping. */
export interface FlatCatalyst extends Catalyst {
  time_bucket: string;
  time_bucket_range: string;
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/core/models/catalyst.model.ts`
Expected: All files pass linting

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/catalyst.model.ts
git commit -m "feat(catalysts): add TypeScript interfaces for Key Catalysts page"
```

---

### Task 2: Create Grouping Utility

**Files:**
- Create: `src/client/src/app/features/catalysts/group-catalysts.ts`

- [ ] **Step 1: Create the grouping utility**

This is a pure function that takes a flat chronological list of catalysts and groups them into adaptive time buckets: This Week, Next Week, then monthly (for the next 2 calendar months), then quarterly beyond that.

```typescript
// src/client/src/app/features/catalysts/group-catalysts.ts

import { Catalyst, CatalystGroup, FlatCatalyst } from '../../core/models/catalyst.model';

/**
 * Groups a chronologically-sorted list of catalysts into adaptive time buckets.
 * - Current ISO week -> "This Week"
 * - Next ISO week -> "Next Week"
 * - Next 2 calendar months -> monthly ("May 2026")
 * - Beyond that -> quarterly ("Q3 2026")
 */
export function groupCatalystsByTimePeriod(
  catalysts: Catalyst[],
  referenceDate: Date = new Date(),
): CatalystGroup[] {
  const groups = new Map<string, CatalystGroup>();

  for (const catalyst of catalysts) {
    const eventDate = parseDate(catalyst.event_date);
    const bucket = computeBucket(eventDate, referenceDate);

    if (!groups.has(bucket.key)) {
      groups.set(bucket.key, {
        label: bucket.label,
        date_range: bucket.dateRange,
        catalysts: [],
      });
    }
    groups.get(bucket.key)!.catalysts.push(catalyst);
  }

  return Array.from(groups.values());
}

/**
 * Flattens grouped catalysts back into a flat array with time_bucket fields
 * for use with PrimeNG p-table rowGroupMode="subheader".
 */
export function flattenGroupedCatalysts(groups: CatalystGroup[]): FlatCatalyst[] {
  return groups.flatMap((g) =>
    g.catalysts.map((c) => ({
      ...c,
      time_bucket: g.label,
      time_bucket_range: g.date_range,
    })),
  );
}

interface Bucket {
  key: string;
  label: string;
  dateRange: string;
}

function computeBucket(eventDate: Date, referenceDate: Date): Bucket {
  const refWeekStart = getISOWeekStart(referenceDate);
  const refWeekEnd = addDays(refWeekStart, 6);
  const nextWeekStart = addDays(refWeekStart, 7);
  const nextWeekEnd = addDays(refWeekStart, 13);

  // This Week
  if (eventDate >= refWeekStart && eventDate <= refWeekEnd) {
    return {
      key: `week-this`,
      label: 'This Week',
      dateRange: `${formatShort(refWeekStart)}\u2013${formatShort(refWeekEnd)}`,
    };
  }

  // Next Week
  if (eventDate >= nextWeekStart && eventDate <= nextWeekEnd) {
    return {
      key: `week-next`,
      label: 'Next Week',
      dateRange: `${formatShort(nextWeekStart)}\u2013${formatShort(nextWeekEnd)}`,
    };
  }

  // Monthly: within 2 calendar months after the reference month
  const monthBoundary = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() + 3,
    0,
  );
  if (eventDate <= monthBoundary) {
    const monthLabel = eventDate.toLocaleDateString('en-US', {
      month: 'long',
      year: 'numeric',
    });
    return {
      key: `month-${eventDate.getFullYear()}-${eventDate.getMonth()}`,
      label: monthLabel,
      dateRange: '',
    };
  }

  // Quarterly
  const quarter = Math.floor(eventDate.getMonth() / 3) + 1;
  return {
    key: `quarter-${eventDate.getFullYear()}-Q${quarter}`,
    label: `Q${quarter} ${eventDate.getFullYear()}`,
    dateRange: '',
  };
}

function getISOWeekStart(date: Date): Date {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const day = d.getDay();
  const diff = day === 0 ? -6 : 1 - day; // Monday = start of ISO week
  d.setDate(d.getDate() + diff);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

function parseDate(dateStr: string): Date {
  // Parse YYYY-MM-DD without timezone shift
  const [y, m, d] = dateStr.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function formatShort(date: Date): string {
  return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/features/catalysts/group-catalysts.ts`
Expected: All files pass linting

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/catalysts/group-catalysts.ts
git commit -m "feat(catalysts): add time-bucket grouping utility"
```

---

### Task 3: Create Database Migration (RPC Functions)

**Files:**
- Create: `supabase/migrations/20260414120000_key_catalysts_rpc.sql`

- [ ] **Step 1: Create the migration file with both RPC functions**

```sql
-- migration: 20260414120000_key_catalysts_rpc
-- purpose: RPC functions for the Key Catalysts page
-- affected functions (created): get_key_catalysts, get_catalyst_detail

-- ============================================================
-- 1. get_key_catalysts - forward-looking chronological feed
-- ============================================================

create or replace function public.get_key_catalysts(
  p_space_id      uuid,
  p_category_ids  uuid[]   default null,
  p_company_id    uuid     default null,
  p_product_id    uuid     default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  -- normalize empty arrays to null
  if p_category_ids = '{}' then p_category_ids := null; end if;

  select coalesce(jsonb_agg(row_data order by event_date asc, title asc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'marker_id',        m.id,
        'title',            m.title,
        'event_date',       m.event_date,
        'end_date',         m.end_date,
        'category_name',    mc.name,
        'category_id',      mc.id,
        'marker_type_name', mt.name,
        'marker_type_icon', mt.icon,
        'marker_type_color', mt.color,
        'marker_type_shape', mt.shape,
        'is_projected',     m.is_projected,
        'company_name',     co.name,
        'company_id',       co.id,
        'product_name',     pr.name,
        'product_id',       pr.id,
        'trial_name',       t.name,
        'trial_id',         t.id,
        'trial_phase',      t.phase,
        'description',      m.description,
        'source_url',       m.source_url
      ) as row_data,
      m.event_date,
      m.title
    from public.markers m
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    left join lateral (
      select ma_inner.trial_id
      from public.marker_assignments ma_inner
      where ma_inner.marker_id = m.id
      limit 1
    ) ma on true
    left join public.trials t on t.id = ma.trial_id
    left join public.products pr on pr.id = t.product_id
    left join public.companies co on co.id = pr.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_product_id is null or pr.id = p_product_id)
  ) sub;

  return result;
end;
$$;


-- ============================================================
-- 2. get_catalyst_detail - enriched single-catalyst view
-- ============================================================

create or replace function public.get_catalyst_detail(
  p_marker_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_catalyst   jsonb;
  v_trial_id   uuid;
  v_product_id uuid;
  v_company_id uuid;
  v_upcoming   jsonb;
  v_related    jsonb;
begin
  -- Fetch main catalyst data
  select
    jsonb_build_object(
      'marker_id',          m.id,
      'title',              m.title,
      'event_date',         m.event_date,
      'end_date',           m.end_date,
      'category_name',      mc.name,
      'category_id',        mc.id,
      'marker_type_name',   mt.name,
      'marker_type_icon',   mt.icon,
      'marker_type_color',  mt.color,
      'marker_type_shape',  mt.shape,
      'is_projected',       m.is_projected,
      'company_name',       co.name,
      'company_id',         co.id,
      'product_name',       pr.name,
      'product_id',         pr.id,
      'trial_name',         t.name,
      'trial_id',           t.id,
      'trial_phase',        t.phase,
      'recruitment_status', t.recruitment_status,
      'description',        m.description,
      'source_url',         m.source_url
    ),
    t.id,
    pr.id,
    co.id
  into v_catalyst, v_trial_id, v_product_id, v_company_id
  from public.markers m
  join public.marker_types mt on mt.id = m.marker_type_id
  join public.marker_categories mc on mc.id = mt.category_id
  left join lateral (
    select ma_inner.trial_id
    from public.marker_assignments ma_inner
    where ma_inner.marker_id = m.id
    limit 1
  ) ma on true
  left join public.trials t on t.id = ma.trial_id
  left join public.products pr on pr.id = t.product_id
  left join public.companies co on co.id = pr.company_id
  where m.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  -- Upcoming markers for the same trial (next 5, excluding current)
  if v_trial_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id',        sub.id,
      'title',            sub.title,
      'event_date',       sub.event_date,
      'marker_type_name', sub.mt_name,
      'is_projected',     sub.is_projected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name, m2.is_projected
      from public.markers m2
      join public.marker_types mt2 on mt2.id = m2.marker_type_id
      join public.marker_assignments ma2 on ma2.marker_id = m2.id
      where ma2.trial_id = v_trial_id
        and m2.event_date >= current_date
        and m2.id != p_marker_id
        and m2.no_longer_expected = false
      order by m2.event_date asc
      limit 5
    ) sub;
  else
    v_upcoming := '[]'::jsonb;
  end if;

  -- Related events for the same trial/product/company (last 10)
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',      sub.id,
    'title',         sub.title,
    'event_date',    sub.event_date,
    'category_name', sub.cat_name
  )), '[]'::jsonb)
  into v_related
  from (
    select e.id, e.title, e.event_date, ec.name as cat_name
    from public.events e
    join public.event_categories ec on ec.id = e.category_id
    where (
      (v_trial_id   is not null and e.trial_id   = v_trial_id)
      or (v_product_id is not null and e.product_id = v_product_id)
      or (v_company_id is not null and e.company_id = v_company_id)
    )
    order by e.event_date desc
    limit 10
  ) sub;

  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', v_upcoming,
    'related_events',   v_related
  );
end;
$$;
```

- [ ] **Step 2: Verify migration applies cleanly**

Run: `supabase db reset`
Expected: All migrations apply without errors, seed data loads successfully.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260414120000_key_catalysts_rpc.sql
git commit -m "feat(catalysts): add get_key_catalysts and get_catalyst_detail RPC functions"
```

---

### Task 4: Create CatalystService

**Files:**
- Create: `src/client/src/app/core/services/catalyst.service.ts`

- [ ] **Step 1: Create the service**

```typescript
// src/client/src/app/core/services/catalyst.service.ts

import { inject, Injectable } from '@angular/core';

import {
  Catalyst,
  CatalystDetail,
  CatalystFilters,
} from '../models/catalyst.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class CatalystService {
  private supabase = inject(SupabaseService);

  async getKeyCatalysts(
    spaceId: string,
    filters: CatalystFilters = {},
  ): Promise<Catalyst[]> {
    const { data, error } = await this.supabase.client.rpc('get_key_catalysts', {
      p_space_id: spaceId,
      p_category_ids:
        filters.category_ids && filters.category_ids.length > 0
          ? filters.category_ids
          : null,
      p_company_id: filters.company_id ?? null,
      p_product_id: filters.product_id ?? null,
    });
    if (error) throw error;
    return (data ?? []) as Catalyst[];
  }

  async getCatalystDetail(markerId: string): Promise<CatalystDetail> {
    const { data, error } = await this.supabase.client.rpc('get_catalyst_detail', {
      p_marker_id: markerId,
    });
    if (error) throw error;
    return data as CatalystDetail;
  }
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/core/services/catalyst.service.ts`
Expected: All files pass linting

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/services/catalyst.service.ts
git commit -m "feat(catalysts): add CatalystService for RPC calls"
```

---

### Task 5: Create CatalystDetailPanelComponent

**Files:**
- Create: `src/client/src/app/features/catalysts/catalyst-detail-panel.component.ts`

- [ ] **Step 1: Create the detail panel component**

This component follows the same pattern as `EventDetailPanelComponent` (see `src/client/src/app/features/events/event-detail-panel.component.ts`). Uses `input()` and `output()` signals, `DatePipe`, and the same Tailwind typography/spacing conventions.

```typescript
// src/client/src/app/features/catalysts/catalyst-detail-panel.component.ts

import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';

import { CatalystDetail } from '../../core/models/catalyst.model';

@Component({
  selector: 'app-catalyst-detail-panel',
  standalone: true,
  imports: [DatePipe],
  template: `
    <div class="flex h-full flex-col overflow-hidden border-l border-slate-200 bg-white">
      <!-- Panel header -->
      <div class="flex shrink-0 items-start justify-between gap-3 border-b border-slate-100 px-5 py-4">
        <div class="min-w-0 flex-1">
          <p class="text-[10px] font-semibold uppercase tracking-widest text-teal-600">
            {{ detail()!.catalyst.category_name }} &middot; {{ detail()!.catalyst.marker_type_name }}
          </p>
        </div>
        <button
          type="button"
          class="flex h-7 w-7 shrink-0 items-center justify-center rounded text-slate-400 hover:bg-slate-100 hover:text-slate-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
          (click)="panelClose.emit()"
          aria-label="Close detail panel"
        >
          <i class="fa-solid fa-xmark text-xs"></i>
        </button>
      </div>

      <!-- Panel body (scrollable) -->
      <div class="flex-1 overflow-y-auto px-5 py-4">
        @if (detail(); as d) {
          <!-- Title -->
          <h2 class="mb-3 text-sm font-semibold leading-snug text-slate-900">
            {{ d.catalyst.title }}
          </h2>

          <!-- Date & Status -->
          <div class="mb-4 flex items-center gap-4 text-xs text-slate-500">
            <div>
              <span class="font-semibold">Date</span><br />
              {{ d.catalyst.event_date | date:'mediumDate' }}
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
                {{ d.catalyst.source_url }}
                <i class="fa-solid fa-arrow-up-right-from-square text-[9px]"></i>
              </a>
            </div>
          }

          <!-- Trial Context -->
          @if (d.catalyst.trial_name) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
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

          <!-- Program -->
          @if (d.catalyst.company_name) {
            <div class="mb-4">
              <p class="mb-1.5 text-[10px] font-semibold uppercase tracking-widest text-slate-400">
                Program
              </p>
              <p class="text-xs text-slate-900">
                <span class="uppercase">{{ d.catalyst.company_name }}</span>
                @if (d.catalyst.product_name) {
                  &middot; {{ d.catalyst.product_name }}
                }
              </p>
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
                    {{ um.event_date | date:'MMM yyyy' }} &middot;
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
                    {{ re.event_date | date:'mediumDate' }} &mdash; {{ re.title }}
                    <span class="text-slate-300">({{ re.category_name }})</span>
                  </li>
                }
              </ul>
            </div>
          }
        }
      </div>
    </div>
  `,
})
export class CatalystDetailPanelComponent {
  readonly detail = input<CatalystDetail | null>(null);
  readonly panelClose = output<void>();
  readonly markerClick = output<string>();
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/features/catalysts/catalyst-detail-panel.component.ts`
Expected: All files pass linting

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/catalysts/catalyst-detail-panel.component.ts
git commit -m "feat(catalysts): add CatalystDetailPanelComponent"
```

---

### Task 6: Create CatalystTableComponent

**Files:**
- Create: `src/client/src/app/features/catalysts/catalyst-table.component.ts`

- [ ] **Step 1: Create the table component**

Uses PrimeNG `p-table` with `rowGroupMode="subheader"` and `groupRowsBy="time_bucket"`. The table receives a flat array of `FlatCatalyst[]` (already grouped and flattened by the page component). Each row shows date (monospace), category dot + label, title, company/product, and confirmed/projected status badge.

```typescript
// src/client/src/app/features/catalysts/catalyst-table.component.ts

import { Component, input, output } from '@angular/core';
import { DatePipe } from '@angular/common';
import { TableModule } from 'primeng/table';

import { FlatCatalyst } from '../../core/models/catalyst.model';

@Component({
  selector: 'app-catalyst-table',
  standalone: true,
  imports: [DatePipe, TableModule],
  template: `
    <p-table
      [value]="catalysts()"
      [rowGroupMode]="'subheader'"
      groupRowsBy="time_bucket"
      [scrollable]="true"
      scrollHeight="flex"
      dataKey="marker_id"
      styleClass="catalyst-table"
    >
      <ng-template #header>
        <tr>
          <th class="w-[80px]">Date</th>
          <th class="w-[110px]">Category</th>
          <th>Catalyst</th>
          <th class="w-[200px]">Company / Product</th>
          <th class="w-[90px]">Status</th>
        </tr>
      </ng-template>

      <ng-template #groupheader let-catalyst>
        <tr class="catalyst-group-header">
          <td colspan="5">
            <div
              class="flex items-baseline gap-2 px-1 py-1 text-[10px] font-bold uppercase tracking-widest"
              [class.text-teal-700]="catalyst.time_bucket === 'This Week'"
              [class.text-slate-500]="catalyst.time_bucket !== 'This Week'"
            >
              {{ catalyst.time_bucket }}
              @if (catalyst.time_bucket_range) {
                <span class="font-normal tracking-normal text-slate-400">
                  {{ catalyst.time_bucket_range }}
                </span>
              }
            </div>
          </td>
        </tr>
      </ng-template>

      <ng-template #body let-catalyst>
        <tr
          class="cursor-pointer transition-colors hover:bg-slate-50"
          [class.selected-row]="catalyst.marker_id === selectedId()"
          (click)="rowSelect.emit(catalyst.marker_id)"
          (keydown.enter)="rowSelect.emit(catalyst.marker_id)"
          tabindex="0"
          role="button"
          [attr.aria-label]="'View details for ' + catalyst.title"
          [attr.aria-pressed]="catalyst.marker_id === selectedId()"
        >
          <td class="font-mono text-xs tabular-nums text-slate-500">
            {{ catalyst.event_date | date:'MMM dd' }}
          </td>
          <td>
            <span class="inline-flex items-center gap-1.5">
              <span
                class="inline-block h-2 w-2 shrink-0"
                [style.background]="catalyst.marker_type_color"
                [class.rounded-full]="catalyst.marker_type_shape === 'circle'"
                [style.transform]="catalyst.marker_type_shape === 'diamond' ? 'rotate(45deg)' : 'none'"
              ></span>
              <span class="text-xs text-slate-500">{{ catalyst.category_name }}</span>
            </span>
          </td>
          <td class="text-sm font-medium text-slate-900">{{ catalyst.title }}</td>
          <td class="text-xs text-slate-500">
            @if (catalyst.company_name) {
              <span class="uppercase">{{ catalyst.company_name }}</span>
              @if (catalyst.product_name) {
                <span> &middot; {{ catalyst.product_name }}</span>
              }
            }
          </td>
          <td>
            @if (catalyst.is_projected) {
              <span
                class="inline-block rounded bg-amber-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-amber-600"
              >
                Projected
              </span>
            } @else {
              <span
                class="inline-block rounded bg-green-50 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-green-600"
              >
                Confirmed
              </span>
            }
          </td>
        </tr>
      </ng-template>

      <ng-template #emptymessage>
        <tr>
          <td colspan="5" class="py-8 text-center text-sm text-slate-400">
            No upcoming catalysts match your filters.
          </td>
        </tr>
      </ng-template>
    </p-table>
  `,
  styles: `
    :host ::ng-deep .catalyst-table {
      .p-datatable-thead > tr > th {
        @apply bg-slate-50 text-[10px] font-bold uppercase tracking-wide text-slate-500 border-b border-slate-200;
        padding: 0.5rem 0.75rem;
      }
      .p-datatable-tbody > tr > td {
        padding: 0.5rem 0.75rem;
        border-bottom: 1px solid theme('colors.slate.100');
      }
      .p-datatable-tbody > tr.selected-row > td {
        @apply bg-teal-50;
        border-color: theme('colors.teal.200');
      }
      .catalyst-group-header td {
        @apply bg-slate-50 border-b border-slate-200;
        padding: 0.25rem 0.75rem;
      }
      .catalyst-group-header:first-child td {
        @apply bg-teal-50/50 border-teal-200;
      }
    }
  `,
})
export class CatalystTableComponent {
  readonly catalysts = input.required<FlatCatalyst[]>();
  readonly selectedId = input<string | null>(null);
  readonly rowSelect = output<string>();
}
```

- [ ] **Step 2: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/features/catalysts/catalyst-table.component.ts`
Expected: All files pass linting

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/catalysts/catalyst-table.component.ts
git commit -m "feat(catalysts): add CatalystTableComponent with row grouping"
```

---

### Task 7: Create CatalystsPageComponent

**Files:**
- Create: `src/client/src/app/features/catalysts/catalysts-page.component.ts`
- Create: `src/client/src/app/features/catalysts/catalysts-page.component.html`

- [ ] **Step 1: Create the page component TypeScript**

This follows the same pattern as `EventsPageComponent` (see `src/client/src/app/features/events/events-page.component.ts`). Uses `ManagePageShellComponent` with eyebrow="Intelligence", manages filter state with signals, fetches via `CatalystService`, and groups results via the utility function.

```typescript
// src/client/src/app/features/catalysts/catalysts-page.component.ts

import { Component, computed, inject, OnInit, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { ActivatedRoute } from '@angular/router';
import { MessageModule } from 'primeng/message';
import { MultiSelectModule } from 'primeng/multiselect';
import { ProgressSpinner } from 'primeng/progressspinner';
import { SelectModule } from 'primeng/select';
import { InputTextModule } from 'primeng/inputtext';

import { Catalyst, CatalystDetail, FlatCatalyst } from '../../core/models/catalyst.model';
import { MarkerCategory } from '../../core/models/marker.model';
import { Company } from '../../core/models/company.model';
import { Product } from '../../core/models/product.model';
import { CatalystService } from '../../core/services/catalyst.service';
import { MarkerCategoryService } from '../../core/services/marker-category.service';
import { CompanyService } from '../../core/services/company.service';
import { ProductService } from '../../core/services/product.service';
import { ManagePageShellComponent } from '../../shared/components/manage-page-shell.component';
import { CatalystTableComponent } from './catalyst-table.component';
import { CatalystDetailPanelComponent } from './catalyst-detail-panel.component';
import {
  groupCatalystsByTimePeriod,
  flattenGroupedCatalysts,
} from './group-catalysts';

@Component({
  selector: 'app-catalysts-page',
  standalone: true,
  imports: [
    DatePipe,
    FormsModule,
    MessageModule,
    MultiSelectModule,
    ProgressSpinner,
    SelectModule,
    InputTextModule,
    ManagePageShellComponent,
    CatalystTableComponent,
    CatalystDetailPanelComponent,
  ],
  templateUrl: './catalysts-page.component.html',
})
export class CatalystsPageComponent implements OnInit {
  private catalystService = inject(CatalystService);
  private markerCategoryService = inject(MarkerCategoryService);
  private companyService = inject(CompanyService);
  private productService = inject(ProductService);
  private route = inject(ActivatedRoute);

  private spaceId = '';

  // Data
  readonly rawCatalysts = signal<Catalyst[]>([]);
  readonly markerCategories = signal<MarkerCategory[]>([]);
  readonly companies = signal<Company[]>([]);
  readonly products = signal<Product[]>([]);

  // UI state
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  // Server-side filters
  readonly selectedCategoryIds = signal<string[]>([]);
  readonly selectedCompanyId = signal<string | null>(null);
  readonly selectedProductId = signal<string | null>(null);

  // Client-side search
  readonly searchText = signal('');

  // Detail panel
  readonly selectedMarkerId = signal<string | null>(null);
  readonly selectedDetail = signal<CatalystDetail | null>(null);
  readonly detailLoading = signal(false);

  // Computed: filter options
  readonly categoryOptions = computed(() =>
    this.markerCategories().map((c) => ({ label: c.name, value: c.id })),
  );

  readonly companyOptions = computed(() =>
    this.companies().map((c) => ({ label: c.name, value: c.id })),
  );

  readonly filteredProductOptions = computed(() => {
    const companyId = this.selectedCompanyId();
    const prods = companyId
      ? this.products().filter((p) => p.company_id === companyId)
      : this.products();
    return prods.map((p) => ({ label: p.name, value: p.id }));
  });

  // Computed: apply client-side search, then group
  readonly filteredCatalysts = computed(() => {
    const search = this.searchText().toLowerCase().trim();
    if (!search) return this.rawCatalysts();
    return this.rawCatalysts().filter(
      (c) =>
        c.title.toLowerCase().includes(search) ||
        (c.company_name?.toLowerCase().includes(search) ?? false) ||
        (c.product_name?.toLowerCase().includes(search) ?? false) ||
        c.marker_type_name.toLowerCase().includes(search) ||
        c.category_name.toLowerCase().includes(search),
    );
  });

  readonly groups = computed(() =>
    groupCatalystsByTimePeriod(this.filteredCatalysts()),
  );

  readonly flatCatalysts = computed<FlatCatalyst[]>(() =>
    flattenGroupedCatalysts(this.groups()),
  );

  readonly totalCount = computed(() => this.rawCatalysts().length);

  async ngOnInit(): Promise<void> {
    this.spaceId = this.getSpaceId();
    await this.loadInitialData();
  }

  async onCategoryChange(ids: string[] | null): Promise<void> {
    this.selectedCategoryIds.set(ids ?? []);
    await this.loadCatalysts();
  }

  async onCompanyChange(companyId: string | null): Promise<void> {
    this.selectedCompanyId.set(companyId);
    // Clear product filter when company changes
    this.selectedProductId.set(null);
    await this.loadCatalysts();
  }

  async onProductChange(productId: string | null): Promise<void> {
    this.selectedProductId.set(productId);
    await this.loadCatalysts();
  }

  async onRowClick(markerId: string): Promise<void> {
    // Toggle: clicking the same row closes the panel
    if (this.selectedMarkerId() === markerId) {
      this.selectedMarkerId.set(null);
      this.selectedDetail.set(null);
      return;
    }

    this.selectedMarkerId.set(markerId);
    this.selectedDetail.set(null);
    this.detailLoading.set(true);

    try {
      const detail = await this.catalystService.getCatalystDetail(markerId);
      // Only apply if the same marker is still selected
      if (this.selectedMarkerId() === markerId) {
        this.selectedDetail.set(detail);
      }
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Could not load catalyst detail.',
      );
    } finally {
      this.detailLoading.set(false);
    }
  }

  closePanel(): void {
    this.selectedMarkerId.set(null);
    this.selectedDetail.set(null);
  }

  async clearFilters(): Promise<void> {
    this.selectedCategoryIds.set([]);
    this.selectedCompanyId.set(null);
    this.selectedProductId.set(null);
    this.searchText.set('');
    await this.loadCatalysts();
  }

  private async loadInitialData(): Promise<void> {
    this.loading.set(true);
    try {
      const [catalysts, categories, companies, products] = await Promise.all([
        this.catalystService.getKeyCatalysts(this.spaceId),
        this.markerCategoryService.list(this.spaceId),
        this.companyService.list(this.spaceId),
        this.productService.list(this.spaceId),
      ]);
      this.rawCatalysts.set(catalysts);
      this.markerCategories.set(categories);
      this.companies.set(companies);
      this.products.set(products);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load catalysts.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private async loadCatalysts(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const catalysts = await this.catalystService.getKeyCatalysts(this.spaceId, {
        category_ids: this.selectedCategoryIds().length
          ? this.selectedCategoryIds()
          : undefined,
        company_id: this.selectedCompanyId() ?? undefined,
        product_id: this.selectedProductId() ?? undefined,
      });
      this.rawCatalysts.set(catalysts);
    } catch (err) {
      this.error.set(
        err instanceof Error ? err.message : 'Failed to load catalysts.',
      );
    } finally {
      this.loading.set(false);
    }
  }

  private getSpaceId(): string {
    let route = this.route.snapshot;
    while (route) {
      const id = route.paramMap.get('spaceId');
      if (id) return id;
      if (!route.parent) break;
      route = route.parent;
    }
    return '';
  }
}
```

- [ ] **Step 2: Create the page component template**

```html
<!-- src/client/src/app/features/catalysts/catalysts-page.component.html -->

<app-manage-page-shell
  eyebrow="Intelligence"
  title="Key Catalysts"
  [count]="totalCount()"
>
  @if (error()) {
    <p-message severity="error" [closable]="false" styleClass="mb-4">{{ error() }}</p-message>
  }

  <!-- Filter bar -->
  <div class="flex items-center gap-3 border-b border-slate-200 bg-white px-4 py-2.5">
    <div class="flex items-center gap-2">
      <label
        for="catalyst-category-filter"
        class="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
      >
        Category
      </label>
      <p-multiselect
        inputId="catalyst-category-filter"
        [options]="categoryOptions()"
        [ngModel]="selectedCategoryIds()"
        (ngModelChange)="onCategoryChange($event)"
        optionLabel="label"
        optionValue="value"
        placeholder="All Categories"
        [showClear]="true"
        [style]="{ minWidth: '10rem' }"
        size="small"
      />
    </div>

    <div class="flex items-center gap-2">
      <label
        for="catalyst-company-filter"
        class="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
      >
        Company
      </label>
      <p-select
        inputId="catalyst-company-filter"
        [options]="companyOptions()"
        [ngModel]="selectedCompanyId()"
        (ngModelChange)="onCompanyChange($event)"
        optionLabel="label"
        optionValue="value"
        placeholder="All Companies"
        [showClear]="true"
        [filter]="true"
        filterPlaceholder="Search..."
        [style]="{ minWidth: '10rem' }"
        size="small"
      />
    </div>

    <div class="flex items-center gap-2">
      <label
        for="catalyst-product-filter"
        class="text-[10px] font-semibold uppercase tracking-wide text-slate-500"
      >
        Product
      </label>
      <p-select
        inputId="catalyst-product-filter"
        [options]="filteredProductOptions()"
        [ngModel]="selectedProductId()"
        (ngModelChange)="onProductChange($event)"
        optionLabel="label"
        optionValue="value"
        placeholder="All Products"
        [showClear]="true"
        [filter]="true"
        filterPlaceholder="Search..."
        [style]="{ minWidth: '10rem' }"
        size="small"
      />
    </div>

    <div class="ml-auto">
      <input
        pInputText
        type="text"
        placeholder="Search catalysts..."
        [ngModel]="searchText()"
        (ngModelChange)="searchText.set($event)"
        class="text-sm"
        aria-label="Search catalysts"
      />
    </div>
  </div>

  <!-- Main content: table + detail panel -->
  <div class="flex flex-1 overflow-hidden" [class.divide-x]="selectedMarkerId()">
    <!-- Table -->
    <div class="min-w-0 flex-1 overflow-hidden">
      @if (loading() && rawCatalysts().length === 0) {
        <div class="flex items-center justify-center py-16">
          <p-progressSpinner strokeWidth="3" [style]="{ width: '32px', height: '32px' }" />
        </div>
      } @else {
        <app-catalyst-table
          [catalysts]="flatCatalysts()"
          [selectedId]="selectedMarkerId()"
          (rowSelect)="onRowClick($event)"
        />
      }
    </div>

    <!-- Detail panel (380px) -->
    @if (selectedMarkerId()) {
      <div class="w-[380px] shrink-0">
        @if (detailLoading()) {
          <div class="flex h-full items-center justify-center py-12">
            <p-progressSpinner strokeWidth="3" [style]="{ width: '28px', height: '28px' }" />
          </div>
        } @else {
          <app-catalyst-detail-panel
            [detail]="selectedDetail()"
            (panelClose)="closePanel()"
            (markerClick)="onRowClick($event)"
          />
        }
      </div>
    }
  </div>
</app-manage-page-shell>
```

- [ ] **Step 3: Verify lint passes**

Run: `cd src/client && npx ng lint --files src/app/features/catalysts/catalysts-page.component.ts`
Expected: All files pass linting

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/catalysts/
git commit -m "feat(catalysts): add CatalystsPageComponent with filters and detail panel"
```

---

### Task 8: Add Routing and Navigation

**Files:**
- Modify: `src/client/src/app/app.routes.ts:227-233`
- Modify: `src/client/src/app/core/layout/header.component.ts:123-129`

- [ ] **Step 1: Add the catalysts route**

In `src/client/src/app/app.routes.ts`, add the catalysts route right after the events route (line 233). The route is at the same level as `events`:

```typescript
// After the events route block (line 228-233), add:
          {
            path: 'catalysts',
            loadComponent: () =>
              import('./features/catalysts/catalysts-page.component').then(
                (m) => m.CatalystsPageComponent,
              ),
          },
```

- [ ] **Step 2: Add the navigation link**

In `src/client/src/app/core/layout/header.component.ts`, add a "Catalysts" nav link after the Events link (after line 129). Follow the exact same pattern:

```html
            <a
              [routerLink]="spaceBase().concat('catalysts')"
              routerLinkActive="nav-active"
              class="nav-link"
            >
              Catalysts
            </a>
```

- [ ] **Step 3: Verify lint and build pass**

Run: `cd src/client && ng lint && ng build`
Expected: No lint errors, build succeeds

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/app.routes.ts src/client/src/app/core/layout/header.component.ts
git commit -m "feat(catalysts): add route and navigation link"
```

---

### Task 9: Build Verification and Cleanup

**Files:** None (verification only)

- [ ] **Step 1: Run full lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: Zero lint errors, zero build errors, clean output

- [ ] **Step 2: Verify migration applies cleanly on fresh database**

Run: `supabase db reset`
Expected: All migrations apply, seed data loads, no errors

- [ ] **Step 3: Start the app and verify the page loads**

Run: `cd src/client && ng serve`
Then navigate to the catalysts page in the browser. Verify:
- Page loads without console errors
- Filter bar renders with Category, Company, Product dropdowns and search input
- Table shows group headers and catalyst rows (if future-dated markers exist in seed data)
- Clicking a row opens the detail panel
- Clicking X closes the detail panel
- Filters narrow the results
- Search filters client-side

- [ ] **Step 4: Final commit if any adjustments were needed**

```bash
git add -A
git commit -m "fix(catalysts): address build/lint issues from verification"
```
