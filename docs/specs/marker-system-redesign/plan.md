# Marker System Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the flat marker system with a category-based, many-to-many marker model with rich metadata, collapse trial phases onto trials, and add an analyst-triggered in-app notification system.

**Architecture:** New normalized Postgres tables (`marker_categories`, `markers`, `marker_assignments`, `marker_notifications`, `notification_reads`) replace `trial_markers` and `trial_phases`. Phase data moves to columns on `trials`. Frontend services, models, and components are updated to match. RPC functions are rewritten.

**Tech Stack:** Angular 19 (standalone components, signals), PrimeNG 19, Supabase (Postgres, RLS, RPCs), Tailwind CSS v4

**Spec:** `docs/specs/marker-system-redesign/spec.md`

**Verification command:** `cd src/client && ng lint && ng build`

---

## Task 1: Database Migration -- New Tables and Data Migration

Create a single migration file that adds the new schema, migrates existing data, and drops old tables.

**Files:**
- Create: `supabase/migrations/20260412130100_marker_system_redesign.sql`

- [ ] **Step 1: Create the migration file**

```sql
-- =============================================================
-- Marker System Redesign
-- - Create marker_categories, restructure marker_types
-- - Replace trial_markers with markers + marker_assignments
-- - Add marker_notifications + notification_reads
-- - Collapse trial_phases onto trials table
-- - Migrate existing data
-- =============================================================

-- -------------------------------------------------------
-- 1. marker_categories
-- -------------------------------------------------------
create table public.marker_categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid references public.spaces (id) on delete cascade,
  name text not null,
  display_order int not null default 0,
  is_system boolean not null default false,
  created_by uuid references auth.users (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_marker_categories_space on public.marker_categories (space_id);

alter table public.marker_categories enable row level security;

create policy "space members can view marker categories"
  on public.marker_categories for select to authenticated
  using (is_system = true or public.has_space_access(space_id));

create policy "space editors can insert marker categories"
  on public.marker_categories for insert to authenticated
  with check (
    is_system = false
    and public.has_space_access(space_id)
  );

create policy "space editors can update marker categories"
  on public.marker_categories for update to authenticated
  using (is_system = false and public.has_space_access(space_id))
  with check (is_system = false and public.has_space_access(space_id));

create policy "space editors can delete marker categories"
  on public.marker_categories for delete to authenticated
  using (is_system = false and public.has_space_access(space_id));

-- Seed system categories
insert into public.marker_categories (id, space_id, name, display_order, is_system, created_by)
values
  ('c0000000-0000-0000-0000-000000000001', null, 'Clinical Trial', 1, true, null),
  ('c0000000-0000-0000-0000-000000000002', null, 'Data',           2, true, null),
  ('c0000000-0000-0000-0000-000000000003', null, 'Regulatory',     3, true, null),
  ('c0000000-0000-0000-0000-000000000004', null, 'Approval',       4, true, null),
  ('c0000000-0000-0000-0000-000000000005', null, 'Loss of Exclusivity', 5, true, null);

-- -------------------------------------------------------
-- 2. Add category_id to marker_types
-- -------------------------------------------------------
alter table public.marker_types
  add column category_id uuid references public.marker_categories (id);

-- Map existing system marker types to categories
-- Projected Data Reported, Data Reported -> Data
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000002'
  where id in ('a0000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000002');

-- Projected Regulatory Filing, Submitted Regulatory Filing -> Regulatory
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000003'
  where id in ('a0000000-0000-0000-0000-000000000003', 'a0000000-0000-0000-0000-000000000004');

-- Label Projected Approval/Launch, Label Update, Est. Range -> Approval
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000004'
  where id in ('a0000000-0000-0000-0000-000000000005', 'a0000000-0000-0000-0000-000000000006', 'a0000000-0000-0000-0000-000000000007');

-- Primary Completion Date -> Clinical Trial
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000001'
  where id = 'a0000000-0000-0000-0000-000000000008';

-- Change from Prior Update -> Data (closest fit)
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000002'
  where id = 'a0000000-0000-0000-0000-000000000009';

-- Event No Longer Expected -> Clinical Trial (closest fit)
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000001'
  where id = 'a0000000-0000-0000-0000-000000000010';

-- For any custom (non-system) marker types without a category, default to Data
update public.marker_types set category_id = 'c0000000-0000-0000-0000-000000000002'
  where category_id is null;

alter table public.marker_types
  alter column category_id set not null;

-- Add new system marker types for categories that lack specific types
insert into public.marker_types (id, space_id, created_by, category_id, name, icon, shape, fill_style, color, is_system, display_order)
values
  -- Clinical Trial
  ('a0000000-0000-0000-0000-000000000011', null, null, 'c0000000-0000-0000-0000-000000000001', 'Trial Start',     null, 'circle', 'outline', '#374151', true, 11),
  ('a0000000-0000-0000-0000-000000000012', null, null, 'c0000000-0000-0000-0000-000000000001', 'Trial End',       null, 'circle', 'filled',  '#374151', true, 12),
  -- Data
  ('a0000000-0000-0000-0000-000000000013', null, null, 'c0000000-0000-0000-0000-000000000002', 'Topline Data',    null, 'circle', 'filled',  '#22c55e', true, 13),
  ('a0000000-0000-0000-0000-000000000014', null, null, 'c0000000-0000-0000-0000-000000000002', 'Interim Data',    null, 'circle', 'striped', '#22c55e', true, 14),
  ('a0000000-0000-0000-0000-000000000015', null, null, 'c0000000-0000-0000-0000-000000000002', 'Full Data',       null, 'circle', 'filled',  '#16a34a', true, 15),
  -- Regulatory
  ('a0000000-0000-0000-0000-000000000016', null, null, 'c0000000-0000-0000-0000-000000000003', 'FDA Submission',  null, 'diamond', 'filled',  '#ef4444', true, 16),
  ('a0000000-0000-0000-0000-000000000017', null, null, 'c0000000-0000-0000-0000-000000000003', 'FDA Acceptance',  null, 'diamond', 'outline', '#ef4444', true, 17),
  -- Approval
  ('a0000000-0000-0000-0000-000000000018', null, null, 'c0000000-0000-0000-0000-000000000004', 'PDUFA Date',      null, 'flag', 'filled',  '#3b82f6', true, 18),
  ('a0000000-0000-0000-0000-000000000019', null, null, 'c0000000-0000-0000-0000-000000000004', 'Launch Date',     null, 'flag', 'outline', '#3b82f6', true, 19),
  -- Loss of Exclusivity
  ('a0000000-0000-0000-0000-000000000020', null, null, 'c0000000-0000-0000-0000-000000000005', 'LOE Date',        null, 'x', 'filled',  '#f97316', true, 20),
  ('a0000000-0000-0000-0000-000000000021', null, null, 'c0000000-0000-0000-0000-000000000005', 'Generic Entry Date', null, 'x', 'outline', '#f97316', true, 21);

-- -------------------------------------------------------
-- 3. markers (replaces trial_markers)
-- -------------------------------------------------------
create table public.markers (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  marker_type_id uuid not null references public.marker_types (id),
  title text not null,
  projection text not null default 'actual'
    check (projection in ('stout', 'company', 'primary', 'actual')),
  event_date date not null,
  end_date date,
  description text,
  source_url text,
  metadata jsonb,
  is_projected boolean generated always as (projection <> 'actual') stored,
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create index idx_markers_space on public.markers (space_id);
create index idx_markers_type on public.markers (marker_type_id);
create index idx_markers_date on public.markers (event_date);

alter table public.markers enable row level security;

create policy "space members can view markers"
  on public.markers for select to authenticated
  using (public.has_space_access(space_id));

create policy "space editors can insert markers"
  on public.markers for insert to authenticated
  with check (public.has_space_access(space_id));

create policy "space editors can update markers"
  on public.markers for update to authenticated
  using (public.has_space_access(space_id))
  with check (public.has_space_access(space_id));

create policy "space editors can delete markers"
  on public.markers for delete to authenticated
  using (public.has_space_access(space_id));

-- -------------------------------------------------------
-- 4. marker_assignments (many-to-many)
-- -------------------------------------------------------
create table public.marker_assignments (
  id uuid primary key default gen_random_uuid(),
  marker_id uuid not null references public.markers (id) on delete cascade,
  trial_id uuid not null references public.trials (id) on delete cascade,
  created_at timestamptz default now(),
  unique (marker_id, trial_id)
);

create index idx_marker_assignments_marker on public.marker_assignments (marker_id);
create index idx_marker_assignments_trial on public.marker_assignments (trial_id);

alter table public.marker_assignments enable row level security;

-- RLS via the marker's space_id
create policy "space members can view marker assignments"
  on public.marker_assignments for select to authenticated
  using (exists (
    select 1 from public.markers m
    where m.id = marker_id and public.has_space_access(m.space_id)
  ));

create policy "space editors can insert marker assignments"
  on public.marker_assignments for insert to authenticated
  with check (exists (
    select 1 from public.markers m
    where m.id = marker_id and public.has_space_access(m.space_id)
  ));

create policy "space editors can delete marker assignments"
  on public.marker_assignments for delete to authenticated
  using (exists (
    select 1 from public.markers m
    where m.id = marker_id and public.has_space_access(m.space_id)
  ));

-- -------------------------------------------------------
-- 5. marker_notifications
-- -------------------------------------------------------
create table public.marker_notifications (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  marker_id uuid not null references public.markers (id) on delete cascade,
  priority text not null default 'low'
    check (priority in ('low', 'high')),
  summary text not null,
  created_by uuid not null references auth.users (id),
  created_at timestamptz default now()
);

create index idx_marker_notifications_space on public.marker_notifications (space_id);
create index idx_marker_notifications_marker on public.marker_notifications (marker_id);

alter table public.marker_notifications enable row level security;

create policy "space members can view marker notifications"
  on public.marker_notifications for select to authenticated
  using (public.has_space_access(space_id));

create policy "space editors can insert marker notifications"
  on public.marker_notifications for insert to authenticated
  with check (public.has_space_access(space_id));

-- -------------------------------------------------------
-- 6. notification_reads
-- -------------------------------------------------------
create table public.notification_reads (
  id uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.marker_notifications (id) on delete cascade,
  user_id uuid not null references auth.users (id),
  read_at timestamptz default now(),
  unique (notification_id, user_id)
);

create index idx_notification_reads_user on public.notification_reads (user_id);

alter table public.notification_reads enable row level security;

create policy "users can view own notification reads"
  on public.notification_reads for select to authenticated
  using (user_id = auth.uid());

create policy "users can insert own notification reads"
  on public.notification_reads for insert to authenticated
  with check (user_id = auth.uid());

-- -------------------------------------------------------
-- 7. Migrate trial_markers -> markers + marker_assignments
-- -------------------------------------------------------
insert into public.markers (id, space_id, marker_type_id, title, projection, event_date, end_date, description, source_url, metadata, created_by, created_at, updated_at)
select
  tm.id,
  tm.space_id,
  tm.marker_type_id,
  coalesce(tm.tooltip_text, mt.name),
  case when tm.is_projected then 'company' else 'actual' end,
  tm.event_date,
  tm.end_date,
  tm.tooltip_text,
  null,
  case when tm.tooltip_image_url is not null
    then jsonb_build_object('image_url', tm.tooltip_image_url)
    else null
  end,
  tm.created_by,
  tm.created_at,
  tm.updated_at
from public.trial_markers tm
join public.marker_types mt on mt.id = tm.marker_type_id;

insert into public.marker_assignments (marker_id, trial_id, created_at)
select tm.id, tm.trial_id, tm.created_at
from public.trial_markers tm;

-- -------------------------------------------------------
-- 8. Collapse trial_phases onto trials
-- -------------------------------------------------------
alter table public.trials
  add column phase_type text,
  add column phase_start_date date,
  add column phase_end_date date;

-- Migrate: for each trial, take the phase with the latest start_date
-- (most trials have 1 phase; this picks the most relevant for multi-phase)
update public.trials t
set
  phase_type = sub.phase_type,
  phase_start_date = sub.start_date,
  phase_end_date = sub.end_date
from (
  select distinct on (trial_id)
    trial_id, phase_type, start_date, end_date
  from public.trial_phases
  order by trial_id, start_date desc
) sub
where t.id = sub.trial_id;

-- -------------------------------------------------------
-- 9. Drop old tables
-- -------------------------------------------------------
drop table if exists public.trial_markers;
drop table if exists public.trial_phases;
```

