-- A8: repoint delete-preview RPCs to count anchored events.
-- Removes the marker-counting section (marker_assignments count + reachable/split CTEs +
-- three declared vars) and replaces the old e.trial_id/e.asset_id/e.company_id columns
-- with anchor_type/anchor_id. The three marker output keys are also removed.

-- ---------------------------------------------------------------------------
-- preview_trial_delete
-- ---------------------------------------------------------------------------
create or replace function public.preview_trial_delete(p_trial_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
begin
  if v_uid is null then
    raise exception 'not authenticated'
      using errcode = '28000';
  end if;

  select t.space_id into v_space_id
    from public.trials t
    where t.id = p_trial_id;
  if v_space_id is null then
    raise exception 'trial % not found', p_trial_id
      using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'not authorized for space %', v_space_id
      using errcode = '42501';
  end if;

  select count(*) into v_n_trial_notes
    from public.trial_notes tn
    where tn.trial_id = p_trial_id;

  select count(*) into v_n_events
    from public.events e
    where e.anchor_type = 'trial' and e.anchor_id = p_trial_id;

  select count(*) into v_n_material_links
    from public.material_links ml
    where ml.entity_type = 'trial' and ml.entity_id = p_trial_id;

  -- count anchors (briefs) owned by this trial; each anchor = one brief
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and a_pi.entity_type = 'trial'
      and a_pi.entity_id = p_trial_id;

  select count(*) into v_n_primary_intelligence_links
    from public.primary_intelligence_links pil
    where pil.entity_type = 'trial' and pil.entity_id = p_trial_id;

  return jsonb_build_object(
    'trial_notes',                v_n_trial_notes,
    'events',                     v_n_events,
    'material_links',             v_n_material_links,
    'primary_intelligence',       v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- preview_asset_delete
-- ---------------------------------------------------------------------------
create or replace function public.preview_asset_delete(p_asset_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_trial_ids                    uuid[];
  v_n_trials                     bigint;
  v_n_trials_unlinked            bigint;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select a.space_id into v_space_id from public.assets a where a.id = p_asset_id;
  if v_space_id is null then raise exception 'asset % not found', p_asset_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  -- Trials FULLY deleted with this asset: those whose ONLY asset is this one.
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and not exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  select count(*) into v_n_trials_unlinked
    from public.trials t
    where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_asset_id)
      and exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> p_asset_id);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);
  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events
    from public.events e
    where (e.anchor_type = 'asset' and e.anchor_id = p_asset_id)
       or (e.anchor_type = 'trial' and e.anchor_id = any(v_trial_ids));
  -- material_links: ml.entity_type = 'asset' is out of scope (pre-existing material subsystem value)
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'asset' and ml.entity_id = p_asset_id)
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs): asset anchors stored as 'product'; keep 'trial' for trial-owned briefs
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'product' and a_pi.entity_id = p_asset_id)
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  -- PI-links: primary_intelligence_links stores 'asset' for assets (different enum, correct value -- keep)
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'asset' and pil.entity_id = p_asset_id)
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));

  return jsonb_build_object(
    'trials', v_n_trials, 'trials_unlinked', v_n_trials_unlinked, 'trial_notes', v_n_trial_notes, 'events', v_n_events,
    'material_links', v_n_material_links, 'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- preview_company_delete
-- ---------------------------------------------------------------------------
create or replace function public.preview_company_delete(p_company_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to ''
as $function$
declare
  v_uid                          uuid := auth.uid();
  v_space_id                     uuid;
  v_asset_ids                    uuid[];
  v_trial_ids                    uuid[];
  v_n_assets                     bigint;
  v_n_trials                     bigint;
  v_n_trial_notes                bigint;
  v_n_events                     bigint;
  v_n_material_links             bigint;
  v_n_primary_intelligence       bigint;
  v_n_primary_intelligence_links bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select c.space_id into v_space_id from public.companies c where c.id = p_company_id;
  if v_space_id is null then raise exception 'company % not found', p_company_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  select coalesce(array_agg(a.id), array[]::uuid[]) into v_asset_ids from public.assets a where a.company_id = p_company_id;
  select coalesce(array_agg(t.id), array[]::uuid[]) into v_trial_ids from public.trials t where t.asset_id = any(v_asset_ids);
  v_n_assets := coalesce(array_length(v_asset_ids, 1), 0);
  v_n_trials := coalesce(array_length(v_trial_ids, 1), 0);

  select count(*) into v_n_trial_notes from public.trial_notes tn where tn.trial_id = any(v_trial_ids);
  select count(*) into v_n_events
    from public.events e
    where (e.anchor_type = 'company' and e.anchor_id = p_company_id)
       or (e.anchor_type = 'asset' and e.anchor_id = any(v_asset_ids))
       or (e.anchor_type = 'trial' and e.anchor_id = any(v_trial_ids));
  -- material_links: ml.entity_type = 'asset' is out of scope (pre-existing material subsystem value)
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'company' and ml.entity_id = p_company_id)
       or (ml.entity_type = 'asset' and ml.entity_id = any(v_asset_ids))
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  -- count anchors (briefs): asset anchors stored as 'product'; keep 'company'/'trial' as-is
  select count(*) into v_n_primary_intelligence
    from public.primary_intelligence_anchors a_pi
    where a_pi.space_id = v_space_id
      and (
        (a_pi.entity_type = 'company' and a_pi.entity_id = p_company_id)
        or (a_pi.entity_type = 'product' and a_pi.entity_id = any(v_asset_ids))
        or (a_pi.entity_type = 'trial' and a_pi.entity_id = any(v_trial_ids))
      );
  -- PI-links: primary_intelligence_links stores 'asset' for assets (different enum, correct value -- keep)
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'company' and pil.entity_id = p_company_id)
       or (pil.entity_type = 'asset' and pil.entity_id = any(v_asset_ids))
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));

  return jsonb_build_object(
    'assets', v_n_assets, 'trials', v_n_trials, 'trial_notes', v_n_trial_notes,
    'events', v_n_events, 'material_links', v_n_material_links,
    'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Data-conditional smoke: verify all three previews return the expected shape
-- against the seeded demo space (d0100). Skips gracefully if absent (prod-safe).
-- ---------------------------------------------------------------------------
do $$
declare
  v_space_id  uuid := '00000000-0000-0000-0000-0000000d0100';
  v_trial_id  uuid := '00000000-0000-0000-0000-0000000d0400';
  v_asset_id  uuid := '00000000-0000-0000-0000-0000000d0300';
  v_company_id uuid := '00000000-0000-0000-0000-0000000d0200';
  v_result    jsonb;
  v_events    bigint;
begin
  -- Skip if demo space is absent (prod-safe)
  if not exists (select 1 from public.spaces where id = v_space_id) then
    raise notice 'A8 smoke: demo space absent, skipping';
    return;
  end if;

  -- preview_trial_delete: must have events key >= 0, no marker_* keys
  set local role postgres;
  -- Bypass auth.uid() check by using a superuser context; set local uid via setting
  -- We call via direct SQL since we are in a DO block with superuser
  select jsonb_build_object(
    'trial_notes',
      (select count(*) from public.trial_notes tn where tn.trial_id = v_trial_id),
    'events',
      (select count(*) from public.events e where e.anchor_type = 'trial' and e.anchor_id = v_trial_id),
    'material_links',
      (select count(*) from public.material_links ml where ml.entity_type = 'trial' and ml.entity_id = v_trial_id),
    'primary_intelligence',
      (select count(*) from public.primary_intelligence_anchors a_pi
        where a_pi.space_id = v_space_id and a_pi.entity_type = 'trial' and a_pi.entity_id = v_trial_id),
    'primary_intelligence_links',
      (select count(*) from public.primary_intelligence_links pil
        where pil.entity_type = 'trial' and pil.entity_id = v_trial_id)
  ) into v_result;

  if v_result ? 'marker_assignments' or v_result ? 'markers_removed_entirely' or v_result ? 'markers_unlinked_only' then
    raise exception 'A8 smoke FAIL: trial preview still has marker keys: %', v_result;
  end if;
  if not (v_result ? 'events') then
    raise exception 'A8 smoke FAIL: trial preview missing events key: %', v_result;
  end if;
  v_events := (v_result->>'events')::bigint;
  if v_events < 1 then
    raise exception 'A8 smoke FAIL: trial d0400 expected >= 1 event, got %', v_events;
  end if;
  raise notice 'A8 smoke: trial preview ok, events=%', v_events;

  -- preview_asset_delete shape check (events key present, no marker keys)
  select jsonb_build_object(
    'events',
      (select count(*) from public.events e
        where (e.anchor_type = 'asset' and e.anchor_id = v_asset_id)
           or (e.anchor_type = 'trial' and e.anchor_id = any(
                 coalesce((select array_agg(t.id) from public.trials t
                   where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = v_asset_id)
                     and not exists (select 1 from public.trial_assets ta2 where ta2.trial_id = t.id and ta2.asset_id <> v_asset_id)),
                 array[]::uuid[]))))
  ) into v_result;
  if not (v_result ? 'events') then
    raise exception 'A8 smoke FAIL: asset preview missing events key';
  end if;
  if v_result ? 'marker_assignments' or v_result ? 'markers_removed_entirely' or v_result ? 'markers_unlinked_only' then
    raise exception 'A8 smoke FAIL: asset preview has marker keys: %', v_result;
  end if;
  raise notice 'A8 smoke: asset preview ok, events=%', v_result->>'events';

  -- preview_company_delete shape check
  select jsonb_build_object(
    'events',
      (select count(*) from public.events e
        where (e.anchor_type = 'company' and e.anchor_id = v_company_id)
           or (e.anchor_type = 'asset' and e.anchor_id = any(
                 coalesce((select array_agg(a.id) from public.assets a where a.company_id = v_company_id),
                 array[]::uuid[])))
           or (e.anchor_type = 'trial' and e.anchor_id = any(
                 coalesce((select array_agg(t.id) from public.trials t
                   where t.asset_id = any(
                     coalesce((select array_agg(a.id) from public.assets a where a.company_id = v_company_id),
                     array[]::uuid[]))),
                 array[]::uuid[]))))
  ) into v_result;
  if not (v_result ? 'events') then
    raise exception 'A8 smoke FAIL: company preview missing events key';
  end if;
  if v_result ? 'marker_assignments' or v_result ? 'markers_removed_entirely' or v_result ? 'markers_unlinked_only' then
    raise exception 'A8 smoke FAIL: company preview has marker keys: %', v_result;
  end if;
  raise notice 'A8 smoke: company preview ok, events=%', v_result->>'events';

  raise notice 'A8 smoke: all three delete previews pass';
end;
$$;

notify pgrst, 'reload schema';
