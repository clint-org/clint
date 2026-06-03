-- migration: 20260528060000_commit_source_import_redelegate_and_backfill
-- purpose:
--   Restore commit_source_import to a thin orchestrator that delegates to the
--   shared create_* RPCs. The original delegation in
--   20260526120100_shared_entity_create_rpcs.sql was discarded by
--   20260528030000_commit_source_import_link_moa_roa_existing.sql (which
--   wanted to add MOA/ROA linking for existing-match assets but did so by
--   re-inlining the entire function body) and then again by
--   20260528040000_fix_commit_source_import_trial_name.sql (trial-name fix,
--   carried forward the inlined body). The inlined trial insert silently
--   stopped writing condition_indication_map and asset_indications -- the
--   join targets that get_dashboard_data, get_bullseye_assets, and
--   get_positioning_data all hang their results on. Result: imported trials
--   were visible in /trials and the events feed but absent from the
--   timeline, bullseye, and density-matrix views.
--
--   This migration:
--     1) adds link_asset_moa_roa() -- the MOA/ROA name->link helper used by
--        both create_asset (internals) and commit_source_import (existing-
--        match branch). Same write path everywhere; drift becomes
--        structurally hard.
--     2) refactors create_asset to call link_asset_moa_roa internally.
--        Signature is unchanged so the Angular asset.service caller and the
--        smoke in 20260524120400 keep working.
--     3) rewrites commit_source_import to delegate to create_company,
--        create_asset (+ link_asset_moa_roa for existing matches),
--        create_trial, create_marker, create_event. Preserves the trial-name
--        fix from 20260528040000 (coalesce of top-level briefTitle, falling
--        back to match.name = NCT ID only as last resort).
--     4) backfills assets that were imported via the broken inlined path so
--        they surface in the dashboard immediately, without re-import.
--     5) end-to-end smoke that imports a synthetic proposal and asserts
--        get_dashboard_data returns the trial. This is the canary that will
--        fail if a future migration silently re-inlines.
--
-- affected functions:
--   public.link_asset_moa_roa  (new)
--   public.create_asset        (refactored internals, signature unchanged)
--   public.commit_source_import (rewritten to delegate)
-- affected data:
--   public.asset_indications, public.condition_indication_map  (backfill)

-- =============================================================================
-- 1. link_asset_moa_roa helper
-- =============================================================================