- [ ] **Step 2: Apply the migration locally**

Run: `supabase db reset`
Expected: All migrations re-run successfully, including the new one. No errors.

- [ ] **Step 3: Verify the migration**

Run: `supabase db reset 2>&1 | tail -20`
Expected: `Finished supabase db reset` with no errors. Check that the new tables exist:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\dt public.marker*"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\dt public.notification*"
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "\d public.trials" | grep phase
```

Expected: `marker_categories`, `markers`, `marker_assignments`, `marker_notifications`, `notification_reads` tables exist. `trials` table has `phase_type`, `phase_start_date`, `phase_end_date` columns. `trial_markers` and `trial_phases` tables are gone.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260412130100_marker_system_redesign.sql
git commit -m "feat(db): marker system redesign migration

New tables: marker_categories, markers, marker_assignments,
marker_notifications, notification_reads. Collapse trial_phases
onto trials. Migrate existing data. Drop old tables."
```

---

## Task 2: Update seed.sql for New Schema

Update the seed file to use the new table structure for demo data.

**Files:**
- Modify: `supabase/seed.sql`

- [ ] **Step 1: Read the current seed.sql**

Read `supabase/seed.sql` to understand the full structure. The marker type seeds are already handled by the migration (they stay in `marker_types` with the new `category_id`). The seed file needs to be updated to:
- Remove any `trial_markers` inserts and replace with `markers` + `marker_assignments` inserts
- Remove any `trial_phases` inserts and ensure trial rows include `phase_type`, `phase_start_date`, `phase_end_date`

