-- migration: 20260501115541_material_rpcs
-- purpose: rpcs that back the materials registry ui:
--   register_material            create row + links, enforces per-tenant
--                                 size and mime-type limits
--   list_materials_for_entity    materials linked to a single entity
--   list_recent_materials_for_space  recency-ordered feed for the
--                                 engagement landing
--   download_material            validates access, returns the storage
--                                 path; the frontend issues the signed
--                                 url via supabase.storage.createSignedUrl
--   update_material              edit title / type / linked entities
--   delete_material              hard-delete the row, links, and the
--                                 storage object


-- =============================================================================
-- helper: validate_material_links_payload
-- =============================================================================
-- shared validator for the jsonb p_links argument used by register_material
-- and update_material. raises on invalid entity_type values.

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
       or v_type not in ('trial', 'marker', 'company', 'product', 'space')
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
-- register_material
-- =============================================================================

create or replace function public.register_material(
  p_space_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_material_type text,
  p_title text,
  p_links jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id uuid;
  v_max_size bigint;
  v_allowed_types text[];
begin
  if not public.has_space_access(p_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_material_type not in ('briefing', 'priority_notice', 'ad_hoc') then
    raise exception 'invalid material_type: %', p_material_type
      using errcode = '22023';
  end if;

  if p_file_size_bytes is null or p_file_size_bytes < 0 then
    raise exception 'invalid file_size_bytes'
      using errcode = '22023';
  end if;

  perform public.validate_material_links_payload(p_links);

  -- read tenant upload limits via space -> tenant.
  select t.material_max_size_bytes, t.material_allowed_mime_types
    into v_max_size, v_allowed_types
  from public.spaces s
  join public.tenants t on t.id = s.tenant_id
  where s.id = p_space_id;

  if v_max_size is null then
    raise exception 'space not found' using errcode = 'P0002';
  end if;

  if p_file_size_bytes > v_max_size then
    raise exception 'file_too_large: limit is %', v_max_size
      using errcode = '22023';
  end if;

  if not (p_mime_type = any(v_allowed_types)) then
    raise exception 'mime_type_not_allowed: %', p_mime_type
      using errcode = '22023';
  end if;

  insert into public.materials (
    space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title
  ) values (
    p_space_id, auth.uid(), p_file_path, p_file_name, p_file_size_bytes,
    p_mime_type, p_material_type, coalesce(nullif(p_title, ''), p_file_name)
  )
  returning id into v_id;

  if p_links is not null and jsonb_array_length(p_links) > 0 then
    insert into public.material_links (
      material_id, entity_type, entity_id, display_order
    )
    select v_id,
           (l->>'entity_type')::text,
           (l->>'entity_id')::uuid,
           coalesce((l->>'display_order')::int, (row_number() over ())::int - 1)
    from jsonb_array_elements(p_links) l
    on conflict (material_id, entity_type, entity_id) do nothing;
  end if;

  return v_id;
end;
$$;

revoke execute on function public.register_material(
  uuid, text, text, bigint, text, text, text, jsonb
) from public, anon;
grant  execute on function public.register_material(
  uuid, text, text, bigint, text, text, text, jsonb
) to authenticated;


-- =============================================================================
-- list_materials_for_entity
-- =============================================================================

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

  -- materials are visible only when the caller has access to the
  -- containing space. the rls policy on materials handles that, but to
  -- short-circuit and produce a clean empty payload we filter explicitly.

  select count(*)::int
    into v_total
  from public.material_links ml
  join public.materials m on m.id = ml.material_id
  where ml.entity_type = p_entity_type
    and ml.entity_id = p_entity_id
    and (p_material_types is null or m.material_type = any(p_material_types))
    and public.has_space_access(m.space_id);

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id,
           m.space_id,
           m.uploaded_by,
           m.file_path,
           m.file_name,
           m.file_size_bytes,
           m.mime_type,
           m.material_type,
           m.title,
           m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.material_links ml
      join public.materials m on m.id = ml.material_id
     where ml.entity_type = p_entity_type
       and ml.entity_id = p_entity_id
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

revoke execute on function public.list_materials_for_entity(
  text, uuid, text[], int, int
) from public, anon;
grant  execute on function public.list_materials_for_entity(
  text, uuid, text[], int, int
) to authenticated;


-- =============================================================================
-- list_recent_materials_for_space
-- =============================================================================

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

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id,
           m.space_id,
           m.uploaded_by,
           m.file_path,
           m.file_name,
           m.file_size_bytes,
           m.mime_type,
           m.material_type,
           m.title,
           m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
     where m.space_id = p_space_id
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
  ) r;

  return jsonb_build_object('rows', v_rows);
end;
$$;

revoke execute on function public.list_recent_materials_for_space(uuid, int)
  from public, anon;
grant  execute on function public.list_recent_materials_for_space(uuid, int)
  to authenticated;


-- =============================================================================
-- list_materials_for_space
-- =============================================================================
-- backs the engagement-level "All materials" browse page. supports type
-- and entity filters; recency-ordered.

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
    and (p_material_types is null or m.material_type = any(p_material_types))
    and (
      p_entity_type is null
      or (
        ml.entity_type = p_entity_type
        and (p_entity_id is null or ml.entity_id = p_entity_id)
      )
    );

  select coalesce(jsonb_agg(row_to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select distinct
           m.id,
           m.space_id,
           m.uploaded_by,
           m.file_path,
           m.file_name,
           m.file_size_bytes,
           m.mime_type,
           m.material_type,
           m.title,
           m.uploaded_at,
           coalesce((
             select jsonb_agg(jsonb_build_object(
               'entity_type', l.entity_type,
               'entity_id', l.entity_id,
               'display_order', l.display_order
             ) order by l.display_order)
             from public.material_links l
             where l.material_id = m.id
           ), '[]'::jsonb) as links
      from public.materials m
      left join public.material_links ml on ml.material_id = m.id
     where m.space_id = p_space_id
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

revoke execute on function public.list_materials_for_space(
  uuid, text[], text, uuid, int, int
) from public, anon;
grant  execute on function public.list_materials_for_space(
  uuid, text[], text, uuid, int, int
) to authenticated;


-- =============================================================================
-- download_material
-- =============================================================================
-- validates access then returns the storage path. the frontend issues the
-- signed url via supabase.storage.from('materials').createSignedUrl().
-- this avoids a postgres dependency on a signed-url helper that isn't
-- available in this project, while keeping the access check server-side.

create or replace function public.download_material(
  p_material_id uuid
)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.file_path, m.file_name, m.mime_type
    into v_row
  from public.materials m
  where m.id = p_material_id
    and public.has_space_access(m.space_id);

  if v_row.id is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'material_id', v_row.id,
    'space_id', v_row.space_id,
    'file_path', v_row.file_path,
    'file_name', v_row.file_name,
    'mime_type', v_row.mime_type
  );
end;
$$;

revoke execute on function public.download_material(uuid) from public, anon;
grant  execute on function public.download_material(uuid) to authenticated;


-- =============================================================================
-- update_material
-- =============================================================================

create or replace function public.update_material(
  p_id uuid,
  p_title text default null,
  p_material_type text default null,
  p_links jsonb default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by
    into v_row
  from public.materials m
  where m.id = p_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_material_type is not null
     and p_material_type not in ('briefing', 'priority_notice', 'ad_hoc')
  then
    raise exception 'invalid material_type: %', p_material_type
      using errcode = '22023';
  end if;

  perform public.validate_material_links_payload(p_links);

  update public.materials
  set title = coalesce(nullif(p_title, ''), title),
      material_type = coalesce(p_material_type, material_type)
  where id = p_id;

  -- replace links wholesale when an explicit array is provided.
  if p_links is not null then
    delete from public.material_links where material_id = p_id;
    if jsonb_array_length(p_links) > 0 then
      insert into public.material_links (
        material_id, entity_type, entity_id, display_order
      )
      select p_id,
             (l->>'entity_type')::text,
             (l->>'entity_id')::uuid,
             coalesce((l->>'display_order')::int, (row_number() over ())::int - 1)
      from jsonb_array_elements(p_links) l
      on conflict (material_id, entity_type, entity_id) do nothing;
    end if;
  end if;
end;
$$;

revoke execute on function public.update_material(uuid, text, text, jsonb)
  from public, anon;
grant  execute on function public.update_material(uuid, text, text, jsonb)
  to authenticated;


-- =============================================================================
-- delete_material
-- =============================================================================

create or replace function public.delete_material(
  p_id uuid
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by, m.file_path
    into v_row
  from public.materials m
  where m.id = p_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  delete from public.materials where id = p_id;

  -- the storage object is removed by the frontend after this call; the
  -- file_path is returned so the client can call storage.remove() in the
  -- same flow.
  return jsonb_build_object(
    'material_id', v_row.id,
    'file_path', v_row.file_path
  );
end;
$$;

revoke execute on function public.delete_material(uuid) from public, anon;
grant  execute on function public.delete_material(uuid) to authenticated;
