-- 02_version_stamping
-- Asserts BEFORE trigger stamps version_number and published_at on entry into published.

do $$
declare
  v_space uuid;
  v_entity uuid;
  v_user uuid;
  v_id1 uuid;
  v_id2 uuid;
  v_n1 int;
  v_n2 int;
  v_pa1 timestamptz;
begin
  select id, space_id into v_entity, v_space
  from public.products order by id limit 1;
  select id into v_user from auth.users order by id limit 1;
  if v_space is null or v_entity is null or v_user is null then
    raise notice 'no seed data; skipping';
    return;
  end if;

  -- first publish gets v1
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by
  ) values (v_space, 'product', v_entity, 'published', 'V1', '', '', v_user)
  returning id, version_number, published_at into v_id1, v_n1, v_pa1;

  if v_n1 <> 1 then raise exception 'expected v1, got %', v_n1; end if;
  if v_pa1 is null then raise exception 'expected published_at to be stamped'; end if;

  -- archive the first
  update public.primary_intelligence set state='archived' where id = v_id1;

  -- new publish gets v2
  insert into public.primary_intelligence (
    space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by
  ) values (v_space, 'product', v_entity, 'published', 'V2', '', '', v_user)
  returning id, version_number into v_id2, v_n2;

  if v_n2 <> 2 then raise exception 'expected v2, got %', v_n2; end if;

  -- editing the published row in place must not re-stamp version_number
  update public.primary_intelligence set headline='V2 edited' where id = v_id2;
  select version_number into v_n2 from public.primary_intelligence where id = v_id2;
  if v_n2 <> 2 then raise exception 'expected version_number to remain 2 after in-place edit, got %', v_n2; end if;

  -- cleanup
  delete from public.primary_intelligence where id in (v_id1, v_id2);
end $$;
