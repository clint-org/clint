-- migration: 20260607140000_multi_indication_on_import
-- purpose:
--   Support MULTIPLE indications per trial on the import path. Previously
--   multi-indication reached only the Manage UI (set_trial_indications); the
--   import commit path (commit_source_import -> create_trial) persisted a single
--   indication. This closes that gap end-to-end.
--
-- changes:
--   1. create_trial: add p_indication_names text[] (drop old 10-arg signature,
--      create 11-arg). Loops over the name set (prefers the array, falls back to
--      the legacy scalar p_indication_name), writing indications / conditions /
--      condition_indication_map / trial_conditions / asset_indications per name.
--   2. commit_source_import: trials loop reads v_item->'indications' (array of
--      names) with fallback to the scalar 'indication', passing the array param.
--      All other loops copied verbatim from 20260604230810.
--
-- back-compat: the legacy single-indication proposal shape ({indication:'X'})
-- and the legacy create_trial positional call (10 args) both still work via the
-- p_indication_name fallback.

-- ---------------------------------------------------------------------------
-- 1. create_trial: multi-indication
-- ---------------------------------------------------------------------------

drop function if exists public.create_trial(
  uuid, uuid, text, text, text, text, date, date, text, uuid
);

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
  p_source_doc_id    uuid     default null,
  p_indication_names text[]   default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
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
    name, identifier, status, phase_type, phase_start_date, phase_end_date,
    asset_id, space_id, created_by, source_doc_id
  ) values (
    p_name, p_identifier, p_status, p_phase_type,
    p_phase_start_date, p_phase_end_date,
    p_asset_id, p_space_id, v_uid, p_source_doc_id
  )
  returning id into v_id;

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
$$;

revoke execute on function public.create_trial(
  uuid, uuid, text, text, text, text, date, date, text, uuid, text[]
) from anon, public;
grant execute on function public.create_trial(
  uuid, uuid, text, text, text, text, date, date, text, uuid, text[]
) to authenticated;

comment on function public.create_trial(
  uuid, uuid, text, text, text, text, date, date, text, uuid, text[]
) is
  'Shared entity-create RPC for trials. Creates trial_conditions, condition_indication_map, and asset_indications for each indication name (p_indication_names[] preferred; p_indication_name kept for back-compat). Used by both commit_source_import and the Angular UI. Caller must hold owner/editor on the space.';

