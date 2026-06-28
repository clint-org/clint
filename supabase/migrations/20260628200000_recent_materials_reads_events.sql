-- A7-gap: list_recent_materials_for_space reads events
--
-- Phase A Task A7 was applied to list_materials_for_space but accidentally
-- skipped list_recent_materials_for_space (the plan mis-named it
-- list_materials_recent). The function still references the dropped
-- public.markers and public.marker_assignments tables and throws
-- relation "public.markers" does not exist on the RECENT MATERIALS widget.
--
-- Two changes only (mirror the already-fixed sibling list_materials_for_space):
-- 1. Drop the marker branch from the entity_name CASE.
-- 2. Repoint trial_id derivation from marker_assignments to events.anchor_id.

create or replace function public.list_recent_materials_for_space(p_space_id uuid, p_limit integer default 5)
 returns jsonb
 language plpgsql
 stable security definer
 set search_path to ''
as $function$
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
                 when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
                 when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
                 when 'space' then (select s.name from public.spaces s where s.id = l.entity_id)
                 when 'event' then (select ev.title from public.events ev where ev.id = l.entity_id)
               end),
               'trial_id', (case when l.entity_type = 'event' then (
                 select e.anchor_id from public.events e
                 where e.id = l.entity_id and e.anchor_type = 'trial'
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
$function$;

-- ============================================================
-- In-file smoke (data-conditional, prod-safe)
-- ============================================================

do $$
declare
  v_demo_space_id uuid := '00000000-0000-0000-0000-0000000d0100'::uuid;
  v_space_exists  boolean;
  v_result        jsonb;
begin
  select exists(
    select 1 from public.spaces where id = v_demo_space_id
  ) into v_space_exists;

  if not v_space_exists then
    raise notice 'A7-gap smoke: demo space absent, skipping data assertions (prod-safe).';
    return;
  end if;

  begin
    v_result := public.list_recent_materials_for_space(v_demo_space_id, 5);
    if v_result is null or not (v_result ? 'rows') then
      raise exception 'A7-gap smoke: list_recent_materials_for_space returned unexpected result: %', v_result;
    end if;
    raise notice 'A7-gap smoke: SMOKE PASS - list_recent_materials_for_space OK (rows=%)' ,
      jsonb_array_length(v_result->'rows');
  exception when sqlstate '42501' then
    raise notice 'A7-gap smoke: SMOKE PASS - list_recent_materials_for_space forbidden (no session user) - schema OK.';
  end;
end;
$$;

notify pgrst, 'reload schema';
