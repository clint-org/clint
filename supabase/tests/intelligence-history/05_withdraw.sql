-- 05_withdraw
-- Asserts withdraw_primary_intelligence transitions a published row to
-- 'withdrawn', requires a non-empty change_note, and rejects re-withdraw.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_state text;
  v_withdrawn_at timestamptz;
  v_caught boolean;
  v_added_membership boolean := false;
begin
  -- Pick a marker whose space sits in a tenant that has an agency with members.
  select m.id, s.id into v_entity, v_space
  from public.markers m
  join public.spaces s on s.id = m.space_id
  join public.tenants t on t.id = s.tenant_id
  where t.agency_id is not null
    and exists (select 1 from public.agency_members am where am.agency_id = t.agency_id)
  order by m.id
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
    null, v_space, 'marker', v_entity,
    'to withdraw', '', '', '', 'published', null, '[]'::jsonb
  );

  -- Withdraw with empty change_note: must fail.
  v_caught := false;
  begin
    perform public.withdraw_primary_intelligence(v_id1, '');
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected withdraw with empty change_note to fail, but it succeeded';
  end if;

  -- Withdraw with valid change_note: must succeed.
  perform public.withdraw_primary_intelligence(v_id1, 'no longer accurate');
  select state, withdrawn_at into v_state, v_withdrawn_at
    from public.primary_intelligence where id = v_id1;
  if v_state is null then
    raise exception 'expected withdrawn row to be readable, got null (RLS hid the row)';
  end if;
  if v_state <> 'withdrawn' then
    raise exception 'expected state=withdrawn, got %', v_state;
  end if;
  if v_withdrawn_at is null then
    raise exception 'expected withdrawn_at to be stamped, got null';
  end if;

  -- Withdraw again: must fail (not in published state anymore).
  v_caught := false;
  begin
    perform public.withdraw_primary_intelligence(v_id1, 'second try');
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected re-withdraw to fail, but it succeeded';
  end if;

  -- Cleanup data row we created.
  delete from public.primary_intelligence where id = v_id1;

  -- Cleanup the temporary space membership we may have added.
  if v_added_membership then
    perform set_config('role', 'postgres', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.space_members where space_id = v_space and user_id = v_user;
  end if;
end $$;
