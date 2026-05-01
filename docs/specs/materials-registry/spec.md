# Materials registry

## Goal

Register every PPT, PDF, and doc that Stout produces for the engagement (and that the client uploads) against the entities they relate to. The dashboard becomes the institutional memory: every artifact ever produced for the engagement is discoverable from the assets it talks about.

This is priority 4 in the intelligence layer roadmap.

Reference sketches:
- `src/client/public/internal/trial-detail-materials.html` (entity-level Materials section on a trial detail page)
- `src/client/public/internal/engagement-landing.html` (Recent materials feed on the engagement landing)

## Scope

In v1:
- Upload PPTX, PDF, DOCX files. Drag-drop or browse from any entity detail page.
- Three types: **Briefing**, **Priority Notice**, **Ad Hoc**.
- Multi-entity linking: a single material can attach to many entities (trials, markers, companies, products, the engagement itself).
- One flat list per entity, recency-ordered. Visible to everyone in the engagement (no visibility lanes).
- File-type icons in the materials list (PPTX amber, PDF red, DOCX blue). Click any row to open a preview drawer; download from there.
- Engagement-level "All materials" page: cross-cutting list filterable by type and entity.
- Admin-configurable per-tenant settings: max file size and allowed mime types.

Out of scope (deferred to v2):
- Slide-1 / page-1 thumbnail rendering. v1 uses file-type icons; thumbnails are polish.
- Access log (who viewed / downloaded which material).
- Email-in upload.
- Connectors to Google Drive, SharePoint, Box.
- Text extraction and full-text search across material contents.
- Slide carousel preview (in-app slide-by-slide view).
- Versioning. v1 is replace-in-place; previous versions are not retained.
- Comments / annotations on materials.

## Data model

### `materials`

```sql
create table materials (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references spaces(id) on delete cascade,
  uploaded_by uuid not null references auth.users(id),
  file_path text not null,             -- Supabase Storage path
  file_name text not null,             -- original filename
  file_size_bytes bigint not null,
  mime_type text not null,
  material_type text not null check (material_type in ('briefing', 'priority_notice', 'ad_hoc')),
  title text not null,                 -- analyst-supplied or defaults to filename
  uploaded_at timestamptz not null default now()
);

create index on materials (space_id, uploaded_at desc);
create index on materials (space_id, material_type, uploaded_at desc);
```

### `material_links`

```sql
create table material_links (
  id uuid primary key default gen_random_uuid(),
  material_id uuid not null references materials(id) on delete cascade,
  entity_type text not null check (entity_type in ('trial', 'marker', 'company', 'product', 'space')),
  entity_id uuid not null,
  display_order int not null default 0,
  created_at timestamptz not null default now(),
  unique (material_id, entity_type, entity_id)
);

create index on material_links (material_id);
create index on material_links (entity_type, entity_id);
```

A material can link to as many entities as it relates to. The unique constraint prevents duplicate links to the same entity.

### Tenant-level upload settings

```sql
-- Add columns to existing tenants table; adjust if a tenant_settings table is preferred.
alter table tenants
  add column material_max_size_bytes bigint not null default 52428800,         -- 50 MB default
  add column material_allowed_mime_types text[] not null default array[
    'application/vnd.openxmlformats-officedocument.presentationml.presentation', -- .pptx
    'application/pdf',                                                            -- .pdf
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document'    -- .docx
  ];
```

Tenant admins (or super-admins) can edit these from the agency portal under tenant settings. The `register_material` RPC reads these values and rejects uploads that exceed `material_max_size_bytes` or use a mime type not in `material_allowed_mime_types`.

## Storage

Files live in a Supabase Storage bucket called `materials`. Path convention:

```
materials/{space_id}/{material_id}/{file_name}
```

Bucket is private. Access controlled via signed URLs issued by RPCs that check space membership.

## RLS

```sql
alter table materials enable row level security;
alter table material_links enable row level security;

-- Anyone in the space can view materials.
create policy materials_view on materials for select
  using (has_space_access(space_id));

-- Anyone in the space can upload (clients can register their own decks).
create policy materials_insert on materials for insert
  with check (has_space_access(space_id) and uploaded_by = auth.uid());

-- Only the uploader can update or delete their own material.
create policy materials_update on materials for update
  using (has_space_access(space_id) and uploaded_by = auth.uid());

create policy materials_delete on materials for delete
  using (has_space_access(space_id) and uploaded_by = auth.uid());

-- Links inherit visibility from parent.
create policy material_links_view on material_links for select
  using (exists (
    select 1 from materials m
    where m.id = material_links.material_id
      and has_space_access(m.space_id)
  ));

create policy material_links_write on material_links for all
  using (exists (
    select 1 from materials m
    where m.id = material_links.material_id
      and m.uploaded_by = auth.uid()
  ));
```

