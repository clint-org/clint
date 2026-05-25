-- migration: 20260525100800_rpc_commit_source_import
-- purpose: user-callable RPC that atomically commits a reviewed source import.
--          dependency-ordered inserts: companies -> assets -> trials ->
--          trial_conditions -> markers -> marker_assignments -> events.
--          also includes get_space_inventory_snapshot helper for hash computation.

-- =============================================================================
-- helper: inventory snapshot with hash
-- =============================================================================
create or replace function public.get_space_inventory_snapshot(p_space_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_companies jsonb;
  v_assets    jsonb;
  v_trials    jsonb;
  v_indications jsonb;
  v_hash      text;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
    into v_companies
    from public.companies c where c.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'company_id', a.company_id,
    'generic_name', a.generic_name) order by a.name), '[]'::jsonb)
    into v_assets
    from public.assets a where a.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
    'identifier', t.identifier, 'asset_id', t.asset_id, 'phase_type', t.phase_type) order by t.name), '[]'::jsonb)
    into v_trials
    from public.trials t where t.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name), '[]'::jsonb)
    into v_indications
    from public.indications i where i.space_id = p_space_id;

  v_hash := md5(v_companies::text || v_assets::text || v_trials::text || v_indications::text);

  return jsonb_build_object(
    'companies', v_companies,
    'assets', v_assets,
    'trials', v_trials,
    'indications', v_indications,
    'hash', v_hash
  );
end;
$$;

revoke execute on function public.get_space_inventory_snapshot(uuid) from public;
grant execute on function public.get_space_inventory_snapshot(uuid) to authenticated;

