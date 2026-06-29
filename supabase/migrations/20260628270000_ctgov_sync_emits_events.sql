-- CT.gov sync emits clinical EVENTS (preserving the UPSERT drift behavior)
--
-- The CT.gov sync path (_create_trial_date_markers, _seed_ctgov_marker_upsert,
-- _seed_ctgov_markers) still wrote the dropped public.markers /
-- public.marker_assignments tables. This repoints those writes to the unified
-- public.events table, anchored to the trial (anchor_type='trial',
-- anchor_id=p_trial_id), with NO assignment rows. The 3-branch UPSERT-by-
-- (trial, event_type, metadata.source='ctgov') drift behavior is preserved
-- exactly.
--
-- DEVIATION FROM THE C3 PLAN TEXT ("via create_event"): this is a faithful
-- INLINE repoint, NOT a create_event delegation. create_event is structurally
-- incompatible here:
--   1. It enforces has_space_access(owner|editor) on auth.uid(); the CT.gov
--      worker runs anon (auth.uid() is null), so create_event would raise
--      'forbidden' on every sync.
--   2. It is INSERT-only; the drift logic is a 3-branch UPSERT (steady-state
--      update / adopt one analyst event / insert fresh). create_event cannot
--      update or adopt.
--   3. It has no metadata param; drift detection REQUIRES
--      metadata->>'source'='ctgov' to find the ct.gov-owned row.
--   4. events has a BEFORE INSERT trigger _set_created_by() that does
--      created_by := coalesce(auth.uid(), new.created_by). An INLINE insert
--      setting created_by = the trial's analyst SURVIVES the anon path;
--      create_event would force auth.uid() (null) and violate events.created_by
--      NOT NULL.
-- So we keep the exact UPSERT control flow and only retarget the tables.
--
-- SOURCES MODEL (Phase S): CT.gov events carry NO source_url and NO
-- event_sources rows. The registry link (clinicaltrials.gov/study/<nct>) is
-- DERIVED by readers from the anchor trial's identifier (public.event_registry_url
-- in the read RPCs). So the producer STOPS storing it: the v_source_url variable,
-- the hardcoded literal, and the _seed_ctgov_marker_upsert p_source_url parameter
-- are all removed. events.source_url the COLUMN is untouched (dropped later by S5).
--
-- The DB-level ct.gov write-lock trigger (_guard_ctgov_locked_markers) lived on
-- the dropped markers table and is gone in the event model. The GUC
-- clint.ctgov_seeding is therefore now inert (no events trigger reads it); the
-- set_config calls are retained for forward compatibility.

-- ---------------------------------------------------------------------------
-- 1. _create_trial_date_markers: analyst Trial Start / Trial End events.
--    search_path='' -> everything schema-qualified. Insert directly into
--    public.events (anchor_type='trial', anchor_id=p_trial_id); no assignment.
-- ---------------------------------------------------------------------------
create or replace function public._create_trial_date_markers(p_trial_id uuid, p_space_id uuid, p_created_by uuid, p_start_date date, p_end_date date)
 returns void
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  c_start_id  constant uuid := 'a0000000-0000-0000-0000-000000000011';
  c_end_id    constant uuid := 'a0000000-0000-0000-0000-000000000012';
begin
  if p_created_by is null then
    return;  -- events.created_by is NOT NULL.
  end if;

  if p_start_date is not null then
    insert into public.events (
      space_id, event_type_id, title, projection, event_date, date_precision,
      anchor_type, anchor_id, metadata, created_by
    ) values (
      p_space_id, c_start_id, 'Trial Start',
      case when p_start_date <= current_date then 'actual' else 'company' end,
      p_start_date, 'exact',
      'trial', p_trial_id,
      jsonb_build_object('source', 'analyst'),
      p_created_by
    );
  end if;

  if p_end_date is not null then
    insert into public.events (
      space_id, event_type_id, title, projection, event_date, date_precision,
      anchor_type, anchor_id, metadata, created_by
    ) values (
      p_space_id, c_end_id, 'Trial End',
      case when p_end_date <= current_date then 'actual' else 'company' end,
      p_end_date, 'exact',
      'trial', p_trial_id,
      jsonb_build_object('source', 'analyst'),
      p_created_by
    );
  end if;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 2. _seed_ctgov_marker_upsert: the 3-branch drift UPSERT, retargeted to events.
