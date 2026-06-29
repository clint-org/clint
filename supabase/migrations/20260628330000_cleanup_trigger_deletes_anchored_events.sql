-- migration: 20260628330000_cleanup_trigger_deletes_anchored_events
-- purpose: extend _cleanup_polymorphic_refs so that deleting a trial, asset,
--   or company also removes events anchored to that entity. events.anchor_id
--   carries NO foreign key constraint (polymorphic anchor), so an entity delete
--   would otherwise silently orphan its events and cause preview_*_delete
--   footprint counts to lie. event_sources.event_id has ON DELETE CASCADE, so
--   event_sources rows are cleaned up automatically when their event is deleted.
--
-- change: byte-identical to the live body EXCEPT for the new events delete
--   block added before return old;. Captured from pg_get_functiondef to avoid
--   stale-base clobber.

create or replace function public._cleanup_polymorphic_refs()
 returns trigger
 language plpgsql
 security definer
 set search_path to ''
as $function$
declare
  v_type text := tg_argv[0];
begin
  -- links that POINT TO the deleted entity as a target
  delete from public.primary_intelligence_links
    where entity_type = v_type and entity_id = old.id;
  -- briefs OWNED by the deleted entity (only the four owner types match the CHECK)
  delete from public.primary_intelligence_anchors
    where entity_type = v_type and entity_id = old.id;
  -- asset/product value split: asset trigger fires with v_type='asset', but
  -- primary_intelligence_anchors stores entity_type='product' for assets
  -- (the pre-rename type; 'asset' is forbidden by CHECK). Delete 'product'
  -- anchors when the deleted entity is an asset so briefs are not orphaned.
  if v_type = 'asset' then
    delete from public.primary_intelligence_anchors
      where entity_type = 'product' and entity_id = old.id;
  end if;
  delete from public.material_links
    where entity_type = v_type and entity_id = old.id;
  -- anchored events have no FK on anchor_id -> delete them so an entity
  -- delete does not orphan its events (event_sources cascades from events).
  delete from public.events
    where anchor_type = v_type and anchor_id = old.id;
  return old;
end;
$function$;

-- ============================================================================
-- In-file smoke: prod-safe, data-conditional, self-cleaning.
-- Proves that deleting a trial removes the event anchored to it AND the
-- event_sources row attached to that event. Runs only when the demo space
-- and a usable owner are present.
-- ============================================================================
do $$
declare
  v_space   uuid := '00000000-0000-0000-0000-0000000d0100';
  v_uid     uuid;
  v_company uuid;
  v_asset   uuid;
  v_trial   uuid;
  v_type    uuid;
  v_event   uuid;
  v_events  int;
  v_sources int;
begin
  if not exists (select 1 from public.spaces where id = v_space) then
    raise notice 'Dtrig smoke: demo space absent (prod-safe skip)';
    return;
  end if;
  select user_id into v_uid from public.space_members
    where space_id = v_space and role = 'owner' limit 1;
  if v_uid is null then
    raise notice 'Dtrig smoke: no owner for demo space (prod-safe skip)';
    return;
  end if;
  select id into v_type from public.event_types where space_id is null limit 1;

  insert into public.companies (space_id, name, created_by)
    values (v_space, 'Dtrig Smoke Co', v_uid) returning id into v_company;
  insert into public.assets (space_id, company_id, name, created_by)
    values (v_space, v_company, 'Dtrig Smoke Asset', v_uid) returning id into v_asset;
  insert into public.trials (space_id, asset_id, name, created_by)
    values (v_space, v_asset, 'Dtrig Smoke Trial', v_uid) returning id into v_trial;
  insert into public.events
    (space_id, event_type_id, title, event_date, anchor_type, anchor_id, created_by)
    values (v_space, v_type, 'Dtrig Smoke Event', '2026-01-01', 'trial', v_trial, v_uid)
    returning id into v_event;
  insert into public.event_sources (event_id, url, label, sort_order)
    values (v_event, 'https://smoke.test', 'Smoke Source', 0);

  -- delete the trial: _cleanup_polymorphic_refs should remove the event;
  -- event_sources cascades automatically from events ON DELETE CASCADE.
  delete from public.trials where id = v_trial;

  select count(*) into v_events from public.events where id = v_event;
  if v_events <> 0 then
    raise exception 'Dtrig smoke FAIL: event not deleted after trial delete (count=%)', v_events;
  end if;

  select count(*) into v_sources from public.event_sources where event_id = v_event;
  if v_sources <> 0 then
    raise exception 'Dtrig smoke FAIL: event_sources not deleted after trial delete (count=%)', v_sources;
  end if;

  -- cleanup: assets.company_id has ON DELETE CASCADE so deleting the company
  -- removes the asset; trial was already deleted above.
  delete from public.assets where id = v_asset;
  delete from public.companies where id = v_company;
  raise notice 'Dtrig smoke: PASS';
end$$;

notify pgrst, 'reload schema';
