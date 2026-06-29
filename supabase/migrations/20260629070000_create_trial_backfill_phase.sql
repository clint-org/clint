-- QA-002: manual trial create left the human-readable `phase` text column NULL.
--
-- Both `phase` (human string, e.g. "Phase 3", written on the ct.gov path by
-- _map_phase_array) and `phase_type` (bucketed code P1..P4/OBS) are kept columns
-- on `trials` per the ctgov-trial-dates spec (Settled decisions table). The
-- ct.gov sync writes both; create_trial only ever wrote `phase_type`, so manual
-- trials rendered "(not set)" in the trial-detail Phase field while ct.gov-synced
-- trials showed "Phase 3". This backfills `phase` from `phase_type` so manual
-- creates reach parity.
--
-- The phase_type -> human label map is extracted into an immutable helper so the
-- in-file smoke can exercise it directly: create_trial is has_space_access-gated
-- (SECURITY DEFINER), and calling it from a migration `do` block with no
-- auth.uid() raises 42501 on a populated remote, so the guarded RPC itself is not
-- smoke-safe. The helper is.

-- ---------------------------------------------------------------------------
-- _phase_label_from_type: bucketed phase code -> human-readable phase label.
-- Mirrors the trial-create dialog's PHASE_TYPES labels (P3 -> "Phase 3") and the
-- ct.gov path's _map_phase_array vocabulary. Unknown / null codes map to null.
-- ---------------------------------------------------------------------------
create or replace function public._phase_label_from_type(p_phase_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_phase_type
    when 'P1'  then 'Phase 1'
    when 'P2'  then 'Phase 2'
    when 'P3'  then 'Phase 3'
    when 'P4'  then 'Phase 4'
    when 'OBS' then 'Observational'
    else null
  end;
$$;

comment on function public._phase_label_from_type(text) is
  'Maps a bucketed trial phase code (P1..P4/OBS) to its human-readable phase '
  'label for the trials.phase text column. Unknown/null codes map to null. '
  'Used by create_trial so manual trials populate phase like the ct.gov path.';

revoke execute on function public._phase_label_from_type(text) from public;

-- ---------------------------------------------------------------------------
-- create_trial: body verbatim from 20260628270000_ctgov_sync_emits_events.sql,
-- adding only the `phase` column to the insert (derived from p_phase_type). The
-- signature is unchanged, so existing grants carry over.
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
    name, identifier, status, phase, phase_type,
    asset_id, space_id, created_by, source_doc_id
  ) values (
    p_name, p_identifier, p_status,
    public._phase_label_from_type(p_phase_type), p_phase_type,
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
-- In-file smoke (prod-safe, deterministic, no data dependency): exercise the
-- phase-label helper directly. create_trial's full behavior is covered by the
-- integration spec (ctgov-marker-precision-over-time group 6).
-- ---------------------------------------------------------------------------
do $$
begin
  if public._phase_label_from_type('P3') is distinct from 'Phase 3' then
    raise exception 'QA-002 SMOKE FAIL: P3 -> %, expected Phase 3',
      public._phase_label_from_type('P3');
  end if;
  if public._phase_label_from_type('P1') is distinct from 'Phase 1' then
    raise exception 'QA-002 SMOKE FAIL: P1 -> %, expected Phase 1',
      public._phase_label_from_type('P1');
  end if;
  if public._phase_label_from_type('OBS') is distinct from 'Observational' then
    raise exception 'QA-002 SMOKE FAIL: OBS -> %, expected Observational',
      public._phase_label_from_type('OBS');
  end if;
  if public._phase_label_from_type(null) is not null then
    raise exception 'QA-002 SMOKE FAIL: null phase_type must map to null phase';
  end if;
  if public._phase_label_from_type('NOPE') is not null then
    raise exception 'QA-002 SMOKE FAIL: unknown code must map to null phase';
  end if;
  raise notice 'QA-002 SMOKE PASS: _phase_label_from_type maps codes to human labels';
end;
$$;

notify pgrst, 'reload schema';
