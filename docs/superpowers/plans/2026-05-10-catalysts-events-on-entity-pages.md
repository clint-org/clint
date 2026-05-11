# Catalysts and Events on Entity Detail Pages: Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Surface the existing landscape timeline plus a scoped events panel on the three entity detail pages (trial, product, company), each filtered to the page's entity with a default time window tuned per scope.

**Architecture:** Reuse `TimelineViewComponent` with locked `LandscapeStateService` filters per entity page. Reuse the existing `get_events_page_data` RPC, extended once to roll up events through trial → product → company. Add one new shared component (`EntityEventsPanelComponent`). No new chart types, no schema changes, no dedupe logic between markers and events.

**Tech Stack:** Angular 21 (standalone, signals, OnPush, native control flow), Tailwind v4, PrimeNG, Supabase Postgres, Vitest (units + integration) and Playwright (component units + e2e).

**Spec reference:** `docs/superpowers/specs/2026-05-10-catalysts-events-on-entity-pages-design.md`

> **Heads up on terminology:** at plan-writing time, a `products` → `assets` rename was staged in the working tree. Paths below assume the pre-rename state (`features/manage/products/product-detail.component.*`, `core/services/product.service.ts`, `core/models/product.model.ts`). If the rename has landed before this plan executes, substitute `assets` for `products` and `asset` for `product` in the affected paths and class names. The behavior is unchanged.

---

## File map

### Frontend (Angular)

**Modify:**

- `src/client/src/app/core/models/landscape.model.ts`: add `trialIds: string[]` to `LandscapeFilters` and `EMPTY_LANDSCAPE_FILTERS`.
- `src/client/src/app/features/landscape/landscape-state.service.ts`: export `filterDashboardData`, apply trial filter, add `disablePersistence` option on `init()`.
- `src/client/src/app/features/landscape/timeline-view.component.ts`: promote `startYear`/`endYear` to optional inputs; gate auto-fit effect.
- `src/client/src/app/features/manage/trials/trial-detail.component.ts`: provide own `LandscapeStateService`, mount `<app-timeline-view>` and `<app-entity-events-panel>`.
- `src/client/src/app/features/manage/trials/trial-detail.component.html`: add Timeline section above the existing Markers table; add Events panel.
- `src/client/src/app/features/manage/products/product-detail.component.ts`: same wiring with product-scoped filter.
- `src/client/src/app/features/manage/products/product-detail.component.html`: add Timeline + Events panel.
- `src/client/src/app/features/manage/companies/company-detail.component.ts`: same wiring with company-scoped filter, plus forward-8q year inputs.
- `src/client/src/app/features/manage/companies/company-detail.component.html`: add Timeline + Events panel.

**Create:**

- `src/client/src/app/features/landscape/landscape-state.service.spec.ts`: Vitest unit tests for `filterDashboardData`.
- `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.ts`
- `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.html`
- `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.service.ts`: thin wrapper around `get_events_page_data`.
- `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.spec.ts`: Playwright unit test.

### Backend (Supabase)

**Create:**

- `supabase/migrations/20260510120000_events_rpc_hierarchical_scope.sql`: rewrite of `get_events_page_data` extending the events half of the union to roll up through `trial -> product -> company`.
- `src/client/integration/tests/events-hierarchical-scope.spec.ts`: Vitest integration test against local Supabase.

### Docs

- Regenerate runbook auto-gen blocks via `npm run docs:arch` from `src/client/`.

---

## Phase 1: Foundation changes to `LandscapeStateService` and `TimelineViewComponent`

### Task 1: Add `trialIds` filter to `LandscapeStateService`

**Files:**

- Modify: `src/client/src/app/core/models/landscape.model.ts:135-157`
- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts:222-298`
- Create: `src/client/src/app/features/landscape/landscape-state.service.spec.ts`

- [ ] **Step 1: Export `filterDashboardData` for testing**

Edit `src/client/src/app/features/landscape/landscape-state.service.ts` line 224, change:

```typescript
function filterDashboardData(companies: Company[], filters: LandscapeFilters): Company[] {
```

to:

```typescript
export function filterDashboardData(companies: Company[], filters: LandscapeFilters): Company[] {
```

- [ ] **Step 2: Write the failing spec**

Create `src/client/src/app/features/landscape/landscape-state.service.spec.ts`:

```typescript
import { describe, expect, it } from 'vitest';

import type { Company } from '../../core/models/company.model';
import { EMPTY_LANDSCAPE_FILTERS, type LandscapeFilters } from '../../core/models/landscape.model';

import { filterDashboardData } from './landscape-state.service';

function makeFixture(): Company[] {
  return [
    {
      id: 'c1',
      name: 'Co1',
      products: [
        {
          id: 'p1',
          name: 'Prod1',
          company_id: 'c1',
          mechanisms_of_action: [],
          routes_of_administration: [],
          trials: [
            { id: 't1', name: 'Trial1', product_id: 'p1', markers: [] } as any,
            { id: 't2', name: 'Trial2', product_id: 'p1', markers: [] } as any,
          ],
        } as any,
      ],
    } as Company,
  ];
}

describe('filterDashboardData', () => {
  it('passes through every trial when filters are empty', () => {
    const result = filterDashboardData(makeFixture(), { ...EMPTY_LANDSCAPE_FILTERS });
    expect(result[0].products![0].trials!.map((t) => t.id)).toEqual(['t1', 't2']);
  });

  it('keeps only trials whose id is in trialIds', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['t2'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result[0].products![0].trials!.map((t) => t.id)).toEqual(['t2']);
  });

  it('drops a product when trialIds matches none of its trials', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['nope'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result).toEqual([]);
  });

  it('keeps multiple matching trials and preserves order', () => {
    const filters: LandscapeFilters = { ...EMPTY_LANDSCAPE_FILTERS, trialIds: ['t2', 't1'] };
    const result = filterDashboardData(makeFixture(), filters);
    expect(result[0].products![0].trials!.map((t) => t.id)).toEqual(['t1', 't2']);
  });
});
```

- [ ] **Step 3: Run the spec and confirm it fails**

Run from `src/client/`:

```bash
npm run test:units -- landscape-state.service.spec.ts
```

Expected: FAIL, with TypeScript error about `trialIds` not being assignable to `LandscapeFilters`.

- [ ] **Step 4: Add `trialIds` to the model**

Edit `src/client/src/app/core/models/landscape.model.ts` line 135-157. Replace the interface and constant with:

```typescript
export interface LandscapeFilters {
  companyIds: string[];
  productIds: string[];
  trialIds: string[];
  therapeuticAreaIds: string[];
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  phases: RingPhase[];
  recruitmentStatuses: string[];
  studyTypes: string[];
  markerCategoryIds: string[];
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  companyIds: [],
  productIds: [],
  trialIds: [],
  therapeuticAreaIds: [],
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
  markerCategoryIds: [],
};
```

- [ ] **Step 5: Apply the new filter in `filterDashboardData`**

Edit `src/client/src/app/features/landscape/landscape-state.service.ts`. Find the trial-level filtering block (around lines 252-277) and add the `trialIds` filter as the first trial-level check, before therapeutic-area / phase / status filters:

```typescript
let trials = p.trials ?? [];

