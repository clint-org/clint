# Event Model Stage 3: IA / Terminology Rename, Merged Event Form, Taxonomy Admin

Date: 2026-06-28
Status: Draft (design)
Parent spec: `docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`
Predecessors (must land first): Stage 1 data foundation
(`docs/superpowers/plans/2026-06-28-event-model-stage-1-data-foundation.md`) and the
consumer/producer cutover
(`docs/superpowers/plans/2026-06-28-event-model-consumer-producer-cutover.md`). Stage 3
is the IA/terminology layer explicitly scoped OUT of the cutover (cutover plan, line 7
and Self-Review notes).

## Context

The cutover repoints every DB function and frontend service onto the unified `events` /
`event_types` / `event_type_categories` schema while **keeping the old user-facing
names** (the `/catalysts` route, the "Events" page, "Marker Types" admin, "Catalyst"
labels). The app runs correctly on the new model but still speaks the old vocabulary.
Stage 3 closes that gap: it makes the surface match the model. It is the last user-facing
stage before the Stage 5 deck/glossary sweep.

This stage is greenfield-friendly: there is no external commitment to route names or
labels, so we rename on merit per the parent spec's locked vocabulary.

### Locked vocabulary (from the parent spec)

| Term | Meaning |
| --- | --- |
| **Intelligence** | The authored analytical read (versioned briefs). "Primary" is dropped from the name. |
| **Event** | A dated fact about an entity. The merge of the old markers + events. |
| **Marker** | The *glyph* that draws an event on the timeline. Pure rendering. Internal term only; retired from user-facing copy. |
| **Activity** | System-detected record changes (CT.gov diffs, edit history). |
| **Catalyst** | **Retired.** Everything is an Event; the forward-looking list is "Future Events". |

## Goals

1. Rename every user-facing route, nav label, page title, topbar string, component
   string, and the `catalyst*` code surface to the locked vocabulary, with a rename-guard
   method that closes the known blind spots (so nothing 404s and no stale copy survives).
2. Split the current combined Events page into its two real jobs: authored events flow to
   the Intelligence feed + Future Events + timeline; detected changes become the Activity
   surface.
3. Ship one **merged Event authoring form** that creates/edits a unified Event, replacing
   both the old marker form and the old events form, launched contextually.
4. Consolidate the glyph taxonomy admin (event types + event categories) into the existing
   tabbed Taxonomies screen, retiring the two standalone marker-type/-category screens.
5. Keep the full pre-existing suite and the drift gates green; pair tests with each task.

## Non-goals (deferred)

- **Event threads / storylines** are designed here (see "Deferred follow-up: threads")
  but built as a fast-follow, not in v1.
- **Pairwise event-to-event links** are dropped (subsumed by threads).
- The **sources data model** (`event_sources` re-introduction, derived CT.gov registry
  link, `source_url` drop) is delivered by the cutover, not Stage 3. Stage 3's merged
  form *consumes* that contract (`create_event` sources param, `update_event_sources`).
- The **Stage 5 deck + glossary** sweep (`stout-intro.html`, the runbook glossary) is
  separate. Stage 3 updates only the help pages and runbook prose it directly touches.
- No new timeline rendering behavior (that is the parent spec / cutover); Stage 3 only
  adds edit/delete affordances to the surfaces that survive.

## Dependency note (sources)

The merged form's multi-source control depends on the cutover having landed
`event_sources` + `create_event(p_sources ...)` + `update_event_sources`. If those are not
yet in place when Stage 3 begins, the form ships with a single-source field behind a flag
and the multi-source repeater is enabled when the contract exists. The CT.gov registry
link is derived (never an editable source row).

---

## 1. Rename inventory

The authoritative list of surfaces to rename. Grouped by kind. File:line are from the
`develop` baseline (the cutover does not change these user-facing strings, so they remain
accurate at Stage 3 start; re-confirm with the guard grep at implementation).

### 1.1 Routes (app.routes.ts) and redirects

