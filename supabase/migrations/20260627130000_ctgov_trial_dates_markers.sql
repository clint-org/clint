-- ============================================================================
-- CT.gov trial-dates + marker-precision (combined Workstream A + B, DB layer)
-- ============================================================================
-- Spec: docs/specs/ctgov-trial-dates/spec.md
--
-- Workstream A (precision + drift fix):
--   * new _ctgov_resolve_partial_date(text) midpoint resolver (month -> YYYY-MM-15,
--     year -> YYYY-07-01), pinned to precisionMidpointISO in the TS layer.
--   * _seed_ctgov_markers becomes precision-native + a source-aware UPSERT with an
--     adoption step (was a create-once exists-guard that dropped partial dates).
--   * _log_marker_change labels emitted events 'ctgov' when the seeder GUC is set.
--
-- Workstream B (markers become the source of truth):
--   * markers are now the sole writer of trial date truth; the four
--     trials.phase_start_date / phase_end_date / *_source columns are DROPPED.
--   * readers/writers stop touching those columns; the phase-field guard is
--     slimmed to phase_type only; a new BEFORE UPDATE/DELETE lock on markers
--     enforces the ct.gov-wins ownership model the columns used to carry.
--
-- Ordering (strict): new helpers -> log/seed rewrites -> write paths -> readers
-- -> guard slim -> marker lock trigger -> DROP columns LAST -> smoke -> reload.
-- Every function below is re-stated from its LIVE definition (pg_get_functiondef),
-- never an older migration copy, to avoid stale-base clobber.
-- ============================================================================


-- ----------------------------------------------------------------------------
-- (a) NEW: _ctgov_resolve_partial_date(text) -> (resolved date, precision text)
--     CT.gov only emits exact (YYYY-MM-DD), month (YYYY-MM) or year (YYYY).
--     Midpoints pinned to precisionMidpointISO (month -> -15, year -> -07-01).
-- ----------------------------------------------------------------------------
create or replace function public._ctgov_resolve_partial_date(p_text text)
returns table (resolved date, "precision" text)
language sql
immutable
set search_path = ''
as $function$
  select
    case
      when p_text ~ '^\d{4}-\d{2}-\d{2}$' then p_text::date
      when p_text ~ '^\d{4}-\d{2}$'       then (p_text || '-15')::date
      when p_text ~ '^\d{4}$'             then (p_text || '-07-01')::date
      else null
    end,
    case
      when p_text ~ '^\d{4}-\d{2}-\d{2}$' then 'exact'
      when p_text ~ '^\d{4}-\d{2}$'       then 'month'
      when p_text ~ '^\d{4}$'             then 'year'
      else null
    end;
$function$;


-- ----------------------------------------------------------------------------
-- (b) _log_marker_change(): GUC-driven event source.
--     Re-stated from live (20260502120700). Only change: read the source from
--     clint.ctgov_seeding ('ctgov' while the seeder runs, else 'analyst') and
--     pass it to _emit_events_from_marker_change (which already takes p_source).
-- ----------------------------------------------------------------------------
create or replace function public._log_marker_change()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_audit_id    uuid;
  v_old_payload jsonb;
  v_new_payload jsonb;
  v_changed_by  uuid;
  v_source      varchar(20);
begin
  v_changed_by := auth.uid();
  v_source := case
    when current_setting('clint.ctgov_seeding', true) = 'on' then 'ctgov'
    else 'analyst'
  end;

  if tg_op = 'INSERT' then
    v_new_payload := jsonb_build_object(
      'event_date',     new.event_date,
      'end_date',       new.end_date,
      'title',          new.title,
      'projection',     new.projection,
      'marker_type_id', new.marker_type_id,
      'description',    new.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      new.id, new.space_id, 'created', null, v_new_payload, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id, v_source);
    return new;

  elsif tg_op = 'UPDATE' then
    -- short-circuit when no material field changed. is distinct from
    -- handles nulls in either side.
    if new.event_date     is not distinct from old.event_date
       and new.end_date   is not distinct from old.end_date
       and new.title      is not distinct from old.title
       and new.projection is not distinct from old.projection
       and new.marker_type_id is not distinct from old.marker_type_id
       and new.description is not distinct from old.description then
      return new;
    end if;

    v_old_payload := jsonb_build_object(
      'event_date',     old.event_date,
      'end_date',       old.end_date,
      'title',          old.title,
      'projection',     old.projection,
      'marker_type_id', old.marker_type_id,
      'description',    old.description
    );
    v_new_payload := jsonb_build_object(
      'event_date',     new.event_date,
      'end_date',       new.end_date,
      'title',          new.title,
      'projection',     new.projection,
      'marker_type_id', new.marker_type_id,
      'description',    new.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      new.id, new.space_id, 'updated', v_old_payload, v_new_payload, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id, v_source);
    return new;

  elsif tg_op = 'DELETE' then
    v_old_payload := jsonb_build_object(
      'event_date',     old.event_date,
      'end_date',       old.end_date,
      'title',          old.title,
      'projection',     old.projection,
      'marker_type_id', old.marker_type_id,
      'description',    old.description
    );

    insert into public.marker_changes (
      marker_id, space_id, change_type, old_values, new_values, changed_by, changed_at
    ) values (
      old.id, old.space_id, 'deleted', v_old_payload, null, v_changed_by, now()
    )
    returning id into v_audit_id;

    perform public._emit_events_from_marker_change(v_audit_id, v_source);
    return old;
  end if;

  return null;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (c-helper) NEW internal: _seed_ctgov_marker_upsert(...) -> boolean
--     One marker type's source-aware UPSERT-with-adoption. Returns true if a
--     marker was created or updated. Keeps _seed_ctgov_markers DRY across the
--     three system marker types. Assumes the caller has set the
--     clint.ctgov_seeding GUC 'on' so steady-state updates to ct.gov-owned
--     markers pass the marker lock trigger.
--
--     Priority (spec A2 step 3):
--       (a) ct.gov-owned marker of this type exists -> UPDATE it.
--       (b) exactly ONE un-owned marker of this type exists -> ADOPT it
--           (re-stamp metadata.source='ctgov', preserving other keys).
--       (c) otherwise (0, or 2+ un-owned) -> INSERT a new ct.gov-owned marker.
--     null resolved date -> no-op (leave any existing ct.gov marker untouched).
-- ----------------------------------------------------------------------------
create or replace function public._seed_ctgov_marker_upsert(
  p_trial_id       uuid,
  p_space_id       uuid,
  p_created_by     uuid,
  p_marker_type_id uuid,
  p_title          text,
  p_field          text,
  p_source_url     text,
  p_date_string    text,
  p_date_type      text,
  p_snapshot_id    uuid
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_event_date date;
  v_precision  text;
  v_date_type  text;
  v_projection text;
  v_marker_id  uuid;
  v_unowned    uuid[];
begin
  select resolved, "precision"
    into v_event_date, v_precision
    from public._ctgov_resolve_partial_date(p_date_string);

  if v_event_date is null then
    return false;  -- unparseable/absent: leave existing markers untouched.
  end if;

  v_date_type  := upper(coalesce(nullif(p_date_type, ''), 'ANTICIPATED'));
  v_projection := case when v_date_type = 'ACTUAL' then 'actual' else 'company' end;

  -- (a) steady-state: a ct.gov-owned marker of this type already exists.
  select m.id
    into v_marker_id
    from public.marker_assignments ma
    join public.markers m on m.id = ma.marker_id
   where ma.trial_id = p_trial_id
     and m.marker_type_id = p_marker_type_id
     and m.metadata->>'source' = 'ctgov'
   limit 1;

  if v_marker_id is not null then
    update public.markers
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           metadata       = coalesce(metadata, '{}'::jsonb)
                            || jsonb_build_object(
                                 'snapshot_id',     p_snapshot_id,
                                 'ctgov_date_type', v_date_type
                               )
     where id = v_marker_id;
    return true;
  end if;

  -- (b) adoption: exactly one un-owned marker of this type for this trial.
  select array_agg(m.id)
    into v_unowned
    from public.marker_assignments ma
    join public.markers m on m.id = ma.marker_id
   where ma.trial_id = p_trial_id
     and m.marker_type_id = p_marker_type_id
     and (m.metadata->>'source' is null or m.metadata->>'source' <> 'ctgov');

  if array_length(v_unowned, 1) = 1 then
    -- Adoption updates source + date/precision/projection (+ metadata) only.
    -- Preserve any analyst-authored description and source_url; fall back to the
    -- ct.gov defaults only when the adopted marker has none.
    update public.markers
       set event_date     = v_event_date,
           date_precision = v_precision,
           projection     = v_projection,
           source_url     = coalesce(source_url, p_source_url),
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

  -- (c) insert a fresh ct.gov-owned marker (+ assignment).
  insert into public.markers (
    space_id, marker_type_id, title, projection, event_date, date_precision,
    description, source_url, metadata, created_by
  ) values (
    p_space_id, p_marker_type_id, p_title, v_projection, v_event_date, v_precision,
    'Auto-derived from clinicaltrials.gov',
    p_source_url,
    jsonb_build_object(
      'source',          'ctgov',
      'field',           p_field,
      'snapshot_id',     p_snapshot_id,
      'ctgov_date_type', v_date_type
    ),
    p_created_by
  )
  returning id into v_marker_id;

  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, p_trial_id);

  return true;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (c) _seed_ctgov_markers(): precision-native + source-aware UPSERT + GUC.
