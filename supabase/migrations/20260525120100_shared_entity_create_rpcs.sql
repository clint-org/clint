-- migration: 20260525120000_shared_entity_create_rpcs
-- purpose: extract shared entity-create RPCs so both commit_source_import and
--          the Angular services produce identical database state.
-- affected objects:
--   - function public._emit_events_from_marker_change (modified: add p_source param)
--   - function public.create_company (new)
--   - function public.create_asset (new)
--   - function public.create_trial (new)
--   - function public.create_marker (new)
--   - function public.create_event (new)
--   - function public.commit_source_import (replaced: calls shared RPCs)
-- spec: 2026-05-25-source-import-data-convergence-design.md

-- =============================================================================
-- T1: modify _emit_events_from_marker_change to accept optional p_source
-- =============================================================================

-- drop the old single-arg overload so the new two-arg version (with default)
-- is unambiguous when called with one argument.
drop function if exists public._emit_events_from_marker_change(uuid);

create or replace function public._emit_events_from_marker_change(
  p_marker_change_id uuid,
  p_source           varchar(20) default 'analyst'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker_id      uuid;
  v_space_id       uuid;
  v_change_type    varchar(20);
  v_old            jsonb;
  v_new            jsonb;
  v_changed_at     timestamptz;
  v_assignment     record;
  v_event_type     varchar(40);
  v_payload        jsonb;
  v_secondary      jsonb;
  v_old_event_date date;
  v_new_event_date date;
  v_old_end_date   date;
  v_new_end_date   date;
  v_old_title      text;
  v_new_title      text;
  v_old_proj       text;
  v_new_proj       text;
  v_old_type       uuid;
  v_new_type       uuid;
  v_old_descr      text;
  v_new_descr      text;
  v_changed_fields text[];
  v_days_diff      int;
  v_direction      text;
  v_marker_id_for_event uuid;
begin
  select marker_id, space_id, change_type, old_values, new_values, changed_at
    into v_marker_id, v_space_id, v_change_type, v_old, v_new, v_changed_at
    from public.marker_changes
   where id = p_marker_change_id;

  if v_marker_id is null then
    raise exception '_emit_events_from_marker_change: audit row % not found', p_marker_change_id;
  end if;

  v_old_event_date := nullif(v_old ->> 'event_date', '')::date;
  v_new_event_date := nullif(v_new ->> 'event_date', '')::date;
  v_old_end_date   := nullif(v_old ->> 'end_date', '')::date;
  v_new_end_date   := nullif(v_new ->> 'end_date', '')::date;
  v_old_title      := v_old ->> 'title';
  v_new_title      := v_new ->> 'title';
  v_old_proj       := v_old ->> 'projection';
  v_new_proj       := v_new ->> 'projection';
  v_old_type       := nullif(v_old ->> 'marker_type_id', '')::uuid;
  v_new_type       := nullif(v_new ->> 'marker_type_id', '')::uuid;
  v_old_descr      := v_old ->> 'description';
  v_new_descr      := v_new ->> 'description';

  v_secondary := '{}'::jsonb;

  if v_change_type = 'created' then
    v_event_type := 'marker_added';
    v_payload := jsonb_build_object(
      'event_date',     v_new ->> 'event_date',
      'marker_type_id', v_new ->> 'marker_type_id',
      'projection',     v_new ->> 'projection'
    );

  elsif v_change_type = 'deleted' then
    v_event_type := 'marker_removed';
    v_payload := jsonb_build_object(
      'event_date',     v_old ->> 'event_date',
      'marker_type_id', v_old ->> 'marker_type_id',
      'projection',     v_old ->> 'projection'
    );

  elsif v_change_type = 'updated' then
    if v_old_event_date is distinct from v_new_event_date then
      v_event_type := 'date_moved';
      v_days_diff := abs((v_new_event_date - v_old_event_date));
      v_direction := case
        when v_new_event_date > v_old_event_date then 'slip'
        when v_new_event_date < v_old_event_date then 'accelerate'
        else 'none'
      end;
      v_payload := jsonb_build_object(
        'which_date', 'event_date',
        'from',       v_old_event_date,
        'to',         v_new_event_date,
        'days_diff',  v_days_diff,
        'direction',  v_direction
      );
      if v_old_proj is distinct from v_new_proj then
        v_secondary := v_secondary || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      if v_old_type is distinct from v_new_type then
        v_secondary := v_secondary || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_new_proj = 'actual' and v_old_proj is distinct from 'actual' then
      v_event_type := 'projection_finalized';
      v_payload := jsonb_build_object(
        'from',       v_old_proj,
        'to',         v_new_proj,
        'event_date', v_new ->> 'event_date'
      );
      if v_old_type is distinct from v_new_type then
        v_secondary := v_secondary || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_type is distinct from v_new_type then
      v_event_type := 'marker_reclassified';
      v_payload := jsonb_build_object(
        'from_type_id', v_old_type,
        'to_type_id',   v_new_type
      );
      if v_old_title is distinct from v_new_title then
        v_secondary := v_secondary || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_secondary := v_secondary || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_secondary := v_secondary || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_title is distinct from v_new_title
       or v_old_descr is distinct from v_new_descr
       or v_old_end_date is distinct from v_new_end_date
       or v_old_proj is distinct from v_new_proj then
      v_changed_fields := array[]::text[];
      if v_old_title is distinct from v_new_title then
        v_changed_fields := array_append(v_changed_fields, 'title');
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changed_fields := array_append(v_changed_fields, 'description');
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changed_fields := array_append(v_changed_fields, 'end_date');
      end if;
      if v_old_proj is distinct from v_new_proj then
        v_changed_fields := array_append(v_changed_fields, 'projection');
      end if;
      v_event_type := 'marker_updated';
      v_payload := jsonb_build_object(
        'changed_fields', to_jsonb(v_changed_fields)
      );
    else
      return;
    end if;
  else
    raise exception '_emit_events_from_marker_change: unknown change_type %', v_change_type;
  end if;

  if v_secondary <> '{}'::jsonb then
    v_payload := v_payload || jsonb_build_object('secondary_changes', v_secondary);
  end if;

  v_marker_id_for_event := case
    when v_change_type = 'deleted' then null
    else v_marker_id
  end;

  for v_assignment in
    select trial_id
      from public.marker_assignments
     where marker_id = v_marker_id
  loop
    insert into public.trial_change_events (
      trial_id,
      space_id,
      event_type,
      source,
      payload,
      occurred_at,
      observed_at,
      derived_from_marker_change_id,
      marker_id
    ) values (
      v_assignment.trial_id,
      v_space_id,
      v_event_type,
      p_source,
      v_payload,
      v_changed_at,
      now(),
      p_marker_change_id,
      v_marker_id_for_event
    );
  end loop;
end;
$$;

revoke execute on function public._emit_events_from_marker_change(uuid, varchar) from public;

comment on function public._emit_events_from_marker_change(uuid, varchar) is
  'Internal: classify a marker_changes row per spec rules and fan out one trial_change_events row per marker_assignments link. p_source defaults to analyst; pass source_import for AI-extracted markers. SECURITY DEFINER. Called by _log_marker_change, backfill_marker_history, and create_marker.';


-- =============================================================================
-- T2a: create_company
-- =============================================================================

create or replace function public.create_company(
  p_space_id      uuid,
  p_name          text,
  p_logo_url      text     default null,
  p_source_doc_id uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.companies (name, logo_url, space_id, created_by, source_doc_id)
    values (p_name, p_logo_url, p_space_id, v_uid, p_source_doc_id)
    returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_company(uuid, text, text, uuid) from public;
grant execute on function public.create_company(uuid, text, text, uuid) to authenticated;

comment on function public.create_company(uuid, text, text, uuid) is
  'Shared entity-create RPC for companies. Used by both commit_source_import and the Angular UI.';


-- =============================================================================
-- T2b: create_asset
-- =============================================================================

create or replace function public.create_asset(
  p_space_id      uuid,
  p_company_id    uuid,
  p_name          text,
  p_generic_name  text     default null,
  p_moa_names     text[]   default null,
  p_roa_names     text[]   default null,
  p_source_doc_id uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_id     uuid;
  v_moa_id uuid;
  v_roa_id uuid;
  v_name   text;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.assets (name, generic_name, company_id, space_id, created_by, source_doc_id)
    values (p_name, p_generic_name, p_company_id, p_space_id, v_uid, p_source_doc_id)
    returning id into v_id;

  if p_moa_names is not null then
    foreach v_name in array p_moa_names
    loop
      select id into v_moa_id
        from public.mechanisms_of_action
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_moa_id is not null then
        insert into public.asset_mechanisms_of_action (asset_id, moa_id)
          values (v_id, v_moa_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;

  if p_roa_names is not null then
    foreach v_name in array p_roa_names
    loop
      select id into v_roa_id
        from public.routes_of_administration
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_roa_id is not null then
        insert into public.asset_routes_of_administration (asset_id, roa_id)
          values (v_id, v_roa_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.create_asset(uuid, uuid, text, text, text[], text[], uuid) from public;
grant execute on function public.create_asset(uuid, uuid, text, text, text[], text[], uuid) to authenticated;

comment on function public.create_asset(uuid, uuid, text, text, text[], text[], uuid) is
  'Shared entity-create RPC for assets. Handles MOA/ROA join-table writes. Used by both commit_source_import and the Angular UI.';


-- =============================================================================
-- T2c: create_trial
-- =============================================================================

create or replace function public.create_trial(
  p_space_id         uuid,
  p_asset_id         uuid,
  p_name             text,
  p_identifier       text     default null,
  p_status           text     default null,
  p_phase_type       text     default null,
  p_phase_start_date date     default null,
  p_phase_end_date   date     default null,
  p_indication_name  text     default null,
  p_source_doc_id    uuid     default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid            uuid := auth.uid();
  v_id             uuid;
  v_indication_id  uuid;
  v_condition_id   uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.trials (
    name, identifier, status, phase_type, phase_start_date, phase_end_date,
    asset_id, space_id, created_by, source_doc_id
  ) values (
    p_name, p_identifier, p_status, p_phase_type,
    p_phase_start_date, p_phase_end_date,
    p_asset_id, p_space_id, v_uid, p_source_doc_id
  )
  returning id into v_id;

  if p_indication_name is not null then
    insert into public.indications (name, space_id, created_by)
      values (p_indication_name, p_space_id, v_uid)
      on conflict (space_id, name) do nothing;

    select id into v_indication_id
      from public.indications
     where space_id = p_space_id and name = p_indication_name;

    insert into public.conditions (name, space_id, source)
      values (p_indication_name, p_space_id, 'analyst')
      on conflict (space_id, name) do nothing;

    select id into v_condition_id
      from public.conditions
     where space_id = p_space_id and name = p_indication_name;

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

      perform public._recompute_asset_indication_status(p_asset_id);
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.create_trial(uuid, uuid, text, text, text, text, date, date, text, uuid) from public;
grant execute on function public.create_trial(uuid, uuid, text, text, text, text, date, date, text, uuid) to authenticated;

comment on function public.create_trial(uuid, uuid, text, text, text, text, date, date, text, uuid) is
  'Shared entity-create RPC for trials. Creates trial_conditions, condition_indication_map, and asset_indications when an indication is provided. Used by both commit_source_import and the Angular UI.';


-- =============================================================================
-- T2d: create_marker
-- =============================================================================

create or replace function public.create_marker(
  p_space_id       uuid,
  p_marker_type_id uuid,
  p_title          text,
  p_projection     text,
  p_event_date     date,
  p_end_date       date      default null,
  p_description    text      default null,
  p_source_url     text      default null,
  p_trial_ids      uuid[]    default null,
  p_source_doc_id  uuid      default null,
  p_change_source  text      default 'analyst'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid       uuid := auth.uid();
  v_id        uuid;
  v_audit_id  uuid;
  v_trial_id  uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.markers (
    space_id, marker_type_id, title, projection, event_date, end_date,
    description, source_url, created_by, source_doc_id
  ) values (
    p_space_id, p_marker_type_id, p_title, p_projection, p_event_date,
    p_end_date, p_description, p_source_url, v_uid, p_source_doc_id
  )
  returning id into v_id;

  if p_trial_ids is not null and array_length(p_trial_ids, 1) > 0 then
    foreach v_trial_id in array p_trial_ids
    loop
      insert into public.marker_assignments (marker_id, trial_id)
        values (v_id, v_trial_id)
        on conflict do nothing;
    end loop;

    select id into v_audit_id
      from public.marker_changes
     where marker_id = v_id and change_type = 'created'
     order by changed_at desc
     limit 1;

    if v_audit_id is not null then
      perform public._emit_events_from_marker_change(v_audit_id, p_change_source);
    end if;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text) from public;
grant execute on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text) to authenticated;

comment on function public.create_marker(uuid, uuid, text, text, date, date, text, text, uuid[], uuid, text) is
  'Shared entity-create RPC for markers. Inserts marker, then assignments, then re-emits audit fan-out so trial_change_events are produced with the correct source. Used by both commit_source_import and the Angular UI.';


-- =============================================================================
-- T2e: create_event
-- =============================================================================

create or replace function public.create_event(
  p_space_id      uuid,
  p_category_id   uuid,
  p_title         text,
  p_event_date    date,
  p_description   text      default null,
  p_priority      text      default 'low',
  p_tags          text[]    default null,
  p_company_id    uuid      default null,
  p_asset_id      uuid      default null,
  p_trial_id      uuid      default null,
  p_source_doc_id uuid      default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.events (
    space_id, company_id, asset_id, trial_id, category_id,
    title, event_date, description, priority, tags,
    created_by, source_doc_id
  ) values (
    p_space_id, p_company_id, p_asset_id, p_trial_id, p_category_id,
    p_title, p_event_date, p_description,
    coalesce(p_priority, 'low'),
    coalesce(p_tags, '{}'::text[]),
    v_uid, p_source_doc_id
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.create_event(uuid, uuid, text, date, text, text, text[], uuid, uuid, uuid, uuid) from public;
grant execute on function public.create_event(uuid, uuid, text, date, text, text, text[], uuid, uuid, uuid, uuid) to authenticated;

comment on function public.create_event(uuid, uuid, text, date, text, text, text[], uuid, uuid, uuid, uuid) is
  'Shared entity-create RPC for events. Used by both commit_source_import and the Angular UI.';


-- =============================================================================
-- T3: rewrite commit_source_import to call shared RPCs
-- =============================================================================

create or replace function public.commit_source_import(
  p_space_id                uuid,
  p_ai_call_id              uuid,
  p_source_document         jsonb,
  p_proposal                jsonb,
  p_inventory_snapshot_hash text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid           uuid := auth.uid();
  v_tenant_id     uuid;
  v_source_doc_id uuid;
  v_warnings      jsonb := '[]'::jsonb;
  v_current_hash  text;

  v_company_map   jsonb := '{}'::jsonb;
  v_asset_map     jsonb := '{}'::jsonb;
  v_trial_map     jsonb := '{}'::jsonb;

  v_created_companies uuid[] := '{}';
  v_created_assets    uuid[] := '{}';
  v_created_trials    uuid[] := '{}';
  v_created_markers   uuid[] := '{}';
  v_created_events    uuid[] := '{}';

  v_item          jsonb;
  v_match         jsonb;
  v_new_id        uuid;
  v_existing_id   uuid;
  v_ref_idx       int;
  v_resolved_id   uuid;
  v_i             int;

  v_moa_item      jsonb;
  v_roa_item      jsonb;
  v_moa_names     text[];
  v_roa_names     text[];
  v_marker_type_id uuid;
  v_category_id   uuid;
  v_trial_ref     jsonb;
  v_trial_ids     uuid[];
begin
  -- 1. access check
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_id
    from public.spaces where id = p_space_id;

  -- 2. inventory drift check
  select md5(
    coalesce((select jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name) from public.companies c where c.space_id = p_space_id), '[]'::jsonb)::text ||
    coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'company_id', a.company_id, 'generic_name', a.generic_name) order by a.name) from public.assets a where a.space_id = p_space_id), '[]'::jsonb)::text ||
    coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name, 'identifier', t.identifier, 'asset_id', t.asset_id, 'phase_type', t.phase_type) order by t.name) from public.trials t where t.space_id = p_space_id), '[]'::jsonb)::text ||
    coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.indications i where i.space_id = p_space_id), '[]'::jsonb)::text ||
    coalesce((select jsonb_agg(jsonb_build_object('id', mt.id, 'name', mt.name) order by mt.display_order) from public.marker_types mt where (mt.space_id = p_space_id or (mt.space_id is null and mt.is_system)) and mt.display_order >= 0), '[]'::jsonb)::text ||
    coalesce((select jsonb_agg(jsonb_build_object('id', ec.id, 'name', ec.name) order by ec.display_order) from public.event_categories ec where ec.space_id = p_space_id or (ec.space_id is null and ec.is_system)), '[]'::jsonb)::text
  ) into v_current_hash;

  if v_current_hash <> p_inventory_snapshot_hash then
    v_warnings := v_warnings || '"inventory_drift"'::jsonb;
  end if;

  -- 3. duplicate source probe
  if p_source_document->>'text_hash' is not null then
    select id into v_existing_id
      from public.source_documents
     where space_id = p_space_id
       and text_hash = p_source_document->>'text_hash'
     limit 1;

    if v_existing_id is not null and (p_source_document->>'allow_duplicate')::boolean is not true then
      return jsonb_build_object(
        'code', 'duplicate_source',
        'existing_id', v_existing_id
      );
    end if;
  end if;

  -- 4. insert source document
  insert into public.source_documents (
    space_id, source_kind, source_url, source_title, source_text,
    text_hash, fetch_outcome, created_by
  ) values (
    p_space_id,
    p_source_document->>'source_kind',
    p_source_document->>'source_url',
    p_source_document->>'source_title',
    p_source_document->>'source_text',
    p_source_document->>'text_hash',
    coalesce(p_source_document->>'fetch_outcome', 'paste'),
    v_uid
  )
  returning id into v_source_doc_id;

  -- 5a. upsert lookup tables (MOA, ROA, indications, conditions)
  if p_proposal->'new_moas' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'new_moas')
    loop
      insert into public.mechanisms_of_action (name, space_id)
        values (v_item->>'name', p_space_id)
        on conflict (space_id, name) do nothing;
    end loop;
  end if;

  if p_proposal->'new_roas' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'new_roas')
    loop
      insert into public.routes_of_administration (name, space_id)
        values (v_item->>'name', p_space_id)
        on conflict (space_id, name) do nothing;
    end loop;
  end if;

  if p_proposal->'new_indications' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'new_indications')
    loop
      insert into public.indications (name, space_id, created_by)
        values (v_item->>'name', p_space_id, v_uid)
        on conflict (space_id, name) do nothing;
    end loop;
  end if;

  -- 5b. companies (via shared RPC)
  v_i := 0;
  if p_proposal->'companies' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'companies')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_company_map := v_company_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        v_new_id := public.create_company(
          p_space_id,
          v_match->>'name',
          v_match->>'logo_url',
          v_source_doc_id
        );
        v_company_map := v_company_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_companies := v_created_companies || v_new_id;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5c. assets (via shared RPC)
  v_i := 0;
  if p_proposal->'assets' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'assets')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_asset_map := v_asset_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        v_ref_idx := (v_item->>'company_ref')::int;
        v_resolved_id := (v_company_map->>v_ref_idx::text)::uuid;

        v_moa_names := null;
        if v_item->'moas' is not null then
          select array_agg(elem#>>'{}')
            into v_moa_names
            from jsonb_array_elements(v_item->'moas') elem;
        end if;

        v_roa_names := null;
        if v_item->'roas' is not null then
          select array_agg(elem#>>'{}')
            into v_roa_names
            from jsonb_array_elements(v_item->'roas') elem;
        end if;

        v_new_id := public.create_asset(
          p_space_id,
          v_resolved_id,
          v_match->>'name',
          v_item->>'generic_name',
          v_moa_names,
          v_roa_names,
          v_source_doc_id
        );
        v_asset_map := v_asset_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_assets := v_created_assets || v_new_id;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5d. trials (via shared RPC)
  v_i := 0;
  if p_proposal->'trials' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'trials')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        v_ref_idx := (v_item->>'asset_ref')::int;
        v_resolved_id := (v_asset_map->>v_ref_idx::text)::uuid;

        v_new_id := public.create_trial(
          p_space_id,
          v_resolved_id,
          v_match->>'name',
          v_item->>'nct_id',
          v_item->>'status',
          v_item->>'phase',
          (v_item->>'phase_start_date')::date,
          (v_item->>'phase_end_date')::date,
          v_item->>'indication',
          v_source_doc_id
        );
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_trials := v_created_trials || v_new_id;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5e. markers (via shared RPC)
  if p_proposal->'markers' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'markers')
    loop
      select id into v_marker_type_id
        from public.marker_types
       where (space_id = p_space_id or (space_id is null and is_system))
         and name = v_item->>'marker_type'
       order by space_id nulls last
       limit 1;

      if v_marker_type_id is null then
        select id into v_marker_type_id
          from public.marker_types
         where (space_id = p_space_id or (space_id is null and is_system))
           and lower(name) = lower(v_item->>'marker_type')
         order by space_id nulls last
         limit 1;
      end if;

      if v_marker_type_id is null then
        select id into v_marker_type_id
          from public.marker_types
         where is_system and space_id is null and display_order >= 0
         order by display_order
         limit 1;
      end if;

      v_trial_ids := null;
      if v_item->'trial_refs' is not null then
        select array_agg((v_trial_map->>((elem#>>'{}')::int)::text)::uuid)
          into v_trial_ids
          from jsonb_array_elements(v_item->'trial_refs') elem
         where (v_trial_map->>((elem#>>'{}')::int)::text) is not null;
      end if;

      v_new_id := public.create_marker(
        p_space_id,
        v_marker_type_id,
        v_item->>'title',
        coalesce(v_item->>'projection', 'company'),
        coalesce((v_item->>'event_date')::date, current_date),
        (v_item->>'end_date')::date,
        v_item->>'description',
        p_source_document->>'source_url',
        v_trial_ids,
        v_source_doc_id,
        'source_import'
      );
      v_created_markers := v_created_markers || v_new_id;
    end loop;
  end if;

  -- 5f. events (via shared RPC)
  if p_proposal->'events' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'events')
    loop
      select id into v_category_id
        from public.event_categories
       where lower(name) = lower(v_item->>'category')
         and (space_id = p_space_id or (space_id is null and is_system))
       order by space_id nulls last
       limit 1;

      if v_category_id is null then
        select id into v_category_id
          from public.event_categories
         where is_system
         order by display_order
         limit 1;
      end if;

      declare
        v_anchor      jsonb := v_item->'anchor';
        v_anchor_level text := v_anchor->>'level';
        v_company_id  uuid;
        v_asset_id    uuid;
        v_trial_id    uuid;
      begin
        if v_anchor_level = 'company' then
          v_ref_idx := (v_anchor->>'ref')::int;
          v_company_id := (v_company_map->>v_ref_idx::text)::uuid;
        elsif v_anchor_level = 'asset' then
          v_ref_idx := (v_anchor->>'ref')::int;
          v_asset_id := (v_asset_map->>v_ref_idx::text)::uuid;
        elsif v_anchor_level = 'trial' then
          v_ref_idx := (v_anchor->>'ref')::int;
          v_trial_id := (v_trial_map->>v_ref_idx::text)::uuid;
        end if;

        v_new_id := public.create_event(
          p_space_id,
          v_category_id,
          v_item->>'title',
          coalesce((v_item->>'event_date')::date, current_date),
          v_item->>'description',
          coalesce(v_item->>'priority', 'low'),
          coalesce(
            (select array_agg(t.value#>>'{}') from jsonb_array_elements(v_item->'tags') t),
            '{}'::text[]
          ),
          v_company_id,
          v_asset_id,
          v_trial_id,
          v_source_doc_id
        );
        v_created_events := v_created_events || v_new_id;
      end;
    end loop;
  end if;

  -- 6. link ai_calls to source document
  update public.ai_calls
     set source_doc_id = v_source_doc_id
   where id = p_ai_call_id;

  -- 7. return summary
  return jsonb_build_object(
    'source_doc_id', v_source_doc_id,
    'warnings', v_warnings,
    'created', jsonb_build_object(
      'companies', to_jsonb(v_created_companies),
      'assets', to_jsonb(v_created_assets),
      'trials', to_jsonb(v_created_trials),
      'markers', to_jsonb(v_created_markers),
      'events', to_jsonb(v_created_events)
    )
  );
end;
$$;

revoke execute on function public.commit_source_import(uuid, uuid, jsonb, jsonb, text) from public;
grant execute on function public.commit_source_import(uuid, uuid, jsonb, jsonb, text) to authenticated;

comment on function public.commit_source_import(uuid, uuid, jsonb, jsonb, text) is
  'User-callable. Atomically commits a reviewed source import via shared entity-create RPCs. Dependency-ordered: companies, assets, trials, markers, events with provenance.';


-- =============================================================================
-- smoke tests
-- =============================================================================
-- RPCs call has_space_access(p_space_id) which requires auth.uid() and
-- space_members membership. Migration context has no JWT, so we add the
-- smoke user as a space_member (owner) to satisfy the access check.
do $$
declare
  v_agency_id   uuid := '99999991-9999-9999-9999-999999999991';
  v_tenant_id   uuid := '99999992-9999-9999-9999-999999999992';
  v_user_id     uuid := '99999993-9999-9999-9999-999999999993';
  v_space_id    uuid := '99999994-9999-9999-9999-999999999994';

  v_company_id  uuid;
  v_asset_id    uuid;
  v_trial_id    uuid;
  v_marker_id   uuid;
  v_event_id    uuid;

  v_audit_count int;
  v_event_count int;

  v_type_a      uuid := 'a0000000-0000-0000-0000-000000000030';
  v_cat_id      uuid;
begin
  -- bootstrap fixture
  insert into auth.users (id, email)
    values (v_user_id, 'shared-rpc-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'RPC Smoke', 'rpc-smoke', 'rpcsmoke', 'RPC', 'rpc@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'RPC', 'rpc-smoke-t', 'rpcsmoket', 'RPC');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');

  -- set request.jwt.claims so auth.uid() returns our smoke user
  perform set_config('request.jwt.claims', json_build_object('sub', v_user_id)::text, true);

  -- smoke 1: create_company
  v_company_id := public.create_company(v_space_id, 'Smoke Co');
  assert v_company_id is not null, 'create_company returned null';
  assert exists (select 1 from public.companies where id = v_company_id and name = 'Smoke Co'),
    'create_company: row not found';
  raise notice 'shared RPC smoke ok 1: create_company';

  -- smoke 2: create_asset with MOA/ROA
  insert into public.mechanisms_of_action (name, space_id)
    values ('GLP-1 RA', v_space_id);
  insert into public.routes_of_administration (name, space_id)
    values ('Oral', v_space_id);

  v_asset_id := public.create_asset(
    v_space_id, v_company_id, 'Smoke Drug', 'smokegen',
    array['GLP-1 RA'], array['Oral']
  );
  assert v_asset_id is not null, 'create_asset returned null';
  assert exists (select 1 from public.asset_mechanisms_of_action where asset_id = v_asset_id),
    'create_asset: MOA join row missing';
  assert exists (select 1 from public.asset_routes_of_administration where asset_id = v_asset_id),
    'create_asset: ROA join row missing';
  raise notice 'shared RPC smoke ok 2: create_asset with MOA/ROA';

  -- smoke 3: create_trial with indication -> asset_indications created
  v_trial_id := public.create_trial(
    v_space_id, v_asset_id, 'SMOKE-TRIAL-1', 'NCT-SMOKE-1', 'Completed',
    'P3', '2026-01-01', '2026-06-01', 'Obesity'
  );
  assert v_trial_id is not null, 'create_trial returned null';

  assert exists (select 1 from public.indications where space_id = v_space_id and name = 'Obesity'),
    'create_trial: indication not created';
  assert exists (select 1 from public.conditions where space_id = v_space_id and name = 'Obesity'),
    'create_trial: condition not created';
  assert exists (
    select 1 from public.trial_conditions where trial_id = v_trial_id
  ), 'create_trial: trial_conditions row missing';
  assert exists (
    select 1 from public.asset_indications
     where asset_id = v_asset_id
       and space_id = v_space_id
  ), 'create_trial: asset_indications row missing';
  raise notice 'shared RPC smoke ok 3: create_trial with indication + asset_indications';

  -- smoke 4: create_marker with trial_ids -> trial_change_events created
  v_marker_id := public.create_marker(
    v_space_id, v_type_a, 'Smoke Topline', 'actual', '2026-03-01',
    null, 'smoke desc', null,
    array[v_trial_id], null, 'source_import'
  );
  assert v_marker_id is not null, 'create_marker returned null';

  select count(*) into v_audit_count
    from public.marker_changes
   where marker_id = v_marker_id and change_type = 'created';
  assert v_audit_count = 1, 'create_marker: expected 1 audit row, got ' || v_audit_count;

  select count(*) into v_event_count
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_added';
  assert v_event_count = 1,
    'create_marker: expected 1 marker_added event, got ' || v_event_count;

  assert exists (
    select 1 from public.trial_change_events
     where marker_id = v_marker_id
       and event_type = 'marker_added'
       and source = 'source_import'
  ), 'create_marker: expected source=source_import on trial_change_events';
  raise notice 'shared RPC smoke ok 4: create_marker with assignments -> trial_change_events (source_import)';

  -- smoke 5: create_marker with zero trial_ids -> zero events
  declare
    v_orphan_marker uuid;
  begin
    v_orphan_marker := public.create_marker(
      v_space_id, v_type_a, 'Orphan Marker', 'company', '2026-04-01'
    );
    assert v_orphan_marker is not null, 'create_marker (orphan) returned null';
    select count(*) into v_event_count
      from public.trial_change_events
     where marker_id = v_orphan_marker;
    assert v_event_count = 0,
      'create_marker (orphan): expected 0 events, got ' || v_event_count;
    raise notice 'shared RPC smoke ok 5: create_marker (orphan) -> 0 events';
    delete from public.markers where id = v_orphan_marker;
  end;

  -- smoke 6: create_event
  select id into v_cat_id from public.event_categories where is_system limit 1;
  v_event_id := public.create_event(
    v_space_id, v_cat_id, 'Smoke Event', '2026-05-01',
    'desc', 'high', array['smoke'], v_company_id
  );
  assert v_event_id is not null, 'create_event returned null';
  assert exists (select 1 from public.events where id = v_event_id and priority = 'high'),
    'create_event: row not found or wrong priority';
  raise notice 'shared RPC smoke ok 6: create_event';

  -- smoke 7: create_marker with analyst source
  declare
    v_analyst_marker uuid;
  begin
    v_analyst_marker := public.create_marker(
      v_space_id, v_type_a, 'Analyst Marker', 'company', '2026-05-15',
      null, null, null,
      array[v_trial_id], null, 'analyst'
    );
    assert exists (
      select 1 from public.trial_change_events
       where marker_id = v_analyst_marker
         and source = 'analyst'
    ), 'create_marker (analyst): expected source=analyst';
    raise notice 'shared RPC smoke ok 7: create_marker with source=analyst';
    delete from public.markers where id = v_analyst_marker;
  end;

  -- cleanup: bypass member-guard triggers, then tear down in dependency order
  perform set_config('request.jwt.claims', '', true);
  alter table public.space_members disable trigger space_members_self_protection;
  delete from public.markers where space_id = v_space_id;
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_changes where space_id = v_space_id;
  delete from public.events where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;
  alter table public.space_members enable trigger space_members_self_protection;

  raise notice 'shared entity-create RPCs smoke test: PASS';
end$$;