| Old segment | New segment | Notes |
| --- | --- | --- |
| `catalysts` (landscape child, ~line 338) | `future-events` | Component dir `features/catalysts/` -> `features/future-events/`. |
| `events` (`EventsPageComponent`, ~line 485) | `activity` | Page repurposed to detected-changes Activity (see Section 2). |
| `activity` (redirect guard, ~line 361) | (becomes the real Activity route) | Retire `activityRedirectGuard`; `/activity` now renders the Activity page directly. |
| `settings/marker-types` (~line 429) | (retired) | Becomes a tab on `/settings/taxonomies`. |
| `settings/marker-categories` (~line 437) | (retired) | Becomes a tab on `/settings/taxonomies`. |
| `intelligence` (~line 347) | unchanged | "Primary Intelligence" already renders as "Intelligence" in the UI; verify no stray copy. |

**Required redirects** (so old deep links and bookmarks do not 404):
- `catalysts` -> `future-events` (preserve `?markerId=` -> `?eventId=` query rename; see 1.5).
- `events` -> `activity` for the detected-changes case; authored-event deep links
  (`/events?eventId=`) redirect to the event in context (feed item detail) or Future
  Events, whichever resolves the id.
- `settings/marker-types` -> `settings/taxonomies?tab=event-types`.
- `settings/marker-categories` -> `settings/taxonomies?tab=event-categories`.

### 1.2 Nav, topbar, breadcrumb maps

| Location | Old | New |
| --- | --- | --- |
| `sidebar-nav.ts:61` | `'Future Catalysts'` | `'Future Events'` |
| `sidebar-nav.ts:79` | `'Events'` -> route `'events'` | `'Activity'` -> route `'activity'` |
| `sidebar-nav.ts:107-111` | `'Marker Types'` item -> `settings/marker-types` | retire item (folded into Taxonomies) |
| `sidebar-nav.ts:126` | `'Markers guide'` -> `help/markers` | `'Event glyphs guide'` (or fold into events help) |
| `app-shell.component.ts:568-571,639` | `'Future Catalysts'` tab + title map, value `catalysts` | `'Future Events'`, value `future-events` |
| `app-shell.component.ts:593,638` | `'Events'` tab + `events: 'Events'` title | `'Activity'`, `activity: 'Activity'` |
| `app-shell.component.ts:641` | `'settings/marker-types': 'Marker Types'` | remove |
| `app-shell.component.ts:489,510,570,804` and `sidebar.component.ts:631` | `route === 'catalysts'` shell logic | `'future-events'` |
| `landscape-shell.component.ts:62,248` | `'catalysts'` view-mode + surface key | `'future-events'` |
| `landscape.model.ts:325` | `{ label: 'Future Catalysts', value: 'catalysts' }` | `{ label: 'Future Events', value: 'future-events' }` |

### 1.3 Component / file / directory renames (catalyst -> event/future-event)

| Old | New |
| --- | --- |
| `features/catalysts/` (dir) | `features/future-events/` |
| `catalysts-page.component.*` | `future-events-page.component.*` |
| `catalyst-table.component.ts` | `event-table.component.ts` |
| `catalyst-row-tooltip.component.ts` | `event-row-tooltip.component.ts` |
| `catalysts-export.util.ts` (+ spec) | `events-export.util.ts` |
| `group-catalysts.ts` (+ spec) | `group-events.ts` |
| `core/models/catalyst.model.ts` | `core/models/event-detail.model.ts` (avoid clashing with existing `event.model.ts`) |
| `core/services/catalyst.service.ts` (+ spec) | `event-detail.service.ts` |

The `marker-*` rendering components (`MarkerIconComponent`, `marker-visual.ts`,
`GLYPH_RATIOS`, `hexagon-icon.component`) keep their internal names. "Marker" survives as
the glyph primitive; only user-facing copy changes.

### 1.4 RPC name references in the frontend

| Old | New | Owner |
| --- | --- | --- |
| `get_catalyst_detail` (`catalyst.service.ts:16,23`) | `get_event_detail` | Stage 3 renames the RPC (a thin migration) + the caller; or keeps the RPC name and renames only the service. **Decision: rename the RPC** so the surface is consistent; map it in `features:check`. |
| `get_key_catalysts` | already dead code (no caller, per cutover notes) | drop |
| cache tag `catalyst:<id>:detail` | `event:<id>:detail` | service |