--     Re-stated from live (20260503060000). Was create-once + _safe_iso_date
--     (dropped partials, never set date_precision). Now resolves precision via
--     _ctgov_resolve_partial_date and upserts/adopts via the helper above, with
--     clint.ctgov_seeding scoped around the writes so emitted events are
--     correctly sourced 'ctgov'. Returns count created OR updated.
-- ----------------------------------------------------------------------------
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
  v_source_url  text;
  v_count       int := 0;

  c_start_id    constant uuid := 'a0000000-0000-0000-0000-000000000011';
  c_pcd_id      constant uuid := 'a0000000-0000-0000-0000-000000000008';
  c_end_id      constant uuid := 'a0000000-0000-0000-0000-000000000012';
begin
  select space_id, created_by, identifier
    into v_space_id, v_created_by, v_nct
    from public.trials
   where id = p_trial_id;

  -- markers.created_by is NOT NULL with FK to auth.users; the worker is anon
  -- and auth.uid() is null here, so the only reliable identity is the analyst
  -- who created the trial.
  if v_created_by is null then
    return 0;
  end if;

  v_source_url := case
    when v_nct is not null and v_nct <> ''
      then 'https://clinicaltrials.gov/study/' || v_nct
    else null
  end;

  -- scope the GUC to the seeder's own writes so later same-transaction analyst
  -- writes are not mislabeled, and steady-state updates pass the marker lock.
  perform set_config('clint.ctgov_seeding', 'on', true);

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_start_id, 'Trial Start',
       'startDateStruct.date', v_source_url,
       p_payload #>> '{protocolSection,statusModule,startDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,startDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_pcd_id, 'Primary Completion Date (PCD)',
       'primaryCompletionDateStruct.date', v_source_url,
       p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  if public._seed_ctgov_marker_upsert(
       p_trial_id, v_space_id, v_created_by, c_end_id, 'Trial End',
       'completionDateStruct.date', v_source_url,
       p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}',
       p_payload #>> '{protocolSection,statusModule,completionDateStruct,type}',
       p_snapshot_id) then
    v_count := v_count + 1;
  end if;

  perform set_config('clint.ctgov_seeding', 'off', true);

  return v_count;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (d) NEW internal: _create_trial_date_markers(...) -> void
--     Creates analyst-owned (un-owned) Trial Start / Trial End markers from
--     phase dates supplied on the create/import paths. Callable WITHOUT
--     auth.uid() (create_marker requires it + has_space_access and rejects the
--     ingest path). Projection derives from the date vs today (past -> actual,
--     future -> company). metadata.source = 'analyst' keeps it un-owned, so the
--     first ct.gov sync ADOPTS it (no duplicate) and the analyst can edit it
--     until then.
-- ----------------------------------------------------------------------------
create or replace function public._create_trial_date_markers(
  p_trial_id   uuid,
  p_space_id   uuid,
  p_created_by uuid,
  p_start_date date,
  p_end_date   date
)
returns void
language plpgsql
security definer
set search_path = ''
as $function$
declare
  v_marker_id uuid;
  c_start_id  constant uuid := 'a0000000-0000-0000-0000-000000000011';
  c_end_id    constant uuid := 'a0000000-0000-0000-0000-000000000012';
begin
  if p_created_by is null then
    return;  -- markers.created_by is NOT NULL.
  end if;

  if p_start_date is not null then
    insert into public.markers (
      space_id, marker_type_id, title, projection, event_date, date_precision,
      metadata, created_by
    ) values (
      p_space_id, c_start_id, 'Trial Start',
      case when p_start_date <= current_date then 'actual' else 'company' end,
      p_start_date, 'exact',
      jsonb_build_object('source', 'analyst'),
      p_created_by
    )
    returning id into v_marker_id;

    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker_id, p_trial_id);
  end if;

  if p_end_date is not null then
    insert into public.markers (
      space_id, marker_type_id, title, projection, event_date, date_precision,
      metadata, created_by
    ) values (
      p_space_id, c_end_id, 'Trial End',
      case when p_end_date <= current_date then 'actual' else 'company' end,
      p_end_date, 'exact',
      jsonb_build_object('source', 'analyst'),
      p_created_by
    )
    returning id into v_marker_id;

    insert into public.marker_assignments (marker_id, trial_id)
      values (v_marker_id, p_trial_id);
  end if;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (e) _materialize_trial_from_snapshot(): stop writing the date columns.
--     Re-stated from live (20260625190000). Keeps phase / phase_type derivation
--     (and the phase_changed event + materialize GUC bypass for the phase_type
--     lock) but no longer writes phase_start_date / phase_end_date / *_source
--     (dropped) and no longer emits phase_start_changed / phase_end_changed
--     (the marker UPSERT is now the sole emitter of trial-date events).
-- ----------------------------------------------------------------------------
create or replace function public._materialize_trial_from_snapshot(p_trial_id uuid, p_payload jsonb)
 returns void
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  v_phase                text;
  v_phase_type           text;
  v_recruitment          text;
  v_status               text;
  v_study_type           text;
  v_last_update_date     date;
  v_acronym              text;
  v_prev_phase_type      text;
  v_prev_phase_type_src  text;
  v_space_id             uuid;
  v_now                  timestamptz := now();
  v_occurred             timestamptz;
begin
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_phase_type       := public._derive_phase_type(
                          p_payload #> '{protocolSection,designModule,phases}',
                          v_study_type
                        );
  v_status           := public._derive_status(v_recruitment);
  v_last_update_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}');
  v_acronym          := nullif(trim(p_payload #>> '{protocolSection,identificationModule,acronym}'), '');
  v_occurred         := coalesce(v_last_update_date::timestamptz, v_now);

  select phase_type, phase_type_source, space_id
    into v_prev_phase_type, v_prev_phase_type_src, v_space_id
    from public.trials where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'on', true);

  update public.trials
     set phase                   = coalesce(v_phase, phase),
         phase_type              = coalesce(v_phase_type, phase_type),
         phase_type_source       = case when v_phase_type is not null then 'ctgov' else phase_type_source end,
         status                  = coalesce(status, v_status),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         acronym                 = coalesce(v_acronym, acronym),
         ctgov_last_synced_at    = v_now
   where id = p_trial_id;

  perform set_config('clint.materialize_in_progress', 'off', true);

  if v_prev_phase_type is not null and v_phase_type is not null and v_phase_type <> v_prev_phase_type then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_type',
        'old_value',  to_jsonb(v_prev_phase_type),
        'new_value',  to_jsonb(v_phase_type),
        'old_source', to_jsonb(v_prev_phase_type_src)
      ),
      v_occurred);
  end if;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (f) create_trial(): phase dates now create analyst-owned Trial Start/End
--     markers via _create_trial_date_markers instead of writing the dropped
--     columns. Signature is unchanged (p_phase_start_date / p_phase_end_date
--     remain) so all three import paths stay uniform. Re-stated from live
--     (20260607140000); only the trial INSERT column list + the new helper call
--     changed.
-- ----------------------------------------------------------------------------
create or replace function public.create_trial(p_space_id uuid, p_asset_id uuid, p_name text, p_identifier text DEFAULT NULL::text, p_status text DEFAULT NULL::text, p_phase_type text DEFAULT NULL::text, p_phase_start_date date DEFAULT NULL::date, p_phase_end_date date DEFAULT NULL::date, p_indication_name text DEFAULT NULL::text, p_source_doc_id uuid DEFAULT NULL::uuid, p_indication_names text[] DEFAULT NULL::text[])
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

  -- phase dates become analyst-owned Trial Start / Trial End markers (the bar
  -- now derives from markers). Un-owned so the first ct.gov sync adopts them.
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

-- NOTE: commit_source_import is intentionally NOT re-stated. Its live body
-- references the strings 'phase_start_date'/'phase_end_date' only as JSON keys
-- (v_item->>'phase_start_date') and passes the resulting date values to
-- create_trial, which now turns them into analyst-owned markers. It never
-- references the trials columns, so the DROP below does not break it, and
-- letting create_trial own marker creation keeps all three import paths uniform
-- (avoids double-creating Trial Start/End markers).


