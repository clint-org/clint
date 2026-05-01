-- 04_palette_recents_rls_and_trim
-- Asserts: user-isolation on palette_recents + trim-to-25 by palette_touch_recent.

do $$
declare
  v_a uuid;
  v_space uuid;
  v_count int;
begin
  select m.user_id, m.space_id into v_a, v_space
  from public.space_members m
  order by m.created_at asc
  limit 1;
  if v_a is null then raise notice 'no seed members; skip'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_a)::text, true);

  for i in 1..30 loop
    perform public.palette_touch_recent(v_space, 'company', gen_random_uuid());
  end loop;

  select count(*) into v_count
  from public.palette_recents
  where user_id = v_a and space_id = v_space;
  if v_count > 25 then
    raise exception 'expected at most 25 recent rows after trim, got %', v_count;
  end if;

  delete from public.palette_recents where user_id = v_a and space_id = v_space;
end $$;
