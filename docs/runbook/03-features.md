# Features

[Back to index](README.md)

---

## Engagement Landing (Default Space Surface)

When a user opens an engagement (a space), the default page is the **Engagement Landing** at `/t/:tenantId/s/:spaceId`. The timeline now lives at `/t/:tenantId/s/:spaceId/timeline` and the engagement landing is the home base that frames everything else. Phase 1 of [docs/specs/engagement-landing/spec.md](../specs/engagement-landing/spec.md).

**Composition:**

- **Engagement context strip** (`<app-engagement-context-strip>`): the engagement title, an "active since YYYY-Q#" subline, and five header counts (active trials, companies, programs, catalysts in next 90 days, intelligence total). Counts come from a single `get_space_landing_stats(p_space_id)` RPC call.
- **Latest from Stout** (main column): in phase 1 this renders as a placeholder slot. Wires up to `<app-intelligence-feed>` in phase 2 once primary intelligence ships.
- **Recent materials** (main column): hidden in phase 1. Section is scaffolded behind a `visible` input on `<app-recent-materials-widget>`; flipped on once the materials registry ships.
- **Your drafts** (side rail, agency-only): rendered only when the viewer is an agency member of the tenant's parent agency. Phase 1 shows an empty state so the placement is locked in.
- **Next 14 days catalysts** (side rail): up to five upcoming markers within 14 days, derived client-side from the existing `get_dashboard_data` feed. Clicking a row opens the marker detail panel on the catalysts tab.

**Onboarding tooltip.** First post-deploy load shows a one-time tooltip pinned to the Timeline tab in the topbar: "Your timeline is now under the Timeline tab." Dismissed by clicking the inline button or by clicking the Timeline tab itself. Persists in localStorage at `clint.engagement-landing.onboarding-tooltip-seen`.

**Routing change details.** Inside the space-scoped router, the engagement landing matches the empty path with `pathMatch: 'full'`, and the LandscapeShellComponent stays mounted for `timeline`, `bullseye`, `positioning`, and `catalysts` as siblings. Existing bookmarks to the timeline keep working via the new `/timeline` route. The topbar nav for the Landscape section is now `Home / Timeline / Bullseye / Positioning / Catalysts`.

**Stats RPC.** `get_space_landing_stats(p_space_id uuid)` returns a single jsonb object with `active_trials` (excludes recruitment_status in `completed`/`withdrawn`/`terminated`), `companies` (distinct company_id on products in the space), `programs` (count of products), `catalysts_90d` (trial_markers within today + 90 days), and `intelligence_total` (always 0 in phase 1; the primary_intelligence table is not yet shipped). Gated on `has_space_access`; security definer; language sql stable.

## Timeline Dashboard

The primary view of the engagement once the user clicks past the home page. Displays a grid where rows represent clinical trials and columns represent time. Reachable at `/t/:tenantId/s/:spaceId/timeline`. The grid is organized hierarchically:

```
Company
  +-- Product
        +-- Trial (with phase bars and event markers)
```

**Phase Bars** -- horizontal bands that span the timeline for each trial phase. Color-coded by phase type:
- **Phase 1** -- Muted slate (`#94a3b8`, early/exploratory)
- **Phase 2** -- Cyan (`#67e8f9`, building evidence)
- **Phase 3** -- Teal (`#2dd4bf`, pivotal trials)
- **Phase 4** -- Violet (`#a78bfa`, post-approval)
- **Observational** -- Amber (`#fbbf24`, caution-adjacent)

**Event Markers** -- icons placed at specific dates on the timeline. 10 system-provided marker types plus custom user-defined types. Shapes include circles, diamonds, flags, arrows, bars, and X marks -- each with color coding by category:
- Green circles -- Data events
- Red diamonds -- Regulatory events
- Blue flags/bars -- Approval/Launch events
- Orange/red arrows/X -- Change/status events

**Notes** -- free-text annotations attached to trials, displayed inline.

## Timeline Zoom

Four zoom levels let users control the time granularity. The `TimelineService` defines pixel-per-year ratios for each:

