-- 01_state_machine_guard
-- Asserts the guard trigger rejects illegal state transitions.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id uuid;
  v_caught boolean;
begin
  select id, space_id into v_entity, v_space
  from public.companies order by id limit 1;
  select id into v_user from auth.users order by id limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed data; skipping';
    return;
  end if;

  -- create a published row directly (skip RLS by inserting as superuser via psql)
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by
  ) values (
    v_space, 'company', v_entity, 'published', 'Guard test',
    '', '', '', v_user
  )
  returning id into v_id;

  -- attempt published -> draft (must fail)
  v_caught := false;
  begin
    update public.primary_intelligence set state='draft' where id = v_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected published -> draft to be rejected';
  end if;

  -- archive it
  update public.primary_intelligence set state='archived' where id = v_id;

  -- attempt archived -> anything (must fail)
  v_caught := false;
  begin
    update public.primary_intelligence set state='published' where id = v_id;
  exception when others then
    v_caught := true;
  end;
  if not v_caught then
    raise exception 'expected archived -> published to be rejected';
  end if;

  -- cleanup
  delete from public.primary_intelligence where id = v_id;
end $$;
