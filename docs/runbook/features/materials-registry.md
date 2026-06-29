---
surface: Materials Registry
spec: docs/specs/materials-registry/spec.md
---

# Materials Registry

The institutional memory layer. Every PPTX, PDF, and DOCX produced for an engagement is registered against the entities it talks about so files surface from any related entity detail page and a single cross-cutting browse view.

**Data model.** `materials` table keyed on `space_id`, with `material_type in ('briefing', 'priority_notice', 'ad_hoc')`, the storage path, the original filename, mime type, size, and the uploader. `material_links` is a polymorphic many-to-many between materials and entities (`trial | marker | company | product | space | event`); a unique constraint on `(material_id, entity_type, entity_id)` blocks duplicate links. Like the other polymorphic targets, `event` links carry no FK; an `AFTER DELETE` trigger on `public.events` sweeps the link rows when an event is deleted (migration `20260625120000`).

**Storage.** Files live in the private Cloudflare R2 bucket `clint-materials`. Key scheme: `{space_id}/{material_id}/{file_name}`. Bytes never traverse the Worker on the hot path: the browser PUTs directly to a 5-minute presigned URL minted by the Worker, and downloads come from a 60-second presigned GET URL. The bucket has no public read; every download is gated. The pre-cutover Supabase Storage `materials` bucket and its bucket-level RLS policies are dropped by the cutover migration.

**Visibility gate.** `materials.finalized_at timestamptz` is `NULL` until the browser confirms the R2 PUT succeeded by calling `finalize_material`. All four list/download RPCs filter on `finalized_at is not null`, so partial uploads are invisible to all readers.

**RLS.** `materials_view` allows any space member to see registered files. `materials_insert` requires editor or owner. `materials_update` and `materials_delete` further require `uploaded_by = auth.uid()`. `material_links` policies inherit from the parent material.

**Tenant settings.** Two columns on `tenants`:
- `material_max_size_bytes` (default 50 MB) caps individual uploads.
- `material_allowed_mime_types` (default PPTX / PDF / DOCX) is the server-side allowlist.

`register_material` reads both before insert and rejects with `file_too_large` or `mime_type_not_allowed` errors. The tenant settings page surfaces both as owner-editable inputs (PrimeNG `p-inputnumber` and `p-multiselect`).

**RPCs.**
- `register_material(p_space_id, p_file_path, p_file_name, p_file_size_bytes, p_mime_type, p_material_type, p_title, p_links jsonb)` -- editor-or-owner; validates tenant size and mime allowlist; inserts row (with `finalized_at = NULL`) plus links; returns the new material id.
- `discard_pending_material(p_material_id)` -- best-effort rollback of an orphaned registration. Deletes the row only when it has never been finalized (`finalized_at IS NULL`) and the caller is the uploader; no-op otherwise. Called from the upload flow's catch handler when a step after `register_material` fails. Not audited (it undoes an upload that never completed).
- `prepare_material_upload(p_material_id)` -- uploader-only. Returns `{ space_id, material_id, file_name, mime_type }` if the row exists, the caller is the uploader, has editor access, and the row is not yet finalized. Backs the worker's `/api/materials/sign-upload` endpoint.
- `finalize_material(p_material_id)` -- uploader-only. Sets `finalized_at = now()`. Idempotent: re-finalize is a no-op so a retried browser-side call after a transient failure does not error.
- `list_materials_for_entity(p_entity_type, p_entity_id, p_material_types, p_limit, p_offset)` -- recency-ordered list filtered by entity, with optional type filter. Filters on `finalized_at is not null`.
- `list_recent_materials_for_space(p_space_id, p_limit)` -- backs the engagement landing's recent feed. Filters on `finalized_at is not null`.
- `list_materials_for_space(p_space_id, p_material_types, p_entity_type, p_entity_id, p_limit, p_offset)` -- backs the cross-cutting "All materials" page; filters by type and entity. Filters on `finalized_at is not null`.
- `download_material(p_material_id)` -- validates `has_space_access` and `finalized_at is not null`, returns `{ file_path, file_name, mime_type }`. The Worker mints a 60-second R2 GET URL with `ResponseContentDisposition: attachment`. Backs `/api/materials/sign-download`.
- `update_material(p_id, p_title, p_material_type, p_links jsonb)` -- uploader-only edits. Wholesale link replacement when an array is supplied.
- `delete_material(p_id)` -- any space editor/owner (the uploader-only gate was dropped). Writes a `material.deleted` audit event (space/tenant/agency scope; metadata carries title, material_type, uploaded_by). Removes the row and cascades the link rows. Returns `{ material_id }`. R2 object cleanup is enqueued by the `AFTER DELETE` trigger on `public.materials` into `public.r2_pending_deletes` and drained by the daily cloudflare worker scheduled handler (07:00 UTC, alongside the CT.gov sync) via `claim_pending_r2_deletes` / `mark_r2_delete_succeeded` / `mark_r2_delete_failed`. Cascade deletes from space, tenant, company, product, or trial paths enqueue the same way. Orphaned R2 objects clear within 24 hours.