| Zoom | Pixels/Year | Column Unit | Use Case |
|---|---|---|---|
| Yearly | 200 px | 1 year | 5-10 year pipelines |
| Quarterly | 600 px (150/quarter) | 1 quarter | 2-3 year views |
| Monthly | 1200 px (100/month) | 1 month | Near-term tracking |
| Daily | 1460 px (4/day) | 1 day | Precise event placement |

The `TimelineService` provides `dateToX()` and `xToDate()` methods for converting between pixel positions and ISO dates, plus `getColumns()` for generating hierarchical column headers with sub-columns.

## Filtering

The `FilterPanelComponent` lets users narrow the dashboard to:

- **Companies** -- show only selected companies
- **Products** -- show only selected products
- **Therapeutic Areas** -- filter by medical indication (Oncology, Cardiology, etc.)
- **Date Range** -- clamp the visible timeline window (start year / end year)
- **Recruitment Status** -- Active, Completed, Suspended, etc.
- **Study Type** -- Interventional, Observational, Expanded Access
- **Phase** -- P1, P2, P3, P4, Observational

All filter values are passed as arrays to the `get_dashboard_data()` RPC function.

## Legend

A grouped reference panel (`LegendComponent`) showing all marker types with their SVG icons and labels. Organized by category. Collapsible for more dashboard space.

## Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Products | Drug/therapy products linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults (each assigned to a category) |
| Therapeutic Areas | Medical indication categories (name, abbreviation) |

## Command Palette (Cmd+K)

A power-user finder/navigator/command runner. Mounted once in `AppShellComponent` so it is available on every space-level page. Not mounted in agency portal, super-admin, or marketing surfaces.

**Open:** `Cmd+K` (or `Ctrl+K`); `/` also opens when focus is not in a text input.

**Empty state** (no query): Pinned (top 10), Recents (top 8), Commands (filtered by `when()` predicates). Recents are bumped on entity navigation by both a Router-event listener (matches `/manage/(trials|products|companies)/:id`) and an explicit `recents.touch()` call after the palette activates an entity row.

**Search:** debounced 80ms, minimum 2 chars. Backed by `search_palette` RPC which unions across companies, products, trials, markers (catalyst kind), and events using `pg_trgm` similarity + prefix-match boost + trial-identifier exact-match boost. When no prefix token is used, matching navigation commands are merged into the result list (typing `bullseye` finds the "Go to Bullseye" command without needing the `>` prefix).

**Prefix tokens:** `>` commands, `@` companies, `#` trials, `!` catalysts. Backspacing the lone token returns to all-kinds.

**Activation targets:**
- trial -> `/manage/trials/:id` (detail page)
- company -> `/manage/companies?selected=<id>` (list filtered to that company)
- product -> `/manage/products?selected=<id>` (list filtered to that product)
- catalyst -> `/catalysts?markerId=<id>` (detail panel opens on load)
- event -> `/events?eventId=<id>` (detail panel opens on load)
- command -> client-side `run()` handler (router navigate, sign-out, etc.)

**Pinned/Recents storage:** `palette_pinned(user_id, space_id, kind, entity_id, position)` and `palette_recents(user_id, space_id, kind, entity_id, last_opened_at)`. Both RLS-scoped to `user_id = auth.uid()`. Recents trimmed to last 25 inside `palette_touch_recent`.

**RPCs:** `search_palette`, `palette_empty_state`, `palette_touch_recent`, `palette_set_pinned`, `palette_unpin` -- all `SECURITY DEFINER`, all gate on `has_space_access(p_space_id)`.

## Events (Intelligence Feed)

A unified chronological feed showing analyst-created events and timeline markers together. Events capture competitive intelligence at four entity levels: space (industry-wide), company, product, and trial.

**Route:** `/t/:tenantId/s/:spaceId/events`. Honors `?eventId=<id>` to deep-link a specific event into the detail panel on load (used by the command palette).

**Layout:** Data table (p-table) with sortable/filterable columns + a right-side overlay detail panel (340px, absolute-positioned, `@slidePanel` animation) that slides in on row click and hides when nothing is selected.

| Column | Content |
|---|---|
| Date | Event date, sorted descending by default |
| Source | Badge: "EVENT" (green) or "MARKER" (slate) |
| Title | Event title with thread indicator if applicable |
| Category | 6 system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial |
| Entity | Company / Product / Trial name, or "Industry" for space-level |
| Priority | Red dot for high, empty for low |