if (filters.trialIds.length > 0) {
  trials = trials.filter((t) => filters.trialIds.includes(t.id));
}

if (filters.therapeuticAreaIds.length > 0) {
  trials = trials.filter(
    (t) =>
      t.therapeutic_area_id && filters.therapeuticAreaIds.includes(t.therapeutic_area_id)
  );
}
// ... rest of trial filters unchanged
```

- [ ] **Step 6: Run the spec and confirm it passes**

```bash
npm run test:units -- landscape-state.service.spec.ts
```

Expected: PASS, 4/4 tests green.

- [ ] **Step 7: Lint and build to catch regressions**

```bash
npm run lint && ng build
```

Expected: both clean (the unrelated `products`-rename build errors may be present in working tree; if so, they pre-date this task and are not part of this commit).

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts \
        src/client/src/app/features/landscape/landscape-state.service.ts \
        src/client/src/app/features/landscape/landscape-state.service.spec.ts
git commit -m "feat(landscape): add trialIds filter for per-trial scoping"
```

---

### Task 2: Add `disablePersistence` option to `LandscapeStateService.init`

**Files:**

- Modify: `src/client/src/app/features/landscape/landscape-state.service.ts:91-105, 113-119`

- [ ] **Step 1: Add a `disablePersistence` field and update `init` signature**

Edit `src/client/src/app/features/landscape/landscape-state.service.ts`. Add a new private signal under the storage-key declaration (around line 47):

```typescript
private storageKey = '';
private spaceId = '';
private disablePersistence = false;
```

Update the `init` method (lines 113-119) to:

```typescript
async init(spaceId: string, opts?: { disablePersistence?: boolean }): Promise<void> {
  this.spaceId = spaceId;
  this.spaceIdSig.set(spaceId);
  this.disablePersistence = opts?.disablePersistence ?? false;
  this.storageKey = STORAGE_PREFIX + spaceId;
  if (!this.disablePersistence) {
    this.restorePersistedState();
  }
  await this.loadData();
}
```

- [ ] **Step 2: Gate the persist effect**

Edit the `persistEffect` (lines 91-105). Add an early return when persistence is disabled:

```typescript
private readonly persistEffect = effect(() => {
  // Read signals first so the effect tracks them, even when we skip writing.
  const state: PersistedLandscapeState = {
    filters: this.filters(),
    zoomLevel: this.zoomLevel(),
    spokeMode: this.spokeMode(),
    positioningGrouping: this.positioningGrouping(),
    countUnit: this.countUnit(),
  };
  if (!this.storageKey || this.disablePersistence) return;
  try {
    sessionStorage.setItem(this.storageKey, JSON.stringify(state));
  } catch {
    // Storage full or unavailable -- silently ignore.
  }
});
```

- [ ] **Step 3: Lint and build**

```bash
cd src/client && npm run lint && ng build
```

Expected: both clean.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/landscape-state.service.ts
git commit -m "feat(landscape): add disablePersistence option to state service init"
```

---

### Task 3: Make `startYear`/`endYear` optional inputs on `TimelineViewComponent`

**Files:**

- Modify: `src/client/src/app/features/landscape/timeline-view.component.ts:36-99`

- [ ] **Step 1: Promote `startYear` and `endYear` to optional inputs and gate the auto-fit effect**

Edit `src/client/src/app/features/landscape/timeline-view.component.ts`. The current shape has internal `signal<number>` for both years and an effect that writes to them. We need an optional override pattern: if a parent provides a year, use it; otherwise auto-fit. Replace the relevant block (lines 36-99) with:

```typescript
export class TimelineViewComponent {
  private readonly router = inject(Router);
  private readonly route = inject(ActivatedRoute);
  readonly state = inject(LandscapeStateService);

  /** Optional caller-supplied window. When null, the component auto-fits to data. */
  readonly startYearInput = input<number | null>(null, { alias: 'startYear' });
  readonly endYearInput = input<number | null>(null, { alias: 'endYear' });

  readonly tenantId = signal('');
  readonly spaceId = signal('');

  private readonly autoStartYear = signal(2016);
  private readonly autoEndYear = signal(2026);

