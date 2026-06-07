-- Atomically reconcile a trial's indication membership to exactly p_indication_ids,
-- preserving CT.gov-sourced trial_conditions while replacing analyst-linked ones.
-- Also syncs asset_indications for every asset the trial tests.
--
-- get_trial_indications: read-only counterpart returning {id, name} for the trial.

-- =============================================================================
-- 1. set_trial_indications
-- =============================================================================
create or replace function public.set_trial_indications(
  p_trial_id      uuid,
  p_indication_ids uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space      uuid;
  v_ind        record;
  v_cond_id    uuid;
  v_asset_id   uuid;
begin
  select space_id into v_space from public.trials where id = p_trial_id;
  if v_space is null then
    raise exception 'trial not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- reject any indication not belonging to this space
  if exists (
    select 1 from unnest(coalesce(p_indication_ids, array[]::uuid[])) as iid
    where not exists (
      select 1 from public.indications i
      where i.id = iid and i.space_id = v_space
    )
  ) then
    raise exception 'indication not in space' using errcode = '42501';
  end if;

  -- upsert condition + map + trial link for each selected indication
  for v_ind in
    select id, name from public.indications
    where id = any(coalesce(p_indication_ids, array[]::uuid[]))
      and space_id = v_space
  loop
    -- ensure condition exists
    insert into public.conditions (space_id, name, source)
      values (v_space, v_ind.name, 'analyst')
      on conflict (space_id, name) do nothing;

    select id into v_cond_id
      from public.conditions
     where space_id = v_space and name = v_ind.name;

    -- ensure condition <-> indication map exists
    insert into public.condition_indication_map (condition_id, indication_id)
      values (v_cond_id, v_ind.id)
      on conflict do nothing;

    -- link trial to condition
    insert into public.trial_conditions (trial_id, condition_id, source)
      values (p_trial_id, v_cond_id, 'analyst')
      on conflict do nothing;
  end loop;

  -- replace semantics: drop analyst trial_conditions whose condition maps to
  -- indications and none of those indications is in p_indication_ids.
  -- leaves source='ctgov' links and indication-less analyst conditions untouched.
  delete from public.trial_conditions tc
  where tc.trial_id = p_trial_id
    and tc.source = 'analyst'
    and exists (
      select 1 from public.condition_indication_map cim
      where cim.condition_id = tc.condition_id
    )
    and not exists (
      select 1 from public.condition_indication_map cim
      where cim.condition_id = tc.condition_id
        and cim.indication_id = any(coalesce(p_indication_ids, array[]::uuid[]))
    );

  -- sync asset_indications for every asset the trial tests
  for v_asset_id in
    select asset_id from public.trial_assets where trial_id = p_trial_id
  loop
    perform public._sync_asset_indications(v_asset_id);
  end loop;
end;
$$;

revoke execute on function public.set_trial_indications(uuid, uuid[]) from public;
grant execute on function public.set_trial_indications(uuid, uuid[]) to authenticated;

comment on function public.set_trial_indications(uuid, uuid[]) is
  'Atomically reconcile a trial''s indication membership to exactly p_indication_ids. Upserts conditions + maps, links trial_conditions (source=analyst), drops analyst links for removed indications (preserves ctgov links), and syncs asset_indications for every asset the trial tests. Caller must hold owner/editor on the space.';

-- =============================================================================
-- 2. get_trial_indications
-- =============================================================================
create or replace function public.get_trial_indications(
  p_trial_id uuid
) returns table(indication_id uuid, indication_name text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space uuid;
begin
  select space_id into v_space from public.trials where id = p_trial_id;
  if v_space is null then
    raise exception 'trial not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select distinct i.id, i.name::text
      from public.trial_conditions tc
      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
      join public.indications i on i.id = cim.indication_id
     where tc.trial_id = p_trial_id
       and i.space_id = v_space
     order by i.name::text;
end;
$$;

revoke execute on function public.get_trial_indications(uuid) from public;
grant execute on function public.get_trial_indications(uuid) to authenticated;

comment on function public.get_trial_indications(uuid) is
  'Returns the distinct indications linked to a trial via trial_conditions -> condition_indication_map -> indications, as (indication_id, indication_name). Any space member may call this.';

-- =============================================================================
-- smoke test: set + get + replace semantics + viewer rejection
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'eeee5555-0001-0001-0001-eeee55550001';
  v_tenant_id  uuid := 'eeee5555-0002-0002-0002-eeee55550002';
  v_owner      uuid := 'eeee5555-0003-0003-0003-eeee55550003';
  v_viewer     uuid := 'eeee5555-0004-0004-0004-eeee55550004';
  v_space_id   uuid := 'eeee5555-0005-0005-0005-eeee55550005';
  v_company_id uuid := 'eeee5555-0006-0006-0006-eeee55550006';
  v_asset_a    uuid := 'eeee5555-0007-0007-0007-eeee55550007';
  v_asset_b    uuid := 'eeee5555-0008-0008-0008-eeee55550008';
  v_trial      uuid := 'eeee5555-0009-0009-0009-eeee55550009';
  v_ind_a      uuid := 'eeee5555-000a-000a-000a-eeee5555000a';
  v_ind_b      uuid := 'eeee5555-000b-000b-000b-eeee5555000b';
  v_count      bigint;
  v_names      text[];
  v_caught     boolean;
begin
  -- fixtures in FK order
  insert into auth.users (id, email, instance_id, aud, role)
    values (v_owner,  'sti-smoke-owner@invalid.local',  '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
           (v_viewer, 'sti-smoke-viewer@invalid.local', '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'STI5', 'sti5', 'sti5', 'STI5', 'sti5@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'STI5', 'sti5-t', 'sti5t', 'STI5');
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner,  'owner'),
           (v_space_id, v_viewer, 'viewer');
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner, 'STI5 Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_a, v_space_id, v_owner, v_company_id, 'STI5-AssetA'),
           (v_asset_b, v_space_id, v_owner, v_company_id, 'STI5-AssetB');
  -- trial bootstrap trigger auto-creates a primary trial_assets row for asset_a
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space_id, v_owner, v_asset_a, 'STI5 Trial', 'NCT-STI5-001');
  -- add asset_b to this trial as a second asset
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_b, false, 'analyst');
  -- indications
  insert into public.indications (id, space_id, name, created_by)
    values (v_ind_a, v_space_id, 'STI5-Oncology',    v_owner),
           (v_ind_b, v_space_id, 'STI5-Immunology',  v_owner);

  -- impersonate the owner
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', 'sti-smoke-owner@invalid.local')::text,
    true
  );

  -- assertion (a): set both indications; expect both linked + asset_indications
  perform public.set_trial_indications(v_trial, array[v_ind_a, v_ind_b]);

  -- check get_trial_indications returns both
  select array_agg(gti.indication_name order by gti.indication_name) into v_names
    from public.get_trial_indications(v_trial) gti;
  if v_names is null or array_length(v_names, 1) <> 2 then
    raise exception 'set_trial_indications smoke FAIL (a): expected 2 indications from get_trial_indications, got %', v_names;
  end if;

  -- check asset_indications for asset_a covers both indications
  select count(*) into v_count
    from public.asset_indications
   where asset_id = v_asset_a
     and indication_id = any(array[v_ind_a, v_ind_b]);
  if v_count <> 2 then
    raise exception 'set_trial_indications smoke FAIL (a): expected 2 asset_indications for asset_a, got %', v_count;
  end if;

  -- check asset_indications for asset_b also covers both indications
  select count(*) into v_count
    from public.asset_indications
   where asset_id = v_asset_b
     and indication_id = any(array[v_ind_a, v_ind_b]);
  if v_count <> 2 then
    raise exception 'set_trial_indications smoke FAIL (a): expected 2 asset_indications for asset_b, got %', v_count;
  end if;

  raise notice 'set_trial_indications smoke ok (a): set 2 indications, both linked + asset_indications';

  -- assertion (b): reduce to just ind_a; ind_b should be dropped
  perform public.set_trial_indications(v_trial, array[v_ind_a]);

  select array_agg(gti.indication_name order by gti.indication_name) into v_names
    from public.get_trial_indications(v_trial) gti;
  if v_names is null or array_length(v_names, 1) <> 1 or v_names[1] <> 'STI5-Oncology' then
    raise exception 'set_trial_indications smoke FAIL (b): expected only STI5-Oncology, got %', v_names;
  end if;

  raise notice 'set_trial_indications smoke ok (b): replace semantics dropped ind_b, kept ind_a';

  -- assertion (c): viewer is rejected with 42501
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', 'sti-smoke-viewer@invalid.local')::text,
    true
  );

  v_caught := false;
  begin
    perform public.set_trial_indications(v_trial, array[v_ind_a]);
    v_caught := false;
  exception when others then
    if sqlstate <> '42501' then
      raise exception 'set_trial_indications smoke FAIL (c): expected 42501, got % (%)', sqlstate, sqlerrm;
    end if;
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'set_trial_indications smoke FAIL (c): viewer was not rejected';
  end if;

  raise notice 'set_trial_indications smoke ok (c): viewer rejected with 42501';

  -- teardown
  perform set_config('request.jwt.claims', '', true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.asset_indications   where space_id = v_space_id;
  delete from public.trial_conditions    where trial_id = v_trial;
  delete from public.condition_indication_map
    where condition_id in (select id from public.conditions where space_id = v_space_id);
  delete from public.conditions          where space_id = v_space_id;
  delete from public.indications         where space_id = v_space_id;
  delete from public.trial_assets        where trial_id = v_trial;
  delete from public.trials              where id = v_trial;
  delete from public.assets              where space_id = v_space_id;
  delete from public.companies           where space_id = v_space_id;
  delete from public.space_members       where space_id = v_space_id;
  delete from public.tenant_members      where tenant_id = v_tenant_id;
  delete from public.spaces              where id = v_space_id;
  delete from public.tenants             where id = v_tenant_id;
  delete from public.agencies            where id = v_agency_id;
  delete from auth.users                 where id in (v_owner, v_viewer);
  perform set_config('clint.member_guard_cascade', 'off', true);
end $$;

notify pgrst, 'reload schema';
