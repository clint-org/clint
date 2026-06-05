-- Phase 2d: preview_asset_delete reflects multi-asset delete semantics.
--
-- Deleting an asset now only deletes trials whose ONLY asset is that one; trials
-- that also test other assets survive (they keep the others). The preview counts
-- the fully-deleted trials in 'trials' and reports the surviving multi-asset ones
-- in a new 'trials_unlinked' field. Body is the definition from 20260524120500
-- with only the trial collection changed.

create or replace function public.preview_asset_delete(p_asset_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid := auth.uid();
  v_space_id uuid;
  v_trial_ids uuid[];
  v_n_trials bigint;
  v_n_trials_unlinked bigint;
  v_n_trial_notes bigint;
  v_n_events bigint;
  v_n_material_links bigint;
  v_n_primary_intelligence bigint;
  v_n_primary_intelligence_links bigint;
  v_n_marker_assignments bigint;
  v_n_markers_removed_entirely bigint;
  v_n_markers_unlinked_only bigint;
begin
  if v_uid is null then raise exception 'not authenticated' using errcode = '28000'; end if;
  select a.space_id into v_space_id from public.assets a where a.id = p_asset_id;
  if v_space_id is null then raise exception 'asset % not found', p_asset_id using errcode = 'P0002'; end if;
  if not public.has_space_access(v_space_id) then raise exception 'not authorized' using errcode = '42501'; end if;

  -- Trials FULLY deleted with this asset: those whose ONLY asset is this one.
  -- Multi-asset trials survive (they keep other assets) and are reported as unlinked.
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
  select count(*) into v_n_events from public.events e where e.asset_id = p_asset_id or e.trial_id = any(v_trial_ids);
  select count(*) into v_n_material_links from public.material_links ml
    where (ml.entity_type = 'asset' and ml.entity_id = p_asset_id)
       or (ml.entity_type = 'trial' and ml.entity_id = any(v_trial_ids));
  select count(*) into v_n_primary_intelligence from public.primary_intelligence pi
    where (pi.entity_type = 'asset' and pi.entity_id = p_asset_id)
       or (pi.entity_type = 'trial' and pi.entity_id = any(v_trial_ids));
  select count(*) into v_n_primary_intelligence_links from public.primary_intelligence_links pil
    where (pil.entity_type = 'asset' and pil.entity_id = p_asset_id)
       or (pil.entity_type = 'trial' and pil.entity_id = any(v_trial_ids));
  select count(*) into v_n_marker_assignments from public.marker_assignments ma where ma.trial_id = any(v_trial_ids);

  with reachable as (
    select distinct ma.marker_id from public.marker_assignments ma where ma.trial_id = any(v_trial_ids)
  ), split as (
    select rm.marker_id,
      not exists (select 1 from public.marker_assignments ma2 where ma2.marker_id = rm.marker_id and ma2.trial_id <> all(v_trial_ids)) as removed_entirely
    from reachable rm
  )
  select count(*) filter (where removed_entirely), count(*) filter (where not removed_entirely)
    into v_n_markers_removed_entirely, v_n_markers_unlinked_only from split;

  return jsonb_build_object(
    'trials', v_n_trials, 'trials_unlinked', v_n_trials_unlinked, 'trial_notes', v_n_trial_notes, 'events', v_n_events,
    'material_links', v_n_material_links, 'primary_intelligence', v_n_primary_intelligence,
    'primary_intelligence_links', v_n_primary_intelligence_links,
    'marker_assignments', v_n_marker_assignments,
    'markers_removed_entirely', v_n_markers_removed_entirely,
    'markers_unlinked_only', v_n_markers_unlinked_only
  );
end;
$$;

-- Smoke: a two-asset trial is reported as unlinked (not deleted) when one of its
-- assets is previewed for deletion; a sole-asset trial is reported as deleted.
do $$
declare
  v_owner   uuid := 'dddd1010-0001-0001-0001-dddddddd0001';
  v_agency  uuid := 'dddd1010-0002-0002-0002-dddddddd0002';
  v_tenant  uuid := 'dddd1010-0003-0003-0003-dddddddd0003';
  v_space   uuid := 'dddd1010-0004-0004-0004-dddddddd0004';
  v_company uuid := 'dddd1010-0005-0005-0005-dddddddd0005';
  v_asset_a uuid := 'dddd1010-0006-0006-0006-dddddddd0006';
  v_asset_b uuid := 'dddd1010-0007-0007-0007-dddddddd0007';
  v_asset_c uuid := 'dddd1010-0008-0008-0008-dddddddd0008';
  v_t_multi uuid;
  v_t_sole  uuid;
  v_prev    jsonb;
begin
  insert into auth.users (id, email) values (v_owner, 'pad-ma-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Pad', 'pad', 'pad', 'Pad', 'pad@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'Pad', 'pad-t', 'padt', 'Pad');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Pad Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space, v_owner, v_company, 'PadAssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'PadAssetB');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_c, v_space, v_owner, v_company, 'PadAssetC');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);
  v_t_multi := public.create_trial(v_space, v_asset_a, 'Pad Multi', 'NCT-PAD-001', 'Active', 'P3', null, null, null, null);
  perform public.set_trial_assets(v_t_multi, array[v_asset_a, v_asset_b], v_asset_a);
  v_t_sole := public.create_trial(v_space, v_asset_c, 'Pad Sole', 'NCT-PAD-002', 'Active', 'P2', null, null, null, null);

  -- Previewing deletion of asset_b: the multi-asset trial is unlinked, not deleted.
  v_prev := public.preview_asset_delete(v_asset_b);
  if (v_prev->>'trials')::int <> 0 then
    raise exception 'pad-ma FAIL: asset_b preview reported % deleted trials, expected 0', v_prev->>'trials';
  end if;
  if (v_prev->>'trials_unlinked')::int <> 1 then
    raise exception 'pad-ma FAIL: asset_b preview reported % unlinked, expected 1', v_prev->>'trials_unlinked';
  end if;

  -- Previewing deletion of asset_c: its sole-asset trial is deleted.
  v_prev := public.preview_asset_delete(v_asset_c);
  if (v_prev->>'trials')::int <> 1 then
    raise exception 'pad-ma FAIL: asset_c preview reported % deleted trials, expected 1', v_prev->>'trials';
  end if;
  if (v_prev->>'trials_unlinked')::int <> 0 then
    raise exception 'pad-ma FAIL: asset_c preview reported % unlinked, expected 0', v_prev->>'trials_unlinked';
  end if;

  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'pad-ma smoke ok: multi-asset trial unlinked not deleted; sole-asset trial deleted';
end $$;
