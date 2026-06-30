-- commit_source_import: resolve an imported event's indication NAME to an
-- indication_id and pass it to create_event (p_indication_id).
--
-- Background: the worker now emits an `indication` NAME string on event items.
-- events has a nullable indication_id; an AFTER trigger on events ensures the
-- (asset, indication) asset_indications row exists and recomputes
-- development_status. event_types.lifts_development_status drives the lift on
-- the system Approval/Launch rows. So the only thing this RPC needs to do is
-- resolve the indication name to an id (scoped to the space) and hand it to
-- create_event via p_indication_id.
--
-- This CREATE OR REPLACE is based VERBATIM on the live definition of
-- public.commit_source_import(uuid,uuid,jsonb,jsonb,text). ONLY the events loop
-- is changed: it now resolves v_item->>'indication' to v_resolved_indication_id
-- (existing case-insensitive match preferred, else minted via the create_trial
-- idiom) and passes it to create_event by NAME (the existing call is positional
-- and omits p_metadata, so p_indication_id cannot be appended positionally).
-- Everything else (dedup, anchor downgrade to space, dup-source guard, drift
-- warnings, MOA/ROA, trials/indications, p_sources, return envelope) is
-- preserved exactly. Signature is unchanged.

CREATE OR REPLACE FUNCTION public.commit_source_import(p_space_id uuid, p_ai_call_id uuid, p_source_document jsonb, p_proposal jsonb, p_inventory_snapshot_hash text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
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
  v_created_events    uuid[] := '{}';
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
  v_significance    text;
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

  -- events ------------------------------------------------------------------
  -- One unified bucket. Resolve event_type by EXACT name (space-scoped wins),
  -- then case-insensitive, then the system default by display_order. No
  -- display_order "lead type" guess. significance comes from the item; when
  -- absent, fall back to the resolved type's default_significance. Anchor
  -- resolves against the entity maps, downgrading to space (with a warning)
  -- when unresolvable. Skip-existing dedup preserved (skipped.events).
  -- Indication: the worker may emit an `indication` NAME on the item; resolve it
  -- to an indication_id scoped to the space and hand it to create_event via
  -- p_indication_id (the events trigger then ensures the asset_indications row
  -- and recomputes development_status; APPROVED/LAUNCHED lifts flow from the
  -- event_type's lifts_development_status).
  if p_proposal->'events' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'events')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        if exists (
          select 1 from public.events
           where id = (v_match->>'id')::uuid and space_id = p_space_id
        ) then
          v_skipped_events := v_skipped_events || (v_match->>'id')::uuid;
          continue;
        end if;
        -- id not valid in this space: fall through and create as new (defensive).
      end if;

      select id into v_event_type_id
        from public.event_types
       where (space_id = p_space_id or (space_id is null and is_system))
         and name = v_item->>'event_type'
       order by space_id nulls last
       limit 1;
      if v_event_type_id is null then
        select id into v_event_type_id
          from public.event_types
         where (space_id = p_space_id or (space_id is null and is_system))
           and lower(name) = lower(v_item->>'event_type')
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

      v_significance := nullif(v_item->>'significance', '');
      if v_significance is null then
        select default_significance into v_significance
          from public.event_types where id = v_event_type_id;
      end if;

      declare
        v_anchor                 jsonb := v_item->'anchor';
        v_anchor_level           text  := v_anchor->>'level';
        v_resolved_anchor_id     uuid  := null;
        v_indication_name        text;
        v_resolved_indication_id uuid  := null;
      begin
        if v_anchor_level = 'company' then
          v_resolved_anchor_id := (v_company_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'asset' then
          v_resolved_anchor_id := (v_asset_map->>((v_anchor->>'ref')::int)::text)::uuid;
        elsif v_anchor_level = 'trial' then
          v_resolved_anchor_id := (v_trial_map->>((v_anchor->>'ref')::int)::text)::uuid;
        end if;

        if v_anchor_level in ('company','asset','trial') and v_resolved_anchor_id is not null then
          v_anchor_type := v_anchor_level;
          v_anchor_id := v_resolved_anchor_id;
        else
          v_anchor_type := 'space';
          v_anchor_id := null;
          v_warnings := v_warnings || '"event_anchored_to_space"'::jsonb;
        end if;

        -- Resolve the event's indication NAME to an indication_id scoped to the
        -- space. Prefer an EXISTING indication (case-insensitive) so variants
        -- like "Severe HTG" do not mint a duplicate of "Severe HTG"; only mint a
        -- new row when there is no existing match. Mirrors create_trial's upsert
        -- idiom (insert ... on conflict (space_id, name) do nothing, then select
        -- id) but with a case-insensitive lookup.
        v_indication_name := nullif(trim(v_item->>'indication'), '');
        v_resolved_indication_id := null;
        if v_indication_name is not null then
          select id into v_resolved_indication_id
            from public.indications
           where space_id = p_space_id
             and lower(name) = lower(v_indication_name)
           order by case when name = v_indication_name then 0 else 1 end, id
           limit 1;

          if v_resolved_indication_id is null then
            insert into public.indications (name, space_id, created_by)
              values (v_indication_name, p_space_id, v_uid)
              on conflict (space_id, name) do nothing;

            select id into v_resolved_indication_id
              from public.indications
             where space_id = p_space_id and name = v_indication_name;
          end if;
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
          v_significance,  -- p_significance (from the AI priority)
          null,            -- p_visibility
          v_source_doc_id,
          v_sources,
          p_indication_id => v_resolved_indication_id  -- named: p_metadata is skipped
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
      'events', to_jsonb(v_created_events)
    ),
    'skipped', jsonb_build_object(
      'events', to_jsonb(v_skipped_events)
    )
  );
end;
$function$;

-- Signature unchanged; reload is harmless and guards against a stale PostgREST
-- schema cache picking up the redefinition.
notify pgrst, 'reload schema';
