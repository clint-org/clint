-- 07_history_payload
-- Asserts get_primary_intelligence_history returns the expected payload shape:
-- a current published row plus versions ordered desc by version_number.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_payload jsonb;
  v_versions_count int;
  v_top_version int;
  v_added_membership boolean := false;
begin
  -- Pick a product whose space sits in a tenant that has an agency with
  -- members. Use desc ordering so this test picks a different product than
  -- test 02 (which orders ascending) when seed data is large enough to differ.
  select p.id, s.id into v_entity, v_space
  from public.products p
  join public.spaces s on s.id = p.space_id
  join public.tenants t on t.id = s.tenant_id
  where t.agency_id is not null
    and exists (select 1 from public.agency_members am where am.agency_id = t.agency_id)
  order by p.id desc
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

  -- v1 publish, no change_note (first publish)
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'A', '', '', '', 'published', null, '[]'::jsonb
  );
  -- v2 publish with change_note
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity, 'B', '', '', '', 'published', 'rev', '[]'::jsonb
  );

  v_payload := public.get_primary_intelligence_history(v_space, 'product', v_entity);

  if v_payload->'current' is null or (v_payload->'current'->>'state') <> 'published' then
    raise exception 'expected current to be the published row';
  end if;
  v_versions_count := jsonb_array_length(v_payload->'versions');
  if v_versions_count <> 2 then
    raise exception 'expected 2 versions, got %', v_versions_count;
  end if;
  v_top_version := (v_payload->'versions'->0->>'version_number')::int;
  if v_top_version <> 2 then
    raise exception 'expected versions ordered desc with v2 first, got %', v_top_version;
  end if;

  -- cleanup via purge anchor (instead of plain delete) to validate that path
  perform public.purge_primary_intelligence(v_id2, 'B', true);

  -- Cleanup the temporary space membership we may have added.
  if v_added_membership then
    perform set_config('role', 'postgres', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.space_members where space_id = v_space and user_id = v_user;
  end if;
end $$;