  readonly startYear = computed(() => this.startYearInput() ?? this.autoStartYear());
  readonly endYear = computed(() => this.endYearInput() ?? this.autoEndYear());

  readonly exportDialogOpen = signal(false);
  readonly companies = computed(() => this.state.filteredCompanies());
  protected readonly skeletonRows = [0, 1, 2, 3, 4, 5];

  constructor() {
    const destroyRef = inject(DestroyRef);
    const exportHandler = () => {
      if (this.companies().length > 0) {
        this.exportDialogOpen.set(true);
      }
    };
    document.addEventListener('landscape:export', exportHandler);
    destroyRef.onDestroy(() => document.removeEventListener('landscape:export', exportHandler));

    let snap: import('@angular/router').ActivatedRouteSnapshot | null = this.route.snapshot;
    while (snap) {
      if (snap.paramMap.has('tenantId')) this.tenantId.set(snap.paramMap.get('tenantId')!);
      if (snap.paramMap.has('spaceId')) this.spaceId.set(snap.paramMap.get('spaceId')!);
      snap = snap.parent;
    }

    effect(() => {
      // Skip auto-fit when caller provides both year inputs.
      if (this.startYearInput() !== null && this.endYearInput() !== null) return;

      const companies = this.companies();
      if (!companies.length) return;

      let minYear = Infinity;
      let maxYear = -Infinity;

      for (const company of companies) {
        for (const product of company.products ?? []) {
          for (const trial of product.trials ?? []) {
            if (trial.phase_start_date) {
              const sy = new Date(trial.phase_start_date).getFullYear();
              if (sy < minYear) minYear = sy;
            }
            if (trial.phase_end_date) {
              const ey = new Date(trial.phase_end_date).getFullYear();
              if (ey > maxYear) maxYear = ey;
            }
            for (const marker of trial.markers ?? []) {
              const my = new Date(marker.event_date).getFullYear();
              if (my < minYear) minYear = my;
              if (my > maxYear) maxYear = my;
            }
          }
        }
      }

      if (minYear !== Infinity) {
        this.autoStartYear.set(minYear - 1);
        this.autoEndYear.set(Math.max(maxYear + 1, new Date().getFullYear() + 1));
      }
    });
  }
  // ... rest unchanged (onPhaseClick, onMarkerClick, etc.)
}
```

- [ ] **Step 2: Verify the template still binds to `startYear` / `endYear`**

Open `src/client/src/app/features/landscape/timeline-view.component.html` and grep for `startYear` and `endYear`. The bindings are now to computed signals, not plain signals, but the template syntax is identical (e.g., `[startYear]="startYear()"`). No template change required.

```bash
grep -n "startYear\|endYear" src/client/src/app/features/landscape/timeline-view.component.html
```

Expected: each reference uses `startYear()` or `endYear()` call syntax (or the safe-call equivalent). If any use plain `startYear`, fix them.

- [ ] **Step 3: Lint and build**

```bash
cd src/client && npm run lint && ng build
```

Expected: clean. If the build complains about `input()` signal API not being callable, double-check the import line at the top of the file includes `input`:

```typescript
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
```

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/landscape/timeline-view.component.ts
git commit -m "feat(timeline): accept optional startYear/endYear inputs"
```

---

## Phase 2: Hierarchical event scope RPC

### Task 4: Migration extending `get_events_page_data` for hierarchical event scope

**Files:**

- Create: `supabase/migrations/20260510120000_events_rpc_hierarchical_scope.sql`

- [ ] **Step 1: Write the migration**

Create `supabase/migrations/20260510120000_events_rpc_hierarchical_scope.sql`. This is a `create or replace` rewrite of `get_events_page_data`. The body is largely the same as `20260413120100_events_rpc_functions.sql:9-172`, with the events-half entity filter widened to roll up through the existing `pr_via_trial` / `co_via_trial` / `co_via_product` joins.

```sql
-- migration: 20260510120000_events_rpc_hierarchical_scope
-- purpose: extend get_events_page_data so events scoped at trial level roll up
--   into product- and company-scope queries, matching the markers half of the
--   union which already rolls up via the trial -> product -> company chain.
--   No change to direct trial-scope queries.
-- spec: docs/superpowers/specs/2026-05-10-catalysts-events-on-entity-pages-design.md

create or replace function public.get_events_page_data(
  p_space_id      uuid,
  p_date_from     date     default null,
  p_date_to       date     default null,
  p_entity_level  text     default null,
  p_entity_id     uuid     default null,
  p_category_ids  uuid[]   default null,
  p_tags          text[]   default null,
  p_priority      text     default null,
  p_source_type   text     default null,
  p_limit         int      default 50,
  p_offset        int      default 0
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
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_tags = '{}' then p_tags := null; end if;

  with unified_feed as (
    -- Events half
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.priority,
      case
        when ev.trial_id is not null then 'trial'
        when ev.product_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.name, pr.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.product_id, ev.company_id) as entity_id,
      coalesce(co.name, co_via_product.name, co_via_trial.name) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.products pr on pr.id = ev.product_id
    left join public.companies co_via_product on pr.id is not null and co_via_product.id = pr.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.products pr_via_trial on t.id is not null and pr_via_trial.id = t.product_id
    left join public.companies co_via_trial on pr_via_trial.id is not null and co_via_trial.id = pr_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.product_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and (ev.company_id is not null or ev.product_id is not null or ev.trial_id is not null))
        or (p_entity_level = 'product' and (ev.product_id is not null or ev.trial_id is not null))
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        -- direct matches
        or ev.company_id = p_entity_id
        or ev.product_id = p_entity_id
        or ev.trial_id   = p_entity_id
        -- product-scope rollup: events on trials under this product
        or (p_entity_level = 'product' and pr_via_trial.id = p_entity_id)
        -- company-scope rollup: events on products and trials under this company
        or (p_entity_level = 'company' and (co_via_product.id = p_entity_id or co_via_trial.id = p_entity_id))
      )

    union all

    -- Markers half (unchanged from prior migration)
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      t.name as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.products pr on pr.id = t.product_id
    join public.companies co on co.id = pr.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and (p_date_from is null or m.event_date >= p_date_from)
      and (p_date_to is null or m.event_date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_entity_level is null or p_entity_level = 'trial')
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or pr.id = p_entity_id
        or co.id = p_entity_id
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_type', uf.source_type,
        'id', uf.id,
        'title', uf.title,
        'event_date', uf.event_date,
        'category_name', uf.category_name,
        'category_id', uf.category_id,
        'priority', uf.priority,
        'entity_level', uf.entity_level,
        'entity_name', uf.entity_name,
        'entity_id', uf.entity_id,
        'company_name', uf.company_name,
        'tags', to_jsonb(uf.tags),
        'has_thread', uf.has_thread,
        'thread_id', uf.thread_id,
        'description', uf.description,
        'source_url', uf.source_url
      )
      order by uf.event_date desc, uf.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select * from unified_feed
    order by event_date desc, created_at desc
    limit p_limit offset p_offset
  ) uf;

  return result;
end;
$$;

grant execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
) to anon, authenticated;
```