create or replace function public.link_asset_moa_roa(
  p_space_id  uuid,
  p_asset_id  uuid,
  p_moa_names text[],
  p_roa_names text[]
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
  v_id   uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_moa_names is not null then
    foreach v_name in array p_moa_names loop
      select id into v_id
        from public.mechanisms_of_action
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_id is not null then
        insert into public.asset_mechanisms_of_action (asset_id, moa_id)
          values (p_asset_id, v_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;

  if p_roa_names is not null then
    foreach v_name in array p_roa_names loop
      select id into v_id
        from public.routes_of_administration
       where space_id = p_space_id and name = v_name
       limit 1;
      if v_id is not null then
        insert into public.asset_routes_of_administration (asset_id, roa_id)
          values (p_asset_id, v_id)
          on conflict do nothing;
      end if;
    end loop;
  end if;
end;
$$;

revoke execute on function public.link_asset_moa_roa(uuid, uuid, text[], text[]) from public;
grant execute on function public.link_asset_moa_roa(uuid, uuid, text[], text[]) to authenticated;

comment on function public.link_asset_moa_roa(uuid, uuid, text[], text[]) is
  'Idempotent MOA/ROA name->link helper for assets. Used by create_asset and commit_source_import (existing-match branch) so the same write path runs everywhere.';

-- =============================================================================
-- 2. create_asset refactor (signature unchanged)
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
  v_uid uuid := auth.uid();
  v_id  uuid;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  insert into public.assets (name, generic_name, company_id, space_id, created_by, source_doc_id)
    values (p_name, p_generic_name, p_company_id, p_space_id, v_uid, p_source_doc_id)
    returning id into v_id;

  perform public.link_asset_moa_roa(p_space_id, v_id, p_moa_names, p_roa_names);

  return v_id;
end;
$$;

comment on function public.create_asset(uuid, uuid, text, text, text[], text[], uuid) is
  'Shared entity-create RPC for assets. Delegates MOA/ROA join-table writes to link_asset_moa_roa. Used by both commit_source_import and the Angular UI.';

-- =============================================================================
-- 3. rewrite commit_source_import to delegate
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

        -- Trial name preference (20260528040000): top-level v_item->>'name'
        -- is the briefTitle from CT.gov; v_match->>'name' is the NCT ID and
        -- is only a safety net to satisfy NOT NULL.
        v_new_id := public.create_trial(
          p_space_id,
          v_resolved_id,
          coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
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
  'Thin orchestrator that resolves match refs and delegates to create_company / create_asset / create_trial / create_marker / create_event. Do NOT inline inserts here -- the shared RPCs write join-table side-effects (asset_indications, condition_indication_map, marker audit fan-out) that the dashboard joins on. See 20260528060000 for the regression history.';

-- =============================================================================
-- 4. backfill: restore asset_indications + condition_indication_map for
--    trials that were imported under the broken inlined path
-- =============================================================================
-- For each trial that has trial_conditions whose condition name matches an
-- existing indication name (the typical NCT-import shape: the analyst's
-- indication string is the same string used to seed both rows), wire up:
--   1) condition_indication_map (condition_id -> indication_id) by name match
--   2) asset_indications (asset_id, indication_id) with source='auto'
-- Then call _recompute_asset_indication_status() per affected asset so the
-- newly-inserted asset_indications get their development_status populated
-- from the trial phases.

do $$
declare
  v_inserted_links  int;
  v_inserted_ai     int;
  v_asset_id        uuid;
  v_affected        int := 0;
begin
  -- 1) condition_indication_map by name match
  with bridge as (
    insert into public.condition_indication_map (condition_id, indication_id)
    select distinct c.id, i.id
      from public.conditions c
      join public.indications i
        on i.space_id = c.space_id
       and i.name = c.name
     where exists (
       select 1 from public.trial_conditions tc where tc.condition_id = c.id
     )
       and not exists (
         select 1 from public.condition_indication_map cim
          where cim.condition_id = c.id and cim.indication_id = i.id
       )
    on conflict do nothing
    returning condition_id
  )
  select count(*) into v_inserted_links from bridge;

  -- 2) asset_indications derived from trials -> trial_conditions -> cim
  with bridge as (
    insert into public.asset_indications (
      asset_id, indication_id, space_id,
      development_status_source, created_by
    )
    select distinct t.asset_id, cim.indication_id, t.space_id,
           'auto'::text, t.created_by
      from public.trials t
      join public.trial_conditions tc on tc.trial_id = t.id
      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
     where t.asset_id is not null
       and not exists (
         select 1 from public.asset_indications ai
          where ai.asset_id = t.asset_id
            and ai.indication_id = cim.indication_id
       )
    on conflict (asset_id, indication_id) do nothing
    returning asset_id
  )
  select count(*) into v_inserted_ai from bridge;

  -- 3) recompute development_status for any asset that just got a new ai row
  for v_asset_id in
    select distinct ai.asset_id
      from public.asset_indications ai
     where ai.development_status_source = 'auto'
       and ai.development_status is null
  loop
    perform public._recompute_asset_indication_status(v_asset_id);
    v_affected := v_affected + 1;
  end loop;

  raise notice 'backfill: % condition_indication_map links, % asset_indications rows, % assets recomputed',
    v_inserted_links, v_inserted_ai, v_affected;
end$$;

-- =============================================================================
-- 5. end-to-end smoke: import a synthetic proposal, assert get_dashboard_data
--    surfaces the new trial. This is the canary; if a future migration
--    re-inlines commit_source_import and drops the indication graph writes,
--    this smoke will fail at db reset.
-- =============================================================================