### 1.5 RouterLink arrays + string URLs (the rename-guard hotspots)

Multi-segment arrays and string URLs that navigate to the renamed routes. These are the
forms the rename guard historically missed (see the guard method, Section 5):

- `['/t', tid, 's', sid, 'catalysts']` -> `'future-events'`:
  `engagement-landing.component.ts:213,223,433`, `seed-demo.component.ts:47`,
  `competitive-read-strip.component.ts:198`, `change-event-row.component.ts:61`.
- String URLs `${base}/catalysts?markerId=${item.id}` -> `${base}/future-events?eventId=${item.id}`:
  `palette-command.registry.ts:56`, `command-palette.component.ts:231`,
  `engagement-landing.component.ts:183,195`.
- The `markerId` query param is renamed to `eventId` everywhere it deep-links an event
  (palette, engagement landing, drawers). Add a redirect/alias that accepts the old
  `markerId` param for one release so live links survive.

### 1.6 User-facing string literals (copy)

| Location | Old | New |
| --- | --- | --- |
| `catalysts-page.component.ts:75` | column `'Catalyst'` | `'Event'` |
| `catalysts-page.component.ts:92` | sheet `'Catalysts'` | `'Events'` |
| `catalysts-page.component.html:4,11,14` | "Search future catalysts...", "Future catalysts", description | "Search future events...", "Future events", reword "...regulatory, trial, and commercial events..." |
| `catalyst-table.component.ts:247` | "No upcoming catalysts match your filters." | "No upcoming events match your filters." |
| `engagement-landing.component.ts:219` | `pluralize(..., 'Catalyst')` | `'Event'` |
| `competitive-read-strip.component.ts:156,157` + `view-clauses.ts:187,206,216,233` | "...catalysts...", "next catalyst in N days", "N catalysts in next 90 days" | "...events...", "next event in N days", "N events in next 90 days" |
| `palette-result-row.component.ts:64,75` | `case 'catalyst'` color/icon map | `case 'event'` (coordinate with palette entity type) |
| `events-page.component.html:6,10,20,344` | "Events" header, "Log event" button, "Search events...", empty state | Activity page copy (Section 2); the "Log event" button moves to contextual launch points |
| `bullseye-detail-panel.component.html:286` | "Recent markers" | "Recent events" (and add the symmetric "Upcoming events" list per parent spec) |
| Count units | "X logged" (events page), "X catalysts" | "X event(s)"; Intelligence keeps "entry/entries" (`intelligence-browse.component.ts:288`); the landscape strip stays "At a glance" (per `project_read_to_analysis_terminology`) |

### 1.7 Help pages + drift hooks