- [ ] **Step 2: Apply the migration locally**

```bash
supabase db reset
```

Expected: clean reset, all migrations apply, no errors.

- [ ] **Step 3: Run the Supabase advisor against local**

```bash
supabase db advisors --local --type all
```

Expected: no new warnings introduced by this migration.

- [ ] **Step 4: Write the integration spec**

Create `src/client/integration/tests/events-hierarchical-scope.spec.ts`:

```typescript
/**
 * events-hierarchical-scope.spec.ts
 *
 * Verifies that get_events_page_data rolls up events through trial -> product
 * -> company when scoped at product or company level. Trial-scope queries
 * remain direct-match. Markers half unchanged.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { adminClient } from '../fixtures/personas';
import {
  createScratchTenant,
  createScratchSpace,
} from '../fixtures/scratch';
import { SupabaseClient } from '@supabase/supabase-js';

let svc: SupabaseClient;
let spaceId: string;
let companyId: string;
let productId: string;
let trialId: string;
let cleanup: () => Promise<void>;

beforeAll(async () => {
  svc = adminClient();
  const tenant = await createScratchTenant('hierarchical-events-test');
  const space = await createScratchSpace(tenant.id, 'hierarchical-events-space');
  spaceId = space.id;
  cleanup = async () => { await tenant.cleanup(); };

  // Seed: 1 company > 1 product > 1 trial, plus one event at each level.
  const { data: company } = await svc.from('companies').insert({
    space_id: spaceId, name: 'Co1',
  }).select('id').single();
  companyId = company!.id;

  const { data: product } = await svc.from('products').insert({
    space_id: spaceId, company_id: companyId, name: 'Prod1',
  }).select('id').single();
  productId = product!.id;

  const { data: trial } = await svc.from('trials').insert({
    space_id: spaceId, product_id: productId, name: 'Trial1',
  }).select('id').single();
  trialId = trial!.id;

  const { data: categoryRow } = await svc
    .from('event_categories').select('id').limit(1).single();
  const categoryId = categoryRow!.id;

  await svc.from('events').insert([
    { space_id: spaceId, company_id: companyId, category_id: categoryId,
      title: 'Company event', event_date: '2026-01-01' },
    { space_id: spaceId, product_id: productId, category_id: categoryId,
      title: 'Product event', event_date: '2026-01-02' },
    { space_id: spaceId, trial_id: trialId, category_id: categoryId,
      title: 'Trial event', event_date: '2026-01-03' },
  ]);
}, 60_000);

afterAll(async () => { if (cleanup) await cleanup(); });

async function listEventsScopedTo(level: 'trial'|'product'|'company', id: string) {
  const { data, error } = await svc.rpc('get_events_page_data', {
    p_space_id: spaceId, p_entity_level: level, p_entity_id: id,
    p_source_type: 'event', p_limit: 50, p_offset: 0,
  });
  if (error) throw new Error(error.message);
  return (data as Array<{ title: string }>).map((r) => r.title).sort();
}

describe('get_events_page_data hierarchical scope', () => {
  it('trial scope returns only the trial-level event (no rollup needed)', async () => {
    expect(await listEventsScopedTo('trial', trialId)).toEqual(['Trial event']);
  });

  it('product scope returns the product-level event PLUS the trial event under it', async () => {
    expect(await listEventsScopedTo('product', productId)).toEqual(
      ['Product event', 'Trial event'].sort()
    );
  });

  it('company scope returns every event under the company subtree', async () => {
    expect(await listEventsScopedTo('company', companyId)).toEqual(
      ['Company event', 'Product event', 'Trial event'].sort()
    );
  });

  it('product scope does not leak events on a sibling product', async () => {
    const { data: p2 } = await svc.from('products').insert({
      space_id: spaceId, company_id: companyId, name: 'Prod2',
    }).select('id').single();
    const { data: catRow } = await svc
      .from('event_categories').select('id').limit(1).single();
    await svc.from('events').insert({
      space_id: spaceId, product_id: p2!.id, category_id: catRow!.id,
      title: 'Sibling event', event_date: '2026-01-04',
    });

    expect(await listEventsScopedTo('product', productId)).toEqual(
      ['Product event', 'Trial event'].sort()
    );
  });
});
```