--    Signature loses p_source_url (sources model). Its only caller is
--    _seed_ctgov_markers, updated below. Drop the old signature first because a
--    parameter is being removed (internal SECURITY DEFINER helper, no grants).
-- ---------------------------------------------------------------------------
drop function if exists public._seed_ctgov_marker_upsert(uuid, uuid, uuid, uuid, text, text, text, text, text, uuid);

create or replace function public._seed_ctgov_marker_upsert(p_trial_id uuid, p_space_id uuid, p_created_by uuid, p_marker_type_id uuid, p_title text, p_field text, p_date_string text, p_date_type text, p_snapshot_id uuid)
 returns boolean
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_event_date date;
  v_precision  text;
  v_date_type  text;
  v_projection text;
  v_event_id   uuid;
  v_unowned    uuid[];
begin
  select resolved, "precision"
    into v_event_date, v_precision
    from public._ctgov_resolve_partial_date(p_date_string);

  if v_event_date is null then
    return false;  -- unparseable/absent: leave existing events untouched.
  end if;

  v_date_type  := upper(coalesce(nullif(p_date_type, ''), 'ANTICIPATED'));
  v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'company' end;

  -- (a) steady-state: a ct.gov-owned event of this type already exists.
  select e.id
    into v_event_id
    from public.events e
   where e.anchor_type = 'trial'
     and e.anchor_id = p_trial_id
     and e.event_type_id = p_marker_type_id
     and e.metadata->>'source' = 'ctgov'
   limit 1;

  if v_event_id is not null then
    update public.events
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           metadata       = coalesce(metadata, '{}'::jsonb)
                            || jsonb_build_object(
                                 'snapshot_id',     p_snapshot_id,
                                 'ctgov_date_type', v_date_type
                               )
     where id = v_event_id;
    return true;
  end if;

  -- (b) adoption: exactly one un-owned event of this type for this trial.
  select array_agg(e.id)
    into v_unowned
    from public.events e
   where e.anchor_type = 'trial'
     and e.anchor_id = p_trial_id
     and e.event_type_id = p_marker_type_id
     and (e.metadata->>'source' is null or e.metadata->>'source' <> 'ctgov');

  if array_length(v_unowned, 1) = 1 then
    -- Adoption updates source + date/precision/projection (+ metadata) only.
    -- Preserve any analyst-authored description; fall back to the ct.gov
    -- default only when the adopted event has none. No source_url write: the
    -- registry link is derived by readers from the anchor trial's NCT.
    update public.events
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           description     = coalesce(description, 'Auto-derived from clinicaltrials.gov'),
           metadata       = coalesce(metadata, '{}'::jsonb)
                            || jsonb_build_object(
                                 'source',          'ctgov',
                                 'field',           p_field,
                                 'snapshot_id',     p_snapshot_id,
                                 'ctgov_date_type', v_date_type
                               )
     where id = v_unowned[1];
    return true;
  end if;

  -- (c) insert a fresh ct.gov-owned event anchored to the trial (no assignment,
  --     no source_url column write).
  insert into public.events (
    space_id, event_type_id, title, projection, event_date, date_precision,
    description, metadata, anchor_type, anchor_id, created_by
  ) values (
    p_space_id, p_marker_type_id, p_title, v_projection, v_event_date, v_precision,
    'Auto-derived from clinicaltrials.gov',
    jsonb_build_object(
      'source',          'ctgov',
      'field',           p_field,
      'snapshot_id',     p_snapshot_id,
      'ctgov_date_type', v_date_type
    ),
    'trial', p_trial_id,
    p_created_by
  );

  return true;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 3. _seed_ctgov_markers: drop the v_source_url variable + its hardcoded
--    clinicaltrials.gov/study literal (sources model: link is derived), and
--    drop the v_source_url argument from the three upsert calls (the upsert no
--    longer takes p_source_url). Comments updated for the event model.
-- ---------------------------------------------------------------------------
create or replace function public._seed_ctgov_markers(p_trial_id uuid, p_payload jsonb, p_snapshot_id uuid)
 returns integer
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_space_id    uuid;
  v_created_by  uuid;
  v_nct         text;
  v_count       int := 0;

  c_start_id    constant uuid := 'a0000000-0000-0000-0000-000000000011';
  c_pcd_id      constant uuid := 'a0000000-0000-0000-0000-000000000008';
  c_end_id      constant uuid := 'a0000000-0000-0000-0000-000000000012';