-- =============================================================================
-- main commit RPC
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
  v_moa_id        uuid;
  v_roa_id        uuid;
  v_indication_id uuid;
  v_condition_id  uuid;
  v_marker_type_id uuid;
  v_category_id   uuid;
  v_trial_ref     jsonb;
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
    coalesce((select jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name) from public.indications i where i.space_id = p_space_id), '[]'::jsonb)::text
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

      select id into v_indication_id
        from public.indications
       where space_id = p_space_id and name = v_item->>'name';

      insert into public.conditions (name, space_id, source)
        values (v_item->>'name', p_space_id, 'analyst')
        on conflict (space_id, name) do nothing;

      select id into v_condition_id
        from public.conditions
       where space_id = p_space_id and name = v_item->>'name';

      if v_indication_id is not null and v_condition_id is not null then
        insert into public.condition_indication_map (condition_id, indication_id)
          values (v_condition_id, v_indication_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;

  -- 5b. companies
  v_i := 0;
  if p_proposal->'companies' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'companies')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_company_map := v_company_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        insert into public.companies (name, logo_url, space_id, created_by, source_doc_id)
          values (
            v_match->>'name',
            v_match->>'logo_url',
            p_space_id, v_uid, v_source_doc_id
          )
          returning id into v_new_id;
        v_company_map := v_company_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_companies := v_created_companies || v_new_id;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5c. assets
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

        insert into public.assets (name, generic_name, company_id, space_id, created_by, source_doc_id)
          values (
            v_match->>'name',
            v_item->>'generic_name',
            v_resolved_id,
            p_space_id, v_uid, v_source_doc_id
          )
          returning id into v_new_id;
        v_asset_map := v_asset_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_assets := v_created_assets || v_new_id;

        if v_item->'moas' is not null then
          for v_moa_item in select * from jsonb_array_elements(v_item->'moas')
          loop
            select id into v_moa_id from public.mechanisms_of_action
             where space_id = p_space_id and name = v_moa_item#>>'{}'
             limit 1;
            if v_moa_id is not null then
              insert into public.asset_mechanisms_of_action (asset_id, moa_id)
                values (v_new_id, v_moa_id)
                on conflict do nothing;
            end if;
          end loop;
        end if;

        if v_item->'roas' is not null then
          for v_roa_item in select * from jsonb_array_elements(v_item->'roas')
          loop
            select id into v_roa_id from public.routes_of_administration
             where space_id = p_space_id and name = v_roa_item#>>'{}'
             limit 1;
            if v_roa_id is not null then
              insert into public.asset_routes_of_administration (asset_id, roa_id)
                values (v_new_id, v_roa_id)
                on conflict do nothing;
            end if;
          end loop;
        end if;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5d. trials
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

        insert into public.trials (
          name, identifier, status, phase_type, phase_start_date, phase_end_date,
          asset_id, space_id, created_by, source_doc_id
        ) values (
          v_match->>'name',
          v_item->>'nct_id',
          v_item->>'status',
          v_item->>'phase',
          (v_item->>'phase_start_date')::date,
          (v_item->>'phase_end_date')::date,
          v_resolved_id,
          p_space_id, v_uid, v_source_doc_id
        )
        returning id into v_new_id;
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_trials := v_created_trials || v_new_id;

        if v_item->>'indication' is not null then
          select id into v_condition_id
            from public.conditions
           where space_id = p_space_id and name = v_item->>'indication';

          if v_condition_id is null then
            insert into public.conditions (name, space_id, source)
              values (v_item->>'indication', p_space_id, 'analyst')
              returning id into v_condition_id;
          end if;

          insert into public.trial_conditions (trial_id, condition_id, source)
            values (v_new_id, v_condition_id, 'analyst')
            on conflict do nothing;
        end if;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- 5e. markers
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
        insert into public.marker_types (name, space_id, is_system)
          values (v_item->>'marker_type', p_space_id, false)
          on conflict (space_id, name) do nothing
          returning id into v_marker_type_id;

        if v_marker_type_id is null then
          select id into v_marker_type_id
            from public.marker_types
           where space_id = p_space_id and name = v_item->>'marker_type';
        end if;
      end if;

      insert into public.markers (
        space_id, marker_type_id, title, projection, event_date, end_date,
        description, source_url, created_by, source_doc_id
      ) values (
        p_space_id, v_marker_type_id,
        v_item->>'title',
        coalesce(v_item->>'projection', 'company'),
        (v_item->>'event_date')::date,
        (v_item->>'end_date')::date,
        v_item->>'description',
        p_source_document->>'source_url',
        v_uid, v_source_doc_id
      )
      returning id into v_new_id;
      v_created_markers := v_created_markers || v_new_id;

      if v_item->'trial_refs' is not null then
        for v_trial_ref in select * from jsonb_array_elements(v_item->'trial_refs')
        loop
          v_ref_idx := (v_trial_ref#>>'{}')::int;
          v_resolved_id := (v_trial_map->>v_ref_idx::text)::uuid;
          if v_resolved_id is not null then
            insert into public.marker_assignments (marker_id, trial_id)
              values (v_new_id, v_resolved_id)
              on conflict do nothing;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  -- 5f. events
  if p_proposal->'events' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'events')
    loop
      select id into v_category_id
        from public.event_categories
       where name = v_item->>'category'
         and (space_id = p_space_id or (space_id is null and is_system))
       order by space_id nulls last
       limit 1;

      if v_category_id is null then
        raise exception 'unknown event category: %', v_item->>'category'
          using errcode = '22023';
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

        insert into public.events (
          space_id, company_id, asset_id, trial_id, category_id,
          title, event_date, description, priority, tags,
          created_by, source_doc_id
        ) values (
          p_space_id, v_company_id, v_asset_id, v_trial_id, v_category_id,
          v_item->>'title',
          (v_item->>'event_date')::date,
          v_item->>'description',
          coalesce(v_item->>'priority', 'low'),
          coalesce(
            (select array_agg(t.value#>>'{}') from jsonb_array_elements(v_item->'tags') t),
            '{}'::text[]
          ),
          v_uid, v_source_doc_id
        )
        returning id into v_new_id;
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
  'User-callable. Atomically commits a reviewed source import: creates source_document, then dependency-ordered inserts for companies, assets, trials, markers, events with provenance.';

-- smoke test (lightweight, no seed data dependency)
do $$
begin
  assert exists (
    select 1 from pg_proc
     where proname = 'commit_source_import'
       and pronamespace = 'public'::regnamespace
  ), 'commit_source_import function not found';

  assert exists (
    select 1 from pg_proc
     where proname = 'get_space_inventory_snapshot'
       and pronamespace = 'public'::regnamespace
  ), 'get_space_inventory_snapshot function not found';

  raise notice 'smoke: commit_source_import + get_space_inventory_snapshot created OK';
end$$;
