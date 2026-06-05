-- Reconcile a trial's asset membership to exactly p_asset_ids, with
-- p_primary_asset_id (default: first element) marked primary. One transaction;
-- the sync trigger updates trials.asset_id. Rejects an empty set (a trial must
-- always keep at least one asset). Demote-then-promote runs in two statements so
-- the partial unique index (at most one primary) holds at each step; the sync
-- trigger does not auto-promote on UPDATE, so no second primary is created.
create or replace function public.set_trial_assets(
  p_trial_id         uuid,
  p_asset_ids        uuid[],
  p_primary_asset_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space   uuid;
  v_primary uuid;
begin
  select space_id into v_space from public.trials where id = p_trial_id;
  if v_space is null then
    raise exception 'trial not found' using errcode = 'P0002';
  end if;
  if not public.has_space_access(v_space) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_asset_ids is null or array_length(p_asset_ids, 1) is null then
    raise exception 'a trial must have at least one asset' using errcode = '23514';
  end if;

  v_primary := coalesce(p_primary_asset_id, p_asset_ids[1]);
  if not (v_primary = any(p_asset_ids)) then
    raise exception 'primary asset must be one of the asset ids' using errcode = '22023';
  end if;

  delete from public.trial_assets
   where trial_id = p_trial_id and not (asset_id = any(p_asset_ids));

  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  select p_trial_id, a, false, 'analyst'
    from unnest(p_asset_ids) a
  on conflict (trial_id, asset_id) do nothing;

  update public.trial_assets set is_primary = false
   where trial_id = p_trial_id and is_primary;
  update public.trial_assets set is_primary = true
   where trial_id = p_trial_id and asset_id = v_primary;
end;
$$;

revoke execute on function public.set_trial_assets(uuid, uuid[], uuid) from public;
grant execute on function public.set_trial_assets(uuid, uuid[], uuid) to authenticated;

comment on function public.set_trial_assets(uuid, uuid[], uuid) is
  'Atomically reconcile a trial''s asset membership to p_asset_ids with p_primary_asset_id marked primary. Used by commit_source_import and the trial-edit UI. The sync trigger updates trials.asset_id.';

-- =============================================================================
-- smoke: grow + repoint + shrink + reject-empty
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'dddd4444-0001-0001-0001-dddd44440001';
  v_tenant_id  uuid := 'dddd4444-0002-0002-0002-dddd44440002';
  v_owner      uuid := 'dddd4444-0003-0003-0003-dddd44440003';
  v_space_id   uuid := 'dddd4444-0004-0004-0004-dddd44440004';
  v_company_id uuid := 'dddd4444-0005-0005-0005-dddd44440005';
  v_asset_a    uuid := 'dddd4444-0006-0006-0006-dddd44440006';
  v_asset_b    uuid := 'dddd4444-0007-0007-0007-dddd44440007';
  v_trial      uuid := 'dddd4444-0008-0008-0008-dddd44440008';
  v_count      bigint;
  v_primary    uuid;
  v_empty_ok   boolean := false;
begin
  -- fixtures in FK order
  insert into auth.users (id, email) values (v_owner, 'trial-assets-t4-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'TA4', 'ta4', 'ta4', 'TA4', 'ta4@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'TA4', 'ta4-t', 'ta4t', 'TA4');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner, 'TA4 Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space_id, v_owner, v_company_id, 'AssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space_id, v_owner, v_company_id, 'AssetB');
  -- trial bootstrap trigger auto-creates a primary trial_assets row for asset_a
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space_id, v_owner, v_asset_a, 'TA4 Trial', 'NCT-TA4-001');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- assertion 1: GROW + REPOINT: add asset_b; make it primary
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_b);
  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 2 then
    raise exception 'set_trial_assets smoke FAIL: expected 2 memberships after grow, got %', v_count;
  end if;
  select asset_id into v_primary from public.trials where id = v_trial;
  if v_primary <> v_asset_b then
    raise exception 'set_trial_assets smoke FAIL: expected trials.asset_id=asset_b after repoint, got %', v_primary;
  end if;

  -- assertion 2: SHRINK: reduce back to just asset_a as primary
  perform public.set_trial_assets(v_trial, array[v_asset_a], v_asset_a);
  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 1 then
    raise exception 'set_trial_assets smoke FAIL: expected 1 membership after shrink, got %', v_count;
  end if;
  select asset_id into v_primary from public.trials where id = v_trial;
  if v_primary <> v_asset_a then
    raise exception 'set_trial_assets smoke FAIL: expected trials.asset_id=asset_a after shrink, got %', v_primary;
  end if;

  -- assertion 3: REJECT EMPTY: an empty array must raise check_violation (23514)
  begin
    perform public.set_trial_assets(v_trial, array[]::uuid[], null);
    v_empty_ok := true;
  exception when check_violation then
    null;
  end;
  if v_empty_ok then
    raise exception 'set_trial_assets smoke FAIL: empty set accepted';
  end if;

  raise notice 'set_trial_assets smoke ok: grow + repoint + shrink + reject-empty';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);
end $$;