**Detail panel (340px overlay):** Description, source URLs, tags, thread context (ordered list of events in the narrative), related events (ad-hoc links), and created timestamp.

**Event features:** Free-form tags, multiple source URLs with labels, threads (sequential narrative chains), ad-hoc links between related events, high/low priority.

## Future Catalysts

The 4th tab in the landscape shell (Timeline | Bullseye | Positioning | **Future Catalysts**). Shows all upcoming markers (clinical trial milestones, data readouts, regulatory dates, approvals, LOE events) in chronological order, grouped into adaptive time buckets.

**Route:** `/t/:tenantId/s/:spaceId/catalysts` (child of landscape shell). Honors `?markerId=<id>` to deep-link a specific marker into the detail panel on load (used by the command palette).

**Layout:** Dense table (p-table with `rowGroupMode="subheader"`). No summary header -- straight to data. The detail panel is shared with other landscape views (see below).

**Grouping:** Adaptive time-bucket density based on distance from today:
- Current ISO week -> "This Week" (with date range)
- Next ISO week -> "Next Week" (with date range)
- Next 2 calendar months -> monthly ("May 2026")
- Beyond that -> quarterly ("Q3 2026")

| Column | Content |
|---|---|
| Date | Monospace, formatted as "Apr 15" |
| Category | Marker shape/color dot + category name (Data, Regulatory, Approval, Clinical Trial, LOE) |
| Catalyst | Title, bold |
| Company / Product | "COMPANY (uppercase) -- Product" |
| Status | "CONFIRMED" (green badge) or "PROJECTED" (amber badge), derived from `is_projected` |

**Filtering:** Uses the shared landscape filter panel (company, product, therapeutic area, MOA, ROA, phase, recruitment status, study type, marker category). The table also has its own text search via `createGridState` for quick in-table filtering.

**Data source:** Derived client-side from the shared `LandscapeStateService.filteredCatalysts` computed signal, which flattens the unfiltered dashboard dataset (fetched once via `get_dashboard_data`) to future markers. Detail panel uses `get_catalyst_detail` RPC.

**Cross-navigation:** Clicking a catalyst row opens the shared detail panel. Switching to the Timeline tab keeps the panel open with the same marker in spatial context. Filters carry over across all landscape tabs.

## PowerPoint Export

The `PptxExportService` generates a `.pptx` file replicating the dashboard view using `pptxgenjs`. Users can configure:

- Title slide content
- Which trials to include
- Date range for the export (start/end year)
- Zoom level

Export details:
- Fixed slide dimensions: 13.33" x 7.5" (widescreen)
- Label column width: 2.8" (Company / Product / Trial names)
- Phase bars rendered with exact colors matching the dashboard
- Markers rendered with shape/fill/color matching their type definitions
- Date labels on markers with overlap detection
- Alternating row backgrounds for readability
- Legend showing all marker types
- Runs entirely client-side -- no file is sent to a server

## CT.gov Integration

The `CtgovSyncService` can fetch trial data from the ClinicalTrials.gov API v2 by NCT ID and map it to internal fields. Trials can store 35+ fields from the ClinicalTrials.gov data model, including:

- **Logistics**: recruitment_status, sponsor_type, lead_sponsor, collaborators[], study_countries[], study_regions[]
- **Scientific Design**: study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, enrollment_type
- **Clinical Context**: conditions[], intervention_type, intervention_name, primary/secondary_outcome_measures (jsonb), is_rare_disease
- **Eligibility**: eligibility_sex, eligibility_min_age, eligibility_max_age, accepts_healthy_volunteers, eligibility_criteria, sampling_method
- **Timeline**: start_date, primary_completion_date, study_completion_date (each with _type: Actual|Estimated), plus posting dates
- **Regulatory**: has_dmc, is_fda_regulated_drug, is_fda_regulated_device, fda_designations[], submission_type
- **Sync Tracking**: ctgov_last_synced_at, ctgov_raw_json

Helper methods in the sync service handle phase mapping, masking conversion, sponsor class normalization, country extraction, and region inference.

## Multi-Tenant Workspaces

See [Multi-Tenant Model](09-multi-tenant-model.md) for full details.

