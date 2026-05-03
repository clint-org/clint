-- =============================================================================
-- Drop the in-app notification feature.
--
-- Removes:
--   public.get_notifications(uuid)
--   public.get_unread_notification_count(uuid)
--   public._seed_demo_notifications(uuid, uuid)
--   public.notification_reads
--   public.marker_notifications
--
-- Also re-defines public.seed_demo_data(uuid) without the
-- _seed_demo_notifications call (everything else identical to the
-- definition in 20260501130349_extend_seed_demo_intelligence_and_materials).
--
-- Earlier migrations that insert into marker_notifications or recreate the
-- notification helper still execute on `db reset`; this migration runs last
-- and removes the surface area entirely.
-- =============================================================================

drop function if exists public.get_notifications(uuid);
drop function if exists public.get_unread_notification_count(uuid);
drop function if exists public._seed_demo_notifications(uuid, uuid);

drop table if exists public.notification_reads;
drop table if exists public.marker_notifications;

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data'
      using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = uid
       and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data'
      using errcode = '42501';
  end if;

  select count(*) into existing_count
    from public.companies
    where space_id = p_space_id;

  if existing_count > 0 then
    return;
  end if;

  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_therapeutic_areas(p_space_id, uid);
  perform public._seed_demo_products(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies, 20 fictional products across 4 therapeutic areas, 26 trials covering all phases, 55+ markers, 12 trial notes, 20 events, plus 5 published primary intelligence reads (4 trial-anchored, 1 space-level thematic), 2 drafts, and 3 materials (briefing PPTX / priority notice PDF / ad hoc DOCX) with multi-entity links. Permission gate: caller must be a space owner of p_space_id or a platform admin. Idempotent: returns early if the space already has companies.';