- [ ] **Step 5: Run the integration test**

```bash
cd src/client && npm run test:integration -- events-hierarchical-scope.spec.ts
```

Expected: PASS, 4/4 tests green. If failures appear about missing scratch helpers, check `src/client/integration/fixtures/scratch.ts` and adapt the helper names to what's exported.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260510120000_events_rpc_hierarchical_scope.sql \
        src/client/integration/tests/events-hierarchical-scope.spec.ts
git commit -m "feat(events): hierarchical scope for product/company in get_events_page_data"
```

---

## Phase 3: `EntityEventsPanelComponent`

### Task 5: Create the events panel component

**Files:**

- Create: `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.service.ts`
- Create: `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.ts`
- Create: `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.html`
- Create: `src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.spec.ts`

- [ ] **Step 1: Create the service wrapper**

`src/client/src/app/shared/components/entity-events-panel/entity-events-panel.service.ts`:

```typescript
import { inject, Injectable } from '@angular/core';

import { SupabaseService } from '../../../core/services/supabase.service';

export interface EntityEventRow {
  id: string;
  title: string;
  event_date: string;
  category_name: string;
  category_id: string;
  priority: string | null;
  entity_level: 'trial' | 'product' | 'company' | 'space';
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
}

export interface FetchEntityEventsParams {
  spaceId: string;
  entityLevel: 'trial' | 'product' | 'company';
  entityId: string;
  limit?: number;
}

@Injectable({ providedIn: 'root' })
export class EntityEventsPanelService {
  private readonly supabase = inject(SupabaseService);

  async fetch(params: FetchEntityEventsParams): Promise<EntityEventRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_events_page_data', {
      p_space_id: params.spaceId,
      p_entity_level: params.entityLevel,
      p_entity_id: params.entityId,
      p_source_type: 'event',
      p_limit: params.limit ?? 20,
      p_offset: 0,
    });
    if (error) throw new Error(error.message);
    return (data as EntityEventRow[]) ?? [];
  }
}
```

- [ ] **Step 2: Create the component**

`src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.ts`:

```typescript
import { DatePipe } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  computed,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { RouterLink } from '@angular/router';

import {
  EntityEventRow,
  EntityEventsPanelService,
} from './entity-events-panel.service';

@Component({
  selector: 'app-entity-events-panel',
  imports: [DatePipe, RouterLink],
  templateUrl: './entity-events-panel.component.html',
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EntityEventsPanelComponent {
  private readonly service = inject(EntityEventsPanelService);

  readonly spaceId = input.required<string>();
  readonly tenantId = input.required<string>();
  readonly entityLevel = input.required<'trial' | 'product' | 'company'>();
  readonly entityId = input.required<string>();
  readonly limit = input<number>(20);

  protected readonly rows = signal<EntityEventRow[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly seeAllLink = computed(() => [
    '/t', this.tenantId(), 's', this.spaceId(), 'activity',
  ]);

  protected readonly seeAllQueryParams = computed(() => ({
    entityLevel: this.entityLevel(),
    entityId: this.entityId(),
  }));

  constructor() {
    effect(() => {
      // Re-fetch whenever any required input changes.
      const space = this.spaceId();
      const level = this.entityLevel();
      const id = this.entityId();
      const lim = this.limit();
      if (!space || !id) return;
      void this.load(space, level, id, lim);
    });
  }

  private async load(
    spaceId: string,
    entityLevel: 'trial' | 'product' | 'company',
    entityId: string,
    limit: number,
  ): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const data = await this.service.fetch({ spaceId, entityLevel, entityId, limit });
      this.rows.set(data);
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : 'Failed to load events.');
      this.rows.set([]);
    } finally {
      this.loading.set(false);
    }
  }
}
```

- [ ] **Step 3: Create the template**

`src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.html`:

```html
<section class="border border-slate-200 bg-white">
  <header class="flex items-center justify-between px-4 py-3 border-b border-slate-200">
    <h3 class="font-mono text-xs font-semibold uppercase tracking-widest text-slate-600">
      Events
    </h3>
    <a
      [routerLink]="seeAllLink()"
      [queryParams]="seeAllQueryParams()"
      class="font-mono text-xs uppercase tracking-wider text-brand-700 hover:text-brand-800"
    >
      See all
    </a>
  </header>

  @if (loading()) {
    <div class="px-4 py-6 text-sm text-slate-500">Loading events...</div>
  } @else if (error()) {
    <div class="px-4 py-6 text-sm text-red-600">{{ error() }}</div>
  } @else if (rows().length === 0) {
    <div class="px-4 py-6 text-sm text-slate-500">
      No external events recorded for this {{ entityLevel() }}.
    </div>
  } @else {
    <ul class="divide-y divide-slate-100">
      @for (row of rows(); track row.id) {
        <li class="px-4 py-3">
          <div class="flex items-baseline gap-3">
            <span class="font-mono text-[10px] font-semibold uppercase tracking-widest text-slate-500 whitespace-nowrap">
              {{ row.event_date | date: 'yyyy-MM-dd' }}
            </span>
            <span class="font-mono text-[10px] font-semibold uppercase tracking-widest text-brand-700">
              {{ row.category_name }}
            </span>
          </div>
          <div class="mt-1 text-sm text-slate-800 leading-snug">{{ row.title }}</div>
          @if (row.entity_name && row.entity_level !== entityLevel()) {
            <div class="mt-0.5 text-xs text-slate-500">
              <span class="uppercase tracking-wider">{{ row.entity_level }}</span>
              · {{ row.entity_name }}
            </div>
          }
        </li>
      }
    </ul>
  }
