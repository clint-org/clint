-- 06_purge
-- Asserts purge_primary_intelligence requires a matching headline
-- confirmation, deletes a single row by default, and deletes the entire
-- anchor when p_purge_anchor=true.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_count int;
  v_caught boolean;
  v_added_membership boolean := false;
begin
  -- Pick a company whose space sits in a tenant that has an agency with
  -- members. Use desc ordering so this test picks a different company than
  -- test 03 when seed data is large enough to differ.
  select c.id, s.id into v_entity, v_space
  from public.companies c
  join public.spaces s on s.id = c.space_id
  join public.tenants t on t.id = s.tenant_id
  where t.agency_id is not null
    and exists (select 1 from public.agency_members am where am.agency_id = t.agency_id)
  order by c.id desc
  limit 1;
  select am.user_id into v_user
  from public.agency_members am
  join public.tenants t on t.agency_id = am.agency_id
  join public.spaces s on s.tenant_id = t.id
  where s.id = v_space
  order by am.user_id
  limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed data; skipping';
    return;
  end if;

  -- Grant temporary editor space membership so SELECT RLS allows reads.
  if not exists (
    select 1 from public.space_members
     where space_id = v_space and user_id = v_user
  ) then
    insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'editor');
    v_added_membership := true;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  -- v1 publish.
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V1 head', '', '', '', 'published', null, '[]'::jsonb
  );

  -- v2 publish.
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V2 head', '', '', '', 'published', 'shifted', '[]'::jsonb
  );

  -- Purge with wrong confirmation: must fail.
  v_caught := false;
  begin
    perform public.purge_primary_intelligence(v_id2, 'wrong', false);
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected purge with wrong confirmation to fail, but it succeeded';
  end if;

  -- Purge v_id2 with correct confirmation, no anchor purge: only v_id2 deleted.
  perform public.purge_primary_intelligence(v_id2, 'V2 head', false);
  select count(*) into v_count
    from public.primary_intelligence
   where id = v_id2;
  if v_count <> 0 then
    raise exception 'expected v_id2 to be deleted, found % rows', v_count;
  end if;
  select count(*) into v_count
    from public.primary_intelligence
   where id = v_id1;
  if v_count <> 1 then
    raise exception 'expected v_id1 to remain, found % rows', v_count;
  end if;

  -- Purge v_id1 with anchor purge: all rows for the anchor deleted.
  perform public.purge_primary_intelligence(v_id1, 'V1 head', true);
  select count(*) into v_count
    from public.primary_intelligence
   where space_id = v_space and entity_type = 'company' and entity_id = v_entity;
  if v_count <> 0 then
    raise exception 'expected anchor to be empty after purge, found % rows', v_count;
  end if;

  -- No data cleanup needed beyond the purge.

  -- Cleanup the temporary space membership we may have added.
  if v_added_membership then
    perform set_config('role', 'postgres', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.space_members where space_id = v_space and user_id = v_user;
  end if;
end $$;
