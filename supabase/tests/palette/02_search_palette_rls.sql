-- 02_search_palette_rls
-- Asserts that a caller without space_members access gets empty results.

do $$
declare
  v_outsider uuid;
  v_space uuid;
  v_count int;
begin
  -- pick a space and an authenticated user not in it
  select s.id into v_space
  from public.spaces s
  order by s.created_at asc
  limit 1;

  select u.id into v_outsider
  from auth.users u
  where not exists (
    select 1 from public.space_members m where m.user_id = u.id and m.space_id = v_space
  )
  order by u.created_at asc
  limit 1;

  if v_space is null or v_outsider is null then
    raise notice 'seed has no outsider/space pair to test; skipping';
    return;
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_outsider)::text, true);
  select count(*) into v_count from public.search_palette(v_space, 'a really long generic query', null, 25);
  if v_count <> 0 then
    raise exception 'outsider got % rows for space %; expected 0', v_count, v_space;
  end if;
end $$;