Storage bucket policies:
- Authenticated users can upload to `materials/{space_id}/...` if they have space access.
- Authenticated users can read from `materials/{space_id}/...` if they have space access.
- Signed URL approach is recommended; the `download_material` RPC issues a time-bound signed URL.

## RPCs

### `register_material`

```sql
create function register_material(
  p_space_id uuid,
  p_file_path text,
  p_file_name text,
  p_file_size_bytes bigint,
  p_mime_type text,
  p_material_type text,
  p_title text,
  p_links jsonb               -- array of { entity_type, entity_id }
) returns uuid
security definer
language plpgsql as $$
declare
  v_id uuid;
  v_max_size bigint;
  v_allowed_types text[];
begin
  if not has_space_access(p_space_id) then
    raise exception 'forbidden';
  end if;

  -- Read tenant upload limits (joined via space -> tenant).
  select t.material_max_size_bytes, t.material_allowed_mime_types
    into v_max_size, v_allowed_types
  from spaces s join tenants t on t.id = s.tenant_id
  where s.id = p_space_id;

  if p_file_size_bytes > v_max_size then
    raise exception 'file_too_large: limit is %', v_max_size;
  end if;

  if not (p_mime_type = any(v_allowed_types)) then
    raise exception 'mime_type_not_allowed: %', p_mime_type;
  end if;

  insert into materials (
    space_id, uploaded_by, file_path, file_name, file_size_bytes, mime_type,
    material_type, title
  ) values (
    p_space_id, auth.uid(), p_file_path, p_file_name, p_file_size_bytes, p_mime_type,
    p_material_type, p_title
  ) returning id into v_id;

  insert into material_links (material_id, entity_type, entity_id, display_order)
  select v_id,
         (l->>'entity_type')::text,
         (l->>'entity_id')::uuid,
         row_number() over () - 1
  from jsonb_array_elements(coalesce(p_links, '[]'::jsonb)) l;

  return v_id;
end $$;
```

### `list_materials_for_entity`

Returns materials linked to a specific entity, recency-ordered.

```sql
create function list_materials_for_entity(
  p_entity_type text,
  p_entity_id uuid,
  p_material_types text[],    -- null for all
  p_limit int default 50,
  p_offset int default 0
) returns jsonb ...
```

### `list_recent_materials_for_space`

Backs the engagement landing's Recent materials feed.

```sql
create function list_recent_materials_for_space(
  p_space_id uuid,
  p_limit int default 5
) returns jsonb ...
```

### `download_material`

Issues a time-bound signed URL for the file.

```sql
create function download_material(p_material_id uuid)
returns text  -- signed URL
security definer
language plpgsql as $$
declare
  v_path text;
  v_url text;
begin
  -- check access against has_space_access via materials.space_id
  -- issue signed URL via storage.create_signed_url() or similar
  return v_url;
end $$;
```

### `update_material`

Edit title, type, or linked entities. Only the uploader can update their own.

### `delete_material`

Hard-delete the row, the storage file, and cascade-delete links and access log entries. Only the uploader.

## Frontend

### New files

```
src/client/src/app/
  core/
    models/
      material.model.ts
    services/
      material.service.ts                       (CRUD + upload + signed URL fetch)
  shared/
    components/
      materials-section/
        materials-section.component.ts          (entity-level list, used on trial / marker / company / product detail pages)
        materials-section.component.html
      material-row/
        material-row.component.ts               (single row presenter, used inside materials-section and recent-materials-widget)
      material-upload-zone/
        material-upload-zone.component.ts       (drag-drop area; handles file selection, type/title input, link picker)
      material-preview-drawer/
        material-preview-drawer.component.ts    (side drawer showing thumbnail + metadata + download button)
```

The recent-materials-widget on the engagement landing reuses `<app-material-row>`.

### Modified files

Each entity detail page that should surface materials adds an `<app-materials-section>`:

```
src/client/src/app/features/manage/trials/trial-detail.component.html      (add Materials section)
src/client/src/app/features/manage/companies/company-detail.component.html (when built)
src/client/src/app/features/manage/products/product-detail.component.html  (when built)
```

The marker detail panel (existing) also gets a small Materials section for materials linked to that specific marker.