</section>
```

- [ ] **Step 4: Write the component spec**

`src/client/src/app/shared/components/entity-events-panel/entity-events-panel.component.spec.ts`:

```typescript
import { test, expect } from '@playwright/test';

import { EntityEventsPanelComponent } from './entity-events-panel.component';

test.describe('EntityEventsPanelComponent', () => {
  test('component is defined and decorated as standalone OnPush', () => {
    expect(EntityEventsPanelComponent).toBeDefined();
    expect(EntityEventsPanelComponent.name).toBe('EntityEventsPanelComponent');
  });

  test('selector is app-entity-events-panel', () => {
    // Selector is on the @Component decorator metadata; cross-check by
    // reading the decorator output via Angular's compiler not feasible
    // here, but the constructor's `ɵcmp` carries selectors after build.
    const cmp = (EntityEventsPanelComponent as any).ɵcmp;
    expect(cmp).toBeDefined();
    expect(cmp.selectors[0][0]).toBe('app-entity-events-panel');
  });
});
```

(End-to-end coverage of fetch + render lives in the page-level e2e specs added in Tasks 7-9. This unit spec only asserts metadata so the build catches accidental regressions in decorator settings.)

- [ ] **Step 5: Lint, build, run**

```bash
cd src/client && npm run lint && ng build && npm run test:unit -- entity-events-panel
```

Expected: lint clean, build clean, 2/2 tests pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/shared/components/entity-events-panel/
git commit -m "feat(shared): EntityEventsPanelComponent for scoped events list"
```

---

## Phase 4: Wire the timeline + events panel into each detail page

### Task 6: Trial detail page

**Files:**

- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Add providers + imports + filter wiring to the component**

Edit `src/client/src/app/features/manage/trials/trial-detail.component.ts`. At the top of the file, add these imports near the existing ones (keep the existing list intact):

```typescript
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsPanelComponent } from '../../../shared/components/entity-events-panel/entity-events-panel.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';
```

In the `@Component` decorator's `imports` array, add `TimelineViewComponent` and `EntityEventsPanelComponent`. Add `providers: [LandscapeStateService]` to the same decorator (alongside `imports` etc.).

Inside the class, after the existing route-param signals, add:

```typescript
private readonly landscape = inject(LandscapeStateService);

private readonly landscapeInitEffect = effect(() => {
  const space = this.spaceId();
  const trial = this.trial();
  if (!space || !trial) return;
  void this.initLandscape(space, trial.id);
});

private async initLandscape(spaceId: string, trialId: string): Promise<void> {
  await this.landscape.init(spaceId, { disablePersistence: true });
  this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, trialIds: [trialId] });
}
```

(Adapt `this.trial()` to whatever signal exposes the loaded trial today; check the existing trial-detail component for the right accessor name. If it's a different signal name like `model()` or `data()`, substitute accordingly.)

- [ ] **Step 2: Add the Timeline section to the template**

Edit `src/client/src/app/features/manage/trials/trial-detail.component.html`. Find the spot above the existing "Markers" section (search for `<!-- Markers -->` or a similar landmark). Insert:

```html
<section class="bg-white border border-slate-200">
  <header class="px-5 py-3 border-b border-slate-200">
    <h2 class="font-mono text-xs font-semibold uppercase tracking-widest text-slate-600">
      Timeline
    </h2>
  </header>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0">
    <div class="border-r border-slate-200 min-w-0">
      <app-timeline-view />
    </div>
    @if (trial(); as t) {
      <app-entity-events-panel
        [spaceId]="spaceId()"
        [tenantId]="tenantId()"
        entityLevel="trial"
        [entityId]="t.id"
      />
    }
  </div>
</section>
```

- [ ] **Step 3: Lint, build**

```bash
cd src/client && npm run lint && ng build
```

Expected: clean.

- [ ] **Step 4: Smoke-test in the browser**

```bash
cd src/client && npm start
```

Navigate to a trial detail page (`/t/<tenant>/s/<space>/manage/trials/<trialId>`). Verify:
- Timeline renders below intelligence sections and above the existing Markers table.
- Only one trial shows in the timeline (your current trial).
- Events panel lists external events for that trial, or shows the empty state.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts \
        src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "feat(trial-detail): add scoped timeline and events panel"
```

---

### Task 7: Product detail page

**Files:**

- Modify: `src/client/src/app/features/manage/products/product-detail.component.ts`
- Modify: `src/client/src/app/features/manage/products/product-detail.component.html`

(If the `products` → `assets` rename has landed, use the `assets`/`asset` paths instead.)

- [ ] **Step 1: Add providers + imports + filter wiring**

Edit `src/client/src/app/features/manage/products/product-detail.component.ts`. Mirror the trial-detail changes from Task 6, with `productIds` instead of `trialIds`:

Top-of-file imports:

```typescript
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsPanelComponent } from '../../../shared/components/entity-events-panel/entity-events-panel.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';
```

`@Component` decorator: add `TimelineViewComponent`, `EntityEventsPanelComponent` to `imports`; add `providers: [LandscapeStateService]`.

Class body (alongside existing signals):

```typescript
private readonly landscape = inject(LandscapeStateService);

private readonly landscapeInitEffect = effect(() => {
  const space = this.spaceId();
  const product = this.product();
  if (!space || !product) return;
  void this.initLandscape(space, product.id);
});

