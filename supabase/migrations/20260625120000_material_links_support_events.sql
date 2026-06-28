-- migration: 20260625120000_material_links_support_events
-- purpose: let materials (deliverable files) link to events, alongside the
--          existing trial / marker / company / asset / space targets. Three
--          coordinated changes keep the polymorphic material_links surface
--          consistent end to end:
--            1. widen the entity_type check constraint to admit 'event'
--            2. widen the shared link-payload validator (register/update) and
--               the three list RPCs (validation guard + entity_name lookup)
--            3. add the missing AFTER DELETE cleanup trigger on events so a
--               deleted event takes its material_links with it (the polymorphic
--               tables carry no FKs by design; cleanup is trigger-driven, per
--               20260521120200_polymorphic_cleanup_triggers).
--
--          No new function or table is introduced, so the API surface and
--          capability mapping are unchanged. events already grants select to
--          authenticated, so the picker can read them client-side.

-- =============================================================================
-- 1. widen the material_links entity_type check constraint
-- =============================================================================
-- Drop whatever the current entity_type constraint is named (it has been
-- recreated under different names across migrations) and re-add it with
-- 'event' included. 'product' is retained alongside 'asset' for back-compat,
-- matching 20260524120200.

do $$
declare
  v_con text;
begin
  -- Match only the CHECK constraint on entity_type. The unique constraint
  -- (material_id, entity_type, entity_id) also mentions entity_type in its
  -- definition, so filter on contype = 'c' to avoid dropping the wrong one.
  select c.conname into v_con
  from pg_constraint c
  join pg_class r on r.oid = c.conrelid
  join pg_namespace n on n.oid = r.relnamespace
  where n.nspname = 'public'
    and r.relname = 'material_links'
    and c.contype = 'c'
    and pg_get_constraintdef(c.oid) like '%entity_type%';
  if v_con is not null then
    execute format('alter table public.material_links drop constraint %I', v_con);
  end if;
end $$;

alter table public.material_links
  add constraint material_links_entity_type_check
  check (entity_type in ('trial', 'marker', 'company', 'asset', 'product', 'space', 'event'));

-- =============================================================================
-- 2a. widen the shared link-payload validator
-- =============================================================================
-- Used by register_material and update_material to reject bad entity_type
-- values before any write.

create or replace function public.validate_material_links_payload(
  p_links jsonb
)
returns void
language plpgsql
immutable
set search_path = ''
as $$
declare
  v_link jsonb;
  v_type text;
begin
  if p_links is null then
    return;
  end if;

  for v_link in select * from jsonb_array_elements(p_links)
  loop
    v_type := v_link->>'entity_type';
    if v_type is null
       or v_type not in ('trial', 'marker', 'company', 'product', 'space', 'event')
    then
      raise exception 'invalid entity_type: %', v_type
        using errcode = '22023';
    end if;
    if (v_link->>'entity_id') is null then
      raise exception 'missing entity_id for link'
        using errcode = '22023';
    end if;
  end loop;
end;
$$;

-- =============================================================================
-- 2b. widen the three list RPCs
-- =============================================================================
-- Bodies copied verbatim from 20260624170000_material_links_marker_trial_id
-- (the latest definition), with 'event' added to each validation guard and an
-- 'event' arm added to the entity_name case (resolves events.title). The
-- trial_id case stays marker-only: events have their own detail panel and are
-- not deep-linked through the trial timeline the way markers are.