- `markers-help.component.ts` (FAQ at :395,399 references "Settings > Marker Types /
  Marker Categories") -> repoint to "Settings > Taxonomies"; reframe as the event-glyph
  reference. Nav "Markers guide" label updated.
- `taxonomies-help.component.ts` gains Event Types / Event Categories coverage.
- Extend `.claude/hooks/runbook-review-guard.sh` `helpRules` so changes to `event_types` /
  `event_type_categories` / the merged form flag the right help page; keep the existing
  `marker_types` pattern matching during the transition.

---

## 2. The Events -> Activity split

Today `/events` (`EventsPageComponent`) is a combined surface: a paginated list of both
**authored events** and **detected changes**, distinguished by a `source` filter
(`event | marker | detected`), with search, a category-distribution overview pane, an
"X logged" count, and an export. `/activity` merely redirects to `/events?source=detected`.

Stage 3 splits this by job:

- **Authored events** no longer have a dedicated browse page. They live in the
  **Intelligence feed** (briefs + events, recency-descending), **Future Events**
  (future-date ascending), and the **timeline**. Discovery of "all events for entity X"
  is the entity's **profile page** plus the feed's type/entity **filter chips**.
- **Detected changes** become the **Activity** page at `/activity` (read-only): CT.gov
  diffs + event edit history, sourced from `get_activity_feed`. The
  `activityRedirectGuard` is retired; `/activity` renders the page directly.

**What the old page provided that needs a home:**
- *Search/filter over authored events* -> the feed's filter chips + per-entity profile
  lists. (The detected-changes filter/search stays on Activity.)
- *Category-distribution overview* -> not carried to Activity in v1 (it described authored
  events, which now live in the feed); revisit if analysts ask.
- *Export* -> Future Events keeps its export (renamed `events-export.util`); an
  all-authored-events export is out of v1 (logged as a follow-up).
- *Edit/delete affordances* -> move onto the surviving surfaces (Section 3.4).

This split is the most behaviorally significant part of Stage 3 and is called out in the
acceptance matrix (rows S5-S7).

---

## 3. Merged Event authoring form

One form creates and edits a unified Event, replacing `marker-form.component`
(`features/manage/trials/`) and `event-form.component` (`features/events/`). Single
component, launched as a dialog from contextual entry points.

### 3.1 Anchor model

One event, **one anchor** (no multi-trial fan-out; the old marker multi-trial
`p-multiselect` is gone). The anchor selector is two controls:

- **Level**: `space | company | asset | trial` (maps to `anchor_type`). Note the old
  events form used `product` for the asset level; the unified `events.anchor_type` uses
  `asset` directly (no `product` alias) per the cutover.
- **Entity**: the specific company / asset / trial (maps to `anchor_id`); hidden when
  Level = space. When launched contextually, Level + Entity are **pre-filled** from the
  entity in view and shown read-only-with-override.

### 3.2 Fields and field-to-column mapping

| Form field | Control | Column (unified `events` unless noted) | Notes |
| --- | --- | --- | --- |
| Event type | select, grouped by category | `event_type_id` | One picker spanning all categories; replaces the marker "Category + Type" two-step and the events "Category" picker. Category is derived from the type. |
| Title | text | `title` | required |
| Anchor: Level | select | `anchor_type` | `space/company/asset/trial` |
| Anchor: Entity | select (filterable) | `anchor_id` | conditional on Level |
| Date | date input or period picker | `event_date` | exact or fuzzy period midpoint |
| Date precision | select | `date_precision` | `exact/month/quarter/half/year` (from marker model; events gain fuzzy dates) |
| Extent | select | drives `end_date` + `is_ongoing` | `point` (no end), `until` (bounded end), `onwards` (`is_ongoing=true`) |
| End date | date/period | `end_date` | when Extent=`until` |
| End precision | select | `end_date_precision` | when Extent=`until` |
| Provenance | select | `projection` | `actual/company/primary/stout` (unchanged enum) |
| Significance | select (Default / High / Low) | `significance` (null = inherit type default) | the event override; "Default" stores null |
| Visibility | segmented (Default / Pinned / Hidden) | `visibility` | manual timeline override (null/pinned/hidden) |
| No longer expected | toggle | `no_longer_expected` | for superseded forward-looking events |
| Regulatory pathway | select (conditional) | `metadata.pathway` | only for regulatory-submission types (carried from the marker form) |
| Description | textarea | `description` | optional |
| Sources | repeater of (URL, label) | `event_sources` rows | multi-source; via `create_event(p_sources)` / `update_event_sources` (cutover contract). The derived CT.gov registry link renders alongside, read-only, when anchored to a trial with an NCT id. |
| Tags | autocomplete chips | `metadata.tags` | optional; folded into `metadata` (the old standalone tags column is not in the unified schema) |

**Dropped from the old forms (intentional):**
- Multi-trial assignment (single anchor now).
- Threads + related-event links (threads deferred; pairwise links dropped).
- The separate single `source_url` field (replaced by `event_sources`).

### 3.3 Type-conditional behavior + CT.gov lock

- Selecting a type sets the default significance preview and reveals type-specific
  metadata (e.g. regulatory pathway).
- **CT.gov-owned events are read-only** in the form (the same lock the marker form had via
  `isCtgovOwnedMarker`, repointed to the event's provenance/source-doc origin): controls
  disabled, save hidden, an explanatory message shown. CT.gov dates are managed by sync.

### 3.4 Entry points and edit/delete (contextual model)

Creation launches the dialog from the entity in view:
- Company / asset / trial **profile pages**: "Log event" (pre-fills anchor).
- **Timeline** and **manage/trials**: "Add event".

Edit/delete move onto the surfaces that survive the Events-page retirement:
- **Intelligence feed item detail** and the **timeline detail panel** gain edit/delete for
  editors (today these affordances exist only on the Events page detail panel; this is
  net-new wiring, scoped here).
- Guarded by `spaceRole.canEdit()`; viewers see read-only.
- `EventFormComponent` is extracted into a reusable dialog wrapper so every entry point
  opens the same component.

### 3.5 Save path

- Create -> `create_event` (with `p_sources` when the cutover contract exists).
- Edit -> `update_event` + `update_event_sources`.
- Audit fields (`created_by/updated_by/timestamps`) are server-side only (DB triggers),
  never client-supplied.

---

## 4. Taxonomy admin (merged into the Taxonomies screen)

### 4.1 Shape

Add two tabs to the existing tabbed `TaxonomiesPageComponent` (`/settings/taxonomies`,
currently `Indications | MOA | ROA`):

`Indications | MOA | ROA | Event Categories | Event Types`

Retire the standalone `marker-type-list` and `marker-category-list` screens and the
standalone "Marker Types" nav item. The page already follows the per-tab
table + row-actions + form-dialog pattern; the two new tabs adopt it.

### 4.2 Event Categories tab

Manages `event_type_categories` (system + space-custom):
- Columns: Name, Event-type count, Default significance (if modeled at category level),
  Origin (System / Custom).
- Form: Name, display order, default significance.
- CRUD against `event_type_categories` (direct supabase `.from()`, mirroring the marker
  services), preserving the `is_system` / `space_id` read-only locking for system rows.

### 4.3 Event Types tab (the richer tab)

Manages `event_types` (system + space-custom):
- Columns: Name, Category, Glyph preview, Default significance, Origin.
- Form: Name, Category (select), Shape, Fill, Color, Inner mark, Default significance,
  Display order; live glyph preview (the marker-type form's SVG preview, reused).
- System types are read-only (UI guard, not only the service query).

### 4.4 Cross-cutting for the merge

- **Modal density**: the page goes from 3 to 5 tab dialogs. Refactor toward a single
  generic dialog host with per-tab content to keep the template readable (review finding).
- **Grid persistence keys**: rename the marker-type grid `persistenceKey`
  (`manage-marker-types` -> `taxonomies-event-types`) to avoid a localStorage collision if
  both surfaces briefly coexist.
- **Cross-links**: the old "Manage categories" / "Manage types" cross-links become
  in-page tab switches.
- **Guards**: all three current routes use `editGuard`; the merged tabs inherit the
  Taxonomies route's guard. Confirm parity (editor+).
- **Redirects**: `/settings/marker-types` and `/settings/marker-categories` redirect to
  the new tabs (Section 1.1).

---

## 5. Rename-guard method (close the known blind spots)

Per `reference_rename_guard_blindspots`, a route-namespace rename guard has two blind
spots that previously shipped a P1. The Stage 3 guard test MUST:

1. Grep the **exact quoted token** across **all** of `src/client/src` with **no folder
   exclusion**: `/['"]catalysts?['"]/`, `/['"]events['"]/` (carefully, see below),
   `/['"]marker-types['"]/`, `/['"]marker-categories['"]/`. Do not exclude a same-named
   folder; its templates still navigate.
2. Drop the single-line prefix anchor; scan **line by line** so own-line array segments
   (`'catalysts',` on its own line in a wrapped Angular array) are caught.
3. Catch array-segment forms (`['/t', id, 's', sid, 'catalysts']`), not just `catalysts/`.
4. Treat `events` carefully: it is both the retired route segment and the live table /
   model name. The guard asserts no **route/nav** use of `'events'` as a path segment
   remains, while allowing data-layer `events` (table, `event.model`, RPC args).
5. Assert the redirects resolve (old paths -> new paths) and the `markerId`->`eventId`
   query alias works.

This guard is a committed test (`app.routes.spec.ts` + a dedicated rename-guard spec), not
a one-time grep.

---

## 6. Acceptance matrix (Stage 3 behaviors)

| # | Scenario | Expected | Layers |
| --- | --- | --- | --- |
| S1 | Visit old `/catalysts` deep link | Redirects to `/future-events`; `?markerId=` -> `?eventId=` preserved | unit (routes) + e2e |
| S2 | Nav + topbar | "Future Events", "Activity", no "Future Catalysts"/"Events"/"Marker Types" strings anywhere | rename-guard unit + e2e |
| S3 | Rename-guard grep | Zero user-facing `catalyst` strings; zero route uses of retired segments; data-layer `events` untouched | unit (guard) |
| S4 | `get_event_detail` (was `get_catalyst_detail`) | Future Events detail panel resolves via the renamed RPC; mapped in `features:check` | integration |
| S5 | Authored event creation | "Log event" on a profile opens the merged form with anchor pre-filled; saved event appears in feed + (if future-dated) Future Events + timeline | e2e |
| S6 | Activity surface | `/activity` renders detected changes only (read-only); no authored events, no "Log event" button | e2e |
| S7 | Edit/delete from surviving surfaces | Editor edits/deletes an event from the feed item detail and the timeline detail panel; viewer sees read-only | unit + e2e |
| S8 | Merged form: fuzzy + extent | Create an event with `date_precision=quarter`, Extent=`until` + end precision; persists correctly; validation blocks end < start | unit + integration |
| S9 | Merged form: significance/visibility override | "Default" stores null (inherits type); "Pinned"/"Hidden" set `visibility`; reflected on the timeline | unit + integration |
| S10 | Merged form: multi-source | Add two labeled sources; persisted to `event_sources`; CT.gov registry link shown read-only for a trial-anchored event | integration + e2e |
| S11 | Merged form: CT.gov lock | A CT.gov-owned event opens read-only with the explanatory message; no save | unit + e2e |
| S12 | Taxonomy: Event Types tab | List shows system + custom with glyph preview; create a custom type with shape/color/inner-mark; system rows read-only | integration + e2e |
| S13 | Taxonomy: Event Categories tab | CRUD a custom category; system categories read-only; delete blocked when types reference it | integration + e2e |
| S14 | Taxonomy redirects | `/settings/marker-types` and `/settings/marker-categories` land on the right tab | unit + e2e |
| S15 | Drift gates | `features:check`, `grants:check`, advisors, `docs:arch`, `migrations:check-redefs` all green; full unit/integration suite green | CI |
| S16 | a11y | Merged form + new tabs: keyboard nav, focus trap, Escape-to-close, ARIA labels, aria-live on save (WCAG AA) | manual + axe |

---

## 7. Testing plan

Tests are paired with each behavior-bearing task (no trailing test phase), across the
project's three layers.

- **Unit (Vitest, `npm run test:units`):** the rename guard (Section 5); merged-form pure
  logic (significance defaulting null-vs-override, extent -> end/`is_ongoing`, fuzzy date
  math reused from `marker-date-precision`, range validity, anchor mapping incl. the
  `product`->`asset` level note); route redirect tables; the form's field-to-payload
  builder for `create_event`/`update_event`.
- **Integration (local Supabase, service-role, run in isolation):** `get_event_detail`
  renamed RPC; merged-form create/edit round-trips for each field group including
  `event_sources` (multi) and the derived registry link; taxonomy CRUD on `event_types` /
  `event_type_categories` with system-row locking and the in-use delete block; RLS parity
  (editor write, viewer read).
- **E2E + visual (Playwright + Chrome MCP, cloud dev):** the rename across nav/topbar/feed/
  timeline/Future Events/Activity; contextual create from a profile; edit/delete from the
  feed + timeline detail; the Taxonomies tabs; the redirects. Screenshot each surface.
- **Drift gates (CI):** `features:check` (map `get_event_detail` and any renamed/new RPC;
  remove dead `get_key_catalysts`), `grants:check`, `supabase db advisors`, `npm run
  docs:arch` (routes changed), `migrations:check-redefs`. Per
  `reference_features_check_not_in_dev_deploy`, map RPCs in the feature manifests.

Known harness constraints (designed around): pre-push e2e is flaky on cold start (CI is
canonical; push `--no-verify` if it flakes); the local Supabase DB is shared across
worktrees (apply schema via `db reset`, run integration specs in isolation); cloud-dev
visual confirmation needs the chrome-channel + automation-flag fingerprint and a
pre-authenticated dev profile.

---

## 8. Blast radius checklist

- **Routes/redirects:** `app.routes.ts` (4 segment renames + 4 redirects), `app.routes.spec.ts`.
- **Nav/topbar/breadcrumb:** `sidebar-nav.ts`, `sidebar.component.ts`,
  `app-shell.component.ts`, `landscape-shell.component.ts`, `landscape.model.ts`,
  `icon-rail.component.ts`, plus specs.
- **Catalyst code surface:** `features/catalysts/` dir + all files,
  `core/models/catalyst.model.ts`, `core/services/catalyst.service.ts` (+ specs),
  `get_catalyst_detail` RPC.
- **Deep links / params:** engagement-landing, seed-demo, competitive-read,
  change-event-row, command palette (+ `markerId`->`eventId` alias).
- **Events page split:** `features/events/` -> Activity page; `activityRedirectGuard`
  retired; `event-form.component` absorbed into the merged form.
- **Merged form entry points:** profile pages, timeline, manage/trials, feed item detail,
  timeline detail panel (edit/delete wiring).
- **Taxonomy:** `taxonomies-page.component`, retire `marker-types`/`marker-categories`
  screens, `MarkerTypeService`/`MarkerCategoryService` repointed at `event_types` /
  `event_type_categories` (the cutover may already do the data repoint; Stage 3 does the
  UI move), grid persistence keys.
- **Help/docs:** `markers-help`, `taxonomies-help`, `runbook-review-guard.sh` helpRules,
  runbook feature prose for the renamed surfaces.

---

## Deferred follow-up: event threads (storylines)

Designed here, built as a fast-follow (not v1).

**Problem it solves:** the timeline already shows chronological order, so the net-new
value is curating a meaningful subset out of the noise and emphasizing it (a program's
regulatory arc; a competitive tit-for-tat), possibly spanning company/asset/trial rows.

**Primitive:** a **thread** (named group), chosen over pairwise event-to-event links. A
thread gives the storyline a name and a highlightable set by membership; pairwise links
produce an unnamed graph that is hard to render as a story. Threads subsume "see related".

**Lean model:**
- `event_threads (id, space_id, title, accent_color?)`; an event belongs to **0 or 1**
  thread via a `thread_id` on the event (matches the old model's cardinality, trivial to
  render).
- **No manual ordering** (drops the old `thread_order`): a thread reads in time order on
  the x-axis.
- **Timeline behavior:** thread members share an accent / faint connecting line in row
  order; selecting/hovering a thread highlights its members and dims the rest; a "Threads"
  filter chip isolates one storyline; threads can span rows.
- **Complementary to Intelligence briefs:** a brief is the prose read that cites events; a
  thread is the visual spine on the timeline the brief points at (briefs do not render as a
  chain).

**Authoring:** a "Thread" select (+ "new thread") in the merged Event form, enabled when
the follow-up ships.

---

## Open items to confirm

1. **`get_catalyst_detail` rename vs keep:** recommended rename to `get_event_detail`
   (consistency); the alternative keeps the RPC name and renames only the service to
   minimize a migration. (Spec assumes rename.)
2. **All-authored-events export:** dropped in v1 (Future Events keeps its export). Confirm
   no analyst workflow depends on exporting the full authored-event set.
3. **Category-level default significance:** whether default significance is modeled on
   `event_type_categories` as well as `event_types` (affects the Event Categories tab
   form). Confirm against the Stage 1 schema.