private async initLandscape(spaceId: string, productId: string): Promise<void> {
  await this.landscape.init(spaceId, { disablePersistence: true });
  this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, productIds: [productId] });
}
```

(Substitute `this.product()` with the existing accessor name for the loaded product on this component.)

- [ ] **Step 2: Add the Timeline section to the template**

Edit `src/client/src/app/features/manage/products/product-detail.component.html`. Insert the Timeline section as the FIRST content block on the page (above the existing intelligence block, per the spec's section ordering):

```html
<section class="bg-white border border-slate-200">
  <header class="px-5 py-3 border-b border-slate-200">
    <h2 class="font-mono text-xs font-semibold uppercase tracking-widest text-slate-600">
      Timeline
    </h2>
  </header>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0">
    <div class="border-r border-slate-200 min-w-0">
      <app-timeline-view />
    </div>
    @if (product(); as p) {
      <app-entity-events-panel
        [spaceId]="spaceId()"
        [tenantId]="tenantId()"
        entityLevel="product"
        [entityId]="p.id"
      />
    }
  </div>
</section>
```

- [ ] **Step 3: Lint, build, smoke-test**

```bash
cd src/client && npm run lint && ng build
```

Expected: clean.

In the browser, navigate to a product detail page. Verify:
- Timeline shows all of the product's trials as rows.
- Phase bars and catalyst markers render correctly.
- Events panel lists events tagged at product OR trial level under this product (this is the hierarchical scope from Task 4 in action).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/products/product-detail.component.ts \
        src/client/src/app/features/manage/products/product-detail.component.html
git commit -m "feat(product-detail): add scoped timeline and events panel"
```

---

### Task 8: Company detail page (with forward-8q window)

**Files:**

- Modify: `src/client/src/app/features/manage/companies/company-detail.component.ts`
- Modify: `src/client/src/app/features/manage/companies/company-detail.component.html`

- [ ] **Step 1: Add providers + imports + filter wiring**

Edit `src/client/src/app/features/manage/companies/company-detail.component.ts`. Same pattern as Tasks 6-7, plus a computed `endYear`:

Top-of-file imports:

```typescript
import { TimelineViewComponent } from '../../landscape/timeline-view.component';
import { LandscapeStateService } from '../../landscape/landscape-state.service';
import { EntityEventsPanelComponent } from '../../../shared/components/entity-events-panel/entity-events-panel.component';
import { EMPTY_LANDSCAPE_FILTERS } from '../../../core/models/landscape.model';
```

`@Component` decorator: add `TimelineViewComponent`, `EntityEventsPanelComponent` to `imports`; add `providers: [LandscapeStateService]`.

Class body:

```typescript
private readonly landscape = inject(LandscapeStateService);

protected readonly timelineStartYear = computed(() => new Date().getFullYear());
protected readonly timelineEndYear = computed(() => new Date().getFullYear() + 2);

private readonly landscapeInitEffect = effect(() => {
  const space = this.spaceId();
  const company = this.company();
  if (!space || !company) return;
  void this.initLandscape(space, company.id);
});

private async initLandscape(spaceId: string, companyId: string): Promise<void> {
  await this.landscape.init(spaceId, { disablePersistence: true });
  this.landscape.filters.set({ ...EMPTY_LANDSCAPE_FILTERS, companyIds: [companyId] });
}
```

The forward-8-quarter window simplifies to "current year through current year + 2" given the timeline accepts year inputs. This is the resolution to open-question #1 from the spec: round to year, not to quarter, until the timeline component grows finer time granularity.

- [ ] **Step 2: Add the Timeline section to the template**

Edit `src/client/src/app/features/manage/companies/company-detail.component.html`. Insert the Timeline section as the FIRST content block on the page:

```html
<section class="bg-white border border-slate-200">
  <header class="px-5 py-3 border-b border-slate-200">
    <h2 class="font-mono text-xs font-semibold uppercase tracking-widest text-slate-600">
      Timeline
    </h2>
  </header>
  <div class="grid grid-cols-1 lg:grid-cols-[1fr_320px] gap-0">
    <div class="border-r border-slate-200 min-w-0">
      <app-timeline-view
        [startYear]="timelineStartYear()"
        [endYear]="timelineEndYear()"
      />
    </div>
    @if (company(); as c) {
      <app-entity-events-panel
        [spaceId]="spaceId()"
        [tenantId]="tenantId()"
        entityLevel="company"
        [entityId]="c.id"
      />
    }
  </div>
</section>
```

- [ ] **Step 3: Lint, build, smoke-test**

```bash
cd src/client && npm run lint && ng build
```

In the browser, navigate to a company detail page. Verify:
- Timeline x-axis spans current year through current year + 2 (no historical data).
- All products of the company appear, each with their trials.
- Events panel lists events tagged at company / product / trial level under this company.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/companies/company-detail.component.ts \
        src/client/src/app/features/manage/companies/company-detail.component.html
git commit -m "feat(company-detail): add scoped timeline (forward 2y) and events panel"
```

---

## Phase 5: End-to-end verification and docs

### Task 9: Add a Playwright e2e smoke test covering all three pages

**Files:**

- Create: `src/client/e2e/tests/entity-page-timeline-events.spec.ts`

- [ ] **Step 1: Write the e2e spec**

`src/client/e2e/tests/entity-page-timeline-events.spec.ts`:

```typescript
import { test, expect, Page } from '@playwright/test';
import { authenticatedPage } from '../helpers/auth.helper';
import {
  createTestTenant, createTestSpace, createTestCompany, createTestProduct,
  createTestTherapeuticArea, createTestTrial, createTestTrialPhase,
} from '../helpers/test-data.helper';