- [ ] **Step 2: Update marker type seeds in seed.sql**

The system marker types are already seeded in the migration file. If `seed.sql` re-inserts marker types, update those inserts to include `category_id`. If it only relies on the migration seed, no change needed for marker types.

- [ ] **Step 3: Update trial inserts to include phase columns**

For every trial INSERT in `seed.sql`, add `phase_type`, `phase_start_date`, `phase_end_date` columns. Remove all `trial_phases` INSERTs. Example:

```sql
-- Before:
insert into trials (id, space_id, ..., name) values (...);
insert into trial_phases (trial_id, phase_type, start_date, end_date, color) values (...);

-- After:
insert into trials (id, space_id, ..., name, phase_type, phase_start_date, phase_end_date) values (..., 'P3', '2024-01-15', '2026-06-30');
```

- [ ] **Step 4: Update marker inserts to use new tables**

Replace all `trial_markers` INSERTs with `markers` + `marker_assignments` INSERTs:

```sql
-- Before:
insert into trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, tooltip_text, is_projected)
values ('...', '...', '...', 'trial-1', 'a000...0002', '2025-03-15', 'Phase 3 topline data', false);

-- After:
insert into markers (id, space_id, created_by, marker_type_id, title, projection, event_date, description)
values ('...', '...', '...', 'a000...0013', 'Phase 3 topline data', 'actual', '2025-03-15', 'Phase 3 topline data');

insert into marker_assignments (marker_id, trial_id)
values ('...', 'trial-1');
```

- [ ] **Step 5: Add sample notification seed data**

Add 2-3 sample `marker_notifications` for demo purposes:

```sql
insert into marker_notifications (id, space_id, marker_id, priority, summary, created_by)
values
  (gen_random_uuid(), '<demo_space_id>', '<marker_id_1>', 'high', 'Pfizer accelerated timeline in Q3 guidance -- potential competitive threat to our client''s PDUFA window.', '<demo_user_id>'),
  (gen_random_uuid(), '<demo_space_id>', '<marker_id_2>', 'low', 'Interim data trending favorable per KOL feedback at ASCO.', '<demo_user_id>');
```

(Use actual IDs from the seed data context.)

- [ ] **Step 6: Verify seed data**

Run: `supabase db reset`
Expected: Clean reset with no errors. Seed data populates correctly.

- [ ] **Step 7: Commit**

```bash
git add supabase/seed.sql
git commit -m "feat(db): update seed.sql for marker system redesign

Use markers + marker_assignments instead of trial_markers.
Inline phase data on trials instead of trial_phases.
Add sample notification seed data."
```

---

## Task 3: Update RPC Functions

Rewrite `get_dashboard_data` and bullseye RPCs to use the new table structure.

**Files:**
- Create: `supabase/migrations/20260412130200_update_rpcs_for_marker_redesign.sql`

- [ ] **Step 1: Read current RPC functions**

Read the following migration files to understand the current RPC signatures and logic:
- `supabase/migrations/20260315120300_create_dashboard_function.sql`
- `supabase/migrations/20260315200100_update_dashboard_function_filters.sql`
- `supabase/migrations/20260411130200_update_dashboard_and_bullseye_functions.sql`
- `supabase/migrations/20260411120300_create_bullseye_data_function.sql`
- `supabase/migrations/20260412120200_create_bullseye_by_company.sql`
- `supabase/migrations/20260412120300_create_bullseye_by_moa.sql`
- `supabase/migrations/20260412120400_create_bullseye_by_roa.sql`

Note the exact function signatures, parameter names, and return types.

- [ ] **Step 2: Write the updated RPCs**

Create `supabase/migrations/20260412130200_update_rpcs_for_marker_redesign.sql`.

Key changes to `get_dashboard_data`:
- Replace `trial_phases` joins with reading `phase_type`, `phase_start_date`, `phase_end_date` from `trials`
- Replace `trial_markers` joins with `markers` joined through `marker_assignments`
- Include `marker_categories` via `marker_types.category_id`
- Return marker metadata: `title`, `projection`, `description`, `source_url`, `metadata`
- Include `trials.identifier` in the trial response

Key changes to bullseye RPCs:
- Replace `trial_phases` references for `highest_phase` calculation -- read `phase_type` from `trials` directly
- Replace `trial_markers` with `markers` via `marker_assignments` for `recent_markers`
- Include `category_id` and `projection` in marker data

New RPCs:
- `get_notifications(p_space_id uuid)` -- returns notifications with read state, ordered reverse-chronologically
- `get_unread_notification_count(p_space_id uuid)` -- returns integer count

The exact SQL will depend on the current RPC structure read in Step 1. Follow the same patterns (json_agg, json_build_object) but update table references.

- [ ] **Step 3: Apply and verify**

Run: `supabase db reset`
Expected: All RPCs created successfully. Test with:

```bash
psql postgresql://postgres:postgres@127.0.0.1:54322/postgres -c "select routine_name from information_schema.routines where routine_schema = 'public' and routine_name in ('get_dashboard_data', 'get_notifications', 'get_unread_notification_count');"
```

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260412130200_update_rpcs_for_marker_redesign.sql
git commit -m "feat(db): update RPCs for marker system redesign

