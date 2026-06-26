-- Add the parent trial id to each material link so the materials UI can make
-- a MARKER chip clickable. Markers have no standalone page; the chip deep-links
-- to the parent trial's timeline and opens the read-only marker drawer via the
-- repo-wide ?markerId=<id> convention. A marker can be assigned to more than one
-- trial (marker_assignments is a join); we resolve the first assignment
-- (earliest created_at, then id for determinism). trial_id is null for every
-- non-marker link and for an unassigned marker.
--
-- Like the entity_name lookup added in 20260618120000, this is a correlated
-- subquery inlined into the existing SECURITY DEFINER list RPCs, which already
-- authorize space access before returning any row. No new function is
-- introduced, so the API surface and capability mapping are unchanged.

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
     and p_entity_type not in ('trial', 'marker', 'company', 'product', 'space')
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
  if p_entity_type not in ('trial', 'marker', 'company', 'product', 'space') then
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

notify pgrst, 'reload schema';