-- ----------------------------------------------------------------------------
-- (h) Demo seed: _seed_demo_trials() seeds Trial Start/End markers instead of
--     the dropped date columns; seed_demo_data() drops the *_date_source
--     backfill (keeps phase_type_source). Re-stated from live (20260524120900).
-- ----------------------------------------------------------------------------
create or replace function public._seed_demo_trials(p_space_id uuid, p_uid uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  p_mounjaro uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_ozempic uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_kerendia uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_vyndaqel uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388 uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_maritide uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  cond_hf uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hf');
  cond_hfref uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hfref');
  cond_hfpef uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hfpef');
  cond_ckd uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_ckd');
  cond_t2d uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_t2d');
  cond_obesity uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_obesity');
  cond_attr_cm uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_attr_cm');
  cond_cv uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_cv');
  cond_hcm uuid := (select id from _seed_ids where entity_type = 'cond' and key = 'cond_hcm');

  t_surmount_1 uuid := gen_random_uuid(); t_surpass_2 uuid := gen_random_uuid();
  t_step_1 uuid := gen_random_uuid(); t_select uuid := gen_random_uuid();
  t_dapa_hf uuid := gen_random_uuid(); t_emperor_reduced uuid := gen_random_uuid();
  t_explorer_hcm uuid := gen_random_uuid(); t_paradigm_hf uuid := gen_random_uuid();
  t_attr_act uuid := gen_random_uuid(); t_attribute_cm uuid := gen_random_uuid();
  t_surmount_mmo uuid := gen_random_uuid(); t_summit uuid := gen_random_uuid();
  t_surmount_osa uuid := gen_random_uuid(); t_attain_1 uuid := gen_random_uuid();
  t_achieve_1 uuid := gen_random_uuid(); t_triumph_1 uuid := gen_random_uuid();
  t_flow uuid := gen_random_uuid(); t_redefine_1 uuid := gen_random_uuid();
  t_redefine_2 uuid := gen_random_uuid(); t_soul uuid := gen_random_uuid();
  t_deliver uuid := gen_random_uuid(); t_dapa_ckd uuid := gen_random_uuid();
  t_emperor_preserved uuid := gen_random_uuid(); t_empa_kidney uuid := gen_random_uuid();
  t_empact_mi uuid := gen_random_uuid(); t_survodutide_p2 uuid := gen_random_uuid();
  t_fineart_hf uuid := gen_random_uuid(); t_sequoia_hcm uuid := gen_random_uuid();
  t_maple_hcm uuid := gen_random_uuid(); t_acacia_hcm uuid := gen_random_uuid();
  t_odyssey_hcm uuid := gen_random_uuid(); t_ct388_p2 uuid := gen_random_uuid();
  t_vk2735_sc_p2 uuid := gen_random_uuid(); t_vk2735_oral_p2 uuid := gen_random_uuid();
  t_maritide_p2 uuid := gen_random_uuid(); t_danuglipron_p2 uuid := gen_random_uuid();

  v_demo  record;
begin
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier,
    status, display_order, phase_type) values
    (t_surmount_1,      p_space_id, p_uid, p_zepbound,    'SURMOUNT-1',      'NCT04184622',  'Completed', 1, 'P3'),
    (t_surpass_2,       p_space_id, p_uid, p_mounjaro,    'SURPASS-2',       'NCT03987919',  'Completed', 1, 'P3'),
    (t_step_1,          p_space_id, p_uid, p_wegovy,      'STEP 1',          'NCT03548935',  'Completed', 1, 'P3'),
    (t_select,          p_space_id, p_uid, p_wegovy,      'SELECT',          'NCT03574597',  'Completed', 2, 'P3'),
    (t_dapa_hf,         p_space_id, p_uid, p_farxiga,     'DAPA-HF',         'NCT03036124',  'Completed', 1, 'P3'),
    (t_emperor_reduced, p_space_id, p_uid, p_jardiance,   'EMPEROR-Reduced', 'NCT03057977',  'Completed', 1, 'P3'),
    (t_explorer_hcm,    p_space_id, p_uid, p_camzyos,     'EXPLORER-HCM',    'NCT03470545',  'Completed', 1, 'P3'),
    (t_paradigm_hf,     p_space_id, p_uid, p_entresto,    'PARADIGM-HF',     'NCT01035255',  'Terminated', 1, 'P3'),
    (t_attr_act,        p_space_id, p_uid, p_vyndaqel,    'ATTR-ACT',        'NCT01994889',  'Completed', 1, 'P3'),
    (t_attribute_cm,    p_space_id, p_uid, p_attruby,     'ATTRibute-CM',    'NCT03860935',  'Completed', 1, 'P3');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier,
    status, display_order, phase_type) values
    (t_surmount_mmo,    p_space_id, p_uid, p_zepbound,    'SURMOUNT-MMO',    'NCT05556512', 'Active, not recruiting', 3, 'P3'),
    (t_summit,          p_space_id, p_uid, p_zepbound,    'SUMMIT',          'NCT04847557', 'Completed', 4, 'P3'),
    (t_surmount_osa,    p_space_id, p_uid, p_zepbound,    'SURMOUNT-OSA',    'NCT05412004', 'Completed', 5, 'P3'),
    (t_attain_1,        p_space_id, p_uid, p_orforglipron,'ATTAIN-1',        'NCT05869903', 'Active, not recruiting', 6, 'P3'),
    (t_achieve_1,       p_space_id, p_uid, p_orforglipron,'ACHIEVE-1',       'NCT05971940', 'Completed', 7, 'P3'),
    (t_triumph_1,       p_space_id, p_uid, p_retatrutide, 'TRIUMPH-1',       'NCT05929066', 'Active, not recruiting', 8, 'P3'),
    (t_flow,            p_space_id, p_uid, p_ozempic,     'FLOW',            'NCT03819153', 'Completed', 4, 'P3'),
    (t_redefine_1,      p_space_id, p_uid, p_cagrisema,   'REDEFINE-1',      'NCT05567796', 'Active, not recruiting', 5, 'P3'),
    (t_redefine_2,      p_space_id, p_uid, p_cagrisema,   'REDEFINE-2',      'NCT05394519', 'Completed', 6, 'P3'),
    (t_soul,            p_space_id, p_uid, p_rybelsus,    'SOUL',            'NCT03914326', 'Completed', 7, 'P3'),
    (t_deliver,         p_space_id, p_uid, p_farxiga,     'DELIVER',         'NCT03619213', 'Completed', 2, 'P3'),
    (t_dapa_ckd,        p_space_id, p_uid, p_farxiga,     'DAPA-CKD',        'NCT03036150', 'Completed', 3, 'P3'),
    (t_emperor_preserved, p_space_id, p_uid, p_jardiance, 'EMPEROR-Preserved','NCT03057951','Completed', 2, 'P3'),
    (t_empa_kidney,     p_space_id, p_uid, p_jardiance,   'EMPA-KIDNEY',     'NCT03594110', 'Completed', 3, 'P3'),
    (t_empact_mi,       p_space_id, p_uid, p_jardiance,   'EMPACT-MI',       'NCT04509674', 'Completed', 4, 'P3'),
    (t_survodutide_p2,  p_space_id, p_uid, p_survodutide, 'Survodutide P2',  'NCT04667377', 'Completed', 1, 'P2'),
    (t_fineart_hf,      p_space_id, p_uid, p_kerendia,    'FINEARTS-HF',     'NCT04435626', 'Completed', 2, 'P3'),
    (t_sequoia_hcm,     p_space_id, p_uid, p_aficamten,   'SEQUOIA-HCM',     'NCT05186818', 'Completed', 1, 'P3'),
    (t_maple_hcm,       p_space_id, p_uid, p_aficamten,   'MAPLE-HCM',       'NCT05767346', 'Completed', 2, 'P3'),
    (t_acacia_hcm,      p_space_id, p_uid, p_aficamten,   'ACACIA-HCM',      'NCT06081894', 'Active, not recruiting', 3, 'P3'),
    (t_odyssey_hcm,     p_space_id, p_uid, p_camzyos,     'ODYSSEY-HCM',     'NCT05582395', 'Completed', 2, 'P3'),
    (t_ct388_p2,        p_space_id, p_uid, p_ct388,       'CT-388 P2',       'NCT06525935', 'Completed', 1, 'P2'),
    (t_vk2735_sc_p2,    p_space_id, p_uid, p_vk2735_sc,   'VK2735 SC P2',    'NCT06068946', 'Completed', 1, 'P2'),
    (t_vk2735_oral_p2,  p_space_id, p_uid, p_vk2735_oral, 'VK2735 oral P2',  'NCT06828055', 'Completed', 2, 'P2'),
    (t_maritide_p2,     p_space_id, p_uid, p_maritide,    'MariTide P2',     'NCT05669599', 'Completed', 1, 'P2'),
    (t_danuglipron_p2,  p_space_id, p_uid, p_danuglipron, 'Danuglipron P2',  'NCT04882961', 'Terminated', 1, 'P2');

  insert into _seed_ids (entity_type, key, id) values
    ('trial', 't_surmount_1', t_surmount_1), ('trial', 't_surpass_2', t_surpass_2),
    ('trial', 't_step_1', t_step_1), ('trial', 't_select', t_select),
    ('trial', 't_dapa_hf', t_dapa_hf), ('trial', 't_emperor_reduced', t_emperor_reduced),
    ('trial', 't_explorer_hcm', t_explorer_hcm), ('trial', 't_paradigm_hf', t_paradigm_hf),
    ('trial', 't_attr_act', t_attr_act), ('trial', 't_attribute_cm', t_attribute_cm),
    ('trial', 't_surmount_mmo', t_surmount_mmo), ('trial', 't_summit', t_summit),
    ('trial', 't_surmount_osa', t_surmount_osa), ('trial', 't_attain_1', t_attain_1),
    ('trial', 't_achieve_1', t_achieve_1), ('trial', 't_triumph_1', t_triumph_1),
    ('trial', 't_flow', t_flow), ('trial', 't_redefine_1', t_redefine_1),
    ('trial', 't_redefine_2', t_redefine_2), ('trial', 't_soul', t_soul),
    ('trial', 't_deliver', t_deliver), ('trial', 't_dapa_ckd', t_dapa_ckd),
    ('trial', 't_emperor_preserved', t_emperor_preserved), ('trial', 't_empa_kidney', t_empa_kidney),
    ('trial', 't_empact_mi', t_empact_mi), ('trial', 't_survodutide_p2', t_survodutide_p2),
    ('trial', 't_fineart_hf', t_fineart_hf), ('trial', 't_sequoia_hcm', t_sequoia_hcm),
    ('trial', 't_maple_hcm', t_maple_hcm), ('trial', 't_acacia_hcm', t_acacia_hcm),
    ('trial', 't_odyssey_hcm', t_odyssey_hcm), ('trial', 't_ct388_p2', t_ct388_p2),
    ('trial', 't_vk2735_sc_p2', t_vk2735_sc_p2), ('trial', 't_vk2735_oral_p2', t_vk2735_oral_p2),
    ('trial', 't_maritide_p2', t_maritide_p2), ('trial', 't_danuglipron_p2', t_danuglipron_p2);

  -- The phase bar now derives from Trial Start / Trial End markers, so seed them
  -- per demo trial (was the phase_start_date / phase_end_date columns). Created
  -- analyst-owned (un-owned) so demo data carries no ct.gov lock; null end =
  -- ongoing (no Trial End marker), matching the old null phase_end_date.
  for v_demo in
    select * from (values
      (t_surmount_1,      date '2019-12-04', date '2022-04-01'),
      (t_surpass_2,       date '2019-07-30', date '2021-01-28'),
      (t_step_1,          date '2018-06-04', date '2020-03-30'),
      (t_select,          date '2018-10-24', date '2023-06-21'),
      (t_dapa_hf,         date '2017-02-08', date '2019-07-17'),
      (t_emperor_reduced, date '2017-03-06', date '2020-05-01'),
      (t_explorer_hcm,    date '2018-05-29', date '2020-03-14'),
      (t_paradigm_hf,     date '2009-12-08', date '2014-05-31'),
      (t_attr_act,        date '2013-12-09', date '2018-02-07'),
      (t_attribute_cm,    date '2019-03-19', date '2023-05-11'),
      (t_surmount_mmo,    date '2022-10-11', null::date),
      (t_summit,          date '2021-04-20', date '2024-07-02'),
      (t_surmount_osa,    date '2022-06-21', date '2024-03-12'),
      (t_attain_1,        date '2023-06-05', date '2025-07-25'),
      (t_achieve_1,       date '2023-08-09', date '2025-04-03'),
      (t_triumph_1,       date '2023-07-10', null::date),
      (t_flow,            date '2019-06-17', date '2024-01-09'),
      (t_redefine_1,      date '2022-11-01', date '2024-10-30'),
      (t_redefine_2,      date '2023-02-01', date '2025-01-28'),
      (t_soul,            date '2019-06-17', date '2024-08-23'),
      (t_deliver,         date '2018-08-27', date '2022-03-27'),
      (t_dapa_ckd,        date '2017-02-02', date '2020-06-12'),
      (t_emperor_preserved, date '2017-03-02', date '2021-04-26'),
      (t_empa_kidney,     date '2019-01-31', date '2022-07-05'),
      (t_empact_mi,       date '2020-12-16', date '2023-11-05'),
      (t_survodutide_p2,  date '2021-03-08', date '2022-09-15'),
      (t_fineart_hf,      date '2020-09-14', date '2024-05-15'),
      (t_sequoia_hcm,     date '2022-02-01', date '2023-11-10'),
      (t_maple_hcm,       date '2023-06-20', date '2025-02-28'),
      (t_acacia_hcm,      date '2023-08-30', null::date),
      (t_odyssey_hcm,     date '2022-12-14', date '2025-03-06'),
      (t_ct388_p2,        date '2024-08-16', date '2025-12-08'),
      (t_vk2735_sc_p2,    date '2023-08-31', date '2024-02-27'),
      (t_vk2735_oral_p2,  date '2024-12-18', date '2025-06-24'),
      (t_maritide_p2,     date '2023-01-18', date '2024-10-08'),
      (t_danuglipron_p2,  date '2021-01-29', date '2023-09-13')
    ) as d(trial_id, start_date, end_date)
  loop
    perform public._create_trial_date_markers(
      v_demo.trial_id, p_space_id, p_uid, v_demo.start_date, v_demo.end_date
    );
  end loop;

  -- link trials to conditions
  insert into public.trial_conditions (trial_id, condition_id, source) values
    (t_surmount_1, cond_obesity, 'ctgov'), (t_surpass_2, cond_t2d, 'ctgov'),
    (t_step_1, cond_obesity, 'ctgov'), (t_select, cond_obesity, 'ctgov'),
    (t_select, cond_cv, 'ctgov'),
    (t_dapa_hf, cond_hf, 'ctgov'), (t_dapa_hf, cond_hfref, 'ctgov'),
    (t_emperor_reduced, cond_hf, 'ctgov'), (t_emperor_reduced, cond_hfref, 'ctgov'),
    (t_explorer_hcm, cond_hcm, 'ctgov'), (t_paradigm_hf, cond_hf, 'ctgov'),
    (t_attr_act, cond_attr_cm, 'ctgov'), (t_attribute_cm, cond_attr_cm, 'ctgov'),
    (t_surmount_mmo, cond_obesity, 'ctgov'), (t_summit, cond_hf, 'ctgov'),
    (t_surmount_osa, cond_obesity, 'ctgov'),
    (t_attain_1, cond_obesity, 'ctgov'), (t_achieve_1, cond_t2d, 'ctgov'),
    (t_triumph_1, cond_obesity, 'ctgov'), (t_flow, cond_ckd, 'ctgov'),
    (t_redefine_1, cond_obesity, 'ctgov'), (t_redefine_2, cond_obesity, 'ctgov'),
    (t_soul, cond_t2d, 'ctgov'),
    (t_deliver, cond_hf, 'ctgov'), (t_deliver, cond_hfpef, 'ctgov'),
    (t_dapa_ckd, cond_ckd, 'ctgov'),
    (t_emperor_preserved, cond_hf, 'ctgov'), (t_emperor_preserved, cond_hfpef, 'ctgov'),
    (t_empa_kidney, cond_ckd, 'ctgov'), (t_empact_mi, cond_hf, 'ctgov'),
    (t_survodutide_p2, cond_obesity, 'ctgov'),
    (t_fineart_hf, cond_hf, 'ctgov'),
    (t_sequoia_hcm, cond_hcm, 'ctgov'), (t_maple_hcm, cond_hcm, 'ctgov'),
    (t_acacia_hcm, cond_hcm, 'ctgov'), (t_odyssey_hcm, cond_hcm, 'ctgov'),
    (t_ct388_p2, cond_obesity, 'ctgov'),
    (t_vk2735_sc_p2, cond_obesity, 'ctgov'), (t_vk2735_oral_p2, cond_obesity, 'ctgov'),
    (t_maritide_p2, cond_obesity, 'ctgov'), (t_danuglipron_p2, cond_obesity, 'ctgov');
