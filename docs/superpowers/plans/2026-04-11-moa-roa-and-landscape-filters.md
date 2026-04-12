# MOA / ROA Attributes and Landscape Filters Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Mechanism of Action (MOA) and Route of Administration (ROA) as first-class reference entities with dashboard columns, dashboard + landscape filters, and landscape-bullseye fade-out behavior.

**Architecture:** Four new Postgres tables (two reference, two join) scoped to `space_id` with RLS. Two new Angular services mirroring `CompanyService`. Two new manage CRUD screens. Dashboard grid gains two hideable columns + a column-visibility popover. Dashboard filter panel gains two multi-select facets wired through the existing `get_dashboard_data` RPC. Landscape bullseye gains a new filter bar and a `matchedProductIds` fade-out pattern. Session-only state; no persistence.

**Tech Stack:** Angular 19 standalone components with signals, PrimeNG 19, Tailwind CSS v4, Supabase Postgres, timestamped migrations.

**Spec:** `docs/superpowers/specs/2026-04-11-moa-roa-and-landscape-filters-design.md`

## Testing Model

This codebase has **no existing `*.spec.ts` test files** and no configured unit-test infrastructure. The spec's "Testing Strategy" section assumed Karma/Jasmine tests that don't exist. Adding unit/component tests for this feature would require setting up test infrastructure as a side-quest, which is out of scope.

**Verification for every task** uses:
1. `cd src/client && ng lint && ng build` (the canonical verify command from CLAUDE.md)
2. Explicit manual QA steps spelled out per task
3. `supabase db reset` to prove migrations + seed apply cleanly end-to-end

Unit-test TDD is not part of the loop. Steps are still bite-sized commits; verification is lint/build/manual instead of red/green test runs.

---

## File Structure

