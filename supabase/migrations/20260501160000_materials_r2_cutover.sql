-- migration: 20260501160000_materials_r2_cutover
-- purpose: cut over engagement materials storage from supabase storage
--          to cloudflare r2. clean cutover (existing rows are throwaway
--          test data) so we delete them, drop the supabase storage bucket
--          and its policies, add a finalized_at column so partial uploads
--          stay invisible, and add prepare_material_upload + finalize_material
--          rpcs for the new register-first flow.

-- =============================================================================
-- 1. clean cutover: delete existing materials rows (cascades to material_links)
-- =============================================================================
delete from public.materials;

-- =============================================================================
-- 2. drop bucket-level rls policies and the bucket itself
-- =============================================================================
drop policy if exists "materials bucket read"   on storage.objects;
drop policy if exists "materials bucket insert" on storage.objects;
drop policy if exists "materials bucket update" on storage.objects;
drop policy if exists "materials bucket delete" on storage.objects;

-- the bucket is private and contains no data we care about; clean cutover.
-- delete storage.objects first to release the bucket FK reference, then
-- the bucket. set the local supabase safety guard that gates direct
-- bucket/object deletion (set local works inside the implicit migration
-- transaction; supabase cli wraps each migration in BEGIN/COMMIT).
set local storage.allow_delete_query = 'true';
delete from storage.objects where bucket_id = 'materials';
delete from storage.buckets where id = 'materials';

-- =============================================================================
-- 3. add finalized_at column. NULL until the file is uploaded to r2.
-- =============================================================================
alter table public.materials
  add column finalized_at timestamptz;

comment on column public.materials.finalized_at is
  'Timestamp at which the file was successfully uploaded to R2 and confirmed '
  'by the browser via finalize_material(). NULL means the row was registered '
  'but the file is not yet known to exist in R2 -- such rows are invisible to '
  'list/download RPCs.';

create index idx_materials_finalized
  on public.materials (space_id, finalized_at)
  where finalized_at is not null;

-- =============================================================================
-- 4. new rpc: prepare_material_upload
-- =============================================================================
-- returns the data the worker needs to sign a presigned r2 put url. only the
-- uploader can prepare an upload, and only while the row is not finalized.

create or replace function public.prepare_material_upload(
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
  select m.id, m.space_id, m.uploaded_by, m.file_name, m.mime_type, m.finalized_at
    into v_row
  from public.materials m
  where m.id = p_material_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.finalized_at is not null then
    raise exception 'already finalized' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'space_id', v_row.space_id,
    'material_id', v_row.id,
    'file_name', v_row.file_name,
    'mime_type', v_row.mime_type
  );
end;
$$;

revoke execute on function public.prepare_material_upload(uuid) from public, anon;
grant  execute on function public.prepare_material_upload(uuid) to authenticated;

-- =============================================================================
-- 5. new rpc: finalize_material
-- =============================================================================

create or replace function public.finalize_material(
  p_material_id uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_row record;
begin
  select m.id, m.space_id, m.uploaded_by, m.finalized_at
    into v_row
  from public.materials m
  where m.id = p_material_id;

  if v_row.id is null then
    raise exception 'material not found' using errcode = 'P0002';
  end if;

  if v_row.uploaded_by <> auth.uid() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if not public.has_space_access(v_row.space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if v_row.finalized_at is not null then
    -- idempotent: re-finalize is a no-op so a retried browser-side finalize
    -- after a transient failure does not error.
    return;
  end if;

  update public.materials
  set finalized_at = now()
  where id = p_material_id;
end;
$$;

revoke execute on function public.finalize_material(uuid) from public, anon;
grant  execute on function public.finalize_material(uuid) to authenticated;

-- =============================================================================
-- 6. update list_materials_for_space to filter on finalized_at
-- =============================================================================

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

-- =============================================================================
-- 7. update list_materials_for_entity to filter on finalized_at
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

-- =============================================================================
-- 8. update list_recent_materials_for_space to filter on finalized_at
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

  select coalesce(jsonb_agg(to_jsonb(r) order by r.uploaded_at desc), '[]'::jsonb)
    into v_rows
  from (
    select m.id, m.space_id, m.uploaded_by, m.file_path, m.file_name,
           m.file_size_bytes, m.mime_type, m.material_type, m.title, m.uploaded_at,
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
       and m.finalized_at is not null
     order by m.uploaded_at desc
     limit greatest(p_limit, 0)
  ) r;

  return jsonb_build_object('rows', v_rows);
end;
$$;

-- =============================================================================
-- 9. update download_material to filter on finalized_at
-- =============================================================================

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
    and m.finalized_at is not null
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

-- =============================================================================
-- 11. update _seed_demo_materials helper to set finalized_at
-- =============================================================================
-- the original helper (migration 20260501130349) inserts materials with
-- finalized_at = NULL, which makes them invisible to all list/download RPCs
-- that were updated in this migration to filter on finalized_at IS NOT NULL.
-- replace the function here so that every subsequent db reset seeds rows that
-- are visible in the engagement landing feed.

create or replace function public._seed_demo_materials(
  p_space_id uuid,
  p_uid      uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t_cardio_shield uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_cardio_shield');
  t_fortify_hf    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fortify_hf');
  t_glyco_advance uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glyco_advance');
  t_valor_hf      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_valor_hf');

  c_cardinal uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cardinal');
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');

  p_zelvox uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');

  mat_briefing  uuid := gen_random_uuid();
  mat_notice    uuid := gen_random_uuid();
  mat_adhoc     uuid := gen_random_uuid();
begin
  -- Briefing: cross-cutting catalyst review deck.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at, finalized_at
  ) values (
    mat_briefing, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_briefing::text || '/q3-catalyst-briefing.pptx',
    'q3-catalyst-briefing.pptx',
    2457600,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'briefing',
    'Q3 catalyst briefing -- HF / CKD',
    now() - interval '4 days',
    now() - interval '4 days'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_briefing, 'trial',   t_cardio_shield, 0),
    (mat_briefing, 'trial',   t_fortify_hf,    1),
    (mat_briefing, 'trial',   t_valor_hf,      2),
    (mat_briefing, 'company', c_meridian,      3);

  -- Priority notice: regulatory / late-breaker note.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at, finalized_at
  ) values (
    mat_notice, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_notice::text || '/aha-late-breaker-priority-notice.pdf',
    'aha-late-breaker-priority-notice.pdf',
    876544,
    'application/pdf',
    'priority_notice',
    'Priority notice: AHA late-breaker session schedule',
    now() - interval '1 day',
    now() - interval '1 day'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_notice, 'trial',   t_cardio_shield, 0),
    (mat_notice, 'product', p_zelvox,        1);

  -- Ad hoc: licensing memo.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at, finalized_at
  ) values (
    mat_adhoc, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_adhoc::text || '/cardinal-licensing-memo.docx',
    'cardinal-licensing-memo.docx',
    154688,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'ad_hoc',
    'Cardinal licensing memo (preliminary)',
    now() - interval '6 hours',
    now() - interval '6 hours'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_adhoc, 'company', c_cardinal,       0),
    (mat_adhoc, 'trial',   t_glyco_advance,  1);