-- ---------------------------------------------------------------------------
-- 2. commit_source_import: pass the indication name array per trial
--    (full body re-created from 20260604230810; only the trials loop changes)
-- ---------------------------------------------------------------------------

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

  v_item            jsonb;
  v_match           jsonb;
  v_new_id          uuid;
  v_existing_id     uuid;
  v_ref_idx         int;
  v_resolved_id     uuid;
  v_i               int;

  v_moa_names       text[];
  v_roa_names       text[];
  v_marker_type_id  uuid;
  v_category_id     uuid;
  v_trial_ids       uuid[];
  v_target_asset_id uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select tenant_id into v_tenant_id
    from public.spaces where id = p_space_id;

  select (public.get_space_inventory_snapshot(p_space_id)->>'hash')
    into v_current_hash;

  if v_current_hash <> p_inventory_snapshot_hash then
    v_warnings := v_warnings || '"inventory_drift"'::jsonb;
  end if;

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

  -- master lookup tables ---------------------------------------------------
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

  -- new_indications are also handled per-trial by create_trial, but writing
  -- them eagerly here ensures the master records exist before any trial
  -- references them and keeps the proposal's "create X new indications"
  -- summary honest even if no trial happens to reference them.
  if p_proposal->'new_indications' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'new_indications')
    loop
      insert into public.indications (name, space_id, created_by)
        values (v_item->>'name', p_space_id, v_uid)
        on conflict (space_id, name) do nothing;
    end loop;
  end if;

  -- companies --------------------------------------------------------------
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

  -- assets -----------------------------------------------------------------
  v_i := 0;
  if p_proposal->'assets' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'assets')
    loop
      v_match := v_item->'match';

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

      if v_match->>'kind' = 'existing' then
        v_target_asset_id := (v_match->>'id')::uuid;
        v_asset_map := v_asset_map || jsonb_build_object(v_i::text, v_target_asset_id::text);
        -- Mirror 20260528030000: apply MOA/ROA to existing-match assets too,
        -- so analyst-curated attributes from the LLM proposal merge into
        -- inventory the LLM matched against. Idempotent via ON CONFLICT.
        perform public.link_asset_moa_roa(p_space_id, v_target_asset_id, v_moa_names, v_roa_names);
      else
        v_ref_idx := (v_item->>'company_ref')::int;
        v_resolved_id := (v_company_map->>v_ref_idx::text)::uuid;

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

  -- trials -----------------------------------------------------------------
  -- Back-compatible multi-asset: read asset_refs[] when present (Phase 1B), else
  -- the legacy scalar asset_ref. Primary is primary_asset_ref when given, else the
  -- first ref. create_trial sets the primary membership via the bootstrap trigger;
  -- set_trial_assets records any additional members.
  -- Multi-indication: read indications[] (array of names) when present, else the
  -- legacy scalar indication; create_trial writes the join rows for each name.
  v_i := 0;
  if p_proposal->'trials' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'trials')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        declare
          v_refs        int[];
          v_primary_ref int;
          v_asset_ids   uuid[] := '{}';
          v_primary_id  uuid;
          r             int;
          v_ind_names   text[] := null;
        begin
          if jsonb_typeof(v_item->'asset_refs') = 'array' then
            select array_agg((e#>>'{}')::int)
              into v_refs
              from jsonb_array_elements(v_item->'asset_refs') e;
          elsif (v_item->>'asset_ref') is not null then
            v_refs := array[(v_item->>'asset_ref')::int];
          else
            v_refs := '{}';
          end if;

          if v_refs is not null then
            foreach r in array v_refs loop
              if (v_asset_map->>r::text) is not null then
                v_asset_ids := v_asset_ids || (v_asset_map->>r::text)::uuid;
              end if;
            end loop;
          end if;

          v_primary_ref := nullif(v_item->>'primary_asset_ref', '')::int;
          if v_primary_ref is not null and (v_asset_map->>v_primary_ref::text) is not null then
            v_primary_id := (v_asset_map->>v_primary_ref::text)::uuid;
          elsif array_length(v_asset_ids, 1) is not null then
            v_primary_id := v_asset_ids[1];
          else
            v_primary_id := null;
          end if;

          if v_primary_id is null then
            raise exception 'commit_source_import: trial "%" has no resolvable asset',
              coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name');
          end if;

          -- Indication name set: prefer indications[] (array), fall back to the
          -- scalar indication.
          if jsonb_typeof(v_item->'indications') = 'array' then
            select array_agg(e#>>'{}')
              into v_ind_names
              from jsonb_array_elements(v_item->'indications') e;
          elsif (v_item->>'indication') is not null then
            v_ind_names := array[v_item->>'indication'];
          end if;

          v_new_id := public.create_trial(
            p_space_id,
            v_primary_id,
            coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
            v_item->>'nct_id',
            v_item->>'status',
            v_item->>'phase',
            (v_item->>'phase_start_date')::date,
            (v_item->>'phase_end_date')::date,
            null,            -- p_indication_name: superseded by p_indication_names
            v_source_doc_id,
            v_ind_names      -- p_indication_names
          );

          if array_length(v_asset_ids, 1) > 1 then
            perform public.set_trial_assets(v_new_id, v_asset_ids, v_primary_id);
          end if;

          v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_new_id::text);
          v_created_trials := v_created_trials || v_new_id;
        end;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;

  -- markers ----------------------------------------------------------------
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

  -- events -----------------------------------------------------------------
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
        v_anchor       jsonb := v_item->'anchor';
        v_anchor_level text  := v_anchor->>'level';
        v_company_id   uuid;
        v_asset_id     uuid;
        v_trial_id     uuid;
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

  update public.ai_calls
     set source_doc_id = v_source_doc_id
   where id = p_ai_call_id;

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

comment on function public.commit_source_import(uuid, uuid, jsonb, jsonb, text) is
  'Thin orchestrator that resolves match refs and delegates to create_company / create_asset / create_trial / create_marker / create_event. Trials support multi-asset via asset_refs[]+primary_asset_ref and multi-indication via indications[] (both back-compatible with the scalar asset_ref / indication). Do NOT inline inserts here -- the shared RPCs write join-table side-effects (asset_indications, condition_indication_map, marker audit fan-out) that the dashboard joins on. See 20260528060000 for the regression history.';

notify pgrst, 'reload schema';

-- =============================================================================
-- smoke: multi-indication import
-- A trial proposed with two indications creates two trial_conditions rows and
-- two asset_indications rows for the primary asset.
-- =============================================================================
do $$
declare
  v_owner      uuid := 'eeee6666-0001-0001-0001-eeeeeeeeee01';
  v_agency_id  uuid := 'eeee6666-0002-0002-0002-eeeeeeeeee02';
  v_tenant_id  uuid := 'eeee6666-0003-0003-0003-eeeeeeeeee03';
  v_space      uuid := 'eeee6666-0004-0004-0004-eeeeeeeeee04';

  v_trial      uuid;
  v_asset      uuid;
  v_cond_count int;
  v_ai_count   int;
begin
  insert into auth.users (id, email)
    values (v_owner, 'commit-mi-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'MI Smoke Agency', 'mi-smoke', 'mismoke', 'MI', 'mi@invalid.local');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'MI Tenant', 'mi-smoke-t', 'mismoket', 'MI');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant_id, 'MI Space', v_owner);

  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  perform public.commit_source_import(
    v_space,
    gen_random_uuid(),
    jsonb_build_object('source_kind','nct','source_text','smoke','text_hash', 'mi-smoke-hash-' || extract(epoch from clock_timestamp())::text),
    jsonb_build_object(
      'companies', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','MI Pharma'), 'evidence','smoke')
      ),
      'assets', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','MI Asset'),
                           'generic_name', null, 'company_ref', 0,
                           'moas', '[]'::jsonb, 'roas', '[]'::jsonb)
      ),
      'trials', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','NCT-MI-0001'),
                           'name','Two-Indication Trial','nct_id','NCT-MI-0001','status','Active','phase','P2',
                           'asset_refs', jsonb_build_array(0), 'primary_asset_ref', 0,
                           'sponsor_ref', 0,
                           'indications', jsonb_build_array('MASLD','NASH'))
      ),
      'markers', '[]'::jsonb,
      'events', '[]'::jsonb
    ),
    'irrelevant-hash'
  );

  select id into v_trial
    from public.trials
   where space_id = v_space and identifier = 'NCT-MI-0001';

  if v_trial is null then
    raise exception 'commit_source_import MI smoke FAIL: trial NCT-MI-0001 not found';
  end if;

  select count(*) into v_cond_count
    from public.trial_conditions
   where trial_id = v_trial;

  if v_cond_count <> 2 then
    raise exception 'commit_source_import MI smoke FAIL: expected 2 trial_conditions rows, got %', v_cond_count;
  end if;

  select id into v_asset
    from public.assets
   where space_id = v_space and name = 'MI Asset';

  select count(*) into v_ai_count
    from public.asset_indications
   where asset_id = v_asset;

  if v_ai_count <> 2 then
    raise exception 'commit_source_import MI smoke FAIL: expected 2 asset_indications rows, got %', v_ai_count;
  end if;

  raise notice 'commit_source_import multi-indication smoke ok: 2 conditions, 2 asset_indications';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner;

  perform set_config('clint.member_guard_cascade', 'off', true);
end$$;
