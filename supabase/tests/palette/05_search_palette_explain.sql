-- 05_search_palette_explain
-- Asserts that a representative trigram query uses a *_trgm GIN index.

do $$
declare
  v_user uuid;
  v_space uuid;
  v_plan jsonb;
  v_uses_trgm boolean := false;
begin
  select user_id, space_id into v_user, v_space
  from public.space_members order by created_at asc limit 1;
  if v_user is null then raise notice 'no seed; skip'; return; end if;

  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  execute 'explain (format json) select * from public.markers where space_id = $1 and title % $2'
  into v_plan
  using v_space, 'KEY';

  v_uses_trgm := position('markers_title_trgm' in v_plan::text) > 0;
  if not v_uses_trgm then
    raise exception 'markers title trigram query did not use markers_title_trgm; plan: %', v_plan;
  end if;
end $$;