create or replace function public.list_materials_for_space(
  p_space_id uuid,
  p_material_types text[] default null,
  p_entity_type text default null,
  p_entity_id uuid default null,
  p_limit int default 100,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_entity_type is not null
     and p_entity_type not in ('trial', 'marker', 'company', 'product', 'space', 'event')
  then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(distinct m.id)::int
    into v_total
  from public.materials m
  left join public.material_links ml on ml.material_id = m.id
  where m.space_id = p_space_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and (
      p_entity_type is null
      or (
        ml.entity_type = p_entity_type
        and (p_entity_id is null or ml.entity_id = p_entity_id)
      )
    );

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select distinct
           m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'entity_name', (case l.entity_type
                 when 'trial' then (select coalesce(t.acronym, t.name) from public.trials t where t.id = l.entity_id)
                 when 'marker' then (select mk.title from public.markers mk where mk.id = l.entity_id)
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'marker' then (
                 select ma.trial_id from public.marker_assignments ma
                 where ma.marker_id = l.entity_id
                 order by ma.created_at, ma.id
                 limit 1
               ) end),
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
      left join public.material_links ml on ml.material_id = m.id
     where m.space_id = p_space_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and (
         p_entity_type is null
         or (
           ml.entity_type = p_entity_type
           and (p_entity_id is null or ml.entity_id = p_entity_id)
         )
       )
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

create or replace function public.list_materials_for_entity(
  p_entity_type text,
  p_entity_id uuid,
  p_material_types text[] default null,
  p_limit int default 50,
  p_offset int default 0
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
  v_total int;
begin
  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space', 'event') then
    raise exception 'invalid entity_type: %', p_entity_type
      using errcode = '22023';
  end if;

  select count(*)::int
    into v_total
  from public.material_links ml
  join public.materials m on m.id = ml.material_id
  where ml.entity_type = p_entity_type
    and ml.entity_id = p_entity_id
    and m.finalized_at is not null
    and (p_material_types is null or m.material_type = any(p_material_types))
    and public.has_space_access(m.space_id);

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'entity_name', (case l.entity_type
                 when 'trial' then (select coalesce(t.acronym, t.name) from public.trials t where t.id = l.entity_id)
                 when 'marker' then (select mk.title from public.markers mk where mk.id = l.entity_id)
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'marker' then (
                 select ma.trial_id from public.marker_assignments ma
                 where ma.marker_id = l.entity_id
                 order by ma.created_at, ma.id
                 limit 1
               ) end),
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.material_links ml
      join public.materials m on m.id = ml.material_id
     where ml.entity_type = p_entity_type
       and ml.entity_id = p_entity_id
       and m.finalized_at is not null
       and (p_material_types is null or m.material_type = any(p_material_types))
       and public.has_space_access(m.space_id)
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
     offset greatest(p_offset, 0)
  ) r;

  return jsonb_build_object(
    'rows', v_rows,
    'total', coalesce(v_total, 0),
    'limit', p_limit,
    'offset', p_offset
  );
end;
$$;

create or replace function public.list_recent_materials_for_space(
  p_space_id uuid,
  p_limit int default 5
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_rows jsonb;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'entity_name', (case l.entity_type
                 when 'trial' then (select coalesce(t.acronym, t.name) from public.trials t where t.id = l.entity_id)
                 when 'marker' then (select mk.title from public.markers mk where mk.id = l.entity_id)
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'marker' then (
                 select ma.trial_id from public.marker_assignments ma
                 where ma.marker_id = l.entity_id
                 order by ma.created_at, ma.id
                 limit 1
               ) end),
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
     where m.space_id = p_space_id
       and m.finalized_at is not null
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
  ) r;

  return jsonb_build_object('rows', v_rows);
end;
$$;

-- =============================================================================
-- 3. AFTER DELETE cleanup trigger on events
-- =============================================================================
-- Backfills the cleanup gap for the new 'event' target. The shared
-- _cleanup_polymorphic_refs() fn reads tg_argv[0] and removes matching rows
-- from primary_intelligence, primary_intelligence_links, and material_links.
-- PI does not admit 'event', so only the material_links delete does any work;
-- the PI deletes are harmless no-ops. The fn is SECURITY DEFINER and not a
-- tier-1 audit target (it fires on data lifecycle, mirroring the existing
-- company/product/trial/marker triggers).

drop trigger if exists _cleanup_polymorphic_refs_event on public.events;
create trigger _cleanup_polymorphic_refs_event
  after delete on public.events
  for each row execute function public._cleanup_polymorphic_refs('event');

notify pgrst, 'reload schema';