- Each **agency** is an optional consulting-firm parent that resells the platform to pharma clients
- Each **tenant** represents an organization (a pharma client of an agency, or a direct customer)
- Each **space** within a tenant is a firewalled engagement scoped to a domain (a therapy area, asset class, client team) — pipelines, catalysts, and portfolio reads all live inside, with their own members and data
- Members can be invited to tenants via invite codes (7-day expiry); branded HTML invite emails are delivered via Resend
- `tenant_members` and `agency_members` are owner-only since migration 75; spaces use owner / editor / viewer (rendered Owner / Contributor / Reader)
- Data isolation is per-space — no implicit cascade from tenant or agency level (firewall introduced in migration 75)

## Whitelabel Brand Resolution

Every request resolves the visitor's identity from the host header before bootstrap, via the anon-callable RPC `get_brand_by_host(p_host)`:

| Host | Kind | Effect |
|---|---|---|
| `pfizer.yourproduct.com` (matches `tenants.subdomain`) | `tenant` | Renders tenant app, branded with that tenant |
| `competitive.pfizer.com` (matches `tenants.custom_domain`) | `tenant` | Same, via sales-led custom domain |
| `zs.yourproduct.com` (matches `agencies.subdomain`) | `agency` | Renders agency portal at `/admin/*` |
| `admin.yourproduct.com` | `super-admin` | Reserved subdomain, super-admin only |
| `yourproduct.com` (apex) | `default` | Marketing landing for unauthenticated visitors; legacy onboarding for direct customers |

`main.ts` synchronously sets `--brand-50..950` CSS vars, swaps the favicon, sets `document.title`, and builds a dynamic PrimeNG preset before bootstrapping Angular. The Tailwind `@theme` block in `styles.css` declares `--color-brand-*` tokens that fall back to the teal scale, so tenants without a brand override render identically to today.

## Branded Login

Single login component at `/login`, rendered on every host. Reads from `BrandContextService`:
- Logo + `app_display_name` headline ("Sign in to {{ brand.appDisplayName() }}")
- One button per provider in `brand.auth_providers` (Google, Microsoft)
- Self-join hint copy when `brand.has_self_join` is true ("Use your work email to join automatically")

The default-host login also surfaces a workspace hint when navigated to with `?workspace=<subdomain>` — used by the marketing landing's "Find your workspace" form.

## Agency Portal

A self-serve portal where consulting firms manage their pharma client tenants. Mounted at `/admin/*` on agency subdomains; gated by `agencyGuard` (kind === `agency`) + `authGuard`.

| Route | Component | Purpose |
|---|---|---|
| `/admin/tenants` | `agency-tenant-list` | Filterable table of all tenants in the agency (logo, name, subdomain, member count, status) |
| `/admin/tenants/new` | `agency-tenant-new` | Provisioning wizard: name, subdomain (debounced live availability), primary color picker, first-user invite |
| `/admin/tenants/:id` | `agency-tenant-detail` | View / edit tenant branding, list members, "Open tenant" cross-host redirect |
| `/admin/members` | `agency-members` | Add agency members (email lookup via `lookup_user_by_email`), change roles, remove |
| `/admin/branding` | `agency-branding` | Edit the agency portal's own brand (display name, primary color, contact email) |

All writes go through SECURITY DEFINER RPCs; agency owners do all writes, agency members get read-only visibility across the agency's tenants.

## Super-Admin Portal

The platform owner's UI for provisioning agencies, registering custom domains, and supervising the install. Mounted at `/super-admin/*`; gated by `superAdminGuard` (kind === `super-admin`) + `authGuard`. Non-admins get a 404-equivalent redirect (do not leak existence of the area).

| Route | Component | Purpose |
|---|---|---|
| `/super-admin/agencies` | `super-admin-agencies` | All agencies; "Provision agency" dialog (name, slug, subdomain, owner email, contact email). Owner email need not be a registered user — if no `auth.users` row matches, an `agency_invites` row is held and `handle_new_user` promotes it on first sign-in. Per-row trash action opens a typed-name confirmation dialog and calls `delete_agency` (refused if any tenants are still attached) |
| `/super-admin/tenants` | `super-admin-tenants` | All tenants across all agencies; filter by agency; register custom domain dialog |
| `/super-admin/domains` | `super-admin-domains` | Retired-hostnames hold list (90-day decommissioning window). Per-row "Release" action calls `release_retired_hostname` for super-admin override (use only after a deliberate super-admin delete; real customer decommissions should keep the holdback) |

