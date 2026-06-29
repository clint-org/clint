-- C4: commit_source_import emits unified events via create_event (with sources).
--
-- The AI import commit path was broken against the new schema in TWO blocks:
--   * markers block: resolved marker_types / called create_marker / checked the
--     dropped public.markers table.
--   * events block: resolved event_categories / called the OLD create_event
--     signature -- both gone after the event-model cutover.
--
-- Both blocks now converge onto the unified create_event RPC (17-arg signature
-- ending in p_sources jsonb). No inline event inserts (shared-RPC rule). The AI
-- proposal keeps its frozen dual markers+events extraction shape (Stage 3 will
-- unify it); we consume it as-is. The return envelope keys (markers/events/
-- skipped) are unchanged for frontend commit-summary compatibility; the
-- "markers" key now holds the EVENT ids created from the markers block.
--
-- All other blocks (companies/assets/trials/indications, the source_documents
-- insert, ai_calls update, warnings, return envelope) are preserved unchanged.

create or replace function public.commit_source_import(p_space_id uuid, p_ai_call_id uuid, p_source_document jsonb, p_proposal jsonb, p_inventory_snapshot_hash text)
 returns jsonb
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
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
  v_skipped_markers   uuid[] := '{}';
  v_skipped_events    uuid[] := '{}';

  v_item            jsonb;
  v_match           jsonb;
  v_new_id          uuid;
  v_existing_id     uuid;
  v_ref_idx         int;
  v_resolved_id     uuid;
  v_i               int;

  v_moa_names       text[];
  v_roa_names       text[];
  v_event_type_id   uuid;
  v_anchor_type     text;
  v_anchor_id       uuid;
  v_sources         jsonb;
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

  -- Single citation derived from the imported document's source_url, handed to
  -- create_event as ONE event_sources row through p_sources. Skip blank urls.
  v_sources := case
    when p_source_document->>'source_url' is not null
         and p_source_document->>'source_url' <> ''
    then jsonb_build_array(jsonb_build_object('url', p_source_document->>'source_url', 'label', null))
    else null
  end;

  -- markers ----------------------------------------------------------------
  -- Repointed onto the unified events model: each proposal "marker" item now
  -- creates a SINGLE trial-anchored event via create_event (no inline insert).
  -- The output key stays "markers" (frozen commit-summary contract); it now
  -- holds the created EVENT ids from this block.
  if p_proposal->'markers' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'markers')
    loop
      -- Skip creation when the AI matched this item to an existing event.
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        if exists (
          select 1 from public.events
           where id = (v_match->>'id')::uuid
             and space_id = p_space_id
        ) then
          v_skipped_markers := v_skipped_markers || (v_match->>'id')::uuid;
          continue;
        end if;
        -- id not valid in this space: fall through and create as new (defensive).
      end if;

      -- Resolve the event_type from the proposal marker_type name with the SAME
      -- 3-tier fallback the legacy marker_types lookup used (system UUIDs and
      -- names carried over unchanged): exact name -> lower(name) -> default
      -- system type by display_order.
      select id into v_event_type_id
        from public.event_types
       where (space_id = p_space_id or (space_id is null and is_system))
         and name = v_item->>'marker_type'
       order by space_id nulls last
       limit 1;

      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where (space_id = p_space_id or (space_id is null and is_system))
           and lower(name) = lower(v_item->>'marker_type')
         order by space_id nulls last
         limit 1;
      end if;

      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where is_system and space_id is null and display_order >= 0
         order by display_order
         limit 1;
      end if;

      -- Single anchor: take the FIRST resolved trial_ref (no fan-out to multiple
      -- events). With no resolved trial_refs, keep the event at space level
      -- rather than lose it, and note the downgrade.
      v_anchor_id := null;
      if v_item->'trial_refs' is not null then
        select (v_trial_map->>((e.elem#>>'{}')::int)::text)::uuid
          into v_anchor_id
          from jsonb_array_elements(v_item->'trial_refs') with ordinality as e(elem, ord)
         where (v_trial_map->>((e.elem#>>'{}')::int)::text) is not null
         order by e.ord
         limit 1;
      end if;

      if v_anchor_id is not null then
        v_anchor_type := 'trial';
      else
        v_anchor_type := 'space';
        v_warnings := v_warnings || '"marker_anchored_to_space"'::jsonb;
      end if;

      v_new_id := public.create_event(
        p_space_id,
        v_event_type_id,
        v_item->>'title',
        coalesce((v_item->>'event_date')::date, current_date),
        v_anchor_type,
        v_anchor_id,
        coalesce(v_item->>'projection', 'company'),
        'exact',
        (v_item->>'end_date')::date,
        'exact',
        false,
        v_item->>'description',
        null,            -- p_source_url: citations flow through p_sources
        null,            -- p_significance
        null,            -- p_visibility
        v_source_doc_id,
        v_sources
      );
      v_created_markers := v_created_markers || v_new_id;
    end loop;
  end if;

  -- events -----------------------------------------------------------------
  -- Repointed onto the unified create_event signature. The proposal still
  -- carries a category NAME (frozen extraction contract); resolve it to the
  -- category's LEAD event_type (lowest display_order).
  -- DOCUMENTED LIMITATION: a category with multiple event_types maps to its
  -- lead type only; carrying an explicit event_type in the AI proposal is a
  -- Stage 3 extraction-schema improvement. This keeps a single create path now.
  if p_proposal->'events' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'events')
    loop
      -- Skip creation when the AI matched this event to an existing row.
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        if exists (
          select 1 from public.events
           where id = (v_match->>'id')::uuid
             and space_id = p_space_id
        ) then
          v_skipped_events := v_skipped_events || (v_match->>'id')::uuid;
          continue;
        end if;
        -- id not valid in this space: fall through and create as new (defensive).
      end if;

      select et.id into v_event_type_id
        from public.event_types et
        join public.event_type_categories ec on ec.id = et.category_id
       where lower(ec.name) = lower(v_item->>'category')
         and (et.space_id = p_space_id or (et.space_id is null and et.is_system))
       order by et.space_id nulls last, et.display_order
       limit 1;

      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where is_system and space_id is null and display_order >= 0
         order by display_order
         limit 1;
      end if;

      declare
        v_anchor             jsonb := v_item->'anchor';
        v_anchor_level       text  := v_anchor->>'level';
        v_resolved_anchor_id uuid  := null;
      begin
        if v_anchor_level = 'company' then
          v_resolved_anchor_id := (v_company_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'asset' then
          v_resolved_anchor_id := (v_asset_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'trial' then
          v_resolved_anchor_id := (v_trial_map->>((v_anchor->>'ref')::int)::text)::uuid;
        end if;

        -- Pass the resolved entity anchor; fall back to space level (rather than
        -- failing the import) when the level is absent or unresolvable.
        if v_anchor_level in ('company','asset','trial') and v_resolved_anchor_id is not null then
          v_anchor_type := v_anchor_level;
          v_anchor_id := v_resolved_anchor_id;
        else
          v_anchor_type := 'space';
          v_anchor_id := null;
          v_warnings := v_warnings || '"event_anchored_to_space"'::jsonb;
        end if;

        v_new_id := public.create_event(
          p_space_id,
          v_event_type_id,
          v_item->>'title',
          coalesce((v_item->>'event_date')::date, current_date),
          v_anchor_type,
          v_anchor_id,
          coalesce(v_item->>'projection', 'company'),
          'exact',
          (v_item->>'end_date')::date,
          'exact',
          false,
          v_item->>'description',
          null,            -- p_source_url: citations flow through p_sources
          null,            -- p_significance
          null,            -- p_visibility
          v_source_doc_id,
          v_sources
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
    ),
    'skipped', jsonb_build_object(
      'markers', to_jsonb(v_skipped_markers),
      'events', to_jsonb(v_skipped_events)
    )
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- In-file smoke (data-conditional, self-cleaning, prod-safe).
-- Commits a synthetic proposal (one trial-anchored marker item + one
-- company-anchored event item, both carrying a source_url) through
-- commit_source_import and asserts both blocks emit anchored events and the
-- source_url lands as an event_sources citation. Skips with a NOTICE when the
-- demo space / a usable owner-or-editor member / an anchorable company+trial is
-- absent (during `supabase db reset` the demo data seeds AFTER migrations, so
-- this skips; the authoritative proof is the import integration specs). Cleans
-- up so it is re-runnable.
-- ---------------------------------------------------------------------------
do $$
declare
  v_demo_space constant uuid := '00000000-0000-0000-0000-0000000d0100';
  v_user_id    uuid;
  v_company_id uuid;
  v_trial_id   uuid;
  v_hash       text;
  v_result     jsonb;
  v_doc_id     uuid;
  v_mk_event   uuid;
  v_ev_event   uuid;
  v_src_url    constant text := 'https://example.com/c4-smoke';
  v_mk_anchor  text;
  v_ev_anchor  text;
  v_src_count  int;
begin
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'C4 smoke: demo space absent (prod-safe skip)';
    return;
  end if;

  select user_id into v_user_id
    from public.space_members
   where space_id = v_demo_space
     and role in ('owner','editor')
   limit 1;
  if v_user_id is null then
    raise notice 'C4 smoke: no owner/editor member of demo space, skipping';
    return;
  end if;

  select id into v_company_id
    from public.companies where space_id = v_demo_space limit 1;
  select id into v_trial_id
    from public.trials where space_id = v_demo_space limit 1;
  if v_company_id is null or v_trial_id is null then
    raise notice 'C4 smoke: demo space has no anchorable company+trial, skipping';
    return;
  end if;

  -- Act as the demo owner/editor so has_space_access() passes.
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user_id, 'role', 'authenticated')::text,
    true
  );

  select get_space_inventory_snapshot(v_demo_space)->>'hash' into v_hash;

  v_result := public.commit_source_import(
    v_demo_space,
    null,  -- p_ai_call_id: no row updated (smoke does not open an ai_call)
    jsonb_build_object(
      'source_kind', 'text',
      'source_text', 'C4 smoke ' || clock_timestamp()::text,
      'source_title', 'C4 smoke doc',
      'source_url', v_src_url,
      'text_hash', 'c4-smoke-' || clock_timestamp()::text,
      'fetch_outcome', 'paste'
    ),
    jsonb_build_object(
      'companies', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind', 'existing', 'id', v_company_id))
      ),
      'trials', jsonb_build_array(
        jsonb_build_object('match', jsonb_build_object('kind', 'existing', 'id', v_trial_id))
      ),
      'markers', jsonb_build_array(
        jsonb_build_object(
          'marker_type', 'Topline Data',
          'title', 'C4 smoke readout',
          'event_date', '2026-07-01',
          'projection', 'company',
          'trial_refs', jsonb_build_array(0)
        )
      ),
      'events', jsonb_build_array(
        jsonb_build_object(
          'category', 'Regulatory',
          'title', 'C4 smoke filing',
          'event_date', '2026-08-01',
          'priority', 'high',
          'tags', '[]'::jsonb,
          'anchor', jsonb_build_object('level', 'company', 'ref', 0)
        )
      )
    ),
    v_hash
  );

  v_doc_id := (v_result->>'source_doc_id')::uuid;
  v_mk_event := ((v_result->'created'->'markers')->>0)::uuid;
  v_ev_event := ((v_result->'created'->'events')->>0)::uuid;

  if v_mk_event is null or v_ev_event is null then
    raise exception 'C4 SMOKE FAIL: expected one event from each block (markers=%, events=%)',
      v_result->'created'->'markers', v_result->'created'->'events';
  end if;

  select anchor_type into v_mk_anchor from public.events where id = v_mk_event;
  select anchor_type into v_ev_anchor from public.events where id = v_ev_event;
  if v_mk_anchor <> 'trial' then
    raise exception 'C4 SMOKE FAIL: markers-block event not trial-anchored, got %', v_mk_anchor;
  end if;
  if v_ev_anchor <> 'company' then
    raise exception 'C4 SMOKE FAIL: events-block event not company-anchored, got %', v_ev_anchor;
  end if;

  select count(*) into v_src_count
    from public.event_sources
   where event_id in (v_mk_event, v_ev_event)
     and url = v_src_url;
  if v_src_count <> 2 then
    raise exception 'C4 SMOKE FAIL: expected 2 event_sources citations, got %', v_src_count;
  end if;

  -- self-clean: events cascade-delete their event_sources; then the doc row.
  delete from public.events where source_doc_id = v_doc_id;
  delete from public.source_documents where id = v_doc_id;

  perform set_config('request.jwt.claims', null, true);

  raise notice 'C4 SMOKE PASS: commit_source_import emits anchored events with source citations';
end;
$$;

notify pgrst, 'reload schema';
