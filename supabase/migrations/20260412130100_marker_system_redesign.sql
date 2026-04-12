-- migration: 20260412130100_marker_system_redesign
-- purpose: redesign the marker system by introducing marker_categories, replacing
--          trial_markers with the space-scoped markers + marker_assignments model,
--          adding notification tables, collapsing trial_phases onto trials, and
--          dropping the now-superseded trial_markers and trial_phases tables.
-- affected tables (created):
--   public.marker_categories
--   public.markers
--   public.marker_assignments
--   public.marker_notifications
--   public.notification_reads
-- affected tables (altered):
--   public.marker_types  -- adds category_id column
--   public.trials        -- adds phase_type, phase_start_date, phase_end_date columns
-- affected tables (dropped):
--   public.trial_markers
--   public.trial_phases
-- notes:
--   - all new tables use has_space_access() for rls, matching the existing pattern
--   - data migration copies trial_markers -> markers + marker_assignments
--   - data migration copies trial_phases -> trials (latest phase per trial wins)
--   - is_projected on markers is a generated always column (projection <> 'actual')

-- =============================================================================
-- 1. marker_categories table
-- =============================================================================

create table public.marker_categories (
  id           uuid primary key default gen_random_uuid(),
  space_id     uuid references public.spaces (id) on delete cascade,
  name         text not null,
  display_order int not null default 0,
  is_system    boolean not null default false,
  created_by   uuid references auth.users (id),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

comment on table public.marker_categories is
  'Grouping categories for marker types (e.g. Clinical Trial, Data, Regulatory). '
  'System categories (is_system=true) have null space_id and are visible to all authenticated users. '
  'Space-scoped categories are visible only to members of that space.';

-- index the space_id for rls filtering
create index idx_marker_categories_space_id on public.marker_categories (space_id);

alter table public.marker_categories enable row level security;

-- allow all authenticated users to read system categories (space_id is null)
-- and space members to read their space's custom categories
create policy "authenticated can view system marker_categories"
on public.marker_categories
for select
to authenticated
using (
  is_system = true
  or (space_id is not null and public.has_space_access(space_id))
);

-- only space editors/owners can insert custom (non-system) categories
create policy "space editors can insert marker_categories"
on public.marker_categories
for insert
to authenticated
with check (
  is_system = false
  and space_id is not null
  and public.has_space_access(space_id, array['owner', 'editor'])
);

-- only space editors/owners can update their custom categories; system rows are immutable
create policy "space editors can update marker_categories"
on public.marker_categories
for update
to authenticated
using (
  is_system = false
  and space_id is not null
  and public.has_space_access(space_id, array['owner', 'editor'])
)
with check (
  is_system = false
  and space_id is not null
  and public.has_space_access(space_id, array['owner', 'editor'])
);

-- only space editors/owners can delete their custom categories; system rows are immutable
create policy "space editors can delete marker_categories"
on public.marker_categories
for delete
to authenticated
using (
  is_system = false
  and space_id is not null
  and public.has_space_access(space_id, array['owner', 'editor'])
);

-- =============================================================================
-- 2. seed 5 system marker categories with fixed UUIDs
-- =============================================================================

insert into public.marker_categories (id, space_id, name, display_order, is_system, created_by)
values
  ('c0000000-0000-0000-0000-000000000001', null, 'Clinical Trial',       1, true, null),
  ('c0000000-0000-0000-0000-000000000002', null, 'Data',                 2, true, null),
  ('c0000000-0000-0000-0000-000000000003', null, 'Regulatory',           3, true, null),
  ('c0000000-0000-0000-0000-000000000004', null, 'Approval',             4, true, null),
  ('c0000000-0000-0000-0000-000000000005', null, 'Loss of Exclusivity',  5, true, null)
on conflict (id) do nothing;

-- =============================================================================
-- 3. add category_id to marker_types and populate it
-- =============================================================================

-- add the column as nullable first so we can populate it before enforcing NOT NULL
alter table public.marker_types
  add column category_id uuid references public.marker_categories (id);

create index idx_marker_types_category_id on public.marker_types (category_id);

-- map existing system marker types to their categories:
--   a0000000-...0001  Projected Data Reported       -> Data (c...0002)
--   a0000000-...0002  Data Reported                 -> Data (c...0002)
--   a0000000-...0003  Projected Regulatory Filing   -> Regulatory (c...0003)
--   a0000000-...0004  Submitted Regulatory Filing   -> Regulatory (c...0003)
--   a0000000-...0005  Label Projected Approval/Launch -> Approval (c...0004)
--   a0000000-...0006  Label Update                  -> Approval (c...0004)
--   a0000000-...0007  Est. Range of Potential Launch -> Approval (c...0004)
--   a0000000-...0008  Primary Completion Date (PCD) -> Clinical Trial (c...0001)
--   a0000000-...0009  Change from Prior Update      -> Data (c...0002)
--   a0000000-...0010  Event No Longer Expected      -> Clinical Trial (c...0001)

update public.marker_types
set category_id = 'c0000000-0000-0000-0000-000000000002'
where id in (
  'a0000000-0000-0000-0000-000000000001',
  'a0000000-0000-0000-0000-000000000002',
  'a0000000-0000-0000-0000-000000000009'
);

update public.marker_types
set category_id = 'c0000000-0000-0000-0000-000000000003'
where id in (
  'a0000000-0000-0000-0000-000000000003',
  'a0000000-0000-0000-0000-000000000004'
);

update public.marker_types
set category_id = 'c0000000-0000-0000-0000-000000000004'
where id in (
  'a0000000-0000-0000-0000-000000000005',
  'a0000000-0000-0000-0000-000000000006',
  'a0000000-0000-0000-0000-000000000007'
);

update public.marker_types
set category_id = 'c0000000-0000-0000-0000-000000000001'
where id in (
  'a0000000-0000-0000-0000-000000000008',
  'a0000000-0000-0000-0000-000000000010'
);

-- any custom (non-system) marker types without a category default to Data
update public.marker_types
set category_id = 'c0000000-0000-0000-0000-000000000002'
where category_id is null;

-- now that every row has a category_id, enforce NOT NULL
alter table public.marker_types
  alter column category_id set not null;

-- =============================================================================
-- 4. add new system marker types (a0000000-...0011 through a0000000-...0021)
-- =============================================================================
-- Clinical Trial: Trial Start, Trial End
-- Data:          Topline Data, Interim Data, Full Data
-- Regulatory:    FDA Submission, FDA Acceptance
-- Approval:      PDUFA Date, Launch Date
-- Loss of Exclusivity: LOE Date, Generic Entry Date

insert into public.marker_types (id, space_id, name, icon, shape, fill_style, color, is_system, display_order, category_id)
values
  -- Clinical Trial category
  ('a0000000-0000-0000-0000-000000000011', null, 'Trial Start',       'trial-start',        'triangle', 'filled',  '#0d9488', true, 11, 'c0000000-0000-0000-0000-000000000001'),
  ('a0000000-0000-0000-0000-000000000012', null, 'Trial End',         'trial-end',          'triangle', 'outline', '#0d9488', true, 12, 'c0000000-0000-0000-0000-000000000001'),
  -- Data category
  ('a0000000-0000-0000-0000-000000000013', null, 'Topline Data',      'topline-data',       'circle',   'filled',  '#16a34a', true, 13, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000014', null, 'Interim Data',      'interim-data',       'circle',   'outline', '#16a34a', true, 14, 'c0000000-0000-0000-0000-000000000002'),
  ('a0000000-0000-0000-0000-000000000015', null, 'Full Data',         'full-data',          'circle',   'striped', '#16a34a', true, 15, 'c0000000-0000-0000-0000-000000000002'),
  -- Regulatory category
  ('a0000000-0000-0000-0000-000000000016', null, 'FDA Submission',    'fda-submission',     'diamond',  'outline', '#dc2626', true, 16, 'c0000000-0000-0000-0000-000000000003'),
  ('a0000000-0000-0000-0000-000000000017', null, 'FDA Acceptance',    'fda-acceptance',     'diamond',  'filled',  '#dc2626', true, 17, 'c0000000-0000-0000-0000-000000000003'),
  -- Approval category
  ('a0000000-0000-0000-0000-000000000018', null, 'PDUFA Date',        'pdufa-date',         'flag',     'filled',  '#2563eb', true, 18, 'c0000000-0000-0000-0000-000000000004'),
  ('a0000000-0000-0000-0000-000000000019', null, 'Launch Date',       'launch-date',        'flag',     'striped', '#2563eb', true, 19, 'c0000000-0000-0000-0000-000000000004'),
  -- Loss of Exclusivity category
  ('a0000000-0000-0000-0000-000000000020', null, 'LOE Date',          'loe-date',           'square',   'filled',  '#92400e', true, 20, 'c0000000-0000-0000-0000-000000000005'),
  ('a0000000-0000-0000-0000-000000000021', null, 'Generic Entry Date','generic-entry-date', 'square',   'outline', '#92400e', true, 21, 'c0000000-0000-0000-0000-000000000005')
on conflict (id) do nothing;

-- =============================================================================
-- 5. markers table (replaces trial_markers)
-- =============================================================================

create table public.markers (
  id              uuid primary key default gen_random_uuid(),
  space_id        uuid not null references public.spaces (id) on delete cascade,
  marker_type_id  uuid not null references public.marker_types (id),
  title           text not null,
  projection      text not null default 'actual'
                  check (projection in ('stout', 'company', 'primary', 'actual')),
  event_date      date not null,
  end_date        date,
  description     text,
  source_url      text,
  metadata        jsonb,
  -- generated column: true when projection is anything other than 'actual'
  is_projected    boolean generated always as (projection <> 'actual') stored,
  created_by      uuid not null references auth.users (id),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

comment on table public.markers is
  'Space-scoped marker events that annotate clinical trial timelines. '
  'Each marker belongs to a space and is linked to one or more trials via marker_assignments. '
  'is_projected is computed from the projection field (any value other than ''actual'' is projected).';

-- performance indexes
create index idx_markers_space_id       on public.markers (space_id);
create index idx_markers_marker_type_id on public.markers (marker_type_id);
create index idx_markers_event_date     on public.markers (event_date);

alter table public.markers enable row level security;

-- space members can view markers in their space
create policy "space members can view markers"
on public.markers
for select
to authenticated
using ( public.has_space_access(space_id) );

-- space editors/owners can insert markers into their space
create policy "space editors can insert markers"
on public.markers
for insert
to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );

-- space editors/owners can update markers in their space
create policy "space editors can update markers"
on public.markers
for update
to authenticated
using  ( public.has_space_access(space_id, array['owner', 'editor']) )
with check ( public.has_space_access(space_id, array['owner', 'editor']) );

-- space editors/owners can delete markers in their space
create policy "space editors can delete markers"
on public.markers
for delete
to authenticated
using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- =============================================================================
-- 6. marker_assignments table
-- =============================================================================

create table public.marker_assignments (
  id         uuid primary key default gen_random_uuid(),
  marker_id  uuid not null references public.markers (id) on delete cascade,
  trial_id   uuid not null references public.trials (id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (marker_id, trial_id)
);

comment on table public.marker_assignments is
  'Join table that links a marker to one or more trials. '
  'A single marker (e.g. a Data Reported event) can appear on multiple trial timelines.';

create index idx_marker_assignments_marker_id on public.marker_assignments (marker_id);
create index idx_marker_assignments_trial_id  on public.marker_assignments (trial_id);

alter table public.marker_assignments enable row level security;

-- access is derived from the parent marker's space_id via a subquery
create policy "space members can view marker_assignments"
on public.marker_assignments
for select
to authenticated
using (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id)
  )
);

create policy "space editors can insert marker_assignments"
on public.marker_assignments
for insert
to authenticated
with check (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
);

create policy "space editors can update marker_assignments"
on public.marker_assignments
for update
to authenticated
using (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
)
with check (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
);

create policy "space editors can delete marker_assignments"
on public.marker_assignments
for delete
to authenticated
using (
  exists (
    select 1 from public.markers m
    where m.id = marker_id
      and public.has_space_access(m.space_id, array['owner', 'editor'])
  )
);

-- =============================================================================
-- 7. marker_notifications table
-- =============================================================================

create table public.marker_notifications (
  id         uuid primary key default gen_random_uuid(),
  space_id   uuid not null references public.spaces (id) on delete cascade,
  marker_id  uuid not null references public.markers (id) on delete cascade,
  priority   text not null default 'low' check (priority in ('low', 'high')),
  summary    text not null,
  created_by uuid references auth.users (id),
  created_at timestamptz not null default now()
);

comment on table public.marker_notifications is
  'Notifications generated when a marker is created or updated within a space. '
  'Users track read state in notification_reads.';

create index idx_marker_notifications_space_id  on public.marker_notifications (space_id);
create index idx_marker_notifications_marker_id on public.marker_notifications (marker_id);

alter table public.marker_notifications enable row level security;

-- space members can see notifications for their spaces
create policy "space members can view marker_notifications"
on public.marker_notifications
for select
to authenticated
using ( public.has_space_access(space_id) );

-- space editors/owners can create notifications
create policy "space editors can insert marker_notifications"
on public.marker_notifications
for insert
to authenticated
with check ( public.has_space_access(space_id, array['owner', 'editor']) );

-- =============================================================================
-- 8. notification_reads table
-- =============================================================================

create table public.notification_reads (
  id              uuid primary key default gen_random_uuid(),
  notification_id uuid not null references public.marker_notifications (id) on delete cascade,
  user_id         uuid not null references auth.users (id),
  read_at         timestamptz not null default now(),
  unique (notification_id, user_id)
);

comment on table public.notification_reads is
  'Tracks which users have read which marker notifications. '
  'Each row represents one user dismissing one notification.';

create index idx_notification_reads_notification_id on public.notification_reads (notification_id);
create index idx_notification_reads_user_id          on public.notification_reads (user_id);

alter table public.notification_reads enable row level security;

-- users can only see their own read receipts
create policy "users can view own notification_reads"
on public.notification_reads
for select
to authenticated
using ( auth.uid() = user_id );

-- users can insert their own read receipts
create policy "users can insert own notification_reads"
on public.notification_reads
for insert
to authenticated
with check ( auth.uid() = user_id );

-- =============================================================================
-- 9. migrate trial_markers -> markers + marker_assignments
-- =============================================================================
-- copy each trial_markers row into markers, then create a marker_assignment
-- linking it back to the original trial.
--
-- mapping rules:
--   title       = coalesce(tm.tooltip_text, mt.name)
--   projection  = 'company' if tm.is_projected = true, else 'actual'
--   description = tm.tooltip_text
--   metadata    = jsonb with image_url key when tooltip_image_url is not null
--
-- note: we use two separate statements. the insert into markers uses the same
--       uuid (tm.id) so the subsequent insert into marker_assignments can
--       reference public.markers by id directly via a join on trial_markers.

-- step 9a: populate markers from trial_markers
insert into public.markers (
  id,
  space_id,
  marker_type_id,
  title,
  projection,
  event_date,
  end_date,
  description,
  source_url,
  metadata,
  created_by,
  created_at,
  updated_at
)
select
  tm.id,
  tm.space_id,
  tm.marker_type_id,
  coalesce(nullif(trim(tm.tooltip_text), ''), mt.name) as title,
  case when tm.is_projected then 'company' else 'actual' end as projection,
  tm.event_date,
  tm.end_date,
  tm.tooltip_text as description,
  null as source_url,
  case
    when tm.tooltip_image_url is not null
      then jsonb_build_object('image_url', tm.tooltip_image_url)
    else null
  end as metadata,
  tm.created_by,
  tm.created_at,
  tm.updated_at
from public.trial_markers tm
join public.marker_types mt on mt.id = tm.marker_type_id;

-- step 9b: create marker_assignments from trial_markers using the preserved ids
insert into public.marker_assignments (marker_id, trial_id)
select tm.id as marker_id, tm.trial_id
from public.trial_markers tm;

-- =============================================================================
-- 10. collapse trial_phases onto trials
-- =============================================================================
-- add columns for storing the single "representative" phase per trial
-- (the phase with the latest start_date), then migrate and drop trial_phases.

-- add new columns (nullable during migration)
alter table public.trials
  add column phase_type       text,
  add column phase_start_date date,
  add column phase_end_date   date;

-- populate from trial_phases: pick the phase with the latest start_date per trial.
-- on ties, fall back to phase_type alphabetical order for determinism.
update public.trials t
set
  phase_type       = subq.phase_type,
  phase_start_date = subq.start_date,
  phase_end_date   = subq.end_date
from (
  select distinct on (trial_id)
    trial_id,
    phase_type,
    start_date,
    end_date
  from public.trial_phases
  order by trial_id, start_date desc, phase_type
) as subq
where t.id = subq.trial_id;

-- =============================================================================
-- 11. drop trial_markers (data now in markers + marker_assignments)
-- =============================================================================
-- destructive: removing trial_markers and all dependent rls policies.
-- all data has been migrated in step 9 above.

drop policy if exists "space members can view trial_markers"  on public.trial_markers;
drop policy if exists "space editors can insert trial_markers" on public.trial_markers;
drop policy if exists "space editors can update trial_markers" on public.trial_markers;
drop policy if exists "space editors can delete trial_markers" on public.trial_markers;

drop table public.trial_markers;

-- =============================================================================
-- 12. drop trial_phases (data now on trials)
-- =============================================================================
-- destructive: removing trial_phases and all dependent rls policies.
-- all data has been migrated in step 10 above.

drop policy if exists "space members can view trial_phases"  on public.trial_phases;
drop policy if exists "space editors can insert trial_phases" on public.trial_phases;
drop policy if exists "space editors can update trial_phases" on public.trial_phases;
drop policy if exists "space editors can delete trial_phases" on public.trial_phases;

drop table public.trial_phases;
