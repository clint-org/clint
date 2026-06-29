-- migration: 20260629000000_restore_event_cleanup_trigger
-- purpose: restore the AFTER DELETE cleanup trigger on public.events that was
--   cascade-dropped when 20260628070739_drop_marker_event_tables.sql ran
--   DROP TABLE public.events CASCADE. The new events table created in
--   20260628071042_events_table.sql was built without the trigger, so deleting
--   an event now orphans its material_links and primary_intelligence_links rows.
--   The trigger function public._cleanup_polymorphic_refs() still exists and
--   correctly handles tg_argv[0]='event'. Only the trigger binding is missing.

drop trigger if exists _cleanup_polymorphic_refs_event on public.events;
create trigger _cleanup_polymorphic_refs_event
  after delete on public.events
  for each row execute function public._cleanup_polymorphic_refs('event');

-- ============================================================================
-- In-file smoke: prod-safe, data-conditional, self-cleaning.
-- Proves that deleting an event removes its material_links row via the AFTER
-- DELETE cleanup trigger, while the material row itself survives.
-- ============================================================================
do $$
declare
  v_space    uuid := '00000000-0000-0000-0000-0000000d0100';
  v_uid      uuid;
  v_type     uuid;
  v_event    uuid;
  v_material uuid;
  v_links    int;
  v_mats     int;
begin
  if not exists (select 1 from public.spaces where id = v_space) then
    raise notice 'Evtrig smoke: demo space absent (prod-safe skip)';
    return;
  end if;
  select user_id into v_uid from public.space_members
    where space_id = v_space and role = 'owner' limit 1;
  if v_uid is null then
    raise notice 'Evtrig smoke: no owner for demo space (prod-safe skip)';
    return;
  end if;
  select id into v_type from public.event_types where space_id is null limit 1;

  -- create a space-anchored event (anchor_id not required when anchor_type='space')
  insert into public.events
    (space_id, event_type_id, title, event_date, anchor_type, created_by)
    values (v_space, v_type, 'Evtrig Smoke Event', '2026-01-01', 'space', v_uid)
    returning id into v_event;

  -- create a material and a material_links row pointing at the event
  insert into public.materials
    (space_id, uploaded_by, file_path, file_name, file_size_bytes, mime_type, material_type, title)
    values (v_space, v_uid,
            'smoke/evtrig-material.pdf', 'evtrig-material.pdf',
            1024, 'application/pdf', 'briefing', 'Evtrig Smoke Material')
    returning id into v_material;
  insert into public.material_links (material_id, entity_type, entity_id)
    values (v_material, 'event', v_event);

  -- delete the event: the AFTER DELETE trigger must sweep the material_links row
  delete from public.events where id = v_event;

  select count(*) into v_links
    from public.material_links where entity_type = 'event' and entity_id = v_event;
  if v_links <> 0 then
    raise exception 'Evtrig smoke FAIL: material_links not deleted after event delete (count=%)', v_links;
  end if;

  -- the material itself must survive (the cascade is material -> material_links, not the reverse)
  select count(*) into v_mats from public.materials where id = v_material;
  if v_mats <> 1 then
    raise exception 'Evtrig smoke FAIL: material unexpectedly gone after event delete (count=%)', v_mats;
  end if;

  -- cleanup: remove the material (cascades any remaining material_links)
  delete from public.materials where id = v_material;
  raise notice 'Evtrig smoke: PASS';
end$$;

notify pgrst, 'reload schema';