do $$
declare
  v_user_id    uuid := '99999990-1234-5678-9abc-000000000001';
  v_agency_id  uuid := '99999990-1234-5678-9abc-000000000002';
  v_tenant_id  uuid := '99999990-1234-5678-9abc-000000000003';
  v_space_id   uuid := '99999990-1234-5678-9abc-000000000004';
  v_ai_call_id uuid := '99999990-1234-5678-9abc-000000000005';

  v_proposal   jsonb;
  v_source_doc jsonb;
  v_result     jsonb;
  v_dashboard  jsonb;
  v_trial_id   uuid;
  v_asset_id   uuid;
  v_company_obj jsonb;
  v_asset_obj   jsonb;
  v_ind_obj     jsonb;
  v_trial_obj   jsonb;
begin
  -- fixture
  insert into auth.users (id, email)
    values (v_user_id, 'commit-import-redelegate-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'CIR Smoke', 'cir-smoke', 'cirsmoke', 'CIR', 'cir@invalid.local');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'CIR Tenant', 'cir-smoke-t', 'cirsmoket', 'CIR');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_user_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'CIR Space', v_user_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');

  insert into public.ai_calls (
    id, tenant_id, space_id, user_id, model, feature, outcome
  ) values (
    v_ai_call_id, v_tenant_id, v_space_id, v_user_id,
    'claude-opus-4-7', 'source_import', 'success'
  );

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  v_source_doc := jsonb_build_object(
    'source_kind', 'nct',
    'source_url', 'https://clinicaltrials.gov/study/NCT99999991',
    'source_title', 'CIR Smoke Study',
    'source_text', 'fixture',
    'text_hash', 'cir-smoke-hash-' || extract(epoch from clock_timestamp())::text,
    'fetch_outcome', 'success'
  );

  v_proposal := jsonb_build_object(
    'new_moas',         jsonb_build_array(jsonb_build_object('name', 'GLP-1 agonist (CIR)')),
    'new_roas',         jsonb_build_array(jsonb_build_object('name', 'Subcutaneous (CIR)')),
    'new_indications',  jsonb_build_array(jsonb_build_object('name', 'Obesity (CIR)')),
    'companies', jsonb_build_array(
      jsonb_build_object(
        'match', jsonb_build_object('kind', 'new', 'name', 'CIR Pharma', 'logo_url', null)
      )
    ),
    'assets', jsonb_build_array(
      jsonb_build_object(
        'company_ref', 0,
        'match', jsonb_build_object('kind', 'new', 'name', 'CIR-001'),
        'generic_name', 'cirastatin',
        'moas', jsonb_build_array('GLP-1 agonist (CIR)'),
        'roas', jsonb_build_array('Subcutaneous (CIR)')
      )
    ),
    'trials', jsonb_build_array(
      jsonb_build_object(
        'asset_ref', 0,
        'match', jsonb_build_object('kind', 'new', 'name', 'NCT99999991'),
        'name', 'A Study of CIR-001 in Obesity',
        'nct_id', 'NCT99999991',
        'status', 'recruiting',
        'phase', 'P3',
        'phase_start_date', '2026-01-01',
        'phase_end_date', '2027-06-30',
        'indication', 'Obesity (CIR)'
      )
    ),
    'markers', jsonb_build_array(
      jsonb_build_object(
        'trial_refs', jsonb_build_array(0),
        'marker_type', 'Topline Data',
        'title', 'CIR Topline Data',
        'projection', 'primary',
        'event_date', '2027-03-15'
      )
    ),
    'events', jsonb_build_array(
      jsonb_build_object(
        'anchor', jsonb_build_object('level', 'company', 'ref', 0),
        'category', 'Leadership',
        'title', 'CIR CEO Hired',
        'event_date', '2026-04-01',
        'priority', 'low',
        'tags', jsonb_build_array()
      )
    )
  );

  v_result := public.commit_source_import(
    v_space_id,
    v_ai_call_id,
    v_source_doc,
    v_proposal,
    'cir-hash-mismatch-ok'  -- inventory_drift warning is fine
  );

  if v_result ->> 'code' = 'duplicate_source' then
    raise exception 'cir smoke FAIL: unexpected duplicate_source on first import';
  end if;

  if jsonb_array_length(v_result -> 'created' -> 'companies') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 created company, got %', v_result -> 'created' -> 'companies';
  end if;
  if jsonb_array_length(v_result -> 'created' -> 'assets') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 created asset, got %', v_result -> 'created' -> 'assets';
  end if;
  if jsonb_array_length(v_result -> 'created' -> 'trials') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 created trial, got %', v_result -> 'created' -> 'trials';
  end if;

  v_trial_id := ((v_result -> 'created' -> 'trials') ->> 0)::uuid;
  v_asset_id := ((v_result -> 'created' -> 'assets') ->> 0)::uuid;

  -- the real assertion: asset_indications must exist (this is what
  -- get_dashboard_data joins on). Without it, the dashboard would be empty
  -- even though /trials and the events feed would show the rows fine.
  if not exists (
    select 1 from public.asset_indications ai
     where ai.asset_id = v_asset_id
       and ai.space_id = v_space_id
  ) then
    raise exception 'cir smoke FAIL: create_trial did not produce asset_indications row -- the dashboard would be empty';
  end if;

  -- trial_conditions must be wired so condition_indication_map can bridge
  if not exists (
    select 1 from public.trial_conditions tc
      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
     where tc.trial_id = v_trial_id
  ) then
    raise exception 'cir smoke FAIL: trial is missing trial_conditions/condition_indication_map bridge';
  end if;

  -- exercise the actual dashboard RPC and assert the trial surfaces
  v_dashboard := public.get_dashboard_data(v_space_id);
  if jsonb_array_length(v_dashboard) <> 1 then
    raise exception 'cir smoke FAIL: expected 1 company in get_dashboard_data, got %', jsonb_array_length(v_dashboard);
  end if;

  v_company_obj := v_dashboard -> 0;
  if jsonb_array_length(v_company_obj -> 'assets') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 asset in dashboard, got %', jsonb_array_length(v_company_obj -> 'assets');
  end if;

  v_asset_obj := (v_company_obj -> 'assets') -> 0;
  if jsonb_array_length(v_asset_obj -> 'indications') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 indication group in dashboard, got %', jsonb_array_length(v_asset_obj -> 'indications');
  end if;

  v_ind_obj := (v_asset_obj -> 'indications') -> 0;
  if jsonb_array_length(v_ind_obj -> 'trials') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 trial under indication in dashboard, got %', jsonb_array_length(v_ind_obj -> 'trials');
  end if;

  v_trial_obj := (v_ind_obj -> 'trials') -> 0;
  if (v_trial_obj ->> 'id')::uuid <> v_trial_id then
    raise exception 'cir smoke FAIL: dashboard trial id mismatch';
  end if;
  if v_trial_obj ->> 'name' <> 'A Study of CIR-001 in Obesity' then
    raise exception 'cir smoke FAIL: expected briefTitle as trial name, got %', v_trial_obj ->> 'name';
  end if;
  if jsonb_array_length(v_trial_obj -> 'markers') <> 1 then
    raise exception 'cir smoke FAIL: expected 1 marker on trial in dashboard, got %', jsonb_array_length(v_trial_obj -> 'markers');
  end if;

  -- cleanup -- spaces and tenants cascade-delete most rows; member-row
  -- deletes must precede tenant delete per the cascade-guard pattern from
  -- 20260521120000_r2_pending_deletes_queue.sql:303-307.
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  -- Drop markers, trial_change_events, etc. before the tenant cascade
  -- so audit triggers (e.g. _log_marker_change) don't fire against a
  -- space row that the cascade is about to delete underneath them.
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_assignments where marker_id in
    (select id from public.markers where space_id = v_space_id);
  delete from public.markers where space_id = v_space_id;
  delete from public.events where space_id = v_space_id;
  delete from public.ai_calls where space_id = v_space_id;
  delete from public.source_documents where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'commit_source_import redelegate smoke: PASS';
end$$;
