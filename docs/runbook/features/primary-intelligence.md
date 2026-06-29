---
surface: Primary Intelligence
spec: docs/specs/primary-intelligence/spec.md
---

# Primary Intelligence

Stout's primary analytical work product, attached to entities in an engagement. Surfaces the intelligence on entity detail pages, the marker tooltip, the bullseye detail panel (navigable intelligence note rows with headlines, lazy-loaded via `get_intelligence_notes_for_asset`), the engagement landing's "Latest from Stout" feed, and the filterable browse view.

**UI terminology.** The deliverable is labeled **"Primary intelligence"** in section/page headings, empty states, and the authoring drawer, and shortened to **"Intelligence"** in compact surfaces (nav, buttons, toasts, badges, tight tooltips). A single instance / count is an **"entry"/"entries"** ("intelligence" is a mass noun). The two body sections inside an entry are **"Summary"** (`summary_md`) and **"Implications"** (`implications_md`). The earlier "Analysis" label and the UI noun "read" are retired (the auto-generated landscape narration strip, formerly "Summary", is now labeled **"At a glance"** so it no longer collides with the Summary body section). Internal symbols keep their names (`primary_intelligence`, `summary_md`, `competitive-read`).

**Data model.** Two-table anchor-version model. `primary_intelligence_anchors` owns the entity binding (`entity_type`, `entity_id`, polymorphic, no FK), the pinned-lead flag (`is_lead`), and manual display order. One entity can now own many briefs (anchors); the first becomes the lead and additional sibling anchors carry `is_lead=false`. `primary_intelligence` rows are versions of an anchor (referenced via `anchor_id`); `entity_type`/`entity_id` are NOT on version rows. Each version carries `state in ('draft','published','archived','withdrawn')`, a per-anchor `version_number` stamped on entry into `published`, and four lifecycle columns: `publish_note` + `published_by` set at publish, `archived_at` set when a newer version publishes over this one, `withdraw_note` set when the row is withdrawn. A unique partial index on `state = 'published'` enforces one published row per anchor; drafts can co-exist. One child table: `primary_intelligence_links` (cross-entity relations with `relationship_type` and optional gloss; marker remains valid as a link target, but marker rows are not anchor owners).

**RLS.** Published reads are visible to anyone with `has_space_access(space_id)`. Drafts are visible only to agency members of the tenant's agency, gated by the `is_agency_member_of_space(space_id)` helper added in this branch (joins space → tenant → agency, calls existing `is_agency_member`).

**RPCs.**
- `upsert_primary_intelligence(p_id, p_space_id, p_entity_type, p_entity_id, headline, summary_md, implications_md, p_state, p_change_note, p_links jsonb)` — agency-only writes. Replaces links wholesale. On publish, writes `publish_note` + `published_by` directly to the new row and stamps `archived_at` on the prior published row in the same call. `summary_md` was renamed from `thesis_md` and `watch_md` was dropped in migration 20260512000000.
- `get_trial_detail_with_intelligence`, `get_company_detail_with_intelligence`, `get_product_detail_with_intelligence`, `get_space_intelligence` — single round-trip detail bundles (published + draft + referenced_in).
- `list_primary_intelligence(space, types, author, since, query, referencing_entity_type, referencing_entity_id, limit, offset)` — feed and browse view; same RPC backs the "Referenced in" sections.
- `delete_primary_intelligence(id)` — agency-only; cascades to links.