Bootstrap is `INSERT INTO platform_admins (user_id) VALUES ('<uuid>')` via SQL — there is no UI to add platform admins.

## Domain-Allowlist Self-Join

Tenant owners can configure `email_domain_allowlist` (e.g., `pfizer.com`) and toggle `email_self_join_enabled`. When a user signs in to a tenant subdomain whose allowlist matches their email and self-join is enabled, the auth callback calls `self_join_tenant(p_subdomain)` and the user is auto-added at `member` role. UI lives in **Tenant Settings → Access**.

The RPC returns the **same generic error** for every failure mode (missing tenant, self-join off, allowlist mismatch, suspended tenant) to prevent enumeration of which subdomains exist and which corporate emails unlock them.

## Branded Invite Emails

When `tenantService.inviteMember()` inserts a row into `tenant_invites`, a Supabase database webhook triggers the `send-invite-email` Edge Function (Deno), which:
- Verifies the `webhook-signature` header against `EMAIL_WEBHOOK_SECRET`
- Reads tenant brand fields (`app_display_name`, `logo_url`, `primary_color`, `email_from_name`, `subdomain`/`custom_domain`) via the service-role client
- Composes HTML + plain-text bodies with brand color tinting and the tenant logo
- POSTs to Resend (`https://api.resend.com/emails`) with sender `noreply@yourproduct.com` and per-tenant display name
- The accept URL points at the tenant subdomain or custom domain: `https://{subdomain}.{apex}/onboarding?code={invite_code}`

The existing manual code-sharing flow stays functional — agency owners can copy invite codes from tenant settings if delivery fails.

## Primary Intelligence

Stout's primary analytical work product, attached to entities in an engagement. Surfaces the read on entity detail pages, the marker tooltip, the engagement landing's "Latest from Stout" feed, and the filterable browse view.

**Data model.** Single polymorphic table `primary_intelligence` keyed on `(space_id, entity_type, entity_id)` where `entity_type in ('trial', 'marker', 'company', 'product', 'space')`. A unique partial index on `state = 'published'` enforces one published row per anchor; drafts can co-exist. Two child tables: `primary_intelligence_links` (cross-entity relations with `relationship_type` and optional gloss) and `primary_intelligence_revisions` (snapshot per save, written by trigger).

**RLS.** Published reads are visible to anyone with `has_space_access(space_id)`. Drafts are visible only to agency members of the tenant's agency, gated by the `is_agency_member_of_space(space_id)` helper added in this branch (joins space → tenant → agency, calls existing `is_agency_member`). Revisions are agency-only.

**RPCs.**
- `upsert_primary_intelligence(p_id, p_space_id, p_entity_type, p_entity_id, headline, thesis_md, watch_md, implications_md, p_state, p_change_note, p_links jsonb)` — agency-only writes. Sets `app.change_note` session var so the revision trigger captures it. Replaces links wholesale.
- `get_trial_detail_with_intelligence`, `get_marker_detail_with_intelligence`, `get_company_detail_with_intelligence`, `get_product_detail_with_intelligence`, `get_space_intelligence` — single round-trip detail bundles (published + draft + referenced_in).
- `list_primary_intelligence(space, types, author, since, query, referencing_entity_type, referencing_entity_id, limit, offset)` — feed and browse view; same RPC backs the "Referenced in" sections.
- `delete_primary_intelligence(id)` — agency-only; cascades to links and revisions.