Rewrite get_dashboard_data and bullseye RPCs for new table structure.
Add get_notifications and get_unread_notification_count RPCs."
```

---

## Task 4: Update TypeScript Models

Update all TypeScript interfaces to match the new schema.

**Files:**
- Modify: `src/client/src/app/core/models/marker.model.ts`
- Modify: `src/client/src/app/core/models/trial.model.ts`
- Modify: `src/client/src/app/core/models/landscape.model.ts`
- Create: `src/client/src/app/core/models/notification.model.ts`

- [ ] **Step 1: Update marker.model.ts**

Replace the contents of `src/client/src/app/core/models/marker.model.ts`:

```typescript
export interface MarkerCategory {
  id: string;
  space_id: string | null;
  name: string;
  display_order: number;
  is_system: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface MarkerType {
  id: string;
  space_id: string | null;
  created_by: string | null;
  category_id: string;
  name: string;
  icon: string | null;
  shape: 'circle' | 'diamond' | 'flag' | 'arrow' | 'x' | 'bar';
  fill_style: 'outline' | 'filled' | 'striped' | 'gradient';
  color: string;
  is_system: boolean;
  display_order: number;
  created_at: string;
  marker_categories?: MarkerCategory;
}

export type Projection = 'stout' | 'company' | 'primary' | 'actual';

export interface Marker {
  id: string;
  space_id: string;
  created_by: string;
  marker_type_id: string;
  title: string;
  projection: Projection;
  event_date: string;
  end_date: string | null;
  description: string | null;
  source_url: string | null;
  metadata: Record<string, unknown> | null;
  is_projected: boolean;
  created_at: string;
  updated_at: string;
  marker_types?: MarkerType;
  marker_assignments?: MarkerAssignment[];
}

export interface MarkerAssignment {
  id: string;
  marker_id: string;
  trial_id: string;
  created_at: string;
  trials?: { id: string; name: string; identifier: string | null };
}
```

- [ ] **Step 2: Update trial.model.ts**

In `src/client/src/app/core/models/trial.model.ts`:

Remove the `TrialPhase` interface entirely.

Remove `TrialMarker` references (the old interface). If `TrialMarker` is still exported from this file, remove it.

Update the `Trial` interface:
- Remove `trial_phases?: TrialPhase[]`
- Change `trial_markers?: TrialMarker[]` to `markers?: Marker[]` (imported from `marker.model.ts`)
- Add `phase_type: string | null`
- Add `phase_start_date: string | null`
- Add `phase_end_date: string | null`

- [ ] **Step 3: Create notification.model.ts**

Create `src/client/src/app/core/models/notification.model.ts`:

```typescript
export interface MarkerNotification {
  id: string;
  space_id: string;
  marker_id: string;
  priority: 'low' | 'high';
  summary: string;
  created_by: string;
  created_at: string;
  marker?: {
    id: string;
    title: string;
    event_date: string;
    projection: string;
    marker_types?: {
      name: string;
      color: string;
      shape: string;
      marker_categories?: {
        name: string;
      };
    };
    marker_assignments?: {
      trial_id: string;
      trials?: { name: string; identifier: string | null };
    }[];
  };
  is_read?: boolean;
}
```

- [ ] **Step 4: Update landscape.model.ts**

In `src/client/src/app/core/models/landscape.model.ts`, update the `BullseyeMarker` interface to include projection and category:

```typescript
export interface BullseyeMarker {
  id: string;
  event_date: string;
  marker_type_name: string;
  icon: string | null;
  shape: string;
  color: string;
  projection: string;
  category_name: string;
}
```

Also update `BullseyeTrial` (if it exists) to use `phase_type` from the trial instead of a separate phase reference.

- [ ] **Step 5: Verify build**

Run: `cd src/client && ng build 2>&1 | head -50`
Expected: Build errors related to services and components still referencing old types. That is expected -- models are updated, services/components follow in subsequent tasks.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/models/
git commit -m "feat(models): update TypeScript interfaces for marker redesign

New: MarkerCategory, Marker, MarkerAssignment, MarkerNotification.
Remove: TrialPhase, TrialMarker. Add phase columns to Trial."
```

---

## Task 5: Update and Create Services

Replace `TrialMarkerService` and `TrialPhaseService` with `MarkerService`, update `MarkerTypeService`, add `MarkerCategoryService` and `NotificationService`.

**Files:**
- Remove: `src/client/src/app/core/services/trial-marker.service.ts`
- Remove: `src/client/src/app/core/services/trial-phase.service.ts`
- Create: `src/client/src/app/core/services/marker.service.ts`
- Create: `src/client/src/app/core/services/marker-category.service.ts`
- Create: `src/client/src/app/core/services/notification.service.ts`
- Modify: `src/client/src/app/core/services/marker-type.service.ts`
- Modify: `src/client/src/app/core/services/dashboard.service.ts`
- Modify: `src/client/src/app/core/services/landscape.service.ts`

- [ ] **Step 1: Create MarkerService**

Create `src/client/src/app/core/services/marker.service.ts`:

```typescript
import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { Marker } from '../models/marker.model';

@Injectable({ providedIn: 'root' })
export class MarkerService {
  private supabase = inject(SupabaseService);

  async create(
    spaceId: string,
    marker: Partial<Marker>,
    trialIds: string[]
  ): Promise<Marker> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { data, error } = await this.supabase.client
      .from('markers')
      .insert({ ...marker, space_id: spaceId, created_by: userId })
      .select()
      .single();
    if (error) throw error;

    if (trialIds.length > 0) {
      const assignments = trialIds.map(trialId => ({
        marker_id: data.id,
        trial_id: trialId,
      }));
      const { error: assignError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (assignError) throw assignError;
    }

    return data as Marker;
  }

  async update(id: string, changes: Partial<Marker>): Promise<Marker> {
    const { data, error } = await this.supabase.client
      .from('markers')
      .update(changes)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data as Marker;
  }

  async updateAssignments(markerId: string, trialIds: string[]): Promise<void> {
    const { error: deleteError } = await this.supabase.client
      .from('marker_assignments')
      .delete()
      .eq('marker_id', markerId);
    if (deleteError) throw deleteError;

    if (trialIds.length > 0) {
      const assignments = trialIds.map(trialId => ({
        marker_id: markerId,
        trial_id: trialId,
      }));
      const { error: insertError } = await this.supabase.client
        .from('marker_assignments')
        .insert(assignments);
      if (insertError) throw insertError;
    }
  }

  async delete(id: string): Promise<void> {
    const { error } = await this.supabase.client
      .from('markers')
      .delete()
      .eq('id', id);
    if (error) throw error;
  }
}
```

- [ ] **Step 2: Create MarkerCategoryService**

Create `src/client/src/app/core/services/marker-category.service.ts`:

```typescript
import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { MarkerCategory } from '../models/marker.model';

@Injectable({ providedIn: 'root' })
export class MarkerCategoryService {
  private supabase = inject(SupabaseService);

  async list(spaceId?: string): Promise<MarkerCategory[]> {
    let query = this.supabase.client
      .from('marker_categories')
      .select('*')
      .order('display_order');

    if (spaceId) {
      query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
    }

    const { data, error } = await query;
    if (error) throw error;
    return data as MarkerCategory[];
  }
}
```

- [ ] **Step 3: Create NotificationService**

Create `src/client/src/app/core/services/notification.service.ts`:

```typescript
import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import { MarkerNotification } from '../models/notification.model';

@Injectable({ providedIn: 'root' })
export class NotificationService {
  private supabase = inject(SupabaseService);

  async createNotification(
    spaceId: string,
    markerId: string,
    priority: 'low' | 'high',
    summary: string
  ): Promise<void> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { error } = await this.supabase.client
      .from('marker_notifications')
      .insert({
        space_id: spaceId,
        marker_id: markerId,
        priority,
        summary,
        created_by: userId,
      });
    if (error) throw error;
  }

  async getNotifications(spaceId: string): Promise<MarkerNotification[]> {
    const { data, error } = await this.supabase.client
      .rpc('get_notifications', { p_space_id: spaceId });
    if (error) throw error;
    return (data ?? []) as MarkerNotification[];
  }

  async getUnreadCount(spaceId: string): Promise<number> {
    const { data, error } = await this.supabase.client
      .rpc('get_unread_notification_count', { p_space_id: spaceId });
    if (error) throw error;
    return (data ?? 0) as number;
  }

  async markAsRead(notificationId: string): Promise<void> {
    const userId = (await this.supabase.client.auth.getUser()).data.user!.id;
    const { error } = await this.supabase.client
      .from('notification_reads')
      .insert({
        notification_id: notificationId,
        user_id: userId,
      });
    if (error) throw error;
  }
}
```

- [ ] **Step 4: Update MarkerTypeService**

In `src/client/src/app/core/services/marker-type.service.ts`, update the `list` method to include the category relationship:

```typescript
async list(spaceId?: string): Promise<MarkerType[]> {
  let query = this.supabase.client
    .from('marker_types')
    .select('*, marker_categories(*)')
    .order('display_order');

  if (spaceId) {
    query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as MarkerType[];
}
```

Also add a method to list by category:

```typescript
async listByCategory(categoryId: string, spaceId?: string): Promise<MarkerType[]> {
  let query = this.supabase.client
    .from('marker_types')
    .select('*, marker_categories(*)')
    .eq('category_id', categoryId)
    .order('display_order');

  if (spaceId) {
    query = query.or(`is_system.eq.true,space_id.eq.${spaceId}`);
  }

  const { data, error } = await query;
  if (error) throw error;
  return data as MarkerType[];
}
```

- [ ] **Step 5: Update DashboardService**

In `src/client/src/app/core/services/dashboard.service.ts`, update the response mapping to use new field names:

- Replace `trial_phases: t.phases ?? []` with phase fields directly on trial: `phase_type: t.phase_type`, `phase_start_date: t.phase_start_date`, `phase_end_date: t.phase_end_date`
- Replace `trial_markers` mapping with `markers` mapping that includes the new fields (title, projection, description, source_url, metadata, category)
- Include `identifier` in the trial mapping

The exact mapping depends on the updated RPC response shape from Task 3.

- [ ] **Step 6: Update LandscapeService**

In `src/client/src/app/core/services/landscape.service.ts`, no structural changes needed -- the RPCs return the same shape, just with updated field names in the marker data. Verify the response mapping matches the updated `BullseyeMarker` interface.

- [ ] **Step 7: Delete old services**

Delete `src/client/src/app/core/services/trial-marker.service.ts` and `src/client/src/app/core/services/trial-phase.service.ts`.

- [ ] **Step 8: Verify build**

Run: `cd src/client && ng build 2>&1 | head -50`
Expected: Build errors from components still importing old services/types. That is expected.

- [ ] **Step 9: Commit**

```bash
git add src/client/src/app/core/services/
git commit -m "feat(services): add MarkerService, MarkerCategoryService, NotificationService

Replace TrialMarkerService and TrialPhaseService. Update MarkerTypeService
with category relationship. Update DashboardService response mapping."
```

---

## Task 6: Update Trial Form -- Inline Phase Fields

Replace the separate phase management with inline phase fields on the trial form.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-form.component.ts`

- [ ] **Step 1: Read the current trial form**

Read `src/client/src/app/features/manage/trials/trial-form.component.ts` in full to understand the template and form logic.

- [ ] **Step 2: Add phase fields to the form**

Add three new form fields to the template, in a "Phase" section:

- Phase Type: `p-select` with options: P1, P2, P3, P4, P1_2, P2_3, OBS
- Phase Start Date: date input
- Phase End Date: date input (optional)

Add corresponding signal/form state:

```typescript
phaseType = signal<string | null>(null);
phaseStartDate = signal<string | null>(null);
phaseEndDate = signal<string | null>(null);

readonly phaseTypeOptions = [
  { label: 'Phase 1', value: 'P1' },
  { label: 'Phase 2', value: 'P2' },
  { label: 'Phase 3', value: 'P3' },
  { label: 'Phase 4', value: 'P4' },
  { label: 'Phase 1/2', value: 'P1_2' },
  { label: 'Phase 2/3', value: 'P2_3' },
  { label: 'Observational', value: 'OBS' },
];
```

- [ ] **Step 3: Update ngOnInit to populate phase fields**

When editing an existing trial, populate from `trial.phase_type`, `trial.phase_start_date`, `trial.phase_end_date`.

- [ ] **Step 4: Update onSubmit to include phase fields**

Add `phase_type`, `phase_start_date`, `phase_end_date` to the trial object passed to `trialService.create()` or `trialService.update()`.

- [ ] **Step 5: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-form.component.ts
git commit -m "feat(trials): add inline phase fields to trial form

Replace separate phase management with phase_type, phase_start_date,
phase_end_date fields directly on the trial form."
```

---

## Task 7: Redesign Marker Form

Replace the existing marker form with the new category-based form including rich metadata and notification toggle.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/marker-form.component.ts`

- [ ] **Step 1: Read the current marker form**

Read `src/client/src/app/features/manage/trials/marker-form.component.ts` in full.

- [ ] **Step 2: Rewrite the component**

Replace the template and component logic. New form fields:

1. **Category** -- `p-select`, loads from `MarkerCategoryService.list(spaceId)`
2. **Marker Type** -- `p-select`, filtered by selected category via `MarkerTypeService.listByCategory(categoryId, spaceId)`
3. **Title** -- `pInputText`
4. **Projection** -- `p-select` with options: Stout, Company, Primary, Actual
5. **Event Date** -- date input, required
6. **End Date** -- date input, optional
7. **Description** -- `pTextarea`, optional
8. **Source URL** -- `pInputText`, optional
9. **Regulatory Pathway** -- `p-select` (standard/priority/cnpv), shown only when category=Regulatory and type=FDA Submission
10. **Trial Assignment** -- PrimeNG `p-multiselect`, loads trials from `TrialService`, at least one required
11. **Notify Team** -- `p-checkbox` toggle. When checked, reveals:
    - Priority: `p-select` (low/high)
    - Summary: `pTextarea`

Key component changes:
- Inject `MarkerService` (replaces `TrialMarkerService`)
- Inject `MarkerCategoryService`
- Inject `MarkerTypeService`
- Inject `NotificationService`
- Inject `TrialService` (for trial multi-select)
- Input changes: accept `marker: Marker | null` instead of `TrialMarker | null`. Accept `trialId` as optional (pre-selects in multi-select).
- Category selection triggers marker type reload
- On submit: call `markerService.create()` with trial IDs, then optionally `notificationService.createNotification()`
- On edit: call `markerService.update()` + `markerService.updateAssignments()`

- [ ] **Step 3: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/marker-form.component.ts
git commit -m "feat(markers): redesign marker form with categories and notifications

Category-filtered marker types, projection selection, multi-trial
assignment, optional notification toggle with priority and summary."
```

---

## Task 8: Update Trial Detail Component

Remove phase sub-management, update marker display to use new models.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Remove: `src/client/src/app/features/manage/trials/phase-form.component.ts`

- [ ] **Step 1: Read the current trial detail component**

Read `src/client/src/app/features/manage/trials/trial-detail.component.ts` in full.

- [ ] **Step 2: Remove phase management**

- Remove `addingPhase`, `editingPhase` signals
- Remove `phaseMenu()` method
- Remove the "Phases" section from the template (the section that lists phases with add/edit/delete)
- Remove `PhaseFormComponent` from the template and imports
- Remove `TrialPhaseService` injection

- [ ] **Step 3: Update marker display**

- Update marker references from `TrialMarker` to `Marker`
- Update marker display in the template to show: title, category, projection type, event_date, description, source_url
- Update `markerMenu()` to use `Marker` type
- Replace `TrialMarkerService` injection with `MarkerService`

- [ ] **Step 4: Delete phase-form.component.ts**

Delete `src/client/src/app/features/manage/trials/phase-form.component.ts`.

- [ ] **Step 5: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 6: Commit**

```bash
git add -A src/client/src/app/features/manage/trials/
git commit -m "feat(trials): remove phase management, update marker display

Remove PhaseFormComponent and phase CRUD from trial detail.
Update marker display to show category, projection, and metadata."
```

---

## Task 9: Update Dashboard Grid and Phase Bar Rendering

Update the dashboard grid to read phase data from the trial instead of trial_phases, and update marker rendering for new types.

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts`
- Modify: `src/client/src/app/features/dashboard/dashboard.component.ts`

- [ ] **Step 1: Read dashboard-grid.component.ts**

Read the full file. Understand how `FlattenedTrial` is constructed and how phase bars are rendered.

- [ ] **Step 2: Update FlattenedTrial and phase rendering**

The `FlattenedTrial` interface uses `trial: Trial` which includes `trial_phases`. Update the phase bar rendering in the template:

Before: iterating over `trial.trial_phases` to render bars
After: render a single bar using `trial.phase_type`, `trial.phase_start_date`, `trial.phase_end_date`

The phase color can be derived from `trial.phase_type` using the existing `PHASE_COLOR` map in `landscape.model.ts`, or a similar mapping.

- [ ] **Step 3: Update marker references**

Update references from `trial.trial_markers` to `trial.markers` throughout the template and component logic.

- [ ] **Step 4: Update dashboard.component.ts**

Read and update `dashboard.component.ts`:
- Update any type references from `TrialMarker` to `Marker`
- Update filter logic if it references phase types (now from trial directly)
- Ensure `identifier` (NCT ID) is available in the data for display

- [ ] **Step 5: Add NCT ID display to grid left rail**

In the grid template, where trial names are rendered in the left rail, add the NCT ID in muted monospace:

```html
<span class="text-xs text-slate-400 font-mono ml-1">{{ trial.identifier }}</span>
```

- [ ] **Step 6: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/dashboard/
git commit -m "feat(dashboard): update grid for inline phases and new markers

Read phase data from trial directly. Update marker references.
Show NCT ID in grid left rail."
```

---

## Task 10: Update Marker and Tooltip Components

Update the dashboard marker rendering to support projection-based visual treatment and new tooltip metadata.

**Files:**
- Modify: `src/client/src/app/features/dashboard/grid/marker.component.ts`
- Modify: `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts`

- [ ] **Step 1: Update marker.component.ts**

Read and update `src/client/src/app/features/dashboard/grid/marker.component.ts`:

- Change input type from `TrialMarker` to `Marker`
- Update `markerType` computed to read from `marker().marker_types`
- Add `projection` computed: `() => this.marker().projection`
- Update `faIcon` computed: consider projection when determining fill_style. If `projection === 'actual'`, use filled. If `projection === 'stout'`, use striped. If `projection === 'company' || 'primary'`, use outline. This overrides the marker_type's default fill_style.
- Update `tooltipText` to use `marker().title` (was `tooltip_text`)

- [ ] **Step 2: Update marker-tooltip.component.ts**

Read and update `src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts`:

Add new inputs:
```typescript
title = input.required<string>();
projection = input<string>('actual');
description = input<string | null>(null);
sourceUrl = input<string | null>(null);
categoryName = input<string>('');
trialNames = input<string[]>([]);
```

Update the template to show:
- Category name tag (small, colored)
- Title (replaces generic text)
- Projection badge (Stout / Company / Primary / Actual) instead of just "Projected"
- Description text
- Source URL as a clickable link (opens in new tab)
- Trial names with NCT IDs (for multi-trial markers)

- [ ] **Step 3: Update marker.component.ts template to pass new inputs**

Update the template where `MarkerTooltipComponent` is used to pass the new inputs.

- [ ] **Step 4: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/dashboard/grid/marker.component.ts src/client/src/app/features/dashboard/grid/marker-tooltip.component.ts
git commit -m "feat(dashboard): update marker and tooltip for projection and metadata

Projection drives fill rendering. Tooltip shows category, title,
projection badge, description, source URL, and trial NCT IDs."
```

---

## Task 11: Build Notification Bell and Panel

Add the notification bell icon to the header and build the dropdown notification panel.

**Files:**
- Create: `src/client/src/app/core/layout/notification-bell.component.ts`
- Create: `src/client/src/app/core/layout/notification-panel.component.ts`
- Modify: `src/client/src/app/core/layout/header.component.ts`

- [ ] **Step 1: Create NotificationBellComponent**

Create `src/client/src/app/core/layout/notification-bell.component.ts`:

```typescript
import { Component, inject, input, signal, effect, computed } from '@angular/core';
import { NotificationService } from '../services/notification.service';
import { NotificationPanelComponent } from './notification-panel.component';

@Component({
  selector: 'app-notification-bell',
  standalone: true,
  imports: [NotificationPanelComponent],
  template: `
    <div class="relative">
      <button
        (click)="panelOpen.set(!panelOpen())"
        class="relative p-2 text-slate-500 hover:text-slate-700 transition-colors"
        aria-label="Notifications"
      >
        <i class="fa-regular fa-bell text-lg"></i>
        @if (unreadCount() > 0) {
          <span
            class="absolute -top-0.5 -right-0.5 min-w-[18px] h-[18px] rounded-full bg-red-500 text-white text-[10px] font-bold flex items-center justify-center px-1"
          >
            {{ unreadCount() > 99 ? '99+' : unreadCount() }}
          </span>
        }
      </button>

      @if (panelOpen()) {
        <app-notification-panel
          [spaceId]="spaceId()"
          (closed)="panelOpen.set(false)"
          (read)="loadUnreadCount()"
        />
      }
    </div>
  `,
})
export class NotificationBellComponent {
  readonly spaceId = input.required<string>();
  private notificationService = inject(NotificationService);

