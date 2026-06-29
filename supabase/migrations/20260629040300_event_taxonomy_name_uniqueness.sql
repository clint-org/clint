-- Stage 3 Part C (D2): restore taxonomy name-uniqueness that the event-model cutover dropped.
-- Space-scoped uniqueness: NULLs are distinct in a UNIQUE constraint, so system rows (space_id
-- IS NULL) are NOT deduped by this constraint -- a partial unique index dedups those instead.
-- This lets a space reuse a system type/category name (different space_id) while blocking two
-- custom rows with the same name in one space, and blocking two system rows with the same name.

alter table public.event_types
  add constraint event_types_space_name_key unique (space_id, name);
alter table public.event_type_categories
  add constraint event_type_categories_space_name_key unique (space_id, name);

create unique index event_types_system_name_key
  on public.event_types (name) where space_id is null;
create unique index event_type_categories_system_name_key
  on public.event_type_categories (name) where space_id is null;

-- in-migration smoke: a duplicate custom name in the same space is rejected; a custom name
-- reusing a system name (different space_id) is allowed. Wrapped so it is remote-safe on a
-- populated DB (no dependence on a specific seeded space beyond "one exists").
do $$
declare v_space uuid;
begin
  select id into v_space from public.spaces limit 1;
  if v_space is not null then
    -- duplicate custom name in one space -> rejected
    begin
      insert into public.event_type_categories (space_id, name) values (v_space, '__dup_smoke__');
      insert into public.event_type_categories (space_id, name) values (v_space, '__dup_smoke__');
      raise exception 'D2 smoke failed: expected duplicate-name rejection, got none';
    exception when unique_violation then
      null; -- expected
    end;
    delete from public.event_type_categories where space_id = v_space and name = '__dup_smoke__';
  end if;
end $$;

notify pgrst, 'reload schema';