**New database migrations (3 files)**
- `supabase/migrations/<ts>_create_mechanisms_and_routes.sql` — two reference tables + RLS
- `supabase/migrations/<ts>_create_product_moa_roa_join_tables.sql` — two join tables + RLS
- `supabase/migrations/<ts>_update_dashboard_and_bullseye_functions.sql` — updates both RPCs in one migration (they're tightly coupled to the new schema)

**Modified seed file**
- `supabase/seed.sql` — append MOA + ROA inserts and product assignments

**New client models (2 files)**
- `src/client/src/app/core/models/mechanism-of-action.model.ts`
- `src/client/src/app/core/models/route-of-administration.model.ts`

**Modified client models (3 files)**
- `src/client/src/app/core/models/product.model.ts` — add `mechanisms_of_action?` + `routes_of_administration?`
- `src/client/src/app/core/models/dashboard.model.ts` — add two filter fields to `DashboardFilters`; add two fields to the product shape used by the grid
- `src/client/src/app/core/models/landscape.model.ts` — add `moas` + `roas` to `BullseyeProduct`

**New client services (2 files)**
- `src/client/src/app/core/services/mechanism-of-action.service.ts`
- `src/client/src/app/core/services/route-of-administration.service.ts`

**Modified client services (2 files)**
- `src/client/src/app/core/services/product.service.ts` — extend `list()` / `getById()` to hydrate MOA + ROA; add `setMechanisms()` + `setRoutes()`
- `src/client/src/app/core/services/dashboard.service.ts` — pass new filter params to the RPC

**New manage screen folders (8 files)**
- `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.ts` + `.html`
- `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-form.component.ts` + `.html`
- `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.ts` + `.html`
- `src/client/src/app/features/manage/routes-of-administration/route-of-administration-form.component.ts` + `.html`

**Modified manage screen (1 file)**
- `src/client/src/app/features/manage/products/product-form.component.ts` + `.html` — add two multiselect fields

**Modified routes (1 file)**
- `src/client/src/app/app.routes.ts` — register the two new manage routes

**Modified dashboard (3 files)**
- `src/client/src/app/features/dashboard/dashboard.component.ts` — extend `filters` signal default shape
- `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts` + `.html` — add MOA/ROA multiselects
- `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts` + `.html` — add MOA/ROA columns + visibility popover

**New landscape component (2 files)**
- `src/client/src/app/features/landscape/landscape-filter-bar.component.ts` + `.html`

**Modified landscape (3 files)**
- `src/client/src/app/features/landscape/landscape.component.ts` + `.html` — mount filter bar, add `landscapeFilters` signal, compute `matchedProductIds`
- `src/client/src/app/features/landscape/bullseye-chart.component.ts` + `.html` — add `matchedProductIds` input + fade-out render logic
- `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` + `.html` — add MOA/ROA metadata rows

---

## Conventions

- **Migration timestamps**: use `YYYYMMDDHHmmss` format with the current UTC date. For this plan assume `20260411130000`, `20260411130100`, `20260411130200`. If any already exist when you implement, bump each by one minute.
- **UUID seed values**: hand-picked stable UUIDs (`b0000000-...`, `c0000000-...`) so re-running `supabase db reset` is idempotent.
- **File casing**: component files use `kebab-case-list.component.ts`; services `kebab-case.service.ts`; models `kebab-case.model.ts`. Match existing files exactly.
- **Commit style**: follow the existing history — lowercase `feat(...)`, `polish(...)`, `docs(...)`, `feat(db)` etc. Do NOT add the Claude co-author trailer (per user's global CLAUDE.md rule).
- **No emojis** in any code, comments, or commit messages (per user's global CLAUDE.md rule).
- **Verification command** after every task: `cd src/client && ng lint && ng build`. Both must pass.

---

# Phase 1 — Database

## Task 1: Create MOA and ROA reference tables + RLS

**Files:**
- Create: `supabase/migrations/20260411130000_create_mechanisms_and_routes.sql`

- [ ] **Step 1: Write the migration**

Create the file with this exact content:

```sql
-- create mechanisms_of_action and routes_of_administration reference tables

create table if not exists public.mechanisms_of_action (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  description text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create index if not exists idx_mechanisms_of_action_space_order
  on public.mechanisms_of_action (space_id, display_order, name);

create table if not exists public.routes_of_administration (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete cascade,
  created_by uuid references auth.users(id) on delete set null,
  name text not null,
  abbreviation text,
  display_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (space_id, name)
);

create index if not exists idx_routes_of_administration_space_order
  on public.routes_of_administration (space_id, display_order, name);

-- RLS
alter table public.mechanisms_of_action enable row level security;
alter table public.routes_of_administration enable row level security;

create policy "space members can view mechanisms_of_action" on public.mechanisms_of_action for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert mechanisms_of_action" on public.mechanisms_of_action for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update mechanisms_of_action" on public.mechanisms_of_action for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete mechanisms_of_action" on public.mechanisms_of_action for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

create policy "space members can view routes_of_administration" on public.routes_of_administration for select to authenticated
using ( public.has_space_access(space_id) );
create policy "space editors can insert routes_of_administration" on public.routes_of_administration for insert to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update routes_of_administration" on public.routes_of_administration for update to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete routes_of_administration" on public.routes_of_administration for delete to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );
```

> **Note:** This codebase does not use `updated_at` triggers — existing tables have `updated_at timestamptz default now()` set on INSERT but no automatic UPDATE trigger. Match that pattern. Do not add a trigger.

- [ ] **Step 2: Apply the migration and verify**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase db reset
```

Expected: runs cleanly, no errors, seed re-applied. If `supabase` is not running, `supabase start` first.

- [ ] **Step 3: Verify tables and policies exist**

```bash
supabase db execute "select tablename from pg_tables where tablename in ('mechanisms_of_action','routes_of_administration');"
```

Expected: two rows.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260411130000_create_mechanisms_and_routes.sql
git commit -m "feat(db): add mechanisms_of_action and routes_of_administration tables"
```

---

## Task 2: Create product-MOA and product-ROA join tables + RLS

**Files:**
- Create: `supabase/migrations/20260411130100_create_product_moa_roa_join_tables.sql`

- [ ] **Step 1: Write the migration**

```sql
-- create join tables for products <-> mechanisms_of_action and routes_of_administration

create table if not exists public.product_mechanisms_of_action (
  product_id uuid not null references public.products(id) on delete cascade,
  moa_id uuid not null references public.mechanisms_of_action(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, moa_id)
);

create index if not exists idx_product_mechanisms_by_moa
  on public.product_mechanisms_of_action (moa_id);

create table if not exists public.product_routes_of_administration (
  product_id uuid not null references public.products(id) on delete cascade,
  roa_id uuid not null references public.routes_of_administration(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (product_id, roa_id)
);

create index if not exists idx_product_routes_by_roa
  on public.product_routes_of_administration (roa_id);

-- RLS: gate by the parent product's space_id
alter table public.product_mechanisms_of_action enable row level security;
alter table public.product_routes_of_administration enable row level security;

create policy "space members can view product_mechanisms_of_action" on public.product_mechanisms_of_action for select to authenticated
using ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id)) );
create policy "space editors can insert product_mechanisms_of_action" on public.product_mechanisms_of_action for insert to authenticated
with check ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );
create policy "space editors can delete product_mechanisms_of_action" on public.product_mechanisms_of_action for delete to authenticated
using ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );

create policy "space members can view product_routes_of_administration" on public.product_routes_of_administration for select to authenticated
using ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id)) );
create policy "space editors can insert product_routes_of_administration" on public.product_routes_of_administration for insert to authenticated
with check ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );
create policy "space editors can delete product_routes_of_administration" on public.product_routes_of_administration for delete to authenticated
using ( exists (select 1 from public.products p where p.id = product_id and public.has_space_access(p.space_id, array['owner', 'editor'])) );
```

> Note: no UPDATE policies — rows in join tables are immutable. `setMechanisms` / `setRoutes` always delete-then-insert.

- [ ] **Step 2: Apply and verify**

```bash
supabase db reset
supabase db execute "select tablename from pg_tables where tablename like 'product_%_of_administration' or tablename like 'product_mechanisms%';"
```

Expected: two rows.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260411130100_create_product_moa_roa_join_tables.sql
git commit -m "feat(db): add product MOA and ROA join tables"
```

---

## Task 3: Update `get_dashboard_data` and `get_bullseye_data` RPCs

**Files:**
- Create: `supabase/migrations/20260411130200_update_dashboard_and_bullseye_functions.sql`

This task is the longest migration but it's one logical unit: both RPCs need to learn about the new schema at the same time, so the client can be wired up in one cycle.

- [ ] **Step 1: Read the current `get_dashboard_data` source**

Open `supabase/migrations/20260315200100_update_dashboard_function_filters.sql` and read through it so you understand the lateral-join shape you're extending.

- [ ] **Step 2: Read the current `get_bullseye_data` source**

Open `supabase/migrations/20260411120300_create_bullseye_data_function.sql` and read through it.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260411130200_update_dashboard_and_bullseye_functions.sql` with this content. This is long — copy it verbatim, then check it against the source files you just read.

```sql
-- update get_dashboard_data to accept MOA/ROA filters and return MOA/ROA arrays on each product
-- update get_bullseye_data to return MOA/ROA arrays on each product

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
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
  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'products', coalesce((
        select jsonb_agg(product_obj order by p.display_order)
        from public.products p
        cross join lateral (
          select jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'generic_name', p.generic_name,
            'logo_url', p.logo_url,
            'display_order', p.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pm
              join public.mechanisms_of_action m on m.id = pm.moa_id
              where pm.product_id = p.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration pr
              join public.routes_of_administration r on r.id = pr.roa_id
              where pr.product_id = p.id
            ), '[]'::jsonb),
            'trials', coalesce((
              select jsonb_agg(trial_obj order by t.display_order)
              from public.trials t
              cross join lateral (
                select jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', t.phase,
                  'intervention_type', t.intervention_type,
                  'intervention_name', t.intervention_name,
                  'lead_sponsor', t.lead_sponsor,
                  'study_countries', t.study_countries,
                  'fda_designations', t.fda_designations,
                  'has_dmc', t.has_dmc,
                  'start_date', t.start_date,
                  'primary_completion_date', t.primary_completion_date,
                  'ctgov_last_synced_at', t.ctgov_last_synced_at,
                  'therapeutic_area', (
                    select jsonb_build_object('id', ta.id, 'name', ta.name, 'abbreviation', ta.abbreviation)
                    from public.therapeutic_areas ta where ta.id = t.therapeutic_area_id
                  ),
                  'phases', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tp.id, 'trial_id', tp.trial_id,
                        'phase_type', tp.phase_type, 'start_date', tp.start_date,
                        'end_date', tp.end_date, 'color', tp.color, 'label', tp.label
                      )
                      order by tp.start_date
                    )
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                      and (p_start_year is null or extract(year from tp.end_date) >= p_start_year or tp.end_date is null)
                      and (p_end_year is null or extract(year from tp.start_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'markers', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tm.id, 'trial_id', tm.trial_id,
                        'marker_type_id', tm.marker_type_id,
                        'event_date', tm.event_date, 'end_date', tm.end_date,
                        'tooltip_text', tm.tooltip_text, 'tooltip_image_url', tm.tooltip_image_url,
                        'is_projected', tm.is_projected,
                        'marker_type', (
                          select jsonb_build_object(
                            'id', mt.id, 'name', mt.name, 'icon', mt.icon,
                            'shape', mt.shape, 'fill_style', mt.fill_style,
                            'color', mt.color, 'is_system', mt.is_system,
                            'display_order', mt.display_order
                          )
                          from public.marker_types mt where mt.id = tm.marker_type_id
                        )
                      )
                      order by tm.event_date
                    )
                    from public.trial_markers tm
                    where tm.trial_id = t.id
                      and tm.space_id = p_space_id
                      and (p_start_year is null or extract(year from tm.event_date) >= p_start_year)
                      and (p_end_year is null or extract(year from tm.event_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'trial_notes', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tn.id, 'content', tn.content,
                        'created_at', tn.created_at, 'updated_at', tn.updated_at
                      )
                      order by tn.created_at
                    )
                    from public.trial_notes tn
                    where tn.trial_id = t.id
                      and tn.space_id = p_space_id
                  ), '[]'::jsonb)
                ) as trial_obj
              ) as trial_lateral
              where t.product_id = p.id
                and t.space_id = p_space_id
                and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
                and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                and (p_study_types is null or t.study_type = any(p_study_types))
                and (p_phases is null or t.phase = any(p_phases))
            ), '[]'::jsonb)
          ) as product_obj
        ) as product_lateral
        where p.company_id = c.id
          and p.space_id = p_space_id
          and (p_product_ids is null or p.id = any(p_product_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.product_mechanisms_of_action pm2
              where pm2.product_id = p.id
                and pm2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.product_routes_of_administration pr2
              where pr2.product_id = p.id
                and pr2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$$;

-- get_bullseye_data: reload to include MOA/ROA arrays on each product
-- (copy the existing function and add the two jsonb_agg subqueries in the product object builder)
```

- [ ] **Step 4: Append the `get_bullseye_data` rewrite to the same migration file**

Append this exact block to the bottom of `supabase/migrations/20260411130200_update_dashboard_and_bullseye_functions.sql`. It's the current `get_bullseye_data` function body verbatim, with `'moas'` and `'roas'` keys added inside the product `jsonb_build_object` (between `'highest_phase'` and `'trials'`). Subqueries reference the new join tables via the correlated `pr.product_id` from the `product_rollup` CTE — not to be confused with the outer `pr` alias; note the inner subquery uses `pmoa` and `proa` aliases to avoid shadowing.

```sql
create or replace function public.get_bullseye_data(
  p_space_id uuid,
  p_therapeutic_area_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_ta jsonb;
  v_companies jsonb;
begin
  select jsonb_build_object(
    'id', ta.id,
    'name', ta.name,
    'abbreviation', ta.abbreviation
  )
  into v_ta
  from public.therapeutic_areas ta
  where ta.id = p_therapeutic_area_id
    and ta.space_id = p_space_id;

  if v_ta is null then
    return jsonb_build_object(
      'therapeutic_area', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'companies', '[]'::jsonb
    );
  end if;

  with product_rollup as (
    select
      p.id            as product_id,
      p.company_id    as company_id,
      p.name          as product_name,
      p.generic_name  as generic_name,
      p.logo_url      as logo_url,
      max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.therapeutic_area_id = p_therapeutic_area_id
    join public.trial_phases tp
      on tp.trial_id = t.id
     and tp.space_id = p_space_id
     and tp.phase_type <> 'OBS'
    where p.space_id = p_space_id
    group by p.id, p.company_id, p.name, p.generic_name, p.logo_url
    having max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) is not null
  ),
  company_rank as (
    select
      company_id,
      max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(company_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_companies
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED'
              when 5 then 'APPROVED'
              when 4 then 'P4'
              when 3 then 'P3'
              when 2 then 'P2'
              when 1 then 'P1'
              when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', (
                    select tp.phase_type
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                    order by case tp.phase_type
                      when 'LAUNCHED' then 6
                      when 'APPROVED' then 5
                      when 'P4'       then 4
                      when 'P3'       then 3
                      when 'P2'       then 2
                      when 'P1'       then 1
                      when 'PRECLIN'  then 0
                      else -1
                    end desc,
                    tp.start_date desc
                    limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = p_therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id,
                  'event_date', tmm.event_date,
                  'marker_type_name', mt.name,
                  'icon', mt.icon,
                  'shape', mt.shape,
                  'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = p_therapeutic_area_id
                  and t2.space_id = p_space_id
                  and tm.space_id = p_space_id
                order by tm.event_date desc
                limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'therapeutic_area', v_ta,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'companies', coalesce(v_companies, '[]'::jsonb)
  );
end;
$$;

comment on function public.get_bullseye_data is
  'Returns the full jsonb document needed to render the landscape bullseye for a single therapeutic area: companies with qualifying products, per-product highest phase rollup (with MOAs and ROAs), trial list, and up to three most recent markers. security invoker so RLS applies.';
```

> Changes from the original function: (a) added `'moas'` and `'roas'` jsonb_agg subqueries inside the product object; (b) added `'recruitment_status'` and `'study_type'` to each trial object so the landscape filter bar can filter by them without needing another RPC.

- [ ] **Step 5: Apply and verify**

```bash
supabase db reset
supabase db execute "select pg_get_functiondef('public.get_dashboard_data(uuid,uuid[],uuid[],uuid[],int,int,text[],text[],text[],uuid[],uuid[])'::regprocedure);" | grep -c "p_mechanism_of_action_ids"
```

Expected: at least 1 (confirms the new parameter is in the deployed function).

- [ ] **Step 6: Smoke-test the RPCs manually**

```bash
supabase db execute "select jsonb_pretty(public.get_dashboard_data((select id from public.spaces limit 1), null, null, null, null, null, null, null, null, null, null));" | head -60
```

Expected: returns JSON with companies -> products -> `mechanisms_of_action: []` and `routes_of_administration: []` on each product (empty until seed runs in Task 4).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260411130200_update_dashboard_and_bullseye_functions.sql
git commit -m "feat(db): extend dashboard and bullseye RPCs with MOA/ROA"
```

---

## Task 4: Seed MOA and ROA data and assign to existing products

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Read existing seed file**

Open `supabase/seed.sql` and look at how companies/products are inserted. Scroll to the bottom — you will append to this file, not edit existing blocks.

- [ ] **Step 2: Find the default workspace space_id**

Grep `supabase/seed.sql` for the workspace/space UUID that products are assigned to. It should be a hand-picked UUID like `'00000000-0000-0000-0000-000000000001'` or similar. Use that exact value in the inserts below (replace `<SPACE_ID>` with the real value).

- [ ] **Step 3: Append MOA inserts**

At the bottom of `supabase/seed.sql`, add:

```sql
-- MOAs (mechanisms of action)
insert into public.mechanisms_of_action (id, space_id, created_by, name, description, display_order)
values
  ('b0000000-0000-0000-0000-000000000001', '<SPACE_ID>', null, 'PD-1 inhibitor', 'Blocks the PD-1 checkpoint receptor on T-cells.', 1),
  ('b0000000-0000-0000-0000-000000000002', '<SPACE_ID>', null, 'PD-L1 inhibitor', 'Blocks the PD-L1 ligand on tumor cells.', 2),
  ('b0000000-0000-0000-0000-000000000003', '<SPACE_ID>', null, 'BCL-2 inhibitor', 'Induces apoptosis by inhibiting the BCL-2 protein.', 3),
  ('b0000000-0000-0000-0000-000000000004', '<SPACE_ID>', null, 'CDK4/6 inhibitor', 'Blocks cyclin-dependent kinases 4 and 6.', 4),
  ('b0000000-0000-0000-0000-000000000005', '<SPACE_ID>', null, 'KRAS G12C inhibitor', 'Targets the G12C mutant form of KRAS.', 5),
  ('b0000000-0000-0000-0000-000000000006', '<SPACE_ID>', null, 'CD19 CAR-T', 'Autologous T-cells engineered to target CD19.', 6),
  ('b0000000-0000-0000-0000-000000000007', '<SPACE_ID>', null, 'EGFR inhibitor', 'Targets the epidermal growth factor receptor.', 7),
  ('b0000000-0000-0000-0000-000000000008', '<SPACE_ID>', null, 'HER2 mAb', 'Monoclonal antibody against HER2.', 8)
on conflict (id) do nothing;
```

- [ ] **Step 4: Append ROA inserts**

```sql
-- ROAs (routes of administration)
insert into public.routes_of_administration (id, space_id, created_by, name, abbreviation, display_order)
values
  ('c0000000-0000-0000-0000-000000000001', '<SPACE_ID>', null, 'Oral', 'PO', 1),
  ('c0000000-0000-0000-0000-000000000002', '<SPACE_ID>', null, 'Intravenous', 'IV', 2),
  ('c0000000-0000-0000-0000-000000000003', '<SPACE_ID>', null, 'Subcutaneous', 'SC', 3),
  ('c0000000-0000-0000-0000-000000000004', '<SPACE_ID>', null, 'Intramuscular', 'IM', 4),
  ('c0000000-0000-0000-0000-000000000005', '<SPACE_ID>', null, 'Inhaled', 'INH', 5),
  ('c0000000-0000-0000-0000-000000000006', '<SPACE_ID>', null, 'Topical', 'TOP', 6),
  ('c0000000-0000-0000-0000-000000000007', '<SPACE_ID>', null, 'Intrathecal', 'IT', 7)
on conflict (id) do nothing;
```

- [ ] **Step 5: Append product assignments**

Query the seed file for existing product UUIDs. Pick 4–6 representative seeded products and give each 1–2 MOAs and 1 ROA. Paste real product UUIDs in the `product_id` column.

```sql
-- assign MOAs to products (pick a few seeded products so the dashboard has something to show)
insert into public.product_mechanisms_of_action (product_id, moa_id)
values
  ('<PRODUCT_UUID_1>', 'b0000000-0000-0000-0000-000000000001'), -- PD-1
  ('<PRODUCT_UUID_2>', 'b0000000-0000-0000-0000-000000000002'), -- PD-L1
  ('<PRODUCT_UUID_3>', 'b0000000-0000-0000-0000-000000000003'), -- BCL-2
  ('<PRODUCT_UUID_3>', 'b0000000-0000-0000-0000-000000000004'), -- CDK4/6 (dual MOA example)
  ('<PRODUCT_UUID_4>', 'b0000000-0000-0000-0000-000000000005'), -- KRAS G12C
  ('<PRODUCT_UUID_5>', 'b0000000-0000-0000-0000-000000000006')  -- CD19 CAR-T
on conflict do nothing;

-- assign ROAs to products
insert into public.product_routes_of_administration (product_id, roa_id)
values
  ('<PRODUCT_UUID_1>', 'c0000000-0000-0000-0000-000000000002'), -- IV
  ('<PRODUCT_UUID_2>', 'c0000000-0000-0000-0000-000000000002'), -- IV
  ('<PRODUCT_UUID_3>', 'c0000000-0000-0000-0000-000000000001'), -- Oral
  ('<PRODUCT_UUID_4>', 'c0000000-0000-0000-0000-000000000001'), -- Oral
  ('<PRODUCT_UUID_5>', 'c0000000-0000-0000-0000-000000000002')  -- IV
on conflict do nothing;
```

- [ ] **Step 6: Apply and verify**

```bash
supabase db reset
supabase db execute "select count(*) from public.mechanisms_of_action; select count(*) from public.routes_of_administration; select count(*) from public.product_mechanisms_of_action; select count(*) from public.product_routes_of_administration;"
```

Expected: 8, 7, 6, 5 (give or take if you varied the assignments).

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): seed MOA and ROA reference data and product assignments"
```

---

# Phase 2 — Client models and services

## Task 5: Create MOA and ROA TypeScript models

**Files:**
- Create: `src/client/src/app/core/models/mechanism-of-action.model.ts`
- Create: `src/client/src/app/core/models/route-of-administration.model.ts`

- [ ] **Step 1: Write `mechanism-of-action.model.ts`**

```typescript
export interface MechanismOfAction {
  id: string;
  space_id: string;
  created_by: string | null;
  name: string;
  description: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 2: Write `route-of-administration.model.ts`**

```typescript
export interface RouteOfAdministration {
  id: string;
  space_id: string;
  created_by: string | null;
  name: string;
  abbreviation: string | null;
  display_order: number;
  created_at: string;
  updated_at: string;
}
```

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes (files aren't imported yet).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/mechanism-of-action.model.ts \
        src/client/src/app/core/models/route-of-administration.model.ts
git commit -m "feat(models): add MechanismOfAction and RouteOfAdministration types"
```

---

## Task 6: Extend `Product`, `DashboardFilters`, and `BullseyeProduct` types

**Files:**
- Modify: `src/client/src/app/core/models/product.model.ts`
- Modify: `src/client/src/app/core/models/dashboard.model.ts`
- Modify: `src/client/src/app/core/models/landscape.model.ts`

- [ ] **Step 1: Read the current `product.model.ts`**

Open the file and find the `Product` interface. Add these two optional fields at the end of the interface:

```typescript
  mechanisms_of_action?: { id: string; name: string }[];
  routes_of_administration?: { id: string; name: string; abbreviation: string | null }[];
```

> We use inline `{id, name}` shape (not the full `MechanismOfAction` interface) because the dashboard RPC returns a trimmed view. If the manage product form also needs the full interface, add `| MechanismOfAction[]` later when it's used.

- [ ] **Step 2: Read the current `dashboard.model.ts`**

Find the `DashboardFilters` interface. Add these two fields:

```typescript
  mechanismOfActionIds: string[] | null;
  routeOfAdministrationIds: string[] | null;
```

Match the `| null` pattern used by existing filter fields like `companyIds` and `productIds`.

- [ ] **Step 3: Read the current `landscape.model.ts`**

Find the `BullseyeProduct` interface. Add these two fields at the end:

```typescript
  moas: { id: string; name: string }[];
  roas: { id: string; name: string; abbreviation: string | null }[];
```

Note the shorter names (`moas` / `roas`) to match the RPC output keys — these are different from the `mechanisms_of_action` / `routes_of_administration` names in `get_dashboard_data`, and that's intentional: the bullseye is more space-constrained and uses the compact names.

Also find the `BullseyeTrial` interface (or whatever the trial type is called under the bullseye shape) and add these two fields. Task 3 extended the `get_bullseye_data` RPC to emit them — the filter bar in Task 20 needs them for status/study-type filtering:

```typescript
  recruitment_status: string | null;
  study_type: string | null;
```

> If `BullseyeTrial` doesn't exist as a standalone interface, the trial shape is likely inlined inside `BullseyeProduct['trials']`. Add the two fields there instead.

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: may show errors in callers that construct these types. If the build still passes because all fields are optional or null-able, good. If a caller breaks, fix it in the same task — do not leave a broken build.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/product.model.ts \
        src/client/src/app/core/models/dashboard.model.ts \
        src/client/src/app/core/models/landscape.model.ts
git commit -m "feat(models): add MOA/ROA fields to Product, DashboardFilters, BullseyeProduct"
```

---

## Task 7: Create `MechanismOfActionService` and `RouteOfAdministrationService`

**Files:**
- Create: `src/client/src/app/core/services/mechanism-of-action.service.ts`
- Create: `src/client/src/app/core/services/route-of-administration.service.ts`

- [ ] **Step 1: Read `company.service.ts` to confirm the exact pattern you're mirroring**

Open `src/client/src/app/core/services/company.service.ts` and note: class-level `@Injectable({ providedIn: 'root' })`, `private supabase = inject(SupabaseService)`, async methods that use `this.supabase.client.from(...)`, error-throwing on `{ error }`.

- [ ] **Step 2: Write `mechanism-of-action.service.ts`**

```typescript
import { inject, Injectable } from '@angular/core';

import { MechanismOfAction } from '../models/mechanism-of-action.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class MechanismOfActionService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<MechanismOfAction[]> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .select('*')
      .eq('space_id', spaceId)
      .order('display_order')
      .order('name');
    if (error) throw error;
    return (data ?? []) as MechanismOfAction[];
  }

  async getById(id: string): Promise<MechanismOfAction> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async create(spaceId: string, moa: Partial<MechanismOfAction>): Promise<MechanismOfAction> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .insert({
        space_id: spaceId,
        name: moa.name,
        description: moa.description ?? null,
        display_order: moa.display_order ?? 0,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async update(id: string, changes: Partial<MechanismOfAction>): Promise<MechanismOfAction> {
    const { data, error } = await this.supabase.client
      .from('mechanisms_of_action')
      .update({
        name: changes.name,
        description: changes.description ?? null,
        display_order: changes.display_order ?? 0,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as MechanismOfAction;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('mechanisms_of_action')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async countAssignedProducts(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('product_mechanisms_of_action')
      .select('*', { count: 'exact', head: true })
      .eq('moa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
```

- [ ] **Step 3: Write `route-of-administration.service.ts`**

```typescript
import { inject, Injectable } from '@angular/core';

import { RouteOfAdministration } from '../models/route-of-administration.model';
import { SupabaseService } from './supabase.service';

@Injectable({ providedIn: 'root' })
export class RouteOfAdministrationService {
  private supabase = inject(SupabaseService);

  async list(spaceId: string): Promise<RouteOfAdministration[]> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .select('*')
      .eq('space_id', spaceId)
      .order('display_order')
      .order('name');
    if (error) throw error;
    return (data ?? []) as RouteOfAdministration[];
  }

  async getById(id: string): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .select('*')
      .eq('id', id)
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async create(spaceId: string, roa: Partial<RouteOfAdministration>): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .insert({
        space_id: spaceId,
        name: roa.name,
        abbreviation: roa.abbreviation ?? null,
        display_order: roa.display_order ?? 0,
      })
      .select('*')
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async update(id: string, changes: Partial<RouteOfAdministration>): Promise<RouteOfAdministration> {
    const { data, error } = await this.supabase.client
      .from('routes_of_administration')
      .update({
        name: changes.name,
        abbreviation: changes.abbreviation ?? null,
        display_order: changes.display_order ?? 0,
      })
      .eq('id', id)
      .select('*')
      .single();
    if (error) throw error;
    return data as RouteOfAdministration;
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('routes_of_administration')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }

  async countAssignedProducts(id: string): Promise<number> {
    const { count, error } = await this.supabase.client
      .from('product_routes_of_administration')
      .select('*', { count: 'exact', head: true })
      .eq('roa_id', id);
    if (error) throw error;
    return count ?? 0;
  }
}
```

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/services/mechanism-of-action.service.ts \
        src/client/src/app/core/services/route-of-administration.service.ts
git commit -m "feat(services): add MechanismOfActionService and RouteOfAdministrationService"
```

---

## Task 8: Extend `ProductService` with MOA/ROA hydration and set methods

**Files:**
- Modify: `src/client/src/app/core/services/product.service.ts`

- [ ] **Step 1: Read the current file**

Open `src/client/src/app/core/services/product.service.ts` and find the `list()` and `getById()` methods (if it has one).

- [ ] **Step 2: Extend the product select strings**

In `list()` and any other fetch that's used by the manage screens, change the Supabase select string from `'*'` to include nested MOA/ROA:

```typescript
.select(`
  *,
  mechanisms_of_action:product_mechanisms_of_action (
    moa:mechanisms_of_action ( id, name, description, display_order )
  ),
  routes_of_administration:product_routes_of_administration (
    roa:routes_of_administration ( id, name, abbreviation, display_order )
  )
`)
```

Then after the fetch, flatten the nested join-table rows into a simpler shape. Add this post-processing right after the `error` check:

```typescript
const products = (data ?? []).map((p: any) => ({
  ...p,
  mechanisms_of_action: (p.mechanisms_of_action ?? []).map((j: any) => j.moa).filter(Boolean),
  routes_of_administration: (p.routes_of_administration ?? []).map((j: any) => j.roa).filter(Boolean),
}));
return products as Product[];
```

Replace the existing `return data as Product[]` with the processed `products`.

- [ ] **Step 3: Add `setMechanisms()`**

At the bottom of the class, before the closing brace:

```typescript
async setMechanisms(productId: string, moaIds: string[]): Promise<void> {
  const { error: deleteError } = await this.supabase.client
    .from('product_mechanisms_of_action')
    .delete()
    .eq('product_id', productId);
  if (deleteError) throw deleteError;

  if (moaIds.length === 0) return;

  const rows = moaIds.map((moa_id) => ({ product_id: productId, moa_id }));
  const { error: insertError } = await this.supabase.client
    .from('product_mechanisms_of_action')
    .insert(rows);
  if (insertError) throw insertError;
}
```

- [ ] **Step 4: Add `setRoutes()`**

```typescript
async setRoutes(productId: string, roaIds: string[]): Promise<void> {
  const { error: deleteError } = await this.supabase.client
    .from('product_routes_of_administration')
    .delete()
    .eq('product_id', productId);
  if (deleteError) throw deleteError;

  if (roaIds.length === 0) return;

  const rows = roaIds.map((roa_id) => ({ product_id: productId, roa_id }));
  const { error: insertError } = await this.supabase.client
    .from('product_routes_of_administration')
    .insert(rows);
  if (insertError) throw insertError;
}
```

- [ ] **Step 5: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes. If the `as Product[]` cast complains about shape mismatch, check that `product.model.ts` from Task 6 already has the two optional fields.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/product.service.ts
git commit -m "feat(services): hydrate MOA/ROA in ProductService and add setMechanisms/setRoutes"
```

---

## Task 9: Extend `DashboardService` to pass MOA/ROA filter parameters

**Files:**
- Modify: `src/client/src/app/core/services/dashboard.service.ts`

- [ ] **Step 1: Read the file**

Open `src/client/src/app/core/services/dashboard.service.ts` and find the `getDashboardData` method.

- [ ] **Step 2: Add the two new RPC params**

Extend the `rpc('get_dashboard_data', { ... })` call to include:

```typescript
p_mechanism_of_action_ids: filters.mechanismOfActionIds,
p_route_of_administration_ids: filters.routeOfAdministrationIds,
```

The final shape:

```typescript
const { data, error } = await this.supabase.client.rpc('get_dashboard_data', {
  p_space_id: spaceId,
  p_company_ids: filters.companyIds,
  p_product_ids: filters.productIds,
  p_therapeutic_area_ids: filters.therapeuticAreaIds,
  p_start_year: filters.startYear,
  p_end_year: filters.endYear,
  p_recruitment_statuses: filters.recruitmentStatuses,
  p_study_types: filters.studyTypes,
  p_phases: filters.phases,
  p_mechanism_of_action_ids: filters.mechanismOfActionIds,
  p_route_of_administration_ids: filters.routeOfAdministrationIds,
});
```

No other changes to the service — the product shape already includes `mechanisms_of_action` and `routes_of_administration` because Task 3 updated the RPC and Task 6 updated the type.

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes. If the `filters.mechanismOfActionIds` access complains, confirm Task 6 landed.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/services/dashboard.service.ts
git commit -m "feat(services): pass MOA/ROA filters to get_dashboard_data RPC"
```

---

# Phase 3 — Manage screens

## Task 10: Create MOA manage list component

**Files:**
- Create: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.ts`
- Create: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-list.component.html`

- [ ] **Step 1: Read the reference implementation**

Open `src/client/src/app/features/manage/companies/company-list.component.ts` and `.html`. This is the exact template you are mirroring. The differences for MOA: no logo, show a `description` column, no "products" navigation (no child resource).

- [ ] **Step 2: Write the TS file**

```typescript
import { Component, inject, OnInit, signal } from '@angular/core';
import { ButtonModule } from 'primeng/button';
import { Dialog } from 'primeng/dialog';
import { MessageModule } from 'primeng/message';
import { TableModule } from 'primeng/table';

import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { SpaceService } from '../../../core/services/space.service';
import { ManagePageShellComponent } from '../shared/manage-page-shell.component';
import { RowActionsComponent } from '../shared/row-actions.component';
import { MechanismOfActionFormComponent } from './mechanism-of-action-form.component';

@Component({
  selector: 'app-mechanism-of-action-list',
  standalone: true,
  imports: [
    TableModule,
    ButtonModule,
    Dialog,
    MessageModule,
    MechanismOfActionFormComponent,
    ManagePageShellComponent,
    RowActionsComponent,
  ],
  templateUrl: './mechanism-of-action-list.component.html',
})
export class MechanismOfActionListComponent implements OnInit {
  private readonly moaService = inject(MechanismOfActionService);
  private readonly spaceService = inject(SpaceService);

  readonly items = signal<MechanismOfAction[]>([]);
  readonly loading = signal(false);
  readonly modalOpen = signal(false);
  readonly editing = signal<MechanismOfAction | null>(null);
  readonly deleteError = signal<string | null>(null);

  async ngOnInit(): Promise<void> {
    await this.load();
  }

  openCreate(): void {
    this.editing.set(null);
    this.modalOpen.set(true);
  }

  openEdit(item: MechanismOfAction): void {
    this.editing.set(item);
    this.modalOpen.set(true);
  }

  closeModal(): void {
    this.modalOpen.set(false);
    this.editing.set(null);
  }

  async onSaved(): Promise<void> {
    this.closeModal();
    await this.load();
  }

  async confirmDelete(item: MechanismOfAction): Promise<void> {
    const count = await this.moaService.countAssignedProducts(item.id);
    const message =
      count > 0
        ? `This MOA is assigned to ${count} product${count === 1 ? '' : 's'}. Delete anyway?`
        : `Delete "${item.name}"?`;
    if (!confirm(message)) return;
    try {
      await this.moaService.delete(item.id);
      this.deleteError.set(null);
      await this.load();
    } catch (e: any) {
      this.deleteError.set(e?.message ?? 'Delete failed');
    }
  }

  private async load(): Promise<void> {
    const spaceId = this.spaceService.currentSpaceId();
    if (!spaceId) return;
    this.loading.set(true);
    try {
      this.items.set(await this.moaService.list(spaceId));
    } finally {
      this.loading.set(false);
    }
  }
}
```

> Before writing this, verify the exact names of: `SpaceService.currentSpaceId()` (or equivalent), `ManagePageShellComponent` path, `RowActionsComponent` path. If the existing `company-list.component.ts` uses different imports, match those instead.

- [ ] **Step 3: Write the HTML file**

```html
<app-manage-page-shell
  title="Mechanisms of Action"
  subtitle="Curate the MOAs used to classify drug programs."
  (createClick)="openCreate()"
>
  @if (deleteError(); as err) {
    <p-message severity="error" [text]="err" styleClass="mb-3" />
  }

  <p-table [value]="items()" [loading]="loading()" styleClass="p-datatable-sm" [rowHover]="true">
    <ng-template pTemplate="header">
      <tr>
        <th class="w-16">Order</th>
        <th>Name</th>
        <th>Description</th>
        <th class="w-24 text-right">Actions</th>
      </tr>
    </ng-template>
    <ng-template pTemplate="body" let-item>
      <tr>
        <td>{{ item.display_order }}</td>
        <td class="font-medium">{{ item.name }}</td>
        <td class="text-slate-600">{{ item.description || '—' }}</td>
        <td class="text-right">
          <app-row-actions
            (edit)="openEdit(item)"
            (delete)="confirmDelete(item)"
          />
        </td>
      </tr>
    </ng-template>
    <ng-template pTemplate="emptymessage">
      <tr>
        <td colspan="4" class="text-center text-slate-500 py-8">No MOAs yet. Click "New" to add one.</td>
      </tr>
    </ng-template>
  </p-table>

  <p-dialog
    [visible]="modalOpen()"
    [modal]="true"
    [closable]="true"
    [dismissableMask]="true"
    header="{{ editing() ? 'Edit MOA' : 'New MOA' }}"
    [style]="{ width: '480px' }"
    (onHide)="closeModal()"
  >
    <app-mechanism-of-action-form
      [item]="editing()"
      (saved)="onSaved()"
      (cancelled)="closeModal()"
    />
  </p-dialog>
</app-manage-page-shell>
```

> If `app-manage-page-shell`, `app-row-actions`, or `app-mechanism-of-action-form` don't match the actual selectors, check the companies equivalents and update the selector names to match. Do NOT invent selectors.

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes once the form component exists. For now, it will fail with "cannot find MechanismOfActionFormComponent" — that's OK if you're running the verify at the end of this task. If it fails with other errors, fix them.

- [ ] **Step 5: Commit**

Defer commit until Task 11 (the form component) is done so the build is clean.

---

## Task 11: Create MOA manage form component

**Files:**
- Create: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-form.component.ts`
- Create: `src/client/src/app/features/manage/mechanisms-of-action/mechanism-of-action-form.component.html`

- [ ] **Step 1: Read the reference implementation**

Open `src/client/src/app/features/manage/companies/company-form.component.ts` and `.html`.

- [ ] **Step 2: Write the TS file**

```typescript
import { Component, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { InputNumberModule } from 'primeng/inputnumber';
import { InputTextModule } from 'primeng/inputtext';
import { MessageModule } from 'primeng/message';
import { TextareaModule } from 'primeng/textarea';

import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { SpaceService } from '../../../core/services/space.service';
import { FormFieldComponent } from '../shared/form-field.component';

@Component({
  selector: 'app-mechanism-of-action-form',
  standalone: true,
  imports: [
    FormsModule,
    InputTextModule,
    InputNumberModule,
    TextareaModule,
    ButtonModule,
    MessageModule,
    FormFieldComponent,
  ],
  templateUrl: './mechanism-of-action-form.component.html',
})
export class MechanismOfActionFormComponent implements OnInit {
  private readonly moaService = inject(MechanismOfActionService);
  private readonly spaceService = inject(SpaceService);

  readonly item = input<MechanismOfAction | null>(null);
  readonly saved = output<MechanismOfAction>();
  readonly cancelled = output<void>();

  readonly name = signal('');
  readonly description = signal('');
  readonly displayOrder = signal(0);
  readonly submitting = signal(false);
  readonly error = signal<string | null>(null);
  readonly nameBlurred = signal(false);

  ngOnInit(): void {
    const current = this.item();
    if (current) {
      this.name.set(current.name);
      this.description.set(current.description ?? '');
      this.displayOrder.set(current.display_order ?? 0);
    }
  }

  get isEdit(): boolean {
    return this.item() !== null;
  }

  get nameInvalid(): boolean {
    return this.nameBlurred() && this.name().trim().length === 0;
  }

  async onSubmit(): Promise<void> {
    if (this.nameInvalid || this.name().trim().length === 0) {
      this.nameBlurred.set(true);
      return;
    }
    this.submitting.set(true);
    this.error.set(null);
    try {
      const spaceId = this.spaceService.currentSpaceId();
      if (!spaceId) throw new Error('No active space');
      const payload: Partial<MechanismOfAction> = {
        name: this.name().trim(),
        description: this.description().trim() || null,
        display_order: this.displayOrder(),
      };
      const result = this.isEdit
        ? await this.moaService.update(this.item()!.id, payload)
        : await this.moaService.create(spaceId, payload);
      this.saved.emit(result);
    } catch (e: any) {
      this.error.set(e?.message ?? 'Save failed');
    } finally {
      this.submitting.set(false);
    }
  }

  cancel(): void {
    this.cancelled.emit();
  }
}
```

- [ ] **Step 3: Write the HTML file**

```html
<form (ngSubmit)="onSubmit()" class="flex flex-col gap-4">
  @if (error(); as err) {
    <p-message severity="error" [text]="err" />
  }

  <app-form-field label="Name" [required]="true" [invalid]="nameInvalid" errorText="Name is required">
    <input
      pInputText
      type="text"
      [ngModel]="name()"
      (ngModelChange)="name.set($event)"
      (blur)="nameBlurred.set(true)"
      name="name"
      autocomplete="off"
      class="w-full"
    />
  </app-form-field>

  <app-form-field label="Description">
    <textarea
      pTextarea
      [ngModel]="description()"
      (ngModelChange)="description.set($event)"
      name="description"
      rows="3"
      class="w-full"
    ></textarea>
  </app-form-field>

  <app-form-field label="Display order">
    <p-inputnumber
      [ngModel]="displayOrder()"
      (ngModelChange)="displayOrder.set($event)"
      name="displayOrder"
      [showButtons]="true"
      [min]="0"
    />
  </app-form-field>

  <div class="flex justify-end gap-2 pt-2">
    <p-button type="button" label="Cancel" severity="secondary" (onClick)="cancel()" [disabled]="submitting()" />
    <p-button type="submit" label="{{ isEdit ? 'Save' : 'Create' }}" [loading]="submitting()" />
  </div>
</form>
```

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/manage/mechanisms-of-action/
git commit -m "feat(manage): add mechanisms of action list and form components"
```

---

## Task 12: Create ROA manage list component

**Files:**
- Create: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.ts`
- Create: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-list.component.html`

- [ ] **Step 1: Copy-adapt from Task 10**

Follow Task 10's Step 2 and Step 3 exactly, but substitute everywhere:
- `MechanismOfAction` → `RouteOfAdministration`
- `MechanismOfActionService` → `RouteOfAdministrationService`
- `mechanism-of-action` → `route-of-administration`
- `app-mechanism-of-action-*` → `app-route-of-administration-*`
- `MOA` → `ROA` in user-facing strings
- `Mechanisms of Action` → `Routes of Administration`
- Table: replace the "Description" column with an "Abbreviation" column (`<td>{{ item.abbreviation || '—' }}</td>`)

- [ ] **Step 2: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: compilation fails until Task 13 (the form) lands; continue to Task 13 without commit.

---

## Task 13: Create ROA manage form component

**Files:**
- Create: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-form.component.ts`
- Create: `src/client/src/app/features/manage/routes-of-administration/route-of-administration-form.component.html`

- [ ] **Step 1: Copy-adapt from Task 11**

Same substitution rules as Task 12, plus replace the `description` field with `abbreviation`:
- Signal: `readonly abbreviation = signal('');`
- Template: swap the `textarea` field for an `<input pInputText ...>` bound to `abbreviation`, with label "Abbreviation (e.g. IV, PO)"
- `onSubmit` payload: `abbreviation: this.abbreviation().trim() || null`
- `ngOnInit`: `this.abbreviation.set(current.abbreviation ?? '')`

- [ ] **Step 2: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/features/manage/routes-of-administration/
git commit -m "feat(manage): add routes of administration list and form components"
```

---

## Task 14: Register MOA and ROA routes in `app.routes.ts`

**Files:**
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Read the current routes array**

Find the `manage/companies`, `manage/marker-types`, `manage/therapeutic-areas` entries.

- [ ] **Step 2: Add two new routes**

Insert alphabetically between `manage/marker-types` and `manage/therapeutic-areas` (or at the end of the manage block if you prefer — order doesn't affect functionality):

```typescript
{
  path: 'manage/mechanisms-of-action',
  loadComponent: () =>
    import('./features/manage/mechanisms-of-action/mechanism-of-action-list.component').then(
      (m) => m.MechanismOfActionListComponent,
    ),
},
{
  path: 'manage/routes-of-administration',
  loadComponent: () =>
    import('./features/manage/routes-of-administration/route-of-administration-list.component').then(
      (m) => m.RouteOfAdministrationListComponent,
    ),
},
```

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 4: Manual QA — smoke-test both new screens**

```bash
cd src/client && ng serve
```

Then in the browser:
1. Navigate to `http://localhost:4200/manage/mechanisms-of-action`. Expect the list with 8 seeded MOAs.
2. Click "New", fill in Name = "Test MOA", click Create. Row appears.
3. Click edit on the new row, change Name to "Test MOA 2", Save. Row updates.
4. Click delete on it. Confirm "Delete "Test MOA 2"?" dialog. Row disappears.
5. Navigate to `http://localhost:4200/manage/routes-of-administration`. Expect 7 seeded ROAs.
6. Repeat create/edit/delete for an ROA, including the abbreviation field.

If any step fails, fix before committing.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/app.routes.ts
git commit -m "feat(routes): register MOA and ROA manage routes"
```

---

## Task 15: Extend `ProductFormComponent` with MOA/ROA multiselects

**Files:**
- Modify: `src/client/src/app/features/manage/products/product-form.component.ts`
- Modify: `src/client/src/app/features/manage/products/product-form.component.html`

- [ ] **Step 1: Read the current form component**

Open both files and identify the class-level signals (`name`, `genericName`, `companyId`, etc.) and the template's field layout.

- [ ] **Step 2: Add new imports and signals**

At the top of `product-form.component.ts`:

```typescript
import { MultiSelectModule } from 'primeng/multiselect';
import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
```

Add `MultiSelectModule` to the `imports` array.

Inject the two new services:

```typescript
private readonly moaService = inject(MechanismOfActionService);
private readonly roaService = inject(RouteOfAdministrationService);
```

Add signals:

```typescript
readonly moaOptions = signal<MechanismOfAction[]>([]);
readonly roaOptions = signal<RouteOfAdministration[]>([]);
readonly selectedMoaIds = signal<string[]>([]);
readonly selectedRoaIds = signal<string[]>([]);
```

- [ ] **Step 3: Load options in `ngOnInit`**

Find `ngOnInit` and after loading companies, add:

```typescript
const spaceId = this.spaceService.currentSpaceId();
if (spaceId) {
  const [moas, roas] = await Promise.all([
    this.moaService.list(spaceId),
    this.roaService.list(spaceId),
  ]);
  this.moaOptions.set(moas);
  this.roaOptions.set(roas);
}

const current = this.product();
if (current) {
  this.selectedMoaIds.set((current.mechanisms_of_action ?? []).map((m) => m.id));
  this.selectedRoaIds.set((current.routes_of_administration ?? []).map((r) => r.id));
}
```

- [ ] **Step 4: Extend `onSubmit` to persist MOA/ROA after the product upsert**

After the existing upsert code (where it gets the saved product with an id), before `this.saved.emit(...)`:

```typescript
await Promise.all([
  this.productService.setMechanisms(savedProduct.id, this.selectedMoaIds()),
  this.productService.setRoutes(savedProduct.id, this.selectedRoaIds()),
]);
```

> If the upsert doesn't assign the result to a `savedProduct` variable, rename the binding or extract it. Error handling: if these calls fail after the product upsert succeeds, catch and show `this.error.set('Product saved but MOA/ROA assignment failed. Retry?')` — do not throw through the emit.

Concrete error-handling pattern:

```typescript
try {
  await Promise.all([
    this.productService.setMechanisms(savedProduct.id, this.selectedMoaIds()),
    this.productService.setRoutes(savedProduct.id, this.selectedRoaIds()),
  ]);
} catch (e: any) {
  this.error.set('Product saved but MOA/ROA assignment failed: ' + (e?.message ?? 'unknown error'));
  this.submitting.set(false);
  return;
}
this.saved.emit(savedProduct);
```

- [ ] **Step 5: Add the two fields to the template**

In `product-form.component.html`, below the existing `companyId` / `logoUrl` / `displayOrder` fields, add:

```html
<app-form-field label="Mechanisms of action">
  <p-multiselect
    [options]="moaOptions()"
    [ngModel]="selectedMoaIds()"
    (ngModelChange)="selectedMoaIds.set($event)"
    name="moas"
    optionLabel="name"
    optionValue="id"
    placeholder="Select mechanisms"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-full"
  />
</app-form-field>

<app-form-field label="Routes of administration">
  <p-multiselect
    [options]="roaOptions()"
    [ngModel]="selectedRoaIds()"
    (ngModelChange)="selectedRoaIds.set($event)"
    name="roas"
    optionLabel="name"
    optionValue="id"
    placeholder="Select routes"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-full"
  />
</app-form-field>
```

- [ ] **Step 6: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 7: Manual QA**

```bash
cd src/client && ng serve
```

1. Navigate to `http://localhost:4200/manage/products`.
2. Edit a seeded product that has assigned MOAs (from the seed file). Expect the MOA multiselect to show the pre-assigned names as chips.
3. Add another MOA, remove an existing one, add an ROA, click Save.
4. Re-open the same product. Confirm the selections round-trip (the ones you set are still there).
5. Create a brand new product, pick 2 MOAs + 1 ROA, save, re-open, confirm they're stored.

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/features/manage/products/product-form.component.ts \
        src/client/src/app/features/manage/products/product-form.component.html
git commit -m "feat(manage): add MOA/ROA multiselects to product form"
```

---

# Phase 4 — Dashboard filter panel and grid columns

## Task 16: Extend dashboard filter signal default shape

**Files:**
- Modify: `src/client/src/app/features/dashboard/dashboard.component.ts`

- [ ] **Step 1: Find the `filters` signal default**

Locate the `filters = signal<DashboardFilters>({ ... })` initializer.

- [ ] **Step 2: Add two new keys**

```typescript
mechanismOfActionIds: null,
routeOfAdministrationIds: null,
```

Place them next to the existing filter keys.

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes. TypeScript will yell if `DashboardFilters` is missing these fields — Task 6 already added them.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/dashboard/dashboard.component.ts
git commit -m "feat(dashboard): add MOA/ROA fields to default filter state"
```

---

## Task 17: Add MOA and ROA multiselects to `FilterPanelComponent`

**Files:**
- Modify: `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts`
- Modify: `src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html`

- [ ] **Step 1: Read the current panel**

Identify: (a) how input/output filters flow (likely `input()` for current values + `output()` for changes, or two-way signal binding), (b) how existing multiselects like "Company" populate their options.

- [ ] **Step 2: Add service injection + option signals**

In the TS file, add:

```typescript
import { MechanismOfActionService } from '../../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../../core/services/route-of-administration.service';
import { MechanismOfAction } from '../../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../../core/models/route-of-administration.model';
```

```typescript
private readonly moaService = inject(MechanismOfActionService);
private readonly roaService = inject(RouteOfAdministrationService);

readonly moaOptions = signal<{ label: string; value: string }[]>([]);
readonly roaOptions = signal<{ label: string; value: string }[]>([]);

readonly selectedMoaIds = signal<string[]>([]);
readonly selectedRoaIds = signal<string[]>([]);
```

> Match the shape used by existing option signals like `companyOptions` — if they use `{ label, value }` objects (as verified in exploration), do the same. If they use the raw entity, use that instead.

- [ ] **Step 3: Load options**

In the existing init hook (likely `ngOnInit` or an effect), fetch MOAs and ROAs from their services and map to `{ label: name, value: id }`:

```typescript
const spaceId = this.spaceService.currentSpaceId();
if (spaceId) {
  const [moas, roas] = await Promise.all([
    this.moaService.list(spaceId),
    this.roaService.list(spaceId),
  ]);
  this.moaOptions.set(moas.map((m) => ({ label: m.name, value: m.id })));
  this.roaOptions.set(roas.map((r) => ({ label: r.name, value: r.id })));
}
```

- [ ] **Step 4: Wire up filter emit**

Find where the existing multi-selects emit filter changes (likely an `emitFilters()` method or a `(ngModelChange)` that writes back to a parent via output). Wire the two new signals into the same emit path so changes flow back to `dashboard.component.ts`.

Example: if the existing pattern is an `emitFilters()` method that builds a `DashboardFilters` object:

```typescript
private emitFilters(): void {
  this.filtersChange.emit({
    companyIds: this.selectedCompanyIds().length ? this.selectedCompanyIds() : null,
    // ...existing fields
    mechanismOfActionIds: this.selectedMoaIds().length ? this.selectedMoaIds() : null,
    routeOfAdministrationIds: this.selectedRoaIds().length ? this.selectedRoaIds() : null,
  });
}
```

- [ ] **Step 5: Add two multiselects to the template**

In `filter-panel.component.html`, find the existing multiselect block (the `@else { <div class="flex flex-wrap items-center gap-1.5">...`). Add two new `<p-multiselect>` elements after the existing ones, matching the exact style:

```html
<p-multiselect
  [options]="moaOptions()"
  [ngModel]="selectedMoaIds()"
  (ngModelChange)="selectedMoaIds.set($event); emitFilters()"
  placeholder="MOA"
  ariaLabel="Filter by mechanism of action"
  optionLabel="label"
  optionValue="value"
  display="comma"
  [filter]="true"
  [showClear]="true"
  styleClass="w-32"
  size="small"
/>
<p-multiselect
  [options]="roaOptions()"
  [ngModel]="selectedRoaIds()"
  (ngModelChange)="selectedRoaIds.set($event); emitFilters()"
  placeholder="ROA"
  ariaLabel="Filter by route of administration"
  optionLabel="label"
  optionValue="value"
  display="comma"
  [filter]="true"
  [showClear]="true"
  styleClass="w-32"
  size="small"
/>
```

- [ ] **Step 6: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 7: Manual QA**

1. `ng serve`, navigate to `http://localhost:4200/dashboard`.
2. Two new MOA and ROA chips appear in the filter bar.
3. Open MOA dropdown → see the 8 seeded MOAs.
4. Select "PD-1 inhibitor". Grid narrows to only products assigned to PD-1.
5. Select "PD-L1 inhibitor" as well. Grid shows products matching PD-1 OR PD-L1.
6. Clear via the `×` on the multiselect. Grid restores.
7. Same check for ROA.

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts \
        src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html
git commit -m "feat(dashboard): add MOA and ROA multiselects to filter panel"
```

---

## Task 18: Add MOA and ROA columns to `DashboardGridComponent`

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts`
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html`

- [ ] **Step 1: Read the current grid component**

Focus on the `flattenedTrials` computed: it already builds per-product rows with `productName`, `productLogoUrl`, `isFirstInProduct`. You need to include MOA and ROA on the flattened row.

- [ ] **Step 2: Extend `FlattenedTrial` type**

Find the `FlattenedTrial` interface (or wherever it's defined — `dashboard.model.ts` or inline in the grid component) and add:

```typescript
productMoas: { id: string; name: string }[];
productRoas: { id: string; name: string; abbreviation: string | null }[];
```

- [ ] **Step 3: Populate in `flattenedTrials` computed**

Inside the loop where rows are pushed, add:

```typescript
productMoas: product.mechanisms_of_action ?? [],
productRoas: product.routes_of_administration ?? [],
```

- [ ] **Step 4: Add visibility signals**

Above `flattenedTrials`:

```typescript
readonly showMoaColumn = signal(true);
readonly showRoaColumn = signal(true);

toggleMoaColumn(value: boolean): void {
  this.showMoaColumn.set(value);
}
toggleRoaColumn(value: boolean): void {
  this.showRoaColumn.set(value);
}
```

- [ ] **Step 5: Add MOA and ROA columns to the template**

In `dashboard-grid.component.html`, find where the existing product cell is rendered (should be a `<td>` or equivalent with `product name`). Insert two new `<td>` cells after the product cell and before the trial cell.

Wrap each in an `@if` so the column conditionally renders:

```html
@if (showMoaColumn()) {
  <td class="min-w-[88px] max-w-[140px] align-top px-2 py-1">
    @if (row.isFirstInProduct) {
      @if (row.productMoas.length > 0) {
        <div class="flex flex-col gap-0.5" [pTooltip]="moaTooltipText(row.productMoas)" tooltipPosition="top">
          @for (moa of row.productMoas.slice(0, 2); track moa.id) {
            <span class="inline-block rounded-sm bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 truncate">{{ moa.name }}</span>
          }
          @if (row.productMoas.length > 2) {
            <span class="text-[10px] text-slate-500">+{{ row.productMoas.length - 2 }}</span>
          }
        </div>
      } @else {
        <span class="text-slate-400">—</span>
      }
    }
  </td>
}

@if (showRoaColumn()) {
  <td class="min-w-[88px] max-w-[140px] align-top px-2 py-1">
    @if (row.isFirstInProduct) {
      @if (row.productRoas.length > 0) {
        <div class="flex flex-col gap-0.5" [pTooltip]="roaTooltipText(row.productRoas)" tooltipPosition="top">
          @for (roa of row.productRoas.slice(0, 2); track roa.id) {
            <span class="inline-block rounded-sm bg-slate-100 text-slate-700 text-[10px] px-1.5 py-0.5 truncate">{{ roa.abbreviation ?? roa.name }}</span>
          }
          @if (row.productRoas.length > 2) {
            <span class="text-[10px] text-slate-500">+{{ row.productRoas.length - 2 }}</span>
          }
        </div>
      } @else {
        <span class="text-slate-400">—</span>
      }
    }
  </td>
}
```

- [ ] **Step 6: Add header cells**

Find the `<thead>` / header row. Insert two `<th>` cells between Product and Trial (match existing header styling, likely uppercase tracked labels):

```html
@if (showMoaColumn()) {
  <th scope="col" class="min-w-[88px] max-w-[140px] px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500">MOA</th>
}
@if (showRoaColumn()) {
  <th scope="col" class="min-w-[88px] max-w-[140px] px-2 py-1 text-left text-[10px] uppercase tracking-wider text-slate-500">ROA</th>
}
```

- [ ] **Step 7: Add tooltip helper methods to the TS**

```typescript
moaTooltipText(moas: { id: string; name: string }[]): string {
  return moas.map((m) => m.name).join(' · ');
}

roaTooltipText(roas: { id: string; name: string; abbreviation: string | null }[]): string {
  return roas.map((r) => r.name).join(' · ');
}
```

Add `TooltipModule` from `primeng/tooltip` to the component imports if it isn't there already.

- [ ] **Step 8: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes. If header column count doesn't match body column count, check `colspan` on empty-state rows.

- [ ] **Step 9: Manual QA**

1. `ng serve`, navigate to dashboard.
2. MOA and ROA columns visible between Product and Trial.
3. Products with assigned MOAs show the pill chips; unassigned products show `—`.
4. ROA column shows abbreviations (`IV`, `PO`, etc.).
5. Hover a pill — tooltip shows the full name(s).

- [ ] **Step 10: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts \
        src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat(dashboard): add MOA and ROA columns to grid"
```

---

## Task 19: Add column-visibility popover to grid toolbar

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts`
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.html`

- [ ] **Step 1: Add PopoverModule to imports**

```typescript
import { PopoverModule } from 'primeng/popover';
import { CheckboxModule } from 'primeng/checkbox';
import { FormsModule } from '@angular/forms';
```

Add `PopoverModule`, `CheckboxModule`, `FormsModule` to the component's `imports` array if they're not already there.

- [ ] **Step 2: Add the popover button to the toolbar**

Find the grid toolbar area (where the zoom control lives — should be near the top of the grid). Add next to the zoom control:

```html
<p-button
  icon="pi pi-sliders-h"
  severity="secondary"
  [rounded]="true"
  [text]="true"
  size="small"
  ariaLabel="Toggle columns"
  aria-haspopup="dialog"
  (onClick)="columnsPopover.toggle($event)"
/>
<p-popover #columnsPopover>
  <div class="flex flex-col gap-2 p-1 min-w-[200px]">
    <div class="text-[10px] uppercase tracking-wider text-slate-500 pb-1 border-b border-slate-200">Columns</div>
    <label class="flex items-center gap-2 cursor-pointer">
      <p-checkbox
        [ngModel]="showMoaColumn()"
        (ngModelChange)="toggleMoaColumn($event)"
        [binary]="true"
        inputId="toggle-moa"
      />
      <span class="text-sm">Mechanism of action</span>
    </label>
    <label class="flex items-center gap-2 cursor-pointer">
      <p-checkbox
        [ngModel]="showRoaColumn()"
        (ngModelChange)="toggleRoaColumn($event)"
        [binary]="true"
        inputId="toggle-roa"
      />
      <span class="text-sm">Route of administration</span>
    </label>
  </div>
</p-popover>
```

> If the existing toolbar is on a parent `DashboardComponent` template, not the grid template, move the button to that parent and emit toggle events from grid to parent — mirror whatever pattern the zoom control uses.

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 4: Manual QA**

1. `ng serve`, navigate to dashboard.
2. Click the sliders-h button in the toolbar. Popover opens with two checkboxes, both checked.
3. Uncheck "Mechanism of action". MOA column disappears from the grid (header + cells).
4. Uncheck "Route of administration". ROA column disappears.
5. Re-check both. Columns reappear.
6. Close popover by clicking outside or pressing Escape. State persists (within this session).
7. Reload the page. Both columns visible again (session-only, expected).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts \
        src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
git commit -m "feat(dashboard): add column-visibility popover for MOA and ROA columns"
```

---

# Phase 5 — Landscape filter bar and fade-out

## Task 20: Create `LandscapeFilterBarComponent`

**Files:**
- Create: `src/client/src/app/features/landscape/landscape-filter-bar.component.ts`
- Create: `src/client/src/app/features/landscape/landscape-filter-bar.component.html`

- [ ] **Step 1: Define the filter type**

The landscape filter type will live in `landscape.model.ts`. Before creating the filter bar component, add to `src/client/src/app/core/models/landscape.model.ts`:

```typescript
export type LandscapePhase = 'PRECLIN' | 'P1' | 'P2' | 'P3' | 'P4' | 'APPROVED' | 'LAUNCHED';
export type LandscapeRecruitmentStatus = string;
export type LandscapeStudyType = string;

export interface LandscapeFilters {
  mechanismOfActionIds: string[];
  routeOfAdministrationIds: string[];
  companyIds: string[];
  productIds: string[];
  phases: LandscapePhase[];
  recruitmentStatuses: LandscapeRecruitmentStatus[];
  studyTypes: LandscapeStudyType[];
}

export const EMPTY_LANDSCAPE_FILTERS: LandscapeFilters = {
  mechanismOfActionIds: [],
  routeOfAdministrationIds: [],
  companyIds: [],
  productIds: [],
  phases: [],
  recruitmentStatuses: [],
  studyTypes: [],
};
```

> If `landscape.model.ts` already has phase/status/type unions from the existing bullseye types, reuse those instead of redeclaring.

- [ ] **Step 2: Write the filter bar TS**

```typescript
import { Component, computed, inject, input, OnInit, output, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { ButtonModule } from 'primeng/button';
import { MultiSelectModule } from 'primeng/multiselect';
import { SelectButtonModule } from 'primeng/selectbutton';

import { MechanismOfAction } from '../../core/models/mechanism-of-action.model';
import { RouteOfAdministration } from '../../core/models/route-of-administration.model';
import {
  BullseyeProduct,
  EMPTY_LANDSCAPE_FILTERS,
  LandscapeFilters,
  LandscapePhase,
} from '../../core/models/landscape.model';
import { MechanismOfActionService } from '../../core/services/mechanism-of-action.service';
import { RouteOfAdministrationService } from '../../core/services/route-of-administration.service';
import { SpaceService } from '../../core/services/space.service';

@Component({
  selector: 'app-landscape-filter-bar',
  standalone: true,
  imports: [FormsModule, MultiSelectModule, ButtonModule, SelectButtonModule],
  templateUrl: './landscape-filter-bar.component.html',
})
export class LandscapeFilterBarComponent implements OnInit {
  private readonly moaService = inject(MechanismOfActionService);
  private readonly roaService = inject(RouteOfAdministrationService);
  private readonly spaceService = inject(SpaceService);

  readonly products = input.required<BullseyeProduct[]>();
  readonly filters = input.required<LandscapeFilters>();
  readonly filtersChange = output<LandscapeFilters>();

  readonly moaOptions = signal<{ label: string; value: string }[]>([]);
  readonly roaOptions = signal<{ label: string; value: string }[]>([]);

  readonly companyOptions = computed(() => {
    const seen = new Map<string, string>();
    for (const p of this.products()) {
      if (!seen.has(p.company_id)) seen.set(p.company_id, p.company_name);
    }
    return Array.from(seen, ([value, label]) => ({ label, value }));
  });

  readonly productOptions = computed(() =>
    this.products().map((p) => ({ label: p.name, value: p.id })),
  );

  readonly phaseOptions: { label: string; value: LandscapePhase }[] = [
    { label: 'P1', value: 'P1' },
    { label: 'P2', value: 'P2' },
    { label: 'P3', value: 'P3' },
    { label: 'Appr', value: 'APPROVED' },
  ];

  readonly statusOptions = computed(() => {
    const seen = new Set<string>();
    for (const p of this.products()) {
      for (const t of p.trials ?? []) {
        if (t.recruitment_status) seen.add(t.recruitment_status);
      }
    }
    return Array.from(seen).sort().map((v) => ({ label: v, value: v }));
  });

  readonly studyTypeOptions = computed(() => {
    const seen = new Set<string>();
    for (const p of this.products()) {
      for (const t of p.trials ?? []) {
        if (t.study_type) seen.add(t.study_type);
      }
    }
    return Array.from(seen).sort().map((v) => ({ label: v, value: v }));
  });

  async ngOnInit(): Promise<void> {
    const spaceId = this.spaceService.currentSpaceId();
    if (!spaceId) return;
    const [moas, roas] = await Promise.all([
      this.moaService.list(spaceId),
      this.roaService.list(spaceId),
    ]);
    this.moaOptions.set(moas.map((m) => ({ label: m.name, value: m.id })));
    this.roaOptions.set(roas.map((r) => ({ label: r.name, value: r.id })));
  }

  update<K extends keyof LandscapeFilters>(key: K, value: LandscapeFilters[K]): void {
    this.filtersChange.emit({ ...this.filters(), [key]: value });
  }

  clearAll(): void {
    this.filtersChange.emit({ ...EMPTY_LANDSCAPE_FILTERS });
  }

  get hasAnyActive(): boolean {
    const f = this.filters();
    return (
      f.mechanismOfActionIds.length > 0 ||
      f.routeOfAdministrationIds.length > 0 ||
      f.companyIds.length > 0 ||
      f.productIds.length > 0 ||
      f.phases.length > 0 ||
      f.recruitmentStatuses.length > 0 ||
      f.studyTypes.length > 0
    );
  }
}
```

> Note: the `BullseyeTrial` type is assumed to have `recruitment_status` and `study_type` fields. If the actual field names differ, update the `statusOptions` / `studyTypeOptions` accessors.

- [ ] **Step 3: Write the filter bar HTML**

```html
<div
  class="flex flex-wrap items-center gap-1.5 px-3 py-2 border-b border-slate-200 bg-white"
  role="toolbar"
  aria-label="Landscape filters"
>
  <p-multiselect
    [options]="moaOptions()"
    [ngModel]="filters().mechanismOfActionIds"
    (ngModelChange)="update('mechanismOfActionIds', $event)"
    placeholder="MOA"
    ariaLabel="Filter by mechanism of action"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />
  <p-multiselect
    [options]="roaOptions()"
    [ngModel]="filters().routeOfAdministrationIds"
    (ngModelChange)="update('routeOfAdministrationIds', $event)"
    placeholder="ROA"
    ariaLabel="Filter by route of administration"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />
  <p-multiselect
    [options]="companyOptions()"
    [ngModel]="filters().companyIds"
    (ngModelChange)="update('companyIds', $event)"
    placeholder="Company"
    ariaLabel="Filter by company"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />
  <p-multiselect
    [options]="productOptions()"
    [ngModel]="filters().productIds"
    (ngModelChange)="update('productIds', $event)"
    placeholder="Product"
    ariaLabel="Filter by product"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />
  <p-selectbutton
    [options]="phaseOptions"
    [ngModel]="filters().phases"
    (ngModelChange)="update('phases', $event)"
    [multiple]="true"
    optionLabel="label"
    optionValue="value"
    ariaLabelledBy="Phase"
    styleClass="text-[10px]"
  />
  <p-multiselect
    [options]="statusOptions()"
    [ngModel]="filters().recruitmentStatuses"
    (ngModelChange)="update('recruitmentStatuses', $event)"
    placeholder="Status"
    ariaLabel="Filter by recruitment status"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />
  <p-multiselect
    [options]="studyTypeOptions()"
    [ngModel]="filters().studyTypes"
    (ngModelChange)="update('studyTypes', $event)"
    placeholder="Study type"
    ariaLabel="Filter by study type"
    optionLabel="label"
    optionValue="value"
    display="comma"
    [filter]="true"
    [showClear]="true"
    styleClass="w-32"
    size="small"
  />

  @if (hasAnyActive) {
    <p-button
      label="Clear"
      severity="secondary"
      [text]="true"
      size="small"
      (onClick)="clearAll()"
    />
  }
</div>
```

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes (component exists but is not yet mounted).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/models/landscape.model.ts \
        src/client/src/app/features/landscape/landscape-filter-bar.component.ts \
        src/client/src/app/features/landscape/landscape-filter-bar.component.html
git commit -m "feat(landscape): add landscape filter bar component"
```

---

## Task 21: Wire filter bar into `LandscapeComponent` and compute `matchedProductIds`

**Files:**
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.html`

- [ ] **Step 1: Add state**

In `landscape.component.ts`, add near the other signals:

```typescript
import { EMPTY_LANDSCAPE_FILTERS, LandscapeFilters } from '../../core/models/landscape.model';

readonly landscapeFilters = signal<LandscapeFilters>({ ...EMPTY_LANDSCAPE_FILTERS });
```

- [ ] **Step 2: Compute `matchedProductIds`**

```typescript
readonly matchedProductIds = computed<Set<string> | null>(() => {
  const f = this.landscapeFilters();
  const noneActive =
    f.mechanismOfActionIds.length === 0 &&
    f.routeOfAdministrationIds.length === 0 &&
    f.companyIds.length === 0 &&
    f.productIds.length === 0 &&
    f.phases.length === 0 &&
    f.recruitmentStatuses.length === 0 &&
    f.studyTypes.length === 0;
  if (noneActive) return null;

  const matched = new Set<string>();
  for (const product of this.allProducts()) {
    if (this.productMatches(product, f)) matched.add(product.id);
  }
  return matched;
});

private productMatches(product: BullseyeProduct, f: LandscapeFilters): boolean {
  if (f.mechanismOfActionIds.length > 0) {
    const ok = (product.moas ?? []).some((m) => f.mechanismOfActionIds.includes(m.id));
    if (!ok) return false;
  }
  if (f.routeOfAdministrationIds.length > 0) {
    const ok = (product.roas ?? []).some((r) => f.routeOfAdministrationIds.includes(r.id));
    if (!ok) return false;
  }
  if (f.companyIds.length > 0 && !f.companyIds.includes(product.company_id)) return false;
  if (f.productIds.length > 0 && !f.productIds.includes(product.id)) return false;
  if (f.phases.length > 0 && !f.phases.includes(product.highest_phase)) return false;
  if (f.recruitmentStatuses.length > 0) {
    const ok = (product.trials ?? []).some(
      (t: any) => t.recruitment_status && f.recruitmentStatuses.includes(t.recruitment_status),
    );
    if (!ok) return false;
  }
  if (f.studyTypes.length > 0) {
    const ok = (product.trials ?? []).some(
      (t: any) => t.study_type && f.studyTypes.includes(t.study_type),
    );
    if (!ok) return false;
  }
  return true;
}

onFiltersChange(filters: LandscapeFilters): void {
  this.landscapeFilters.set(filters);
}
```

- [ ] **Step 3: Mount the filter bar in the template**

Open `landscape.component.html`. Find the TA selector area. Immediately after it and before the bullseye chart, add:

```html
<app-landscape-filter-bar
  [products]="allProducts()"
  [filters]="landscapeFilters()"
  (filtersChange)="onFiltersChange($event)"
/>
```

- [ ] **Step 4: Pass `matchedProductIds` to the chart**

Find the `<app-bullseye-chart ... />` element and add:

```html
[matchedProductIds]="matchedProductIds()"
```

- [ ] **Step 5: Import the filter bar component**

In `landscape.component.ts`, add to imports:

```typescript
import { LandscapeFilterBarComponent } from './landscape-filter-bar.component';
```

and add `LandscapeFilterBarComponent` to the component's `imports` array.

- [ ] **Step 6: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: build will fail on the `matchedProductIds` input to `BullseyeChartComponent` because it doesn't exist yet. That's expected — Task 22 adds it. Continue without committing.

- [ ] **Step 7: Commit (deferred to Task 22)**

---

## Task 22: Add `matchedProductIds` input and fade-out render to `BullseyeChartComponent`

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.html` (or the inline template)

- [ ] **Step 1: Add the input**

```typescript
readonly matchedProductIds = input<Set<string> | null>(null);

isProductMatched(productId: string): boolean {
  const set = this.matchedProductIds();
  return set === null || set.has(productId);
}
```

- [ ] **Step 2: Update the dot rendering**

Find the SVG `<circle>` (or `<g>`) that renders each dot. Add conditional styling and pointer-events.

Current likely form:
```html
<circle [attr.cx]="dot.x" [attr.cy]="dot.y" [attr.r]="dot.radius" [attr.fill]="dot.fillColor" ... />
```

Updated form:
```html
<circle
  [attr.cx]="dot.x"
  [attr.cy]="dot.y"
  [attr.r]="dot.radius"
  [attr.fill]="dot.fillColor"
  [class.dot-faded]="!isProductMatched(dot.product.id)"
  [attr.tabindex]="isProductMatched(dot.product.id) ? 0 : -1"
  (click)="isProductMatched(dot.product.id) && onDotClick(dot)"
  (mouseenter)="isProductMatched(dot.product.id) && onDotHover(dot)"
  ...
/>
```

> If the current template already uses a class binding for something else, adapt the class name; don't clobber the existing binding.

- [ ] **Step 3: Add fade-out CSS**

In the component's `styles` block (or a colocated `.scss`/`.css` file if one exists), add:

```css
circle {
  transition: opacity 200ms ease-out, stroke 200ms ease-out;
}
circle.dot-faded {
  opacity: 0.15;
  pointer-events: none;
  stroke: #cbd5e1; /* slate-300 */
}
```

> If existing styles are in a Tailwind utility style or a separate stylesheet, match that approach. `pointer-events: none` is the critical piece — verify it's applied.

- [ ] **Step 4: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 5: Manual QA**

1. `ng serve`, navigate to landscape.
2. Pick a TA. Bullseye renders.
3. Open the MOA filter, select "PD-1 inhibitor". Most dots fade to 15% opacity; matching dots remain full brightness. No dots move.
4. Hover a faded dot — no tooltip, no cursor feedback.
5. Click a faded dot — nothing happens.
6. Clear the filter (remove selection or click Clear). All dots return to full opacity smoothly.
7. Select multiple facets (MOA + Company + Phase). Intersection logic applies — dot must match all non-empty filters.
8. Click a non-faded dot — detail panel opens for that product.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/landscape/landscape.component.ts \
        src/client/src/app/features/landscape/landscape.component.html \
        src/client/src/app/features/landscape/bullseye-chart.component.ts \
        src/client/src/app/features/landscape/bullseye-chart.component.html
git commit -m "feat(landscape): filter bar with matchedProductIds fade-out"
```

---

## Task 23: Add MOA/ROA rows to `BullseyeDetailPanelComponent`

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts` (imports only if needed)
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.html`

- [ ] **Step 1: Find where the company row renders in the HTML**

Locate the section that renders the selected product's metadata — company name, etc. — above the trials list.

- [ ] **Step 2: Insert MOA and ROA blocks**

After the company metadata and before the trials list, add:

```html
@if (selectedProduct(); as product) {
  @if (product.moas?.length) {
    <div class="px-4 py-2 border-t border-slate-200">
      <div class="text-[10px] uppercase tracking-wider text-slate-500 pb-1">Mechanism of action</div>
      <div class="flex flex-wrap gap-1">
        @for (moa of product.moas; track moa.id) {
          <span class="inline-block rounded-sm bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5">{{ moa.name }}</span>
        }
      </div>
    </div>
  }
  @if (product.roas?.length) {
    <div class="px-4 py-2 border-t border-slate-200">
      <div class="text-[10px] uppercase tracking-wider text-slate-500 pb-1">Route of administration</div>
      <div class="flex flex-wrap gap-1">
        @for (roa of product.roas; track roa.id) {
          <span class="inline-block rounded-sm bg-slate-100 text-slate-700 text-[11px] px-2 py-0.5" [attr.title]="roa.name">{{ roa.abbreviation ?? roa.name }}</span>
        }
      </div>
    </div>
  }
}
```

> If the detail panel uses a different `selectedProduct` binding (e.g., it's an `input` on the component not the landscape parent), adjust accordingly.

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Expected: passes.

- [ ] **Step 4: Manual QA**

1. `ng serve`, navigate to landscape, pick a TA.
2. Click a product dot that has assigned MOAs and ROAs. Detail panel opens.
3. Confirm MOA row shows the MOA pills and ROA row shows the abbreviation pills.
4. Click a product with zero MOAs or zero ROAs. Confirm the corresponding block is omitted entirely (no header, no em-dash).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/bullseye-detail-panel.component.ts \
        src/client/src/app/features/landscape/bullseye-detail-panel.component.html
git commit -m "feat(landscape): show MOA and ROA rows in detail panel"
```

---

# Phase 6 — Final verification

## Task 24: End-to-end manual QA and final build

**Files:** none — this task is pure verification.

- [ ] **Step 1: Full rebuild**

```bash
cd /Users/aadityamadala/Documents/code/clint-v2
supabase db reset
cd src/client && ng lint && ng build
```

Expected: both commands succeed.

- [ ] **Step 2: Dev server + smoke tests**

```bash
cd src/client && ng serve
```

Run through each of the following scenarios against the local dev server. Mark each as pass/fail; if any fails, open a new commit to fix before considering the feature done.

**Manage CRUD:**
- [ ] Navigate to `/manage/mechanisms-of-action`. 8 seeded MOAs visible in table.
- [ ] Create a new MOA "Test X". Appears in list.
- [ ] Edit it to "Test Y". Update persists after save.
- [ ] Delete it with confirm dialog. Disappears.
- [ ] Repeat for `/manage/routes-of-administration`. 7 seeded ROAs.
- [ ] Delete an MOA that's assigned to a product. Confirm dialog reads "This MOA is assigned to N products. Delete anyway?" with the correct N.

**Product form:**
- [ ] Navigate to `/manage/products`. Edit a product that was seeded with MOAs. MOA multiselect shows the pre-assigned names.
- [ ] Add one MOA, remove another, add two ROAs, save, re-open. Selections round-trip.
- [ ] Create a brand-new product with 2 MOAs and 1 ROA. Save, re-open, verify stored.

**Dashboard grid:**
- [ ] Navigate to `/dashboard`. MOA and ROA columns visible between Product and Trial cells.
- [ ] Seeded products show pill chips; unassigned products show `—`.
- [ ] Products with 3+ MOAs show `+N` overflow indicator. Hover reveals full list via tooltip.
- [ ] Click the sliders-h button in the grid toolbar. Popover opens.
- [ ] Uncheck "Mechanism of action". MOA column disappears (header + cells).
- [ ] Uncheck "Route of administration". ROA column disappears.
- [ ] Re-check both. Columns reappear.
- [ ] Reload the page. Columns default back to visible (session-only).

**Dashboard filter panel:**
- [ ] Open the dashboard filter bar. MOA and ROA chips visible.
- [ ] Select "PD-1 inhibitor" in MOA. Grid narrows to only products matching PD-1.
- [ ] Add "PD-L1 inhibitor" to the selection. Grid shows OR-union (products matching either).
- [ ] Select "IV" in ROA. Grid intersects MOA AND ROA.
- [ ] Clear MOA. Only ROA filter active. Grid updates accordingly.

**Landscape filter bar + fade-out:**
- [ ] Navigate to `/landscape`. Pick a TA. Bullseye renders.
- [ ] Filter bar visible below the TA selector with MOA, ROA, Company, Product, Phase, Status, Study type chips.
- [ ] Select "PD-1 inhibitor" in MOA. Non-matching dots fade to ~15% opacity; matching dots stay bright.
- [ ] No dots reflow or move position.
- [ ] Hover a faded dot — no tooltip, no cursor feedback.
- [ ] Click a faded dot — nothing happens.
- [ ] Click a non-faded (matched) dot — detail panel opens.
- [ ] Detail panel shows "Mechanism of action" row with MOA pills and "Route of administration" row with ROA abbreviations.
- [ ] Apply multiple filters: MOA + Company + Phase. Correct intersection (AND across facets, OR within each facet).
- [ ] Click "Clear". All dots return to full opacity. Clear button disappears.

**Accessibility:**
- [ ] Tab through the dashboard column-toggle popover. Focus lands on the button, opens on Enter/Space. Checkboxes reachable via Tab. Escape closes.
- [ ] Tab through the landscape filter bar. Each multiselect reachable. Phase segmented buttons navigable via arrow keys.

- [ ] **Step 3: Commit any fixes or no-op**

If fixes were needed, they landed as commits during the above steps. If everything passed first try, no commit is needed — the feature is done.

---

# Appendix — Commit log expected

When done, the feature should produce roughly this commit sequence on top of the current HEAD:

```
feat(db): add mechanisms_of_action and routes_of_administration tables
feat(db): add product MOA and ROA join tables
feat(db): extend dashboard and bullseye RPCs with MOA/ROA
feat(db): seed MOA and ROA reference data and product assignments
feat(models): add MechanismOfAction and RouteOfAdministration types
feat(models): add MOA/ROA fields to Product, DashboardFilters, BullseyeProduct
feat(services): add MechanismOfActionService and RouteOfAdministrationService
feat(services): hydrate MOA/ROA in ProductService and add setMechanisms/setRoutes
feat(services): pass MOA/ROA filters to get_dashboard_data RPC
feat(manage): add mechanisms of action list and form components
feat(manage): add routes of administration list and form components
feat(routes): register MOA and ROA manage routes
feat(manage): add MOA/ROA multiselects to product form
feat(dashboard): add MOA/ROA fields to default filter state
feat(dashboard): add MOA and ROA multiselects to filter panel
feat(dashboard): add MOA and ROA columns to grid
feat(dashboard): add column-visibility popover for MOA and ROA columns
feat(landscape): add landscape filter bar component
feat(landscape): filter bar with matchedProductIds fade-out
feat(landscape): show MOA and ROA rows in detail panel
```

Twenty commits covering schema, models, services, manage CRUD, form additions, dashboard filters, dashboard columns, column-toggle popover, landscape filter bar, and detail-panel metadata.