end;
$function$;


create or replace function public.seed_demo_data(p_space_id uuid)
 returns void
 language plpgsql
 set search_path to ''
as $function$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data' using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id and user_id = uid and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data' using errcode = '42501';
  end if;

  select count(*) into existing_count from public.companies where space_id = p_space_id;
  if existing_count > 0 then return; end if;

  create temp table if not exists _seed_ids (
    entity_type text not null, key text not null, id uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_indications(p_space_id, uid);
  perform public._seed_demo_assets(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_asset_indications(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
  perform public._seed_demo_recent_activity(p_space_id, uid);
  perform public._seed_demo_activity_variety(p_space_id, uid);

  -- phase_type_source still lives on trials; the phase date *_source columns are
  -- dropped (date ownership now lives on the markers via metadata.source).
  update public.trials
     set phase_type_source = case
           when phase_type is null then null
           when identifier is null then 'analyst'
           else 'ctgov'
         end
   where space_id = p_space_id;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (i) Reader: get_dashboard_data() stops projecting the date columns.
--     Re-stated from live (20260616120100). The phase_data object changed
--     (drops phase_start_date / phase_end_date; keeps phase_type). The per-trial
--     markers array now ALSO emits the flat 'marker_type_id' alongside the
--     nested 'marker_type' object: the client phase bar derives its span via
--     deriveTrialPhaseSpan (trial-phase-span.ts), which matches markers on the
--     flat marker_type_id field (the Marker model column). DashboardService maps
--     the RPC marker with a `...m` spread, so without the flat field the client
--     marker would lack marker_type_id and every phase bar on the dashboard /
--     landscape / pptx-export (all get_dashboard_data-sourced) would silently
--     fail to render. The TrialService path (get_trial(s) -> normalizeTrial)
--     already carries the flat column via marker_assignments.markers.*.
--     Other readers (get_bullseye_*, get_landscape_index_*, preview_*_delete,
--     get_events_page_data, get_bullseye_assets) do NOT reference these columns
--     in their live bodies, so they are intentionally left untouched.
-- ----------------------------------------------------------------------------
create or replace function public.get_dashboard_data(p_space_id uuid, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer, p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[], p_phases text[] DEFAULT NULL::text[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[])
 returns jsonb
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  result jsonb;
begin
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'assets', coalesce((
        select jsonb_agg(asset_obj order by a.display_order)
        from public.assets a
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action am
              join public.mechanisms_of_action m on m.id = am.moa_id
              where am.asset_id = a.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration ar
              join public.routes_of_administration r on r.id = ar.roa_id
              where ar.asset_id = a.id
            ), '[]'::jsonb),
            'indications', coalesce((
              select jsonb_agg(indication_obj order by ind.display_order, ind.name)
              from public.asset_indications ai
              join public.indications ind on ind.id = ai.indication_id
              cross join lateral (
                select jsonb_build_object(
                  'id', ind.id,
                  'name', ind.name,
                  'abbreviation', ind.abbreviation,
                  'development_status', ai.development_status,
                  'development_status_source', ai.development_status_source,
                  'trials', coalesce((
                    select jsonb_agg(trial_obj order by t.display_order)
                    from (
                      select distinct on (t.id) t.*
                      from public.trials t
                      join public.trial_assets ta on ta.trial_id = t.id
                      join public.trial_conditions tc on tc.trial_id = t.id
                      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                      where ta.asset_id = a.id
                        and t.space_id = p_space_id
                        and cim.indication_id = ind.id
                        and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                        and (p_study_types is null or t.study_type = any(p_study_types))
                        and (p_phases is null or t.phase_type = any(p_phases))
                      order by t.id
                    ) t
                    left join lateral (
                      with combined as (
                        select e.event_type::text as etype, e.observed_at as ets, e.id as eid
                        from public.trial_change_events e
                        where e.trial_id = t.id
                          and e.observed_at >= now() - public.recent_change_window()
                        union all
                        select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
                        from public.primary_intelligence pi
                        where pi.entity_type = 'trial'
                          and pi.entity_id = t.id
                          and pi.space_id = p_space_id
                          and pi.state = 'published'
                          and pi.updated_at >= now() - public.recent_change_window()
                      )
                      select
                        count(*)                                  as recent_changes_count,
                        (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
                        (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
                      from combined
                    ) recent on true
                    left join lateral (
                      select pi.headline
                      from public.primary_intelligence pi
                      where pi.entity_type = 'trial'
                        and pi.entity_id   = t.id
                        and pi.space_id    = p_space_id
                        and pi.state       = 'published'
                      order by pi.updated_at desc
                      limit 1
                    ) pi_trial on true
                    cross join lateral (
                      select jsonb_build_object(
                        'id', t.id,
                        'name', t.name,
                        'acronym', t.acronym,
                        'identifier', t.identifier,
                        'status', t.status,
                        'display_order', t.display_order,
                        'asset_id', t.asset_id,
                        'recruitment_status', t.recruitment_status,
                        'study_type', t.study_type,
                        'phase', t.phase,
                        'ctgov_last_synced_at', t.ctgov_last_synced_at,
                        'ctgov_withdrawn_at', t.ctgov_withdrawn_at,
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
                        'most_recent_change_event_id', recent.most_recent_change_event_id,
                        'has_intelligence', (pi_trial.headline is not null),
                        'intelligence_headline', pi_trial.headline,
                        'phase_data', case
                          when t.phase_type is not null then jsonb_build_object(
                            'phase_type', t.phase_type
                          )
                          else null
                        end,
                        'markers', coalesce((
                          select jsonb_agg(
                            jsonb_build_object(
                              'id',                 mk.id,
                              'marker_type_id',     mk.marker_type_id,
                              'title',              mk.title,
                              'projection',         mk.projection,
                              'event_date',         mk.event_date,
                              'date_precision',     mk.date_precision,
                              'end_date',           mk.end_date,
                              'end_date_precision', mk.end_date_precision,
                              'is_ongoing',         mk.is_ongoing,
                              'description',        mk.description,
                              'source_url',         mk.source_url,
                              'metadata',           mk.metadata,
                              'is_projected',       mk.is_projected,
                              'no_longer_expected', mk.no_longer_expected,
                              'marker_type', (
                                select jsonb_build_object(
                                  'id',            mt.id,
                                  'name',          mt.name,
                                  'shape',         mt.shape,
                                  'fill_style',    mt.fill_style,
                                  'color',         mt.color,
                                  'inner_mark',    mt.inner_mark,
                                  'category_id',   mt.category_id,
                                  'category_name', mc.name
                                )
                                from public.marker_types mt
                                left join public.marker_categories mc on mc.id = mt.category_id
                                where mt.id = mk.marker_type_id
                              )
                            )
                            order by mk.event_date
                          )
                          from public.marker_assignments ma
                          join public.markers mk on mk.id = ma.marker_id
                          where ma.trial_id = t.id
                            and mk.space_id = p_space_id
                            and (p_start_year is null or extract(year from mk.event_date) >= p_start_year)
                            and (p_end_year   is null or extract(year from mk.event_date) <= p_end_year)
                        ), '[]'::jsonb)
                      ) as trial_obj
                    ) as trial_lateral
                  ), '[]'::jsonb)
                ) as indication_obj
              ) as indication_lateral
              where ai.asset_id = a.id
                and ai.space_id = p_space_id
                and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
            ), '[]'::jsonb)
          ) as asset_obj
        ) as asset_lateral
        where a.company_id = c.id
          and a.space_id = p_space_id
          and (p_asset_ids is null or a.id = any(p_asset_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.asset_mechanisms_of_action am2
              where am2.asset_id = a.id
                and am2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.asset_routes_of_administration ar2
              where ar2.asset_id = a.id
                and ar2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (j) Slim the phase-field guard to phase_type only (its phase_start_date /
--     phase_end_date / *_source branches reference dropped columns).
--     Re-stated from live (20260521200200).
-- ----------------------------------------------------------------------------
create or replace function public._guard_ctgov_locked_phase_fields()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
begin
  -- bypass when materialize is the caller (set via transaction-local GUC)
  if current_setting('clint.materialize_in_progress', true) = 'on' then
    return new;
  end if;

  if new.phase_type is distinct from old.phase_type and old.phase_type_source = 'ctgov' then
    raise exception 'phase_type is managed by ct.gov for this trial; cannot update directly. Remove the NCT or wait for the next ct.gov sync.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (k) NEW: ct.gov marker edit/delete lock. There is no update_marker RPC --
--     marker edits go through direct .from('markers').update()/.delete() under
--     RLS -- so the ct.gov-wins ownership lock that the column guard used to
--     provide now lives in a BEFORE UPDATE/DELETE trigger on markers. An
--     analyst cannot edit or delete a ct.gov-owned marker (metadata.source =
--     'ctgov') unless the seeder/system bypass GUC is set. INSERT is unguarded
--     (analysts may create markers); adoption updates an un-owned marker
--     (OLD.source <> 'ctgov') so it passes regardless.
-- ----------------------------------------------------------------------------
create or replace function public._guard_ctgov_locked_markers()
 returns trigger
 language plpgsql
 security definer
 set search_path = ''
as $function$
begin
  -- system bypass: the seeder's steady-state updates and the cascade/orphan
  -- cleanup deletes set clint.ctgov_seeding so they pass. (No table refs in this
  -- body, so the hardened empty search_path needs no qualification changes.)
  if current_setting('clint.ctgov_seeding', true) = 'on' then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if old.metadata->>'source' = 'ctgov' then
    raise exception 'This marker is managed by ct.gov for this trial; cannot edit or delete directly. Remove the NCT or wait for the next ct.gov sync.'
      using errcode = 'P0001';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end;
$function$;

drop trigger if exists trg_guard_ctgov_locked_markers on public.markers;
create trigger trg_guard_ctgov_locked_markers
  before update or delete on public.markers
  for each row execute function public._guard_ctgov_locked_markers();


-- ----------------------------------------------------------------------------
-- (k-2) Cascade/orphan delete paths must bypass the new marker lock when they
--       remove ct.gov-owned markers as part of trial/space teardown.
--       Re-stated from live with a scoped clint.ctgov_seeding bypass.
-- ----------------------------------------------------------------------------
create or replace function public._cleanup_orphan_marker()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
begin
  -- only the last assignment removal can orphan a marker. using exists
  -- short-circuits on the first remaining row rather than counting all
  -- of them, which matters for hot markers with many trial assignments.
  if not exists (
    select 1
    from public.marker_assignments
    where marker_id = old.marker_id
  ) then
    -- if the parent marker is already being removed in the enclosing
    -- statement (e.g. delete_space()'s explicit delete-from-markers step),
    -- this where clause matches zero rows and the statement is a safe
    -- no-op. see header comment for the full reentrancy explanation.
    -- bypass the ct.gov marker lock: removing the owning trial releases its
    -- markers (system cleanup, not an analyst edit).
    perform set_config('clint.ctgov_seeding', 'on', true);
    delete from public.markers where id = old.marker_id;
    perform set_config('clint.ctgov_seeding', 'off', true);
  end if;
  return old;
end;
$function$;


create or replace function public.permanently_delete_space(p_space_id uuid)
 returns jsonb
 language plpgsql
 security definer
 set search_path to ''
as $function$
-- @audit:tier1
declare
  v_tenant_id    uuid;
  v_agency_id    uuid;
  v_space_name   text;
  v_archived_at  timestamptz;
  v_is_admin     boolean;
  v_is_owner     boolean;
  v_counts       jsonb;
  v_companies    int;
  v_assets       int;
  v_trials       int;
  v_markers      int;
  v_materials    int;
  v_events       int;
  v_pi           int;
  v_marker_types int;
  v_actor_role   text;
begin
  if auth.uid() is null then
    raise exception 'permanently_delete_space: must be authenticated'
      using errcode = '28000';
  end if;

  -- existence + parent linkage for both authz and audit scope.
  select s.tenant_id, s.name, s.archived_at, t.agency_id
    into v_tenant_id, v_space_name, v_archived_at, v_agency_id
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
    where s.id = p_space_id;

  if v_tenant_id is null then
    raise exception 'permanently_delete_space: space % not found', p_space_id
      using errcode = 'P0002';
  end if;

  v_is_admin := public.is_platform_admin();
  v_is_owner := public.is_tenant_member(v_tenant_id, array['owner']);

  if not (v_is_admin or v_is_owner) then
    raise exception 'permanently_delete_space: not authorized to permanently delete space %', p_space_id
      using errcode = '42501';
  end if;

  -- archive gate: non-admins must archive first; admins override.
  if v_archived_at is null and not v_is_admin then
    raise exception 'permanently_delete_space: space must be archived first (call archive_space)'
      using errcode = '42501';
  end if;

  -- capture dependent counts BEFORE the cascade runs so the audit metadata
  -- reflects what was actually purged. these queries each take the space_id
  -- partial index, so even a populated space is cheap.
  select count(*)::int into v_companies    from public.companies    where space_id = p_space_id;
  select count(*)::int into v_assets       from public.assets       where space_id = p_space_id;
  select count(*)::int into v_trials       from public.trials       where space_id = p_space_id;
  select count(*)::int into v_markers      from public.markers      where space_id = p_space_id;
  select count(*)::int into v_materials    from public.materials    where space_id = p_space_id;
  select count(*)::int into v_events       from public.events       where space_id = p_space_id;
  select count(*)::int into v_pi           from public.primary_intelligence where space_id = p_space_id;
  select count(*)::int into v_marker_types from public.marker_types where space_id = p_space_id;

  v_counts := jsonb_build_object(
    'name',          v_space_name,
    'companies',     v_companies,
    'assets',        v_assets,
    'trials',        v_trials,
    'markers',       v_markers,
    'materials',     v_materials,
    'events',        v_events,
    'primary_intelligence', v_pi,
    'marker_types',  v_marker_types,
    'was_archived',  v_archived_at is not null,
    'platform_admin_override', v_is_admin and v_archived_at is null
  );

  -- ordered delete: markers first so the BEFORE DELETE _log_marker_change
  -- trigger writes marker_changes audit rows while the spaces row still
  -- exists (the FK on marker_changes.space_id rejects orphaned inserts).
  -- the existing materials AFTER DELETE trigger (20260521120000) enqueues
  -- every materials.file_path into r2_pending_deletes as the cascade walks.
  -- bypass the ct.gov marker lock for the teardown (system delete, not an
  -- analyst edit).
  perform set_config('clint.ctgov_seeding', 'on', true);
  delete from public.markers where space_id = p_space_id;
  perform set_config('clint.ctgov_seeding', 'off', true);
  delete from public.spaces  where id = p_space_id;

  -- ===== audit instrumentation =====
  v_actor_role := case
    when v_is_admin and not v_is_owner then 'platform_admin'
    else 'tenant_owner'
  end;
  perform set_config('audit.actor_role', v_actor_role, true);
  perform set_config('audit.rpc_name', 'permanently_delete_space', true);
  perform public.record_audit_event(
    'space.deleted', 'rpc', 'space', p_space_id,
    v_agency_id, v_tenant_id, p_space_id,
    v_counts
  );

  return v_counts;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (k-3) Single date_moved emitter: suppress _classify_change's duplicate.
--     The three ct.gov dates (start / primaryCompletion / completion) are now
--     backed by the Trial Start / PCD / Trial End markers, and the marker audit
--     (_log_marker_change -> _emit_events_from_marker_change) is the single,
--     correctly-sourced (ctgov) emitter of their date_moved events (spec A3).
--     Before this change ingest_ctgov_snapshot's field-diff path ALSO emitted a
--     date_moved via _classify_change, so a ct.gov date slip produced TWO
--     date_moved rows. Re-stated from live (20260625180000); the ONLY change is
--     the three date fields now emit no event (the raw diff is still recorded in
--     trial_field_changes by the caller -- only the duplicate event is dropped).
--     All other field classifications are unchanged. Safety: the marker-side
--     date_moved payload is a superset (adds marker_title / marker_type_name /
--     marker_color and an always-computed days_diff) and is rendered by a
--     first-class consumer branch (change-event-summary.ts, which_date =
--     'event_date' + marker_title), so no events-feed card is blanked.
-- ----------------------------------------------------------------------------
create or replace function public._classify_change(p_field_path text, p_old jsonb, p_new jsonb, p_occurred_at timestamp with time zone DEFAULT now())
 returns table(event_type text, payload jsonb, occurred_at timestamp with time zone)
 language plpgsql
 stable
 set search_path to ''
as $function$
declare
  v_old_date  date;
  v_new_date  date;
  v_days_diff int;
  v_direction text;
  v_which     text;
  v_old_count numeric;
  v_new_count numeric;
  v_pct       numeric;
  v_arm       jsonb;
  v_outcome_kind text;
  v_old_labels text[];
  v_new_labels text[];
  v_old_names  text[];
  v_new_names  text[];
  v_old_keys   text[];
  v_new_keys   text[];
  v_added      jsonb;
  v_removed    jsonb;
  v_modified   jsonb;
begin
  -- statusModule.overallStatus -> status_changed
  if p_field_path = 'protocolSection.statusModule.overallStatus' then
    event_type  := 'status_changed';
    payload     := jsonb_build_object(
      'from', case when p_old is null then null::text else p_old #>> '{}' end,
      'to',   case when p_new is null then null::text else p_new #>> '{}' end
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- statusModule.{start|primaryCompletion|completion}DateStruct.date
  -- These three dates are now marker-backed (Trial Start / PCD / Trial End) and
  -- the marker audit is the single date_moved emitter (spec A3). Emit NOTHING
  -- here to avoid a duplicate event; the caller still records the raw field diff
  -- in trial_field_changes.
  if p_field_path in (
       'protocolSection.statusModule.startDateStruct.date',
       'protocolSection.statusModule.primaryCompletionDateStruct.date',
       'protocolSection.statusModule.completionDateStruct.date'
  ) then
    return;
  end if;

  -- designModule.phases -> phase_transitioned
  if p_field_path = 'protocolSection.designModule.phases' then
    event_type  := 'phase_transitioned';
    payload     := jsonb_build_object(
      'from', coalesce(p_old, '[]'::jsonb),
      'to',   coalesce(p_new, '[]'::jsonb)
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- designModule.enrollmentInfo.count -> enrollment_target_changed
  if p_field_path = 'protocolSection.designModule.enrollmentInfo.count' then
    v_old_count := case when p_old is null then null else (p_old #>> '{}')::numeric end;
    v_new_count := case when p_new is null then null else (p_new #>> '{}')::numeric end;
    if v_old_count is not null and v_old_count <> 0 and v_new_count is not null then
      v_pct := round(((v_new_count - v_old_count) / v_old_count) * 100, 2);
    else
      v_pct := null;
    end if;
    event_type  := 'enrollment_target_changed';
    payload     := jsonb_build_object(
      'from',           v_old_count,
      'to',             v_new_count,
      'percent_change', v_pct
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- armsInterventionsModule.armGroups -> arm_added / arm_removed
  if p_field_path = 'protocolSection.armsInterventionsModule.armGroups' then
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_old_labels
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'label'), array[]::text[])
      into v_new_labels
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    for v_arm in
      select elem
        from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
       where not ((elem ->> 'label') = any(v_old_labels))
    loop
      event_type  := 'arm_added';
      payload     := jsonb_build_object(
        'arm_label',   v_arm ->> 'label',
        'arm_type',    v_arm ->> 'type',
        'description', v_arm ->> 'description'
      );
      occurred_at := p_occurred_at;
      return next;
    end loop;

    for v_arm in
      select elem
        from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
       where not ((elem ->> 'label') = any(v_new_labels))
    loop
      event_type  := 'arm_removed';
      payload     := jsonb_build_object(
        'arm_label', v_arm ->> 'label',
        'arm_type',  v_arm ->> 'type'
      );
      occurred_at := p_occurred_at;
      return next;
    end loop;
    return;
  end if;

  -- armsInterventionsModule.interventions -> intervention_changed
  if p_field_path = 'protocolSection.armsInterventionsModule.interventions' then
    select coalesce(array_agg(elem ->> 'name'), array[]::text[])
      into v_old_names
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'name'), array[]::text[])
      into v_new_names
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    select coalesce(jsonb_agg(jsonb_build_object('name', elem ->> 'name', 'type', elem ->> 'type')), '[]'::jsonb)
      into v_added
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
     where not ((elem ->> 'name') = any(v_old_names));

    select coalesce(jsonb_agg(jsonb_build_object('name', elem ->> 'name', 'type', elem ->> 'type')), '[]'::jsonb)
      into v_removed
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
     where not ((elem ->> 'name') = any(v_new_names));

    event_type  := 'intervention_changed';
    payload     := jsonb_build_object('added', v_added, 'removed', v_removed);
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- outcomesModule.{primary|secondary}Outcomes -> outcome_measure_changed
  if p_field_path in (
       'protocolSection.outcomesModule.primaryOutcomes',
       'protocolSection.outcomesModule.secondaryOutcomes'
  ) then
    v_outcome_kind := case p_field_path
                        when 'protocolSection.outcomesModule.primaryOutcomes'   then 'primary'
                        when 'protocolSection.outcomesModule.secondaryOutcomes' then 'secondary'
                      end;

    select coalesce(array_agg(elem ->> 'measure'), array[]::text[])
      into v_old_keys
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem;
    select coalesce(array_agg(elem ->> 'measure'), array[]::text[])
      into v_new_keys
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem;

    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_added
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_old_keys));

    select coalesce(jsonb_agg(elem), '[]'::jsonb)
      into v_removed
      from jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) elem
     where not ((elem ->> 'measure') = any(v_new_keys));

    select coalesce(jsonb_agg(jsonb_build_object('measure', n ->> 'measure', 'from', o, 'to', n)), '[]'::jsonb)
      into v_modified
      from jsonb_array_elements(coalesce(p_new, '[]'::jsonb)) n
      join jsonb_array_elements(coalesce(p_old, '[]'::jsonb)) o
        on (n ->> 'measure') is not null and (n ->> 'measure') = (o ->> 'measure')
     where n is distinct from o;

    event_type  := 'outcome_measure_changed';
    payload     := jsonb_build_object(
      'outcome_kind', v_outcome_kind,
      'added',        v_added,
      'removed',      v_removed,
      'modified',     v_modified
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- sponsorCollaboratorsModule.leadSponsor.name -> sponsor_changed
  if p_field_path = 'protocolSection.sponsorCollaboratorsModule.leadSponsor.name' then
    event_type  := 'sponsor_changed';
    payload     := jsonb_build_object(
      'from', p_old #>> '{}',
      'to',   p_new #>> '{}'
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- eligibilityModule.eligibilityCriteria -> eligibility_criteria_changed
  if p_field_path = 'protocolSection.eligibilityModule.eligibilityCriteria' then
    event_type  := 'eligibility_criteria_changed';
    payload     := jsonb_build_object(
      'old_length', coalesce(length(p_old #>> '{}'), 0),
      'new_length', coalesce(length(p_new #>> '{}'), 0)
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;

  -- eligibilityModule.{sex|minimumAge|maximumAge} -> eligibility_changed
  if p_field_path in (
       'protocolSection.eligibilityModule.sex',
       'protocolSection.eligibilityModule.minimumAge',
       'protocolSection.eligibilityModule.maximumAge'
  ) then
    v_which := case p_field_path
                 when 'protocolSection.eligibilityModule.sex'        then 'sex'
                 when 'protocolSection.eligibilityModule.minimumAge' then 'minimum_age'
                 when 'protocolSection.eligibilityModule.maximumAge' then 'maximum_age'
               end;
    event_type  := 'eligibility_changed';
    payload     := jsonb_build_object(
      'which_field', v_which,
      'from',        p_old #>> '{}',
      'to',          p_new #>> '{}'
    );
    occurred_at := p_occurred_at;
    return next;
    return;
  end if;
end;
$function$;


-- ----------------------------------------------------------------------------
-- (l) DROP the four date columns LAST. Every reader/writer above has been
--     rewritten to not reference them; markers are now the sole source of
--     trial date truth.
-- ----------------------------------------------------------------------------
alter table public.trials
  drop column phase_start_date,
  drop column phase_end_date,
  drop column phase_start_date_source,
  drop column phase_end_date_source;


-- ----------------------------------------------------------------------------
-- (m) In-migration smoke (the test). Aborts the migration on any assert fail.
--     Covers: resolve helper; over-time precision UPSERT; adoption (+ the
--     2-un-owned fall-through); and the ct.gov marker edit lock.
-- ----------------------------------------------------------------------------
do $smoke$
declare
  v_agency_id   uuid := '99990001-0000-0000-0000-000000000001';
  v_tenant_id   uuid := '99990001-0000-0000-0000-000000000002';
  v_user_id     uuid := '99990001-0000-0000-0000-000000000003';
  v_space_id    uuid := '99990001-0000-0000-0000-000000000004';
  v_company_id  uuid := '99990001-0000-0000-0000-000000000005';
  v_asset_id    uuid := '99990001-0000-0000-0000-000000000006';
  v_trial_a     uuid := '99990001-0000-0000-0000-00000000000a';  -- over-time + lock
  v_trial_b     uuid := '99990001-0000-0000-0000-00000000000b';  -- adoption (1 un-owned)
  v_trial_c     uuid := '99990001-0000-0000-0000-00000000000c';  -- 2 un-owned -> insert

  c_start_id    constant uuid := 'a0000000-0000-0000-0000-000000000011';

  v_d           date;
  v_p           text;
  v_cnt         int;
  v_mid1        uuid;
  v_mid2        uuid;
  v_src         text;
  v_threw       boolean;
begin
  -- ===== test 1: _ctgov_resolve_partial_date =====
  select resolved, "precision" into v_d, v_p from public._ctgov_resolve_partial_date('2026');
  if v_d <> '2026-07-01' or v_p <> 'year' then
    raise exception 'resolve FAIL year: got (%, %)', v_d, v_p;
  end if;
  select resolved, "precision" into v_d, v_p from public._ctgov_resolve_partial_date('2026-11');
  if v_d <> '2026-11-15' or v_p <> 'month' then
    raise exception 'resolve FAIL month: got (%, %)', v_d, v_p;
  end if;
  select resolved, "precision" into v_d, v_p from public._ctgov_resolve_partial_date('2026-11-03');
  if v_d <> '2026-11-03' or v_p <> 'exact' then
    raise exception 'resolve FAIL exact: got (%, %)', v_d, v_p;
  end if;
  select resolved, "precision" into v_d, v_p from public._ctgov_resolve_partial_date('not-a-date');
  if v_d is not null or v_p is not null then
    raise exception 'resolve FAIL malformed: got (%, %)', v_d, v_p;
  end if;
  select resolved, "precision" into v_d, v_p from public._ctgov_resolve_partial_date(null);
  if v_d is not null or v_p is not null then
    raise exception 'resolve FAIL null: got (%, %)', v_d, v_p;
  end if;

  -- ===== bootstrap fixture =====
  insert into auth.users (id, email) values (v_user_id, 'ctgov-markers-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'CTM Smoke', 'ctm-smoke', 'ctmsmoke', 'CTM', 'ctm@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'CTM', 'ctm-smoke-t', 'ctmsmoket', 'CTM');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'CTM Co');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'CTM Drug');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_a, v_space_id, v_user_id, v_asset_id, 'CTM Trial A', 'NCT-CTM-A');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_b, v_space_id, v_user_id, v_asset_id, 'CTM Trial B', 'NCT-CTM-B');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_c, v_space_id, v_user_id, v_asset_id, 'CTM Trial C', 'NCT-CTM-C');

  -- ===== test 2: over-time precision UPSERT (trial A) =====
  -- v1: year-precision anticipated -> 1 Trial Start, 2026-07-01 / year / company.
  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_a, v_space_id, 'NCT-CTM-A', 1, '2026-01-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2026","type":"ANTICIPATED"}}}}'::jsonb,
    'manual_sync', null);

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_cnt <> 1 then raise exception 'over-time FAIL v1: expected 1 Trial Start, got %', v_cnt; end if;

  select m.id, m.event_date, m.date_precision, m.projection
    into v_mid1, v_d, v_p, v_src
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_d <> '2026-07-01' or v_p <> 'year' or v_src <> 'company' then
    raise exception 'over-time FAIL v1 fields: got (%, %, %)', v_d, v_p, v_src;
  end if;

  -- v2: month-precision anticipated -> SAME marker id, 2026-11-15 / month / company.
  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_a, v_space_id, 'NCT-CTM-A', 2, '2026-02-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2026-11","type":"ANTICIPATED"}}}}'::jsonb,
    'manual_sync', null);

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_cnt <> 1 then raise exception 'over-time FAIL v2: expected still 1 Trial Start, got %', v_cnt; end if;

  select m.id, m.event_date, m.date_precision, m.projection
    into v_mid2, v_d, v_p, v_src
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_mid2 <> v_mid1 then raise exception 'over-time FAIL v2: marker id changed % -> %', v_mid1, v_mid2; end if;
  if v_d <> '2026-11-15' or v_p <> 'month' or v_src <> 'company' then
    raise exception 'over-time FAIL v2 fields: got (%, %, %)', v_d, v_p, v_src;
  end if;

  -- single-emitter: the v1->v2 start-date slip must emit EXACTLY ONE date_moved
  -- (the marker audit), not two (it previously also fired via _classify_change),
  -- and it must be sourced 'ctgov'. (v1 had no prior snapshot -> no field diff;
  -- the new marker emitted marker_added, not date_moved.)
  select count(*) into v_cnt
    from public.trial_change_events
   where trial_id = v_trial_a and event_type = 'date_moved';
  if v_cnt <> 1 then
    raise exception 'single-emitter FAIL: expected exactly 1 date_moved after a ct.gov date slip, got %', v_cnt;
  end if;
  select count(*) into v_cnt
    from public.trial_change_events
   where trial_id = v_trial_a and event_type = 'date_moved' and source <> 'ctgov';
  if v_cnt <> 0 then
    raise exception 'single-emitter FAIL: date_moved present with source <> ctgov (count %)', v_cnt;
  end if;
  raise notice 'ctgov markers smoke ok test 2b: ct.gov date slip emits exactly 1 date_moved, source ctgov';

  -- v3: exact actual -> SAME marker, 2026-11-03 / exact / actual.
  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_a, v_space_id, 'NCT-CTM-A', 3, '2026-03-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2026-11-03","type":"ACTUAL"}}}}'::jsonb,
    'manual_sync', null);

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_cnt <> 1 then raise exception 'over-time FAIL v3: expected still 1 Trial Start, got %', v_cnt; end if;

  select m.id, m.event_date, m.date_precision, m.projection
    into v_mid2, v_d, v_p, v_src
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_a and m.marker_type_id = c_start_id;
  if v_mid2 <> v_mid1 then raise exception 'over-time FAIL v3: marker id changed'; end if;
  if v_d <> '2026-11-03' or v_p <> 'exact' or v_src <> 'actual' then
    raise exception 'over-time FAIL v3 fields: got (%, %, %)', v_d, v_p, v_src;
  end if;
  raise notice 'ctgov markers smoke ok test 2: over-time precision UPSERT (1 marker, precision + projection evolve)';

  -- ===== test 3a: adoption -- one un-owned Trial Start adopted on sync (trial B) =====
  perform public._create_trial_date_markers(v_trial_b, v_space_id, v_user_id, '2025-01-01'::date, null);
  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_b and m.marker_type_id = c_start_id;
  if v_cnt <> 1 then raise exception 'adopt FAIL setup: expected 1 un-owned Trial Start, got %', v_cnt; end if;

  -- stamp an analyst-authored description so we can verify adoption preserves it.
  update public.markers m
     set description = 'Analyst note: enrollment kickoff'
    from public.marker_assignments ma
   where ma.marker_id = m.id and ma.trial_id = v_trial_b and m.marker_type_id = c_start_id;

  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_b, v_space_id, 'NCT-CTM-B', 1, '2026-01-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2026-05-20","type":"ACTUAL"}}}}'::jsonb,
    'manual_sync', null);

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_b and m.marker_type_id = c_start_id;
  if v_cnt <> 1 then raise exception 'adopt FAIL: expected still 1 Trial Start (adopted), got %', v_cnt; end if;

  select m.metadata->>'source', m.event_date
    into v_src, v_d
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_b and m.marker_type_id = c_start_id;
  if v_src <> 'ctgov' then raise exception 'adopt FAIL: expected source ctgov, got %', v_src; end if;
  if v_d <> '2026-05-20' then raise exception 'adopt FAIL: expected date refreshed to 2026-05-20, got %', v_d; end if;

  -- adoption must NOT clobber the analyst-authored description.
  select m.description into v_p
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_b and m.marker_type_id = c_start_id;
  if v_p is distinct from 'Analyst note: enrollment kickoff' then
    raise exception 'adopt FAIL: analyst description not preserved across adoption, got %', v_p;
  end if;
  raise notice 'ctgov markers smoke ok test 3a: adoption (un-owned -> ctgov, date refreshed, analyst description preserved, no duplicate)';

  -- ===== test 3b: two un-owned -> do NOT adopt, INSERT a new ctgov-owned (trial C) =====
  perform public._create_trial_date_markers(v_trial_c, v_space_id, v_user_id, '2025-02-01'::date, null);
  perform public._create_trial_date_markers(v_trial_c, v_space_id, v_user_id, '2025-03-01'::date, null);
  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_c and m.marker_type_id = c_start_id;
  if v_cnt <> 2 then raise exception 'no-adopt FAIL setup: expected 2 un-owned, got %', v_cnt; end if;

  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_c, v_space_id, 'NCT-CTM-C', 1, '2026-01-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2026-09","type":"ANTICIPATED"}}}}'::jsonb,
    'manual_sync', null);

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_c and m.marker_type_id = c_start_id;
  if v_cnt <> 3 then raise exception 'no-adopt FAIL: expected 3 (2 un-owned + 1 new ctgov), got %', v_cnt; end if;

  select count(*) into v_cnt
    from public.marker_assignments ma join public.markers m on m.id = ma.marker_id
   where ma.trial_id = v_trial_c and m.marker_type_id = c_start_id and m.metadata->>'source' = 'ctgov';
  if v_cnt <> 1 then raise exception 'no-adopt FAIL: expected exactly 1 ctgov-owned, got %', v_cnt; end if;
  raise notice 'ctgov markers smoke ok test 3b: 2 un-owned -> insert (no adoption guess)';

  -- ===== test 4: lock -- analyst edit of a ctgov-owned marker (trial A) raises =====
  v_threw := false;
  begin
    update public.markers set event_date = '2030-01-01' where id = v_mid1;
  exception when sqlstate 'P0001' then
    v_threw := true;
  end;
  if not v_threw then raise exception 'lock FAIL: analyst update of ctgov-owned marker did not raise'; end if;

  -- verify it was not changed
  select event_date into v_d from public.markers where id = v_mid1;
  if v_d <> '2026-11-03' then raise exception 'lock FAIL: ctgov marker was modified to %', v_d; end if;

  -- a subsequent ct.gov sync still updates it (ct.gov retains ownership).
  perform public.ingest_ctgov_snapshot(
    'local-dev-ctgov-secret', v_trial_a, v_space_id, 'NCT-CTM-A', 4, '2026-04-01'::date,
    '{"protocolSection":{"statusModule":{"startDateStruct":{"date":"2027-01-15","type":"ACTUAL"}}}}'::jsonb,
    'manual_sync', null);
  select event_date into v_d from public.markers where id = v_mid1;
  if v_d <> '2027-01-15' then raise exception 'lock FAIL: ct.gov sync did not update locked marker (got %)', v_d; end if;
  raise notice 'ctgov markers smoke ok test 4: analyst edit locked, ct.gov sync still updates';

  -- ===== teardown (reverse dependency) =====
  -- Mirror permanently_delete_space: remove markers while the space row still
  -- exists so the BEFORE DELETE audit insert satisfies marker_changes.space_id.
  -- The GUC bypasses the ct.gov lock for these system deletes.
  perform set_config('clint.ctgov_seeding', 'on', true);
  delete from public.markers where space_id = v_space_id;
  perform set_config('clint.ctgov_seeding', 'off', true);
  delete from public.tenants where id = v_tenant_id;   -- cascades spaces -> trials/etc.
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'ctgov_trial_dates_markers smoke test: PASS';
end
$smoke$;


-- ----------------------------------------------------------------------------
-- (n) Reload PostgREST schema cache so the new/changed RPC signatures resolve.
-- ----------------------------------------------------------------------------
notify pgrst, 'reload schema';