**Frontend surfaces.**
- `app-materials-section` is the entity-level list. Sits on trial detail and inside the marker detail panel (and is ready for company and product detail pages). Includes a chip filter strip (All / Briefing / Priority Notice / Ad Hoc), a recency-ordered list of `app-material-row` rows, and a drag-drop / browse upload zone at the bottom for owners and editors.
- `app-material-row` renders one row: file-type badge (PPTX amber, PDF red, DOCX blue, other slate), title, type pill, upload date, link count, file size, and two hover-revealed action buttons. Download is shown to anyone who can see the row; delete (trash icon) is shown to any space editor/owner (the row gates it on `SpaceRoleService.canEdit()`). The row is not itself a button; there is no preview drawer.
- `app-material-upload-zone` is the drag-drop add slot plus the upload dialog. Dialog fields: file preview, type select, title input (defaults to filename without extension), and the linked-entities chip picker (current entity pre-selected when not space-level). Drives the register-first upload flow against the Worker.
- `app-recent-materials-widget` (in `features/engagement-landing/recent-materials-widget/`) is the engagement-landing surface. Calls `list_recent_materials_for_space` and renders `app-material-row` cards plus an "All materials" link to the browse page.
- `MaterialsBrowsePageComponent` at `/t/:tenant/s/:space/materials` is the cross-cutting list filterable by type and entity.

Each list-surface component owns its own delete handler: confirmation via `confirmDelete`, then `MaterialService.delete`, then a list reload. Toast on success and error.

**Trial detail page integration.** The materials skeleton from the primary-intelligence branch (the empty `<section id="materials">` block) is replaced inline with `<app-materials-section [entityType]="'trial'" [entityId]="trial.id" [spaceId]="trial.space_id" />`. The surrounding `<section>` element is preserved so future moves of the section don't churn this file.

**Marker detail panel integration.** `MarkerDetailContentComponent` accepts an optional `[spaceId]` input. When provided, it renders a small Materials section anchored to the marker. `LandscapeShellComponent` threads `state.spaceIdSig()` through `MarkerDetailPanelComponent`. The events page reuses `MarkerDetailContentComponent` without setting `spaceId`, so it stays unchanged.

**Event detail panel integration.** The analyst-event branch of `EventDetailPanelComponent` renders an `app-materials-section` anchored to the event (`entityType="event"`, `[entityId]="d.id"`) when a `spaceId` is present. Events are not selectable in the linked-entities chip picker (which is shared with primary-intelligence authoring and only renders the PI link types); the event anchor is force-added at upload time, the same way space-level anchors are. So an event-anchored material can also carry optional cross-links to trials/markers/companies/assets, but you reach the event anchor by uploading from the event panel, not by picking "event" in the dialog.

**Upload flow recap (register-first, R2).**
1. Drop or browse selects a file.
2. Dialog opens; user picks type, title, and linked entities.
3. Frontend calls `register_material`; receives the canonical material id. Tenant size and mime allowlist are enforced here. Row is inserted with `finalized_at = NULL`, invisible to readers.
4. Frontend POSTs `material_id` to the Worker at `/api/materials/sign-upload`; Worker calls `prepare_material_upload`, then signs and returns a 5-minute R2 PUT URL keyed at `{space_id}/{material_id}/{file_name}`.
5. Browser PUTs the bytes directly to R2.
6. Frontend updates `materials.file_path` to the canonical key (RLS gates uploader-only).
7. Frontend calls `finalize_material`; sets `finalized_at = now()`. The row becomes visible to all readers.
8. Section refreshes; the new row appears at the top.

If a step after `register_material` (steps 4-7) throws, the upload flow's catch handler calls `discard_pending_material` to roll the orphaned registration back immediately (best-effort; its own errors are swallowed so the original failure surfaces). If the browser dies outright before that runs, the row stays invisible (`finalized_at IS NULL`) and is harmless. If the network drops at step 7 specifically, the browser retries `finalize_material` once with a 1s backoff before surfacing the failure to the user.

## Capabilities