### Upload flow

1. User drops a file or clicks "Browse" on the materials section's add-slot.
2. A small dialog opens:
   - File preview (icon + filename + size)
   - Type select: Briefing / Priority Notice / Ad Hoc
   - Title input (defaults to filename without extension)
   - Linked entities chip picker (current entity is pre-selected; user can add more)
3. User clicks Upload.
4. Frontend uploads to Supabase Storage at `materials/{space_id}/{tmp_id}/{file_name}`.
5. Frontend calls `register_material` RPC with the storage path and metadata.
6. Server returns the new material id; frontend re-paths the storage object to `materials/{space_id}/{material_id}/{file_name}` (or just records the temp path).
7. Server triggers thumbnail rendering (Edge Function).
8. Materials list refreshes; new row appears at the top.

### View / download flow

1. User clicks a material row.
2. Frontend opens the preview drawer with the material metadata + thumbnail.
3. User clicks Download.
4. Frontend calls `download_material(material_id)` to get a signed URL.
5. Browser downloads the file.

## Engagement landing integration

Recent materials section on the engagement landing renders `<app-recent-materials-widget>` which calls `list_recent_materials_for_space` and renders `<app-material-row>` cards for each result.

Per the engagement landing spec, this section can be hidden in Phase 1 if materials registry hasn't shipped yet.

## Migration plan

1. Migration: `<timestamp>_materials.sql` with the three tables, indexes, RLS, storage bucket setup.
2. Migration: `<timestamp>_material_rpcs.sql` with the RPCs above.
3. Edge Function: thumbnail renderer.
4. Frontend: model, service, components.
5. Wire into trial-detail page.
6. Wire into engagement landing.
7. Wire into marker detail panel.
8. Storage bucket: configure private bucket + RLS-aware access.

## Test plan

1. **Upload a PPTX.** Verify file in storage, row in `materials`, link in `material_links`, thumbnail rendered.
2. **Upload a PDF.** Same as above, page-1 thumbnail.
3. **Upload a DOCX.** Same; thumbnail may be a generic icon (or rendered first page if the converter supports DOCX).
4. **Multi-entity link.** Upload a material; link it to a trial, a company, and a marker. Verify it appears on all three detail pages.
5. **List for entity.** Trial detail's Materials section shows all materials linked to this trial, recency-ordered.
6. **Recent materials feed.** Engagement landing shows up to 5 most recent materials.
7. **Download.** Click download; signed URL works; file downloads.
8. **Access log.** Verify a row in `material_access_log` for the download.
9. **RLS.** A user not in the space cannot view, list, or download materials.
10. **Update.** Uploader updates the title and type. Non-uploader cannot.
11. **Delete.** Uploader deletes; row removed, storage file removed, links cascade.
12. **Type filter.** Trial detail's Materials section filter chips (All / Briefing / Priority Notice / Ad Hoc) filter correctly.
13. **Lint and build.** `cd src/client && ng lint && ng build` passes.

## Branch

`feat/materials-registry`. One PR:

- Database (migrations, RLS, RPCs, storage bucket, tenant upload-limit columns) + service layer + materials section on trial detail + recent materials widget on engagement landing.

Estimated diff: ~800-1000 lines.

## Migration plan

1. Migration: `<timestamp>_materials.sql` with the two tables (materials, material_links), indexes, RLS, and the storage bucket.
2. Migration: `<timestamp>_tenant_material_settings.sql` adding `material_max_size_bytes` and `material_allowed_mime_types` columns to `tenants`.
3. Migration: `<timestamp>_material_rpcs.sql` with the RPCs above.
4. Frontend: model, service, components.
5. Wire into trial detail page.
6. Wire into engagement landing.
7. Wire into marker detail panel.
8. Add tenant settings UI in the agency portal for max size and mime allowlist.

## Open questions

- **Thumbnail rendering.** Deferred to v2. v1 ships with file-type icons (PPTX amber, PDF red, DOCX blue) and a preview drawer with a Download button.
- **Access log.** Deferred to v2. Reintroduce when pharma audit / regulatory demand surfaces.
- **File size limit.** Per-tenant configurable, default 50 MB. Tenant admins edit via the agency portal.
- **Allowed mime types.** Per-tenant configurable, default PPTX / PDF / DOCX. Tenant admins edit via the agency portal.
- **Material visibility for client uploads.** Confirmed: visible to all members of the engagement. No visibility lanes. Pharma legal sensitive material stays in the client's own systems.