**Frontend surfaces.**
- `app-intelligence-block` renders the read on entity detail pages. Bylines render two ways: agency-internal shows contributor initials and publisher (`Contributors: JM, RS — updated 2026-04-21 by JM`); client-facing shows just the agency byline (`Published by {agency}, updated 2026-04-21`). Agency name resolves through `BrandContextService` (`brand.agency.name` for tenant-branded hosts, falls back to `app_display_name`).
- `app-intelligence-empty` is the agency-only "+ Add primary intelligence" placeholder.
- `app-intelligence-drawer` is the single authoring surface (PrimeNG `p-drawer`). Loads the existing draft if any; falls back to seeding from published. Auto-saves on blur and on linked-entity edits, with a 1.5s debounce while typing in the editors. Optional change-note input attaches to the resulting revision row.
- `app-prose-mirror-editor` wraps a ProseMirror EditorView in a thin Angular component. The editor schema, key bindings, and markdown serialisation live in `ProseMirrorService`; components only consume `createEditor` / `destroyEditor`.
- `app-recent-activity-feed` renders read events derived from `primary_intelligence_revisions`. Linked / marker / material event categories are stubbed in v1 with a single hint row; later branches wire them up.
- `app-intelligence-feed` is the recency-ordered list used by the engagement landing's "Latest from Stout" surface and the browse view.
- `app-intelligence-browse` is the filterable expanded view at `/t/:tenant/s/:space/intelligence`. Filters by entity type, since-date, and free-text search across headline and thesis.

**Trial detail page sections (top to bottom).** Section nav strip → primary intelligence block (or empty placeholder) → Referenced in → Recent activity → Materials placeholder (replaced by the materials-registry branch) → Basic info → Phase → Markers → Notes. Authoring drawer mounts at the bottom of the page and is shown via the empty-state add button or the block's Edit affordance.

**ProseMirror packages.** `prosemirror-state`, `prosemirror-view`, `prosemirror-model`, `prosemirror-schema-basic`, `prosemirror-schema-list`, `prosemirror-keymap`, `prosemirror-commands`, `prosemirror-history`, `prosemirror-markdown`. Pinned to current major versions in `package.json`.

## Materials Registry

The institutional memory layer. Every PPTX, PDF, and DOCX produced for an engagement is registered against the entities it talks about so files surface from any related entity detail page and a single cross-cutting browse view.

**Data model.** `materials` table keyed on `space_id`, with `material_type in ('briefing', 'priority_notice', 'ad_hoc')`, the storage path, the original filename, mime type, size, and the uploader. `material_links` is a polymorphic many-to-many between materials and entities (`trial | marker | company | product | space`); a unique constraint on `(material_id, entity_type, entity_id)` blocks duplicate links.

**Storage.** Private `materials` bucket. Convention: `materials/{space_id}/{material_id}/{file_name}`. Uploads land at a temp path `materials/{space_id}/{tmp_uuid}/{file_name}` first, then `register_material` issues the canonical id and the frontend repaths the object via `storage.move`. Bucket-level RLS gates reads on `has_space_access(space_id)` derived from the first folder segment; writes additionally require owner or editor role.

**RLS.** `materials_view` allows any space member to see registered files. `materials_insert` requires editor or owner. `materials_update` and `materials_delete` further require `uploaded_by = auth.uid()`. `material_links` policies inherit from the parent material.

**Tenant settings.** Two columns on `tenants`:
- `material_max_size_bytes` (default 50 MB) caps individual uploads.
- `material_allowed_mime_types` (default PPTX / PDF / DOCX) is the server-side allowlist.

`register_material` reads both before insert and rejects with `file_too_large` or `mime_type_not_allowed` errors. The tenant settings page surfaces both as owner-editable inputs (PrimeNG `p-inputnumber` and `p-multiselect`).

**RPCs.**
- `register_material(p_space_id, p_file_path, p_file_name, p_file_size_bytes, p_mime_type, p_material_type, p_title, p_links jsonb)` -- editor-or-owner; validates limits; inserts row plus links.
- `list_materials_for_entity(p_entity_type, p_entity_id, p_material_types, p_limit, p_offset)` -- recency-ordered list filtered by entity, with optional type filter.
- `list_recent_materials_for_space(p_space_id, p_limit)` -- backs the engagement landing's recent feed.
- `list_materials_for_space(p_space_id, p_material_types, p_entity_type, p_entity_id, p_limit, p_offset)` -- backs the cross-cutting "All materials" page; filters by type and entity.
- `download_material(p_material_id)` -- validates `has_space_access` and returns the storage path. The frontend issues the signed URL via `supabase.storage.from('materials').createSignedUrl(path, 60, { download: file_name })`. Server-side signed URLs are not used because Supabase's Postgres surface in this project does not expose a signed-url helper; doing the validation in SQL and the signing in the SDK keeps the access check authoritative without pulling in a new extension.
- `update_material(p_id, p_title, p_material_type, p_links jsonb)` -- uploader-only edits. Wholesale link replacement when an array is supplied.
- `delete_material(p_id)` -- uploader-only. Returns the file path; the frontend then calls `storage.remove([path])`.

