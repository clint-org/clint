-- 04_change_note_required
-- Asserts upsert_primary_intelligence requires a change_note when republishing
-- (i.e. a prior non-draft version exists for the same anchor).

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_caught boolean;
  v_added_membership boolean := false;
begin
  -- Pick a product whose space sits in a tenant that has an agency with members.
  select p.id, s.id into v_entity, v_space
  from public.products p
  join public.spaces s on s.id = p.space_id
  join public.tenants t on t.id = s.tenant_id
  where t.agency_id is not null
    and exists (select 1 from public.agency_members am where am.agency_id = t.agency_id)
  order by p.id
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

  -- v1 publish with null change_note: must succeed (no prior version yet).
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity,
    'first', '', '', '', 'published', null, '[]'::jsonb
  );

  -- v2 publish with null change_note: must fail.
  v_caught := false;
  begin
    v_id2 := public.upsert_primary_intelligence(
      null, v_space, 'product', v_entity,
      'second', '', '', '', 'published', null, '[]'::jsonb
    );
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected republish without change_note to fail, but it succeeded';
  end if;

  -- v2 publish with valid change_note: must succeed.
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'product', v_entity,
    'second', '', '', '', 'published', 'fixed wording', '[]'::jsonb
  );
  if v_id2 is null then
    raise exception 'expected v2 publish with change_note to succeed';
  end if;

  -- Cleanup data rows we created.
  delete from public.primary_intelligence where id in (v_id1, v_id2);

  -- Cleanup the temporary space membership we may have added.
  if v_added_membership then
    perform set_config('role', 'postgres', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.space_members where space_id = v_space and user_id = v_user;
  end if;
end $$;