**Frontend surfaces.**
- `app-intelligence-stack` renders all of an entity's intelligence briefs as one unified card stack on entity detail pages (it replaces the former `app-intelligence-block` lead hero and `app-intelligence-brief-list` accordion). The lead brief is the first card: badged, expanded by default, and locked at the top; secondary briefs collapse and expand in place. Agency authors get per-card pin (sets the lead via `set_intelligence_lead`), drag-reorder (emits the full anchor set, lead included, to `reorder_intelligence`), edit, and a `...` overflow menu (Discard draft, Withdraw, Purge). The lead card carries the role-aware byline (rendered in its expanded body): agency-internal shows the editor name plus a `Contributors:` line; client-facing shows the authoring agency's logo and name. Agency name resolves through `BrandContextService` (`brand.agency.name` for tenant-branded hosts, falls back to `app_display_name`); the logo comes from `agencyLogoFromBrand` in `shared/utils/agency-byline-logo.ts`. Secondary cards show a compact text byline. Linked entities render with names resolved server-side (the payload's per-link `entity_name`, joined in `build_intelligence_payload_for_row` from `trials.name`, `markers.title`, `companies.name`, `products.name`) and route via `routerLink`: trial → `profiles/trials/:id`, product → `profiles/assets/:id`, company → `profiles/companies/:id`. Marker chips render as non-clickable text -- markers no longer have a detail route; they live inline on the trial detail page. Routes need `tenantId` + `spaceId` inputs; without them the chip falls back to a non-clickable span.
- `app-intelligence-empty` is the agency-only "+ Add primary intelligence" placeholder.
- `app-intelligence-drawer` is the single authoring surface (PrimeNG `p-drawer`). Loads the existing draft if any; falls back to seeding from published. Auto-saves on blur and on linked-entity edits, with a 1.5s debounce while typing in the editors. Optional publish note attaches to the published row via `publish_note`.
- `app-prose-mirror-editor` wraps a ProseMirror EditorView in a thin Angular component, plus a small inline toolbar (Bold, Italic, Bullet list, Numbered list) that highlights its active state from the current selection. The editor schema, key bindings, markdown input rules (`- ` / `* ` / `+ ` -> bullet list, `1. ` -> ordered list), markdown serialisation, and the toolbar command builders live in `ProseMirrorService`; components consume `createEditor` / `destroyEditor` plus the `toggle*` / `is*Active` helpers. The read path in `shared/utils/markdown-render.ts` strips CommonMark backslash-escapes from punctuation so legacy rows authored before the input rules existed (stored as `\- foo`) render as bullets without a destructive data migration. It also treats blank lines between same-type list markers as part of one list, so the loose lists emitted by `defaultMarkdownSerializer` render as a single `<ul>`/`<ol>` rather than a chain of one-item lists.
- `app-intelligence-history-panel` mounts inline inside each brief card in `app-intelligence-stack` (it is no longer a single panel below the block). When a card's Version history disclosure first opens, the page lazily fetches that anchor's history via `get_primary_intelligence_history` and caches it per anchor (the cache is cleared after any mutation, including publish). The panel renders a single linear event timeline for the anchor (`draft_started | published | archived | withdrawn`). Published and withdrawn events expand to show their version's content; published events also render word-level inline ins/del marks (via `diffWords` from the `diff` npm package) against the most recent prior non-withdrawn published version. Markdown fields (`summary_md`, `implications_md`) are first parsed into blocks (paragraphs and list items) so bullets render as `<ul>`/`<ol>` instead of leaking `-` / `1.` markers into the diff; word-level diff then runs inside each matched block. The `links` array per version is returned by `get_primary_intelligence_history` and rendered as added/removed/changed buckets under a Linked entities sub-section. Archive events render as nested sub-lines under their causing publish.
- `app-intelligence-feed` is the recency-ordered list used by the engagement landing's "Latest from Stout" surface and the browse view.
- `app-intelligence-browse` is the filterable expanded view at `/t/:tenant/s/:space/intelligence`. Filters by entity type, since-date, and free-text search across headline and summary.

**Trial detail page sections (top to bottom).** Section nav strip, primary intelligence stack (or empty placeholder), Referenced in, Materials placeholder (replaced by the materials-registry branch), Basic info, Phase, Markers, Notes. Version history is no longer a separate page section; it lives inline inside each brief card in the stack. The authoring drawer mounts at the bottom of the page and is shown via the empty-state add button, the Add entry control, or a card's Edit affordance.

**ProseMirror packages.** `prosemirror-state`, `prosemirror-view`, `prosemirror-model`, `prosemirror-schema-basic`, `prosemirror-schema-list`, `prosemirror-keymap`, `prosemirror-commands`, `prosemirror-history`, `prosemirror-markdown`, `prosemirror-inputrules`. Pinned to current major versions in `package.json`.

## Capabilities

```yaml
- id: primary-intelligence-data-model
  summary: Anchor-version model; primary_intelligence_anchors owns entity binding and lead/order; primary_intelligence rows are versions scoped to an anchor with draft, published, archived, withdrawn lifecycle and per-anchor version_number.
  routes: []
  rpcs:
    - guard_primary_intelligence_state
    - assign_primary_intelligence_version
  tables:
    - primary_intelligence
    - primary_intelligence_anchors
    - primary_intelligence_links
  related: []
  user_facing: false
  role: viewer
  status: active
- id: primary-intelligence-rls
  summary: Published rows readable by anyone with has_space_access; drafts gated to agency members of the tenant's agency via is_agency_member_of_space. resolve_user_display_names is an internal SECURITY DEFINER identity helper (revoked from client roles) that maps editor ids to display names for the payload/history author bylines.
  routes: []
  rpcs:
    - has_space_access
    - is_agency_member_of_space
    - is_agency_member
    - resolve_user_display_names
  tables:
    - primary_intelligence
  related: []
  user_facing: false
  role: viewer
  status: active
- id: primary-intelligence-upsert
  summary: Agency-or-editor authoring RPC handles draft, publish, archive-prior-on-publish, and wholesale link replacement. Creates or reuses an anchor for the entity; a new anchor is created when p_anchor_id is null.
  routes: []
  rpcs:
    - upsert_primary_intelligence
    - validate_material_links_payload
  tables:
    - primary_intelligence
    - primary_intelligence_anchors
    - primary_intelligence_links
  related:
    - primary-intelligence-drawer
  user_facing: false
  role: agency
  status: active
- id: primary-intelligence-entity-bundle
  summary: Per-entity single-round-trip bundles (briefs[], referenced_in) for trial, company, product, and space detail pages. Marker-level PI is not surfaced; the marker description carries the event-level write-up and trial/asset PI carries the competitive read.
  routes:
    - /t/:tenantId/s/:spaceId/profiles/trials/:id
    - /t/:tenantId/s/:spaceId/profiles/companies/:id
    - /t/:tenantId/s/:spaceId/profiles/assets/:id
  rpcs:
    - get_trial_detail_with_intelligence
    - get_company_detail_with_intelligence
    - get_asset_detail_with_intelligence
    - get_space_intelligence
    - referenced_in_entity
    - list_intelligence_for_entity
    - build_intelligence_payload_for_row
  tables:
    - primary_intelligence
    - primary_intelligence_anchors
    - primary_intelligence_links
  related: []
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-block
  summary: Entity-detail-page unified stack rendering all of an entity's intelligence briefs as cards (lead first, pinned and expanded; secondary briefs collapse/expand), with per-card pin, drag-reorder, edit, and overflow lifecycle actions, and a role-aware lead byline that switches between agency-internal and client-facing modes. Replaces the former lead block and brief-list accordion.
  routes:
    - /t/:tenantId/s/:spaceId/profiles/trials/:id
    - /t/:tenantId/s/:spaceId/profiles/companies/:id
    - /t/:tenantId/s/:spaceId/profiles/assets/:id
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
  summary: Inline per-brief version history mounted inside each card of the intelligence stack and lazily loaded per anchor. Renders a linear event timeline (draft_started, published, archived, withdrawn) with block-aware word-level diff between adjacent published versions, plus added/removed/changed linked-entity buckets.
  routes:
    - /t/:tenantId/s/:spaceId/profiles/trials/:id
    - /t/:tenantId/s/:spaceId/profiles/companies/:id
    - /t/:tenantId/s/:spaceId/profiles/assets/:id
  rpcs:
    - get_primary_intelligence_history
  tables:
    - primary_intelligence
    - primary_intelligence_anchors
  related:
    - primary-intelligence-block
  user_facing: true
  role: viewer
  status: active
- id: primary-intelligence-bullseye-notes
  summary: Lightweight RPC returning published intelligence notes for an asset and its trials, used by the bullseye detail panel to show navigable note rows.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye
  rpcs:
    - get_intelligence_notes_for_asset
  tables:
    - primary_intelligence
    - trials
  related:
    - bullseye-chart
    - primary-intelligence-entity-bundle
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
- id: primary-intelligence-ordering
  summary: Agency-only RPCs to pin the lead brief for an entity and manually reorder sibling anchors.
  routes: []
  rpcs:
    - set_intelligence_lead
    - reorder_intelligence
  tables:
    - primary_intelligence_anchors
  related:
    - primary-intelligence-entity-bundle
  user_facing: false
  role: agency
  status: active
- id: primary-intelligence-withdraw
  summary: Withdraw a published row with optional withdraw_note, rendered as a withdraw event in the history timeline. Auto-promotes the next published anchor as lead when the withdrawn row belongs to the current lead.
  routes: []
  rpcs:
    - withdraw_primary_intelligence
    - purge_primary_intelligence
    - _promote_next_intelligence_lead
  tables:
    - primary_intelligence
    - primary_intelligence_anchors
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