begin
  select space_id, created_by, identifier
    into v_space_id, v_created_by, v_nct
    from public.trials
   where id = p_trial_id;

  -- events.created_by is NOT NULL with FK to auth.users; the worker is anon
  -- and auth.uid() is null here, so the only reliable identity is the analyst
  -- who created the trial.
  if v_created_by is null then
    return 0;
  end if;

  -- The registry link (clinicaltrials.gov/study/<nct>) is NOT stored on the
  -- event. In the event sources model readers derive it from the anchor trial's
  -- identifier (public.event_registry_url), so no source_url is passed through.

  -- Scope the GUC to the seeder's own writes. In the event model there is no
  -- DB-level ct.gov write-lock trigger (it lived on the dropped markers table),
  -- so this GUC is now INERT; it is retained for forward compatibility.
  perform set_config('clint.ctgov_seeding', 'on', true);

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_start_id, 'Trial Start',
       'startDateStruct.date',
       p_payload #>> '{protocolSection,statusModule,startDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,startDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_pcd_id, 'Primary Completion Date (PCD)',
       'primaryCompletionDateStruct.date',
       p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_end_id, 'Trial End',
       'completionDateStruct.date',
       p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,completionDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  perform set_config('clint.ctgov_seeding', 'off', true);

  return v_count;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 4. create_trial: pure comment refresh (markers -> events). It only DELEGATES
--    to _create_trial_date_markers; no direct marker writes. Redefined verbatim
--    from the captured live body except the stale comment, to keep it grep-clean
--    for later phases.
-- ---------------------------------------------------------------------------
create or replace function public.create_trial(p_space_id uuid, p_asset_id uuid, p_name text, p_identifier text default null::text, p_status text default null::text, p_phase_type text default null::text, p_phase_start_date date default null::date, p_phase_end_date date default null::date, p_indication_name text default null::text, p_source_doc_id uuid default null::uuid, p_indication_names text[] default null::text[])
 returns uuid
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_uid            uuid := auth.uid();
  v_id             uuid;
  v_names          text[];
  v_name           text;
  v_indication_id  uuid;
  v_condition_id   uuid;
  v_any            boolean := false;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.trials (
    name, identifier, status, phase_type,
    asset_id, space_id, created_by, source_doc_id
  ) values (
    p_name, p_identifier, p_status, p_phase_type,
    p_asset_id, p_space_id, v_uid, p_source_doc_id
  )
  returning id into v_id;

  -- phase dates become analyst-owned Trial Start / Trial End events (the bar
  -- now derives from events). Un-owned so the first ct.gov sync adopts them.
  perform public._create_trial_date_markers(
    v_id, p_space_id, v_uid, p_phase_start_date, p_phase_end_date
  );

  -- Resolve the indication name set: prefer the array, fall back to the legacy
  -- single name. Each name upserts the master indication + condition records and
  -- the join rows the dashboard reads from.
  v_names := coalesce(
    p_indication_names,
    case when p_indication_name is not null then array[p_indication_name] else '{}'::text[] end
  );

  if v_names is not null then
    foreach v_name in array v_names loop
      v_name := nullif(trim(v_name), '');
      continue when v_name is null;

      insert into public.indications (name, space_id, created_by)
        values (v_name, p_space_id, v_uid)
        on conflict (space_id, name) do nothing;

      select id into v_indication_id
        from public.indications
       where space_id = p_space_id and name = v_name;

      insert into public.conditions (name, space_id, source)
        values (v_name, p_space_id, 'analyst')
        on conflict (space_id, name) do nothing;

      select id into v_condition_id
        from public.conditions
       where space_id = p_space_id and name = v_name;

      if v_indication_id is not null and v_condition_id is not null then
        insert into public.condition_indication_map (condition_id, indication_id)
          values (v_condition_id, v_indication_id)
          on conflict do nothing;

        insert into public.trial_conditions (trial_id, condition_id, source)
          values (v_id, v_condition_id, 'analyst')
          on conflict do nothing;

        insert into public.asset_indications (
          asset_id, indication_id, space_id,
          development_status_source, created_by
        ) values (
          p_asset_id, v_indication_id, p_space_id,
          'auto', v_uid
        ) on conflict (asset_id, indication_id) do nothing;

        v_any := true;
      end if;
    end loop;
  end if;

  if v_any then
    perform public._recompute_asset_indication_status(p_asset_id);
  end if;

  return v_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- In-file smoke (self-cleaning, prod-safe): data-conditional on the demo space.
