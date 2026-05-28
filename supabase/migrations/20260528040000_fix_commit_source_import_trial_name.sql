-- migration: 20260528040000_fix_commit_source_import_trial_name
-- purpose: fix commit_source_import storing the NCT ID into trials.name.
--
-- The LLM proposal shape for a trial item has two distinct name fields:
--   match.name -> the NCT ID, used as a uniqueness key for new matches
--   name       -> the brief title from CT.gov, the analyst-facing label
--
-- commit_source_import was reading v_match->>'name' for the trial insert,
-- so every trial committed via the NCT import path landed with name = NCT ID.
-- This made the duplicate-detection dialog render "NCT06066515: NCT06066515"
-- and any other surface that displays trials.name looked broken.
--
-- Fix: pass v_item->>'name' for trials. coalesce on v_match->>'name' as a
-- safety net so the not-null constraint never trips if the LLM omits the
-- top-level name.
--
-- Backfill: any existing trials where name = identifier (the buggy state)
-- get their name rewritten to the best available label, preferring the
-- CT.gov acronym, then the briefTitle from the latest snapshot. Rows with
-- neither stay as-is.

-- 1. replace commit_source_import with the corrected trial insert.
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

  v_i := 0;
  if p_proposal->'assets' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'assets')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_target_asset_id := (v_match->>'id')::uuid;
        v_asset_map := v_asset_map || jsonb_build_object(v_i::text, v_target_asset_id::text);
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
        v_target_asset_id := v_new_id;
      end if;

      if v_item->'moas' is not null then
        for v_moa_item in select * from jsonb_array_elements(v_item->'moas')
        loop
          select id into v_moa_id from public.mechanisms_of_action
           where space_id = p_space_id and name = v_moa_item#>>'{}'
           limit 1;
          if v_moa_id is not null then
            insert into public.asset_mechanisms_of_action (asset_id, moa_id)
              values (v_target_asset_id, v_moa_id)
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
              values (v_target_asset_id, v_roa_id)
              on conflict do nothing;
          end if;
        end loop;
      end if;

      v_i := v_i + 1;
    end loop;
  end if;

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
          -- Top-level name is the human-readable brief title from the LLM
          -- (mapped from CT.gov briefTitle). match.name is the NCT ID, used
          -- only as a uniqueness key; fall back to it as a last resort.
          coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
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

      insert into public.markers (
        space_id, marker_type_id, title, projection, event_date, end_date,
        description, source_url, created_by, source_doc_id
      ) values (
        p_space_id, v_marker_type_id,
        v_item->>'title',
        coalesce(v_item->>'projection', 'company'),
        coalesce((v_item->>'event_date')::date, current_date),
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

        insert into public.events (
          space_id, company_id, asset_id, trial_id, category_id,
          title, event_date, description, priority, tags,
          created_by, source_doc_id
        ) values (
          p_space_id, v_company_id, v_asset_id, v_trial_id, v_category_id,
          v_item->>'title',
          coalesce((v_item->>'event_date')::date, current_date),
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

-- 2. backfill trials where name was incorrectly stored as the NCT ID.
-- Prefer the CT.gov acronym (already materialized by _materialize_trial_from_snapshot);
-- fall back to the briefTitle from the latest snapshot. Rows with neither
-- stay as-is and remain candidates for a future re-import.
update public.trials t
   set name = src.new_name
  from (
    select tt.id,
           coalesce(
             tt.acronym,
             (
               select nullif(trim(s.payload #>> '{protocolSection,identificationModule,briefTitle}'), '')
                 from public.trial_ctgov_snapshots s
                where s.trial_id = tt.id
                order by s.ctgov_version desc, s.fetched_at desc
                limit 1
             )
           ) as new_name
      from public.trials tt
     where tt.name = tt.identifier
       and tt.identifier is not null
  ) src
 where src.id = t.id
   and src.new_name is not null
   and src.new_name <> t.name;
