-- migration: 20260502120000_trial_change_feed_tables
-- purpose: introduce the five tables that back the trial change feed:
--   trial_ctgov_snapshots (append-only JSONB history per trial),
--   trial_field_changes (raw CT.gov diff log),
--   trial_change_events (typed feed read by the UI),
--   marker_changes (analyst marker audit log),
--   ctgov_sync_runs (one row per cron invocation, observability).
-- writes for snapshots, field changes, events, and sync runs are performed
-- only by SECURITY DEFINER pipeline RPCs (worker poller and per-marker
-- trigger) added in later migrations; this file ships read-only RLS.
-- isolation smoke test at the end verifies RLS is enabled on every table.

-- =============================================================================
-- trial_ctgov_snapshots: per-space, trial-keyed, append-only ct.gov history.
--
create table public.trial_ctgov_snapshots (
  id                    uuid primary key default gen_random_uuid(),
  trial_id              uuid not null references public.trials (id) on delete cascade,
  space_id              uuid not null references public.spaces (id) on delete cascade,
  nct_id                varchar(20) not null,
  ctgov_version         int not null,
  last_update_post_date date not null,
  payload               jsonb not null,
  fetched_via           varchar(20) not null,
  fetched_at            timestamptz not null default now(),
  unique (trial_id, ctgov_version)
);

create index idx_snapshots_trial_version
  on public.trial_ctgov_snapshots (trial_id, ctgov_version desc);
create index idx_snapshots_nct
  on public.trial_ctgov_snapshots (nct_id);
create index idx_snapshots_space_post_date
  on public.trial_ctgov_snapshots (space_id, last_update_post_date desc);

alter table public.trial_ctgov_snapshots enable row level security;

create policy trial_ctgov_snapshots_select
  on public.trial_ctgov_snapshots
  for select
  to authenticated
  using (public.has_space_access(space_id));

comment on table public.trial_ctgov_snapshots is
  'Append-only ct.gov payload history per trial and space; written by the worker ingest RPC.';

-- =============================================================================
-- trial_field_changes: per-trial raw diff log derived from snapshot pairs.
--
create table public.trial_field_changes (
  id                 uuid primary key default gen_random_uuid(),
  trial_id           uuid not null references public.trials (id) on delete cascade,
  space_id           uuid not null references public.spaces (id) on delete cascade,
  source_snapshot_id uuid not null references public.trial_ctgov_snapshots (id),
  field_path         text not null,
  old_value          jsonb,
  new_value          jsonb,
  observed_at        timestamptz not null default now()
);

create index idx_field_changes_trial_observed
  on public.trial_field_changes (trial_id, observed_at desc);
create index idx_field_changes_space_observed
  on public.trial_field_changes (space_id, observed_at desc);
create index idx_field_changes_field_path
  on public.trial_field_changes (trial_id, field_path);

alter table public.trial_field_changes enable row level security;

create policy trial_field_changes_select
  on public.trial_field_changes
  for select
  to authenticated
  using (public.has_space_access(space_id));

comment on table public.trial_field_changes is
  'Raw ct.gov field-level diffs between snapshot versions; pure capture, no interpretation.';

-- =============================================================================
-- trial_change_events: typed change feed read by the UI surfaces.
--
create table public.trial_change_events (
  id                            uuid primary key default gen_random_uuid(),
  trial_id                      uuid not null references public.trials (id) on delete cascade,
  space_id                      uuid not null references public.spaces (id) on delete cascade,
  event_type                    varchar(40) not null,
  source                        varchar(20) not null,
  payload                       jsonb not null,
  occurred_at                   timestamptz not null,
  observed_at                   timestamptz not null default now(),
  derived_from_change_id        uuid references public.trial_field_changes (id),
  derived_from_marker_change_id uuid,
  marker_id                     uuid references public.markers (id) on delete set null
);

create index idx_change_events_space_observed
  on public.trial_change_events (space_id, observed_at desc);
create index idx_change_events_trial_observed
  on public.trial_change_events (trial_id, observed_at desc);
