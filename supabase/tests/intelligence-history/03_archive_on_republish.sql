-- 03_archive_on_republish
-- Asserts upsert_primary_intelligence archives prior published row instead of deleting.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_state text;
  v_archived_count int;
begin
  -- Pick a company whose space sits in a tenant that has an agency with members,
  -- since upsert_primary_intelligence gates on is_agency_member_of_space().
  select c.id, s.id into v_entity, v_space
  from public.companies c
  join public.spaces s on s.id = c.space_id
  join public.tenants t on t.id = s.tenant_id
  where t.agency_id is not null
    and exists (select 1 from public.agency_members am where am.agency_id = t.agency_id)
  order by c.id
  limit 1;
  select am.user_id into v_user
  from public.agency_members am
  join public.tenants t on t.agency_id = am.agency_id
  join public.spaces s on s.tenant_id = t.id
  where s.id = v_space
  order by am.user_id
  limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed user; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);
  perform set_config('role', 'authenticated', true);

  -- v1 publish (no change note required since no prior version)
  v_id1 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V1 headline', '', '', '', 'published', null, '[]'::jsonb
  );

  -- v2 publish via a fresh draft id; must archive v1
  v_id2 := public.upsert_primary_intelligence(
    null, v_space, 'company', v_entity,
    'V2 headline', '', '', '', 'published', 'updated thesis', '[]'::jsonb
  );

  -- Reset role so assertions can read archived rows (RLS hides state='archived'
  -- from authenticated readers; the read policy only exposes draft + published).
  perform set_config('role', 'postgres', true);

  -- v1 should still exist, now archived
  select state into v_state from public.primary_intelligence where id = v_id1;
  if v_state <> 'archived' then
    raise exception 'expected v1 to be archived after republish, got state=%', v_state;
  end if;
  select state into v_state from public.primary_intelligence where id = v_id2;
  if v_state <> 'published' then
    raise exception 'expected v2 to be published, got state=%', v_state;
  end if;

  -- exactly one archived row for this anchor
  select count(*) into v_archived_count
    from public.primary_intelligence
   where space_id = v_space and entity_type='company' and entity_id=v_entity
     and state='archived';
  if v_archived_count <> 1 then
    raise exception 'expected 1 archived row, got %', v_archived_count;
  end if;

  -- cleanup
  delete from public.primary_intelligence where id in (v_id1, v_id2);
end $$;