test.describe('Entity-page timeline + events panel', () => {
  let page: Page;
  let tenantId: string;
  let spaceId: string;
  let companyId: string;
  let productId: string;
  let trialId: string;

  test.beforeAll(async ({ browser }) => {
    test.setTimeout(60000);
    tenantId = await createTestTenant('Entity Timeline Org');
    spaceId = await createTestSpace(tenantId, 'Entity Timeline Space');
    const taId = await createTestTherapeuticArea(spaceId, 'Test TA', 'TTA');
    companyId = await createTestCompany(spaceId, 'TestCo');
    productId = await createTestProduct(spaceId, companyId, 'TestProd');
    trialId = await createTestTrial(spaceId, productId, taId, 'TestTrial');
    await createTestTrialPhase(spaceId, trialId, 'P3', '2025-01-01');
    page = await authenticatedPage(browser);
  });

  test.afterAll(async () => { await page.close(); });

  test('trial detail page renders Timeline + Events panel', async () => {
    await page.goto(
      `/t/${tenantId}/s/${spaceId}/manage/trials/${trialId}`,
      { waitUntil: 'networkidle' },
    );
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
    await expect(page.locator('app-entity-events-panel')).toContainText('Events');
  });

  test('product detail page renders Timeline + Events panel', async () => {
    await page.goto(
      `/t/${tenantId}/s/${spaceId}/manage/products/${productId}`,
      { waitUntil: 'networkidle' },
    );
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
  });

  test('company detail page renders forward-windowed Timeline + Events panel', async () => {
    await page.goto(
      `/t/${tenantId}/s/${spaceId}/manage/companies/${companyId}`,
      { waitUntil: 'networkidle' },
    );
    await expect(page.locator('app-timeline-view')).toBeVisible({ timeout: 15000 });
    await expect(page.locator('app-entity-events-panel')).toBeVisible();
  });
});
```

- [ ] **Step 2: Run the e2e spec**

```bash
cd src/client && npm run test:e2e:fast -- entity-page-timeline-events
```

Expected: 3/3 tests pass. If failures cite missing routes or selectors, cross-check that the detail page route prefixes (`manage/trials/`, `manage/products/`, `manage/companies/`) match `app.routes.ts` (or the post-rename `manage/assets/` if applicable).

- [ ] **Step 3: Commit**

```bash
git add src/client/e2e/tests/entity-page-timeline-events.spec.ts
git commit -m "test(e2e): timeline and events panel mount on all three detail pages"
```

---

### Task 10: Regenerate runbook + verify help pages

**Files:**

- Verify: `docs/runbook/*` auto-gen blocks
- Verify: `src/client/src/app/features/help/markers-help.component.ts`
- Verify: `src/client/src/app/features/help/phases-help.component.ts`

- [ ] **Step 1: Regenerate auto-gen runbook blocks**

```bash
cd src/client && npm run docs:arch
```

Expected: zero or minor diffs in `docs/runbook/0*.md` between `<!-- AUTO-GEN -->` markers. Route tree may grow if the timeline mounts on new pages; that is expected.

- [ ] **Step 2: Read the markers and phases help pages**

```bash
grep -n "trial detail\|product detail\|company detail" \
  src/client/src/app/features/help/markers-help.component.ts \
  src/client/src/app/features/help/phases-help.component.ts \
  2>/dev/null
```

If the help pages describe where markers / phases render in the UI, they now also render on product and company detail pages. Update the relevant FAQ entries to reflect that (live data is unchanged; this is purely an editorial update).

- [ ] **Step 3: Hand-edit prose updates around generated blocks**

Open `docs/runbook/03-features.md` and `docs/runbook/05-frontend-architecture.md`. Outside the `<!-- AUTO-GEN -->` markers, add a one-line note under the relevant feature description that the timeline now mounts on trial / product / company detail pages. Pattern after existing prose; do not edit anything inside the auto-gen markers.

- [ ] **Step 4: Commit**

```bash
git add docs/runbook/ src/client/src/app/features/help/
git commit -m "docs(runbook): note timeline on entity detail pages"
```

---

## Final verification

- [ ] **Step 1: Full local verification**

```bash
cd src/client && npm run lint && ng build && npm run test:units && npm run test:unit && npm run test:integration
```

Expected: lint clean, build clean, all three test suites green.

- [ ] **Step 2: Manual smoke-test on all three pages**

Start the dev server, navigate to one trial / one product / one company detail page in turn. Verify:

- Timeline section appears in the expected slot per page (trial: above Markers table; product/company: top of page).
- Events panel lists scoped events or shows the empty-state message.
- Hierarchical event rollup works on product / company pages (events tagged at descendant levels appear).
- Company page x-axis is forward-windowed (current year through current year + 2).
- No console errors.

- [ ] **Step 3: Verify AXE accessibility on each new mounted surface**

In the browser dev tools, run AXE on each of the three detail pages with the timeline section in view. Resolve any violations (focus order, missing labels, contrast).

- [ ] **Step 4: Push**

```bash
git push
```

Pre-push hook will run lint + units + worker + build. All must pass before the push is accepted.

---

## Out of scope (for this plan)

- A window-control affordance on the timeline section. Defaults shipped here are good enough for MVP.
- A drill-through link from the company-page event heatmap. The heatmap isn't part of this scope; it was a Variant-A artifact in the sketch deck that we're not building.
- The portfolio-matrix idiom. Explicitly rejected in the spec.
- Hierarchical scoping for the activity page itself. The activity page accepts explicit filters today and doesn't need rollup.
- A junction table linking events to markers.

## Open questions deferred from the spec (track these post-MVP)

1. Quarter-aligned company window (spec open Q1). Current implementation rounds to current year.
2. Inline window-control affordance on the company page (spec open Q2).
3. Event sort with pinning / priority floats (spec open Q3). Current: pure reverse-chronological.
4. Per-page `LandscapeStateService` instance cost on slow connections (spec open Q4). Worth measuring after MVP.
5. Marker-click drill behavior on entity pages: keep detail drawer or navigate? (spec open Q5). Current: keeps the existing drawer.