create index idx_change_events_type
  on public.trial_change_events (space_id, event_type, observed_at desc);
create index idx_change_events_marker
  on public.trial_change_events (marker_id) where marker_id is not null;

alter table public.trial_change_events enable row level security;

create policy trial_change_events_select
  on public.trial_change_events
  for select
  to authenticated
  using (public.has_space_access(space_id));

comment on table public.trial_change_events is
  'Typed unified change feed (ct.gov plus analyst sources) consumed by activity, badges, and intel surfaces.';

-- =============================================================================
-- marker_changes: per-marker audit log; populated by AFTER trigger on markers.
-- marker_id is intentionally not a FK so audit rows survive marker deletion.
--
create table public.marker_changes (
  id          uuid primary key default gen_random_uuid(),
  marker_id   uuid not null,
  space_id    uuid not null references public.spaces (id) on delete cascade,
  change_type varchar(20) not null,
  old_values  jsonb,
  new_values  jsonb,
  changed_by  uuid references auth.users (id),
  changed_at  timestamptz not null default now()
);

create index idx_marker_changes_marker_changed
  on public.marker_changes (marker_id, changed_at desc);
create index idx_marker_changes_space_changed
  on public.marker_changes (space_id, changed_at desc);

alter table public.marker_changes enable row level security;

create policy marker_changes_select
  on public.marker_changes
  for select
  to authenticated
  using (public.has_space_access(space_id));

comment on table public.marker_changes is
  'Per-marker analyst audit log; rows survive marker deletion and feed analyst-source events.';

-- now that marker_changes exists, attach the deferred FK on trial_change_events.
alter table public.trial_change_events
  add constraint trial_change_events_derived_from_marker_change_id_fkey
  foreign key (derived_from_marker_change_id) references public.marker_changes (id);

-- =============================================================================
-- ctgov_sync_runs: one row per cron invocation; system observability.
--
create table public.ctgov_sync_runs (
  id                uuid primary key default gen_random_uuid(),
  started_at        timestamptz not null,
  ended_at          timestamptz not null,
  trials_checked    int not null default 0,
  ncts_with_changes int not null default 0,
  snapshots_written int not null default 0,
  events_emitted    int not null default 0,
  errors_count      int not null default 0,
  error_summary     jsonb,
  status            varchar(20) not null
);

alter table public.ctgov_sync_runs enable row level security;

create policy ctgov_sync_runs_select
  on public.ctgov_sync_runs
  for select
  to authenticated
  using (auth.uid() is not null);

comment on table public.ctgov_sync_runs is
  'One summary row per worker cron invocation; readable by any authenticated user for status display.';

-- =============================================================================
-- smoke test: verify all five tables exist with RLS enabled and at least one
-- policy attached. seed.sql runs after migrations so we cannot exercise live
-- fixture isolation here; the broader has_space_access invariant is already
-- covered by 20260428042300_whitelabel_isolation_smoke_tests.sql, which the
-- new policies inherit by construction.
--
do $$
declare
  v_tables text[] := array[
    'trial_ctgov_snapshots',
    'trial_field_changes',
    'trial_change_events',
    'marker_changes',
    'ctgov_sync_runs'
  ];
  v_table  text;
  v_rls    boolean;
  v_policy_count int;
begin
  foreach v_table in array v_tables loop
    select c.relrowsecurity
      into v_rls
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
     where n.nspname = 'public'
       and c.relname = v_table;

    if v_rls is null then
      raise exception 'change feed smoke FAIL: table public.% missing', v_table;
    end if;
    if not v_rls then
      raise exception 'change feed smoke FAIL: rls not enabled on public.%', v_table;
    end if;

    select count(*) into v_policy_count
      from pg_policies
     where schemaname = 'public'
       and tablename  = v_table;
    if v_policy_count < 1 then
      raise exception 'change feed smoke FAIL: no policies attached to public.%', v_table;
    end if;

    raise notice 'change feed smoke ok: public.% has rls + % policies', v_table, v_policy_count;
  end loop;

  raise notice 'trial change feed tables smoke test: PASS';
end$$;
