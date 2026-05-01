-- 01_search_palette_ranking
-- Asserts search_palette ranks results sensibly against the seeded pharma demo space.

do $$
declare
  v_user uuid;
  v_space uuid;
  v_top_kind text;
  v_top_name text;
  v_count int;
  v_ident text;
  v_trial_id uuid;
begin
  -- pick the first user that has any space membership
  select user_id, space_id into v_user, v_space
  from public.space_members
  order by created_at asc
  limit 1;
  if v_user is null then
    raise notice 'seed has no space_members; cannot run ranking test';
    return;
  end if;

  -- impersonate that user
  perform set_config('request.jwt.claims', json_build_object('sub', v_user)::text, true);

  -- query 'KEYNOTE' should return at least one trial (if such a trial exists in seed)
  select count(*) into v_count
  from public.search_palette(v_space, 'KEYNOTE', null, 25)
  where kind = 'trial';
  -- not strictly required; just log if zero
  if v_count = 0 then
    raise notice 'no trial named KEYNOTE in seed for this space';
  end if;

  -- query a trial identifier that exists in seed
  select identifier, id into v_ident, v_trial_id
  from public.trials
  where space_id = v_space and identifier is not null
  order by id limit 1;
  if v_ident is not null then
    select kind, id::text into v_top_kind, v_top_name
    from public.search_palette(v_space, v_ident, null, 1);
    if v_top_kind is null or v_top_kind <> 'trial' then
      raise exception 'expected identifier exact-match to return a trial, got % %', v_top_kind, v_top_name;
    end if;
  end if;

  -- query under 2 chars returns nothing
  select count(*) into v_count from public.search_palette(v_space, 'a', null, 25);
  if v_count <> 0 then
    raise exception 'expected zero results for 1-char query, got %', v_count;
  end if;

  -- a 2+ char query against any common token should return >0 rows of any kind
  select count(*) into v_count from public.search_palette(v_space, 'an', null, 25);
  if v_count = 0 then
    raise notice 'no rows for query "an"; seed may have no matching titles';
  end if;
end $$;