  panelOpen = signal(false);
  unreadCount = signal(0);

  constructor() {
    effect(() => {
      const sid = this.spaceId();
      if (sid) this.loadUnreadCount();
    });
  }

  async loadUnreadCount() {
    const count = await this.notificationService.getUnreadCount(this.spaceId());
    this.unreadCount.set(count);
  }
}
```

- [ ] **Step 2: Create NotificationPanelComponent**

Create `src/client/src/app/core/layout/notification-panel.component.ts`:

```typescript
import { Component, inject, input, output, signal, OnInit } from '@angular/core';
import { DatePipe } from '@angular/common';
import { NotificationService } from '../services/notification.service';
import { MarkerNotification } from '../models/notification.model';
import { ButtonModule } from 'primeng/button';
import { Select } from 'primeng/select';
import { FormsModule } from '@angular/forms';

@Component({
  selector: 'app-notification-panel',
  standalone: true,
  imports: [DatePipe, ButtonModule, Select, FormsModule],
  template: `
    <div
      class="absolute right-0 top-full mt-2 w-96 max-h-[480px] bg-white border border-slate-200 rounded-lg shadow-xl z-50 flex flex-col"
    >
      <!-- Header -->
      <div class="flex items-center justify-between px-4 py-3 border-b border-slate-100">
        <span class="text-sm font-semibold text-slate-800 tracking-wide uppercase">Notifications</span>
        <div class="flex items-center gap-2">
          <p-select
            [options]="filterOptions"
            [(ngModel)]="activeFilter"
            (ngModelChange)="applyFilter()"
            optionLabel="label"
            optionValue="value"
            [style]="{ 'font-size': '12px' }"
            size="small"
          />
          <button (click)="closed.emit()" class="text-slate-400 hover:text-slate-600 p-1">
            <i class="fa-solid fa-xmark"></i>
          </button>
        </div>
      </div>

      <!-- List -->
      <div class="overflow-y-auto flex-1">
        @for (n of filteredNotifications(); track n.id) {
          <div
            class="px-4 py-3 border-b border-slate-50 hover:bg-slate-50 cursor-pointer transition-colors"
            [class.bg-teal-50/30]="!n.is_read"
            (click)="onNotificationClick(n)"
          >
            <div class="flex items-center gap-2 mb-1">
              @if (n.priority === 'high') {
                <span class="text-[10px] font-bold uppercase tracking-wider text-red-600 bg-red-50 px-1.5 py-0.5 rounded">High</span>
              }
              @if (n.marker?.marker_types?.marker_categories?.name; as catName) {
                <span class="text-[10px] uppercase tracking-wider text-slate-500">{{ catName }}</span>
              }
              <span class="text-[10px] text-slate-400 ml-auto">{{ n.created_at | date:'MMM d, h:mm a' }}</span>
            </div>
            <div class="text-sm font-medium text-slate-800">{{ n.marker?.title }}</div>
            <div class="text-xs text-slate-500 mt-0.5 line-clamp-2">{{ n.summary }}</div>
          </div>
        } @empty {
          <div class="px-4 py-8 text-center text-sm text-slate-400">No notifications</div>
        }
      </div>
    </div>
  `,
})
export class NotificationPanelComponent implements OnInit {
  readonly spaceId = input.required<string>();
  readonly closed = output<void>();
  readonly read = output<void>();