```yaml
- id: materials-data-model
  summary: materials table keyed on space_id with material_type (briefing, priority_notice, ad_hoc) and polymorphic material_links to six entity kinds (trial, marker, company, asset, space, event). normalize_sample_material normalizes material property values during data operations.
  routes: []
  rpcs:
    - validate_material_links_payload
    - normalize_sample_material
  tables:
    - materials
    - material_links
  related: []
  user_facing: false
  role: viewer
  status: active
- id: materials-r2-storage
  summary: Files live in private Cloudflare R2 bucket; browser PUTs to 5-minute presigned URL and downloads via 60-second presigned GET.
  routes: []
  rpcs:
    - prepare_material_upload
    - download_material
  tables:
    - materials
  related: []
  user_facing: false
  role: editor
  status: active
- id: materials-visibility-gate
  summary: finalized_at NULL until the browser confirms R2 PUT; all list and download RPCs filter on finalized_at not null.
  routes: []
  rpcs:
    - finalize_material
  tables:
    - materials
  related:
    - materials-r2-storage
  user_facing: false
  role: editor
  status: active
- id: materials-register
  summary: Editor or owner register-first RPC that validates tenant size and mime allowlist, inserts the row, and writes links. discard_pending_material rolls back the registration if a later upload step fails.
  routes: []
  rpcs:
    - register_material
    - discard_pending_material
    - validate_material_links_payload
  tables:
    - materials
    - material_links
    - tenants
  related:
    - materials-tenant-settings
  user_facing: true
  role: editor
  status: active
- id: materials-tenant-settings
  summary: Owner-editable tenant columns for material_max_size_bytes and material_allowed_mime_types, surfaced on the tenant settings page.
  routes:
    - /t/:tenantId/settings
  rpcs: []
  tables:
    - tenants
  related:
    - tenant-settings-general
  user_facing: true
  role: owner
  status: active
- id: materials-entity-section
  summary: Entity-level list on trial, company, and product detail pages with chip filter, recency-ordered rows, and upload zone. Event materials surface via the shared event detail panel (timeline/future-events drawer and event-detail panel) instead of a dedicated page.
  routes:
    - /t/:tenantId/s/:spaceId/profiles/trials/:id
    - /t/:tenantId/s/:spaceId/profiles/companies/:id
    - /t/:tenantId/s/:spaceId/profiles/assets/:id
  rpcs:
    - list_materials_for_entity
  tables:
    - materials
    - material_links
  related:
    - materials-data-model
  user_facing: true
  role: viewer
  status: active
- id: materials-browse-page
  summary: Cross-cutting All Materials page filterable by type and entity.
  routes:
    - /t/:tenantId/s/:spaceId/materials
  rpcs:
    - list_materials_for_space
  tables:
    - materials
    - material_links
  related: []
  user_facing: true
  role: viewer
  status: active
- id: materials-recent-widget
  summary: Engagement-landing widget rendering the most recently uploaded materials and a link to the browse page.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_recent_materials_for_space
  tables:
    - materials
  related:
    - engagement-landing-recent-materials
  user_facing: true
  role: viewer
  status: active
- id: materials-update
  summary: Uploader-only edits to title, type, and wholesale link replacement.
  routes: []
  rpcs:
    - update_material
    - validate_material_links_payload
  tables:
    - materials
    - material_links
  related: []
  user_facing: true
  role: editor
  status: active
- id: materials-delete
  summary: Any space editor/owner can delete a material (not just the uploader); the delete writes a material.deleted audit event. Removes the row and cascades link rows. R2 object cleanup is enqueued by the AFTER DELETE trigger on materials and drained by the daily cloudflare worker scheduled handler.
  routes: []
  rpcs:
    - delete_material
  tables:
    - materials
    - material_links
  related:
    - materials-r2-cleanup-queue
  user_facing: true
  role: editor
  status: active
- id: materials-r2-cleanup-queue
  summary: Append-only queue that fires on every materials row deletion (direct delete, space cascade, tenant cascade, company / product / trial cascade). A cloudflare worker drains the queue once a day at 07:00 UTC (same fire as the CT.gov sync) via worker-secret-gated SECURITY DEFINER RPCs and removes the matching R2 object. The drain is lock-aware (WS1). A delete that R2 refuses because the object is still under its 7-day bucket lock is rescheduled via mark_r2_delete_deferred without burning an attempt, and a deny-by-default volume guard (r2_drain_gate over r2_drain_control) refuses to run when an anomalous number of brand-new deletes are queued, deleting nothing and pausing for operator approval. Stuck rows surface for ops review once attempt_count hits 5. Orphaned objects clear within 24 hours.
  routes: []
  rpcs:
    - _enqueue_r2_delete
    - claim_pending_r2_deletes
    - mark_r2_delete_succeeded
    - mark_r2_delete_failed
    - mark_r2_delete_deferred
    - r2_drain_gate
    - _verify_r2_drain_worker_secret
  tables:
    - r2_pending_deletes
    - r2_drain_control
    - materials
  related:
    - materials-delete
  user_facing: false
  role: super-admin
  status: active
- id: materials-download
  summary: Worker-signed 60-second R2 GET URL with attachment Content-Disposition gated by has_space_access and finalized_at.
  routes: []
  rpcs:
    - download_material
  tables:
    - materials
  related:
    - materials-r2-storage
  user_facing: true
  role: viewer
  status: active
- id: materials-upload-flow
  summary: Register-first upload flow that splits register, sign, PUT, link, and finalize into discrete steps to leave failures invisible.
  routes: []
  rpcs:
    - register_material
    - prepare_material_upload
    - finalize_material
  tables:
    - materials
  related:
    - materials-register
    - materials-r2-storage
    - materials-visibility-gate
  user_facing: true
  role: editor
  status: active
```
