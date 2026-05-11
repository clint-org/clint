---
surface: Primary Intelligence
spec: docs/specs/primary-intelligence/spec.md
---

# Primary Intelligence

Stout's primary analytical work product, attached to entities in an engagement. Surfaces the read on entity detail pages, the marker tooltip, the engagement landing's "Latest from Stout" feed, and the filterable browse view.

**Data model.** Single polymorphic table `primary_intelligence` keyed on `(space_id, entity_type, entity_id)` where `entity_type in ('trial', 'marker', 'company', 'product', 'space')`. Each row carries `state in ('draft','published','archived','withdrawn')`, a per-anchor `version_number` stamped on entry into `published`, and four lifecycle columns: `publish_note` + `published_by` set at publish, `archived_at` set when a newer version publishes over this one, `withdraw_note` set when the row is withdrawn. A unique partial index on `state = 'published'` enforces one published row per anchor; drafts can co-exist. One child table: `primary_intelligence_links` (cross-entity relations with `relationship_type` and optional gloss).

**RLS.** Published reads are visible to anyone with `has_space_access(space_id)`. Drafts are visible only to agency members of the tenant's agency, gated by the `is_agency_member_of_space(space_id)` helper added in this branch (joins space → tenant → agency, calls existing `is_agency_member`).

**RPCs.**
- `upsert_primary_intelligence(p_id, p_space_id, p_entity_type, p_entity_id, headline, thesis_md, watch_md, implications_md, p_state, p_change_note, p_links jsonb)` — agency-only writes. Replaces links wholesale. On publish, writes `publish_note` + `published_by` directly to the new row and stamps `archived_at` on the prior published row in the same call.
- `get_trial_detail_with_intelligence`, `get_marker_detail_with_intelligence`, `get_company_detail_with_intelligence`, `get_product_detail_with_intelligence`, `get_space_intelligence` — single round-trip detail bundles (published + draft + referenced_in).
- `list_primary_intelligence(space, types, author, since, query, referencing_entity_type, referencing_entity_id, limit, offset)` — feed and browse view; same RPC backs the "Referenced in" sections.
- `delete_primary_intelligence(id)` — agency-only; cascades to links.