-- Skips with a NOTICE when the demo space or a demo asset is absent (the
-- authoritative drift proof is the integration spec). When present: create a
-- scratch trial, prove _create_trial_date_markers emits exactly 2 analyst
-- trial-anchored events, then call _seed_ctgov_marker_upsert for Trial Start
-- TWICE and assert exactly ONE ct.gov-or-adopted Trial Start event remains with
-- the date updated in place (no duplicate). Cleans up so it is re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_demo_space  constant uuid := '00000000-0000-0000-0000-0000000d0100';
  v_demo_user   constant uuid := '00000000-0000-0000-0000-00000000000d';
  c_start_id    constant uuid := 'a0000000-0000-0000-0000-000000000011';
  v_asset_id    uuid;
  v_user_id     uuid;
  v_trial_id    uuid;
  v_analyst_cnt int;
  v_start_cnt   int;
  v_start_date  date;
begin
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'C3 smoke: demo space absent (prod-safe skip)';
    return;
  end if;

  select id into v_asset_id
    from public.assets
   where space_id = v_demo_space
   limit 1;

  if v_asset_id is null then
    raise notice 'C3 smoke: demo space has no asset, skipping';
    return;
  end if;

  -- created_by must be a real auth.users id; prefer the demo user, else any
  -- member of the demo space.
  if exists (select 1 from auth.users where id = v_demo_user) then
    v_user_id := v_demo_user;
  else
    select user_id into v_user_id
      from public.space_members
     where space_id = v_demo_space
     limit 1;
  end if;
  if v_user_id is null then
    raise notice 'C3 smoke: no usable demo user, skipping';
    return;
  end if;

  insert into public.trials (name, asset_id, space_id, created_by, identifier)
  values ('C3 smoke trial', v_asset_id, v_demo_space, v_user_id, 'C3SMOKE')
  returning id into v_trial_id;

  -- analyst path: 2 trial-anchored analyst events.
  perform public._create_trial_date_markers(
    v_trial_id, v_demo_space, v_user_id, date '2026-01-10', date '2027-01-10'
  );

  select count(*) into v_analyst_cnt
    from public.events
   where anchor_type = 'trial'
     and anchor_id = v_trial_id
     and metadata->>'source' = 'analyst';

  if v_analyst_cnt <> 2 then
    raise exception 'C3 SMOKE FAIL: expected 2 analyst events, got %', v_analyst_cnt;
  end if;

  -- ct.gov upsert TWICE for Trial Start: first adopts the analyst event,
  -- second is steady-state. Must remain exactly ONE Trial Start, updated.
  perform public._seed_ctgov_marker_upsert(
    v_trial_id, v_demo_space, v_user_id, c_start_id, 'Trial Start',
    'startDateStruct.date', '2026', 'ANTICIPATED', null
  );
  perform public._seed_ctgov_marker_upsert(
    v_trial_id, v_demo_space, v_user_id, c_start_id, 'Trial Start',
    'startDateStruct.date', '2026-11-03', 'ACTUAL', null
  );

  select count(*), max(event_date)
    into v_start_cnt, v_start_date
    from public.events
   where anchor_type = 'trial'
     and anchor_id = v_trial_id
     and event_type_id = c_start_id;

  if v_start_cnt <> 1 then
    raise exception 'C3 SMOKE FAIL: expected 1 Trial Start event after upserts, got %', v_start_cnt;
  end if;
  if v_start_date <> date '2026-11-03' then
    raise exception 'C3 SMOKE FAIL: Trial Start date not updated in place, got %', v_start_date;
  end if;

  -- self-clean: delete the scratch trial and its anchored events.
  delete from public.events where anchor_type = 'trial' and anchor_id = v_trial_id;
  delete from public.trials where id = v_trial_id;

  raise notice 'C3 SMOKE PASS: ctgov sync emits drift-correct trial events (no duplicate)';
end;
$$;

notify pgrst, 'reload schema';