  private notificationService = inject(NotificationService);

  notifications = signal<MarkerNotification[]>([]);
  filteredNotifications = signal<MarkerNotification[]>([]);
  activeFilter = 'all';

  readonly filterOptions = [
    { label: 'All', value: 'all' },
    { label: 'Unread', value: 'unread' },
    { label: 'High Priority', value: 'high' },
  ];

  async ngOnInit() {
    const data = await this.notificationService.getNotifications(this.spaceId());
    this.notifications.set(data);
    this.applyFilter();
  }

  applyFilter() {
    const all = this.notifications();
    switch (this.activeFilter) {
      case 'unread':
        this.filteredNotifications.set(all.filter(n => !n.is_read));
        break;
      case 'high':
        this.filteredNotifications.set(all.filter(n => n.priority === 'high'));
        break;
      default:
        this.filteredNotifications.set(all);
    }
  }

  async onNotificationClick(n: MarkerNotification) {
    if (!n.is_read) {
      await this.notificationService.markAsRead(n.id);
      n.is_read = true;
      this.read.emit();
    }
  }
}
```

- [ ] **Step 3: Add bell to header**

In `src/client/src/app/core/layout/header.component.ts`:

1. Add `NotificationBellComponent` to imports
2. In the template, add the bell in the right section before the account menu (around line 126 of the current template):

```html
@if (spaceId()) {
  <app-notification-bell [spaceId]="spaceId()" />
}
```

- [ ] **Step 4: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/core/layout/
git commit -m "feat(notifications): add notification bell and panel to header

Bell shows unread count badge. Panel lists notifications with
priority, category, summary. Filter by all/unread/high priority.
Click to mark as read."
```

---

## Task 12: Update Landscape Components

Update bullseye/landscape components to use new marker and trial models.

**Files:**
- Modify: `src/client/src/app/features/landscape/bullseye-detail-panel.component.ts`
- Modify: `src/client/src/app/features/landscape/bullseye-chart.component.ts`
- Modify: `src/client/src/app/features/landscape/landscape.component.ts`

- [ ] **Step 1: Read landscape components**

Read the key landscape component files to understand current marker and phase references.

- [ ] **Step 2: Update BullseyeMarker references**

The `BullseyeMarker` interface was updated in Task 4 to include `projection` and `category_name`. Update any component code that renders marker data to include these new fields.

In `bullseye-detail-panel.component.ts`, where `recent_markers` are displayed for a selected product, add projection and category info to the display.

- [ ] **Step 3: Update phase references**

The bullseye RPCs calculate `highest_phase` from trial data. Since phases are now on the trial directly, the RPCs handle this. Verify that the frontend reads `highest_phase` from the RPC response (not from `trial_phases`). This should already work since `BullseyeProduct.highest_phase` comes from the RPC, not client-side calculation.

- [ ] **Step 4: Verify build**

Run: `cd src/client && ng lint && ng build`

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/landscape/
git commit -m "feat(landscape): update bullseye components for new marker model

Include projection and category in marker display.
Phase data now read from trial directly via RPCs."
```

---

## Task 13: Clean Up Dead Code and Verify

Remove all remaining references to old types and services. Final verification.

**Files:**
- Grep and fix all remaining `TrialMarker`, `TrialPhase`, `trial_markers`, `trial_phases` references
- Remove: `src/client/src/app/core/services/trial-marker.service.ts` (if not already deleted)
- Remove: `src/client/src/app/core/services/trial-phase.service.ts` (if not already deleted)
- Remove: `src/client/src/app/features/manage/trials/phase-form.component.ts` (if not already deleted)

- [ ] **Step 1: Search for stale references**

Run grep across the client source for old type and table names:

```bash
cd src/client && grep -rn "TrialMarker\|TrialPhase\|trial_markers\|trial_phases\|trial-marker\.service\|trial-phase\.service\|phase-form" src/app/ --include="*.ts"
```

Fix every remaining reference:
- `TrialMarker` -> `Marker`
- `TrialPhase` -> removed (use `trial.phase_type` etc.)
- `trial-marker.service` -> `marker.service`
- `trial-phase.service` -> removed
- `phase-form` -> removed

- [ ] **Step 2: Update any route configurations**

Check `src/client/src/app/app.routes.ts` for any routes that reference removed components. The marker-types management route should still work (it uses `MarkerTypeService` which was updated, not removed).

- [ ] **Step 3: Update model barrel exports**

If there's an index.ts or barrel file in `src/client/src/app/core/models/` that re-exports models, add `notification.model.ts` and remove exports for `TrialPhase` and `TrialMarker`.

- [ ] **Step 4: Final lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: Clean lint, successful build with zero errors.

- [ ] **Step 5: Commit**

```bash
git add -A src/client/
git commit -m "chore: clean up stale marker and phase references

Remove all TrialMarker, TrialPhase, trial-marker.service,
trial-phase.service, and phase-form references."
```

---

## Task 14: Update seed_demo_data Function

The `seed_demo_data` RPC function used in onboarding needs to be updated to create data using the new tables.

**Files:**
- Create: `supabase/migrations/20260412130300_update_seed_demo_for_marker_redesign.sql`

- [ ] **Step 1: Read the current seed_demo_data function**

Read `supabase/migrations/20260315163538_seed_demo_data_function.sql` and any subsequent updates to understand what it creates. It likely inserts into `trial_phases` and `trial_markers`.

- [ ] **Step 2: Write updated function**

Create `supabase/migrations/20260412130300_update_seed_demo_for_marker_redesign.sql`:

Replace all `trial_phases` inserts with setting `phase_type`, `phase_start_date`, `phase_end_date` on the trial itself.

Replace all `trial_markers` inserts with `markers` + `marker_assignments` inserts, including:
- `title` (meaningful name for the event)
- `projection` (mix of stout/company/primary/actual for variety)
- `description` and `source_url` on some markers for demo richness

Add a few `marker_notifications` for demo purposes.

- [ ] **Step 3: Verify**

Run: `supabase db reset`
Expected: Clean reset. Demo data populates with new schema.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260412130300_update_seed_demo_for_marker_redesign.sql
git commit -m "feat(db): update seed_demo_data for marker system redesign

Demo data uses markers + marker_assignments, inline phases,
and sample notifications."
```

---

## Task 15: Final End-to-End Verification

Run the full verification suite and do a visual check.

**Files:** None (verification only)

- [ ] **Step 1: Reset database and verify**

```bash
supabase db reset
```
Expected: Clean reset, all migrations pass, seed data loads.

- [ ] **Step 2: Lint and build**

```bash
cd src/client && ng lint && ng build
```
Expected: Zero lint errors, successful production build.

- [ ] **Step 3: Start dev server and verify visually**

```bash
cd src/client && ng serve
```

Open the app and verify:
- Timeline view loads with phase bars (from trial directly) and markers
- Marker tooltips show title, projection, category, description, source URL
- NCT IDs appear in the grid left rail
- Notification bell appears in the header
- Notification panel opens with demo notifications
- Manage > Trials > trial detail shows markers with new metadata, no phase sub-list
- Marker form shows category > type cascading dropdowns, projection, multi-trial assignment, notify toggle
- Trial form shows inline phase fields

- [ ] **Step 4: Final commit if any fixes needed**

If visual verification reveals issues, fix them and commit:

```bash
git add -A
git commit -m "fix: address issues found during visual verification"
```