**Frontend surfaces.**
- `app-materials-section` is the entity-level list. Sits on trial detail and inside the marker detail panel (and is ready for company and product detail pages). Includes a chip filter strip (All / Briefing / Priority Notice / Ad Hoc), a recency-ordered list of `app-material-row` rows, and a drag-drop / browse upload zone at the bottom for owners and editors.
- `app-material-row` renders one row: file-type badge (PPTX amber, PDF red, DOCX blue, other slate), title, type pill, upload date, link count, file size, and a hover-revealed download icon.
- `app-material-upload-zone` is the drag-drop add slot plus the upload dialog. Dialog fields: file preview, type select, title input (defaults to filename without extension), and the linked-entities chip picker (current entity pre-selected when not space-level). Performs storage upload, `register_material`, and best-effort repath.
- `app-material-preview-drawer` is the side drawer on row click. Shows file metadata, linked entities, a Download button, and a Delete affordance when the caller is the uploader.
- `app-recent-materials-widget` (in `features/engagement-landing/recent-materials-widget/`) is the engagement-landing surface. Calls `list_recent_materials_for_space` and renders `app-material-row` cards plus an "All materials" link to the browse page.
- `MaterialsBrowsePageComponent` at `/t/:tenant/s/:space/materials` is the cross-cutting list filterable by type and entity.

**Trial detail page integration.** The materials skeleton from the primary-intelligence branch (the empty `<section id="materials">` block) is replaced inline with `<app-materials-section [entityType]="'trial'" [entityId]="trial.id" [spaceId]="trial.space_id" />`. The surrounding `<section>` element is preserved so future moves of the section don't churn this file.

**Marker detail panel integration.** `MarkerDetailContentComponent` accepts an optional `[spaceId]` input. When provided, it renders a small Materials section anchored to the marker. `LandscapeShellComponent` threads `state.spaceIdSig()` through `MarkerDetailPanelComponent`. The events page reuses `MarkerDetailContentComponent` without setting `spaceId`, so it stays unchanged.

**Upload flow recap.**
1. Drop or browse selects a file.
2. Dialog opens; user picks type, title, and linked entities.
3. Frontend uploads to `materials/{space_id}/{tmp_uuid}/{file_name}`.
4. Frontend calls `register_material`; receives the canonical id.
5. Frontend issues `storage.move(temp_path, materials/{space_id}/{material_id}/{file_name})`. On success it calls `update materials set file_path = ...` so the row points at the canonical path; on failure it leaves the temp path.
6. Section refreshes; the new row appears at the top.

## Branded PowerPoint Exports

`PptxExportService` reads from `BrandContextService`:
- **Cover slide** with tenant logo (downloaded as base64 once at slide build), `app_display_name` as title (28pt bold, primary color), "Clinical Trial Landscape" subtitle, today's date
- **Title bar accent** and trial label labels tinted with `brand.primary_color`
- **Per-slide footer** with `app_display_name` left, page number right
- Phase-bar fills, marker colors, slate / amber / red / green / cyan / violet stay hard-coded — those are data colors, not brand
- Logo download failure falls back to text-only header without failing the export

## Marketing Landing

Minimal page at `/` on the default host (apex) for unauthenticated visitors. Shows the Clint logo, name, tagline ("Competitive intelligence for pharma"), and a "Find your workspace" form. The form takes a subdomain and redirects to `https://{subdomain}.{apex}/login` (production) or `/login?workspace={subdomain}` (dev where `apexDomain` is empty). Authenticated visitors continue through the existing `onboardingRedirectGuard`. Gated by `marketingLandingGuard`. Brand color is applied via the SVG logo's inner stroke and the tagline (`text-brand-700`).

## Authentication

See [Authentication & Security](08-authentication-security.md) for full details.

Google OAuth and Microsoft (Azure AD) OAuth via Supabase Auth. Users sign in with one of the providers exposed by their tenant's `brand.auth_providers`; no password management required. Cross-subdomain session is shared via cookies on the apex domain.
