-- 03_palette_pinned_rls
-- Asserts that user A cannot read or write user B's pinned rows.

do $$
declare
  v_a uuid;
  v_b uuid;
  v_space uuid;
  v_count int;
begin
  select m1.user_id, m2.user_id, m1.space_id
  into v_a, v_b, v_space
  from public.space_members m1
  join public.space_members m2 on m1.space_id = m2.space_id and m1.user_id <> m2.user_id
  limit 1;

  if v_a is null then
    raise notice 'seed has no pair of users sharing a space; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  insert into public.palette_pinned(user_id, space_id, kind, entity_id, position)
  values (v_a, v_space, 'company', gen_random_uuid(), 0);

  perform set_config('request.jwt.claims', json_build_object('sub', v_b)::text, true);
  select count(*) into v_count from public.palette_pinned where space_id = v_space;
  if v_count <> 0 then
    raise exception 'user B saw % pinned rows; expected 0', v_count;
  end if;

  begin
    insert into public.palette_pinned(user_id, space_id, kind, entity_id, position)
    values (v_a, v_space, 'company', gen_random_uuid(), 0);
    raise exception 'user B was allowed to insert a pin for user A';
  exception when others then
    null;
  end;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);
  delete from public.palette_pinned where user_id = v_a and space_id = v_space;
end $$;
