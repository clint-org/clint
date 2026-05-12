---
surface: Engagement Landing
spec: docs/specs/engagement-landing/spec.md
---

# Engagement Landing

When a user opens an engagement (a space), the default page is the **Engagement Landing** at `/t/:tenantId/s/:spaceId`. The timeline now lives at `/t/:tenantId/s/:spaceId/timeline` and the engagement landing is the home base that frames everything else. See [docs/specs/engagement-landing/spec.md](../specs/engagement-landing/spec.md).

**Composition:**

- **Pulse panel** (one bordered section in `EngagementLandingComponent`, three rows):
  - **Row 1 — slim identity strip.** Slate-50 status band with the engagement name (mono, uppercase, tracked), an `Active since YYYY-Q#` subline, and inline inventory totals (`N trials · N companies · N assets`). Counts come from `get_space_landing_stats(p_space_id)`. No today's date — the hero carries the only date anchor the page needs.
  - **Row 2 — hero catalyst (primary focal point).** Brand-50 panel with three regions in a `1fr_auto_320px` grid: a left date column (`WEEKDAY / 34px DAY / MONTH` in mono) showing the lead's event date, a center content column (window badge in brand-600 + relative `whenPhrase` eyebrow, 20px headline, company name in mono, inline `View catalyst →` link), and a right companion mini-list with the next two upcoming catalysts in the same window under an `Also <window>` header. Companion rows route to the catalysts page with the marker pre-selected. Auto-hides on quiet days (no upcoming catalysts within 90 days).
  - **Row 3 — signal strip.** Single horizontal status line of five metrics (`P3 readouts next 90d`, `Catalysts next 90d`, `New intel last 7d`, `Trial moves last 30d`, `Loss of excl. next 365d`). Each item is `<value> <label> <window-label>` in mono with tabular-nums; `warn` items (counts > 0 that demand attention) keep an amber tint. Each item routes to the corresponding filtered browse view. Replaces the prior five-tile grid; carries the same signal at a fraction of the visual weight so the hero anchors attention.
- **Two-column body (below the pulse):**
  - **Latest from Stout** (left, 2/3 width): the most recently published primary intelligence rows. First row renders as a featured post (larger headline, three-line excerpt); the rest render as a stacked list with the per-row kind chip coloured by `entity_type` (`trial`, `company`, `product`, `marker`, `space`). Header includes a count tag (`X intelligence posts · Y this week`) and entity-type filter chips that filter client-side. Footer surfaces a `View all intelligence` link to `/t/:tenantId/s/:spaceId/intelligence`. Falls back to a dashed empty state when there are no rows.
  - **Side rail** (right, 1/3 width): a `Next 90 days` card listing every upcoming marker grouped by month (sticky month headers, date chip + title + marker glyph per row), stacked over the `<app-what-changed-widget>`.
- **Recent materials** (below feed): renders `<app-recent-materials-widget>` against `list_recent_materials_for_space`. Hidden automatically when there are no materials and no error.

**Onboarding tooltip.** First post-deploy load shows a one-time tooltip pinned to the Timeline tab in the topbar: "Your timeline is now under the Timeline tab." Dismissed by clicking the inline button or by clicking the Timeline tab itself. Persists in localStorage at `clint.engagement-landing.onboarding-tooltip-seen`.

**Routing change details.** Inside the space-scoped router, the engagement landing matches the empty path with `pathMatch: 'full'`, and the LandscapeShellComponent stays mounted for `timeline`, `bullseye`, `positioning`, and `catalysts` as siblings. Existing bookmarks to the timeline keep working via the new `/timeline` route. The topbar nav for the Landscape section is now `Home / Timeline / Bullseye / Positioning / Catalysts`.

**Stats RPC.** `get_space_landing_stats(p_space_id uuid)` returns a single jsonb object with `active_trials` (excludes recruitment_status in `completed`/`withdrawn`/`terminated`), `companies` (distinct company_id on products in the space), `programs` (count of products), `catalysts_90d` (markers within today + 90 days), and `intelligence_total` (count of published rows in `primary_intelligence`). Gated on `has_space_access`; security definer; language sql stable.

**Drafts RPC.** `list_draft_intelligence_for_space(p_space_id uuid, p_limit int default 3)` returns up to `p_limit` draft `primary_intelligence` rows, recency-ordered. Visibility is gated by the `primary_intelligence_view_drafts` RLS policy (agency members of the space only); non-agency callers receive an empty array.

## Capabilities

```yaml
- id: engagement-landing-identity-strip
  summary: Slim slate-50 status band with engagement name, active-since subline, and inline trials/companies/assets inventory totals.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables:
    - spaces
    - trials
    - products
    - companies
  related: []
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-hero-catalyst
  summary: Brand-tinted hero panel with the next upcoming catalyst (event-date column, window/whenPhrase eyebrow, headline, company, View link) plus a right-side companion list of the next two catalysts in the same window. Hides on quiet days.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_dashboard_data
  tables:
    - markers
    - marker_types
    - marker_assignments
  related:
    - catalysts-calendar
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-signal-strip
  summary: Single-row status line of five engagement motion signals (P3 readouts, catalysts, new intel, trial moves, loss of exclusivity), each with metric value, label, and window-label, routing to the corresponding browse view. Warn items (counts > 0 that demand attention) carry an amber tint.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables:
    - spaces
    - trials
    - markers
    - primary_intelligence
  related:
    - engagement-landing-hero-catalyst
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-latest-from-stout
  summary: Two-thirds-width feed of most-recently-published primary intelligence rows, with featured first item, kind chips coloured by entity type, and entity-type filter chips.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_primary_intelligence
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-feed
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-next-90-days
  summary: Side-rail card listing every upcoming marker in the next 90 days, grouped by month with sticky headers; rows open the marker on the catalysts page.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_dashboard_data
  tables:
    - markers
    - marker_types
  related:
    - catalysts-calendar
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-what-changed
  summary: Side-rail widget showing recent change events for the engagement.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_activity_feed
  tables:
    - trial_change_events
  related:
    - trial-change-feed-pipeline
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-recent-materials
  summary: Below-feed widget listing recent materials registered for the space, hidden when empty.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_recent_materials_for_space
  tables:
    - materials
    - material_links
  related:
    - materials-recent-widget
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-onboarding-tooltip
  summary: One-time localStorage-persisted tooltip pinned to the Timeline tab on first post-deploy load.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs: []
  tables: []
  related: []
  user_facing: true
  role: viewer
  status: active
```