end;
$$;

-- =============================================================================
-- 10. invariant test: register -> prepare -> finalize -> list -> download
-- =============================================================================
-- assertion-style. fails the migration if a registered-but-not-finalized row
-- is visible to readers, or if a finalized row is invisible. cleans up after
-- itself so the migration is idempotent.

do $$
declare
  v_agency_id uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant_id uuid := '22222222-2222-2222-2222-222222222222';
  v_user_id   uuid := '33333333-3333-3333-3333-333333333333';
  v_space_id  uuid := '44444444-4444-4444-4444-444444444444';
  v_material_id uuid;
  v_pre_count  int;
  v_post_count int;
  v_dl jsonb;
begin
  -- bootstrap a synthetic agency/tenant/space/user/membership.
  insert into auth.users (id, email)
    values (v_user_id, 'r2-cutover-test@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'R2 Cutover', 'r2-cutover-test', 'r2cutover', 'X', 'x@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'T', 'r2-cutover-t', 'r2cutovert', 'X');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'S', v_user_id);

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_user_id, 'owner');

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'editor');

  -- act as v_user_id for the rpc calls.
  perform set_config('request.jwt.claims',
    jsonb_build_object('sub', v_user_id, 'role', 'authenticated')::text, true);

  -- register a material directly (mirrors what register_material does).
  insert into public.materials (
    space_id, uploaded_by, file_path, file_name, file_size_bytes, mime_type,
    material_type, title
  ) values (
    v_space_id, v_user_id,
    v_space_id::text || '/pending/test.pdf',
    'test.pdf', 1024, 'application/pdf', 'briefing', 'Test'
  ) returning id into v_material_id;

  -- assertion 1: not visible to list_recent before finalize.
  v_pre_count := jsonb_array_length(
    (public.list_recent_materials_for_space(v_space_id, 10))->'rows');
  if v_pre_count <> 0 then
    raise exception 'invariant violation: list_recent returned % rows pre-finalize',
      v_pre_count;
  end if;

  -- assertion 2: download_material denies pre-finalize.
  begin
    perform public.download_material(v_material_id);
    raise exception 'invariant violation: download_material returned pre-finalize';
  exception when sqlstate '42501' then
    null;
  end;

  -- finalize.
  perform public.finalize_material(v_material_id);

  -- assertion 3: visible post-finalize.
  v_post_count := jsonb_array_length(
    (public.list_recent_materials_for_space(v_space_id, 10))->'rows');
  if v_post_count <> 1 then
    raise exception 'invariant violation: list_recent returned % rows post-finalize',
      v_post_count;
  end if;

  -- assertion 4: download_material returns the path post-finalize.
  v_dl := public.download_material(v_material_id);
  if v_dl->>'file_path' is null then
    raise exception 'invariant violation: download_material returned no file_path';
  end if;

  -- assertion 5: finalize_material is idempotent.
  perform public.finalize_material(v_material_id);

  -- clear the jwt context before cleanup.
  perform set_config('request.jwt.claims', null, true);

  -- cleanup: delete parents in reverse-dependency order so cascade triggers
  -- on tenants/spaces set clint.member_guard_cascade=on before the member
  -- rows are touched. tenants_agency_id_fkey is NO ACTION so agencies must
  -- be deleted after tenants.
  delete from public.materials where id = v_material_id;
  delete from public.tenants where id = v_tenant_id;  -- cascades: spaces, space_members, tenant_members
  delete from public.agencies where id = v_agency_id; -- cascades: agency_members
  delete from auth.users where id = v_user_id;
end $$;
