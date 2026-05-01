-- migration: 20260501115539_materials
-- purpose: tables, indexes, rls policies, and the private storage bucket
--          for the engagement materials registry. polymorphic links from
--          materials to entities (trial, marker, company, product, space)
--          live on material_links. files live in the private 'materials'
--          bucket at materials/{space_id}/{material_id}/{file_name}.

-- =============================================================================
-- table: materials
-- =============================================================================

create table public.materials (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces (id) on delete cascade,
  uploaded_by uuid not null references auth.users (id),
  file_path text not null,
  file_name text not null,
  file_size_bytes bigint not null check (file_size_bytes >= 0),
  mime_type text not null,
  material_type text not null
    check (material_type in ('briefing', 'priority_notice', 'ad_hoc')),
  title text not null,
  uploaded_at timestamptz not null default now()
);

comment on table public.materials is
  'Engagement materials registered against a space. The file lives in the '
  'private storage bucket "materials" at materials/{space_id}/{material_id}/'
  '{file_name}. material_links describes the entities each file relates to.';

create index idx_materials_space_uploaded_at
  on public.materials (space_id, uploaded_at desc);

create index idx_materials_space_type_uploaded_at
  on public.materials (space_id, material_type, uploaded_at desc);

create index idx_materials_uploaded_by
  on public.materials (uploaded_by);

alter table public.materials enable row level security;

-- =============================================================================
-- table: material_links
-- =============================================================================

create table public.material_links (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null
    references public.materials (id) on delete cascade,
  entity_type text not null
    check (entity_type in ('trial', 'marker', 'company', 'product', 'space')),
  entity_id uuid not null,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (material_id, entity_type, entity_id)
);

comment on table public.material_links is
  'Polymorphic links from a material to entities in the same space. A '
  'single material can attach to many entities; the unique constraint '
  'prevents duplicate links.';

create index idx_material_links_material
  on public.material_links (material_id);

create index idx_material_links_entity
  on public.material_links (entity_type, entity_id);

alter table public.material_links enable row level security;

-- =============================================================================
-- rls policies: materials
-- =============================================================================

create policy "materials view"
on public.materials for select to authenticated
using ( public.has_space_access(space_id) );

create policy "materials insert"
on public.materials for insert to authenticated
with check (
  public.has_space_access(space_id)
  and uploaded_by = auth.uid()
);

create policy "materials update"
on public.materials for update to authenticated
using (
  public.has_space_access(space_id)
  and uploaded_by = auth.uid()
)
with check (
  public.has_space_access(space_id)
  and uploaded_by = auth.uid()
);

create policy "materials delete"
on public.materials for delete to authenticated
using (
  public.has_space_access(space_id)
  and uploaded_by = auth.uid()
);

-- =============================================================================
-- rls policies: material_links
-- =============================================================================

create policy "material_links view"
on public.material_links for select to authenticated
using (
  exists (
    select 1 from public.materials m
    where m.id = material_links.material_id
      and public.has_space_access(m.space_id)
  )
);

create policy "material_links write"
on public.material_links for all to authenticated
using (
  exists (
    select 1 from public.materials m
    where m.id = material_links.material_id
      and m.uploaded_by = auth.uid()
  )
)
with check (
  exists (
    select 1 from public.materials m
    where m.id = material_links.material_id
      and m.uploaded_by = auth.uid()
  )
);

-- =============================================================================
-- storage bucket: materials (private)
-- =============================================================================
-- private bucket; access controlled via signed urls issued by RPCs that
-- check has_space_access before signing.

insert into storage.buckets (id, name, public)
values ('materials', 'materials', false)
on conflict (id) do nothing;

-- bucket-level policies. paths are materials/{space_id}/...; the first
-- folder segment is the space id. has_space_access gates both reads and
-- writes; reads use no role filter, writes require owner/editor.

create policy "materials bucket read"
on storage.objects for select to authenticated
using (
  bucket_id = 'materials'
  and public.has_space_access(((storage.foldername(name))[1])::uuid)
);

create policy "materials bucket insert"
on storage.objects for insert to authenticated
with check (
  bucket_id = 'materials'
  and public.has_space_access(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'editor']
  )
);

create policy "materials bucket update"
on storage.objects for update to authenticated
using (
  bucket_id = 'materials'
  and public.has_space_access(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'editor']
  )
)
with check (
  bucket_id = 'materials'
  and public.has_space_access(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'editor']
  )
);

create policy "materials bucket delete"
on storage.objects for delete to authenticated
using (
  bucket_id = 'materials'
  and public.has_space_access(
    ((storage.foldername(name))[1])::uuid,
    array['owner', 'editor']
  )
);
