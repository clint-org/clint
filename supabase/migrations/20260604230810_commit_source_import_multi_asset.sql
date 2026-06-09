-- migration: 20260604230810_commit_source_import_multi_asset
-- purpose:
--   Extend commit_source_import to record the FULL asset set for a trial when
--   the proposal carries multiple asset refs (asset_refs[] + primary_asset_ref),
--   back-compatible with the legacy scalar asset_ref field.
--
--   Only the trials loop changes vs 20260528060000. All other loops
--   (companies, assets, markers, events) are copied verbatim.
--
-- affected functions:
--   public.commit_source_import (trials loop extended)

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

          v_new_id := public.create_trial(
            p_space_id,
            v_primary_id,
            coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
            v_item->>'nct_id',
            v_item->>'status',
            v_item->>'phase',
            (v_item->>'phase_start_date')::date,
            (v_item->>'phase_end_date')::date,
            v_item->>'indication',
            v_source_doc_id
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
  'Thin orchestrator that resolves match refs and delegates to create_company / create_asset / create_trial / create_marker / create_event. Trials support multi-asset via asset_refs[]+primary_asset_ref (back-compatible with scalar asset_ref). Do NOT inline inserts here -- the shared RPCs write join-table side-effects (asset_indications, condition_indication_map, marker audit fan-out) that the dashboard joins on. See 20260528060000 for the regression history.';

-- =============================================================================
-- smoke: end-to-end multi-asset import
-- Creates a trial with asset_refs=[0,1] and primary_asset_ref=1, asserts
-- 2 trial_assets rows and that the primary membership points to AssetB.
-- =============================================================================
do $$
declare
  v_owner      uuid := 'eeee5555-0001-0001-0001-eeeeeeeeee01';
  v_agency_id  uuid := 'eeee5555-0002-0002-0002-eeeeeeeeee02';
  v_tenant_id  uuid := 'eeee5555-0003-0003-0003-eeeeeeeeee03';
  v_space      uuid := 'eeee5555-0004-0004-0004-eeeeeeeeee04';

  v_result     jsonb;
  v_trial      uuid;
  v_asset_b_id uuid;
  v_primary_asset_id uuid;
  v_asset_count int;
begin
  -- fixture: auth.users -> agencies -> tenants -> tenant_members -> spaces -> space_members
  insert into auth.users (id, email)
    values (v_owner, 'commit-ma-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'MA Smoke Agency', 'ma-smoke', 'masmoke', 'MA', 'ma@invalid.local');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'MA Tenant', 'ma-smoke-t', 'masmoket', 'MA');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant_id, 'MA Space', v_owner);

  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- call commit_source_import with a multi-asset trial proposal
  -- assets loop expects: match, generic_name, company_ref, moas[], roas[]
  -- trials loop expects: match, name, nct_id, status, phase, asset_refs[], primary_asset_ref
  v_result := public.commit_source_import(
    v_space,
    gen_random_uuid(),                       -- p_ai_call_id: UPDATE is a no-op if absent
    jsonb_build_object('source_kind','nct','source_text','smoke','text_hash', 'ma-smoke-hash-' || extract(epoch from clock_timestamp())::text),
    jsonb_build_object(
      'companies', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','MA Pharma'), 'evidence','smoke')
      ),
      'assets', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','MA AssetA'),
                           'generic_name', null, 'company_ref', 0,
                           'moas', '[]'::jsonb, 'roas', '[]'::jsonb),
        jsonb_build_object('match', jsonb_build_object('kind','new','name','MA AssetB'),
                           'generic_name', null, 'company_ref', 0,
                           'moas', '[]'::jsonb, 'roas', '[]'::jsonb)
      ),
      'trials', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind','new','name','NCT-MA-0001'),
                           'name','Master Protocol Trial','nct_id','NCT-MA-0001','status','Active','phase','P3',
                           'asset_refs', jsonb_build_array(0,1), 'primary_asset_ref', 1,
                           'sponsor_ref', 0, 'indication', null)
      ),
      'markers', '[]'::jsonb,
      'events', '[]'::jsonb
    ),
    'irrelevant-hash'
  );

  -- assertion 1: trial with identifier='NCT-MA-0001' exists in v_space
  select id into v_trial
    from public.trials
   where space_id = v_space
     and identifier = 'NCT-MA-0001';

  if v_trial is null then
    raise exception 'commit_source_import MA smoke FAIL: trial NCT-MA-0001 not found in space';
  end if;

  -- assertion 2: exactly 2 rows in trial_assets
  select count(*) into v_asset_count
    from public.trial_assets
   where trial_id = v_trial;

  if v_asset_count <> 2 then
    raise exception 'commit_source_import MA smoke FAIL: expected 2 trial_assets rows, got %', v_asset_count;
  end if;

  -- assertion 3: primary membership's asset is the one named 'MA AssetB'
  -- and trials.asset_id also points to AssetB
  select a.id into v_asset_b_id
    from public.assets a
   where a.space_id = v_space
     and a.name = 'MA AssetB';

  if v_asset_b_id is null then
    raise exception 'commit_source_import MA smoke FAIL: asset MA AssetB not found';
  end if;

  if not exists (
    select 1 from public.trial_assets
     where trial_id = v_trial
       and asset_id = v_asset_b_id
       and is_primary = true
  ) then
    raise exception 'commit_source_import MA smoke FAIL: MA AssetB is not the primary in trial_assets';
  end if;

  select asset_id into v_primary_asset_id
    from public.trials
   where id = v_trial;

  if v_primary_asset_id <> v_asset_b_id then
    raise exception 'commit_source_import MA smoke FAIL: trials.asset_id=% but expected MA AssetB=%',
      v_primary_asset_id, v_asset_b_id;
  end if;

  raise notice 'commit_source_import multi-asset smoke ok: 2 members, primary=AssetB';

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