**Frontend surfaces.**
- `app-intelligence-block` renders the read on entity detail pages. Bylines render two ways: agency-internal shows contributor initials and publisher (`Contributors: JM, RS — updated 2026-04-21 by JM`); client-facing shows just the agency byline (`Published by {agency}, updated 2026-04-21`). Agency name resolves through `BrandContextService` (`brand.agency.name` for tenant-branded hosts, falls back to `app_display_name`). Linked entities render with names resolved server-side (the payload's per-link `entity_name`, joined in `build_intelligence_payload` from `trials.name`, `markers.title`, `companies.name`, `products.name`) and route via `routerLink`: trial → `manage/trials/:id`, marker → `timeline?markerId=`, product → `timeline?productIds=`, company → `manage/companies`. Routes need `tenantId` + `spaceId` inputs; without them the chip falls back to a non-clickable span.
- `app-intelligence-empty` is the agency-only "+ Add primary intelligence" placeholder.
- `app-intelligence-drawer` is the single authoring surface (PrimeNG `p-drawer`). Loads the existing draft if any; falls back to seeding from published. Auto-saves on blur and on linked-entity edits, with a 1.5s debounce while typing in the editors. Optional publish note attaches to the published row via `publish_note`.
- `app-prose-mirror-editor` wraps a ProseMirror EditorView in a thin Angular component, plus a small inline toolbar (Bold, Italic, Bullet list, Numbered list) that highlights its active state from the current selection. The editor schema, key bindings, markdown input rules (`- ` / `* ` / `+ ` -> bullet list, `1. ` -> ordered list), markdown serialisation, and the toolbar command builders live in `ProseMirrorService`; components consume `createEditor` / `destroyEditor` plus the `toggle*` / `is*Active` helpers. The read path in `shared/utils/markdown-render.ts` strips CommonMark backslash-escapes from punctuation so legacy rows authored before the input rules existed (stored as `\- foo`) render as bullets without a destructive data migration.
- `app-intelligence-history-panel` mounts below `app-intelligence-block` on every detail page. Renders a single linear event timeline for the anchor (`draft_started | published | archived | withdrawn`). Published and withdrawn events expand to show their version's content; published events also render word-level inline ins/del marks (via `diffWords` from the `diff` npm package) against the most recent prior non-withdrawn published version. Archive events render as nested sub-lines under their causing publish.
- `app-intelligence-feed` is the recency-ordered list used by the engagement landing's "Latest from Stout" surface and the browse view.
- `app-intelligence-browse` is the filterable expanded view at `/t/:tenant/s/:space/intelligence`. Filters by entity type, since-date, and free-text search across headline and thesis.

**Trial detail page sections (top to bottom).** Section nav strip → primary intelligence block (or empty placeholder) → History → Referenced in → Materials placeholder (replaced by the materials-registry branch) → Basic info → Phase → Markers → Notes. Authoring drawer mounts at the bottom of the page and is shown via the empty-state add button or the block's Edit affordance.

**ProseMirror packages.** `prosemirror-state`, `prosemirror-view`, `prosemirror-model`, `prosemirror-schema-basic`, `prosemirror-schema-list`, `prosemirror-keymap`, `prosemirror-commands`, `prosemirror-history`, `prosemirror-markdown`, `prosemirror-inputrules`. Pinned to current major versions in `package.json`.

## Capabilities

```yaml
- id: primary-intelligence-data-model
  summary: Polymorphic primary_intelligence table keyed on space, entity_type, entity_id with draft, published, archived, withdrawn lifecycle and per-anchor version_number.
  routes: []
  rpcs:
    - guard_primary_intelligence_state
    - assign_primary_intelligence_version
  tables:
    - primary_intelligence
    - primary_intelligence_links
  related: []
  user_facing: false
  role: viewer
  status: active
- id: primary-intelligence-rls
  summary: Published rows readable by anyone with has_space_access; drafts gated to agency members of the tenant's agency via is_agency_member_of_space.
  routes: []
  rpcs:
    - has_space_access
    - is_agency_member_of_space
    - is_agency_member
  tables:
    - primary_intelligence
  related: []
  user_facing: false
  role: viewer
  status: active
- id: primary-intelligence-upsert
  summary: Agency-only authoring RPC handles draft, publish, archive-prior-on-publish, and wholesale link replacement.
  routes: []
  rpcs:
    - upsert_primary_intelligence
    - build_intelligence_payload
    - validate_material_links_payload
  tables:
    - primary_intelligence
    - primary_intelligence_links
  related:
    - primary-intelligence-drawer
  user_facing: false
  role: agency
  status: active
- id: primary-intelligence-entity-bundle
  summary: Per-entity single-round-trip bundles (published, draft, referenced_in) for trial, marker, company, product, and space detail pages.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
    - /t/:tenantId/s/:spaceId/manage/markers/:id
  rpcs:
    - get_trial_detail_with_intelligence
    - get_marker_detail_with_intelligence
    - get_company_detail_with_intelligence
    - get_product_detail_with_intelligence
    - get_space_intelligence
    - referenced_in_entity
  tables:
    - primary_intelligence
    - primary_intelligence_links
  related: []
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-block
  summary: Entity-detail-page block rendering the published read with byline that switches between agency-internal and client-facing modes.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
  rpcs:
    - get_trial_detail_with_intelligence
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-entity-bundle
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-drawer
  summary: Single authoring drawer with ProseMirror editor, blur-and-typing auto-save, optional publish note, and wholesale link replacement.
  routes: []
  rpcs:
    - upsert_primary_intelligence
  tables:
    - primary_intelligence
    - primary_intelligence_links
  related:
    - primary-intelligence-upsert
  user_facing: true
  role: agency
  status: active
- id: primary-intelligence-history
  summary: Linear event timeline (draft_started, published, archived, withdrawn) with word-level diff between adjacent published versions.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
    - /t/:tenantId/s/:spaceId/manage/markers/:id
  rpcs:
    - get_primary_intelligence_history
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-block
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-feed
  summary: Recency-ordered list used by the engagement landing's Latest from Stout surface.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_primary_intelligence
  tables:
    - primary_intelligence
  related:
    - engagement-landing-latest-from-stout
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-browse
  summary: Filterable expanded view at /intelligence with entity-type, since-date, and free-text search.
  routes:
    - /t/:tenantId/s/:spaceId/intelligence
  rpcs:
    - list_primary_intelligence
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-feed
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-withdraw
  summary: Withdraw a published row with optional withdraw_note, rendered as a withdraw event in the history timeline.
  routes: []
  rpcs:
    - withdraw_primary_intelligence
    - purge_primary_intelligence
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-history
  user_facing: true
  role: agency
  status: active
- id: primary-intelligence-delete
  summary: Agency-only delete that cascades to links.
  routes: []
  rpcs:
    - delete_primary_intelligence
  tables:
    - primary_intelligence
    - primary_intelligence_links
  related: []
  user_facing: true
  role: agency
  status: active
```
