---
surface: Engagement Landing
spec: docs/specs/engagement-landing/spec.md
---

# Engagement Landing

When a user opens an engagement (a space), the default page is the **Engagement Landing** at `/t/:tenantId/s/:spaceId`. The timeline now lives at `/t/:tenantId/s/:spaceId/timeline` and the engagement landing is the home base that frames everything else. See [docs/specs/engagement-landing/spec.md](../specs/engagement-landing/spec.md).

**Composition:**

- **Pulse header** (inline in `EngagementLandingComponent`): tracked eyebrow (`TENANT · SPACE · ENGAGEMENT`), the engagement title, an "active since YYYY-Q#" subline, and five integrated stat tiles (active trials, companies, programs, catalysts in next 90 days, intelligence total). Each tile is a router link to the corresponding browse / list page (`manage/trials`, `manage/companies`, `manage/products`, `catalysts`, `intelligence`); the catalyst tile carries a `warn` accent when it is the only stat coloured by recency. Counts come from a single `get_space_landing_stats(p_space_id)` RPC call.
- **Today brief banner** (optional, inline): teal-accented one-line rollup with today's date and short clauses for catalysts this week and drafts in progress. Hidden when both counts are zero. Trail-arrow link goes to `/catalysts`.
- **Three-up panels (above the fold):**
  - **What changed** (`<app-what-changed-widget>`): high-signal change events from the past 7 days, capped at five.
  - **Next 14 days** (inline calendar): up to seven upcoming markers within 14 days, derived client-side from the existing `get_dashboard_data` feed. Date-chip column (`DD / DAY`), event title, who-line (`COMPANY · PRODUCT · PROJECTED`), trailing marker glyph in the marker-type colour. Clicking a row opens the marker detail panel on the catalysts tab. Header surfaces a `Calendar →` link.
  - **Your drafts** (`<app-drafts-widget>`, agency-only): rendered only when the viewer is an agency member of the tenant's parent agency. Amber left accent on the panel chrome. Backed by `list_draft_intelligence_for_space(p_space_id, p_limit)`. Empty state preserves the placement when there are no drafts.
- **Latest from Stout** (full-width below the fold, inline): the most recently published primary intelligence rows. First row renders as a featured post (larger headline, three-line excerpt); the rest render as a two-column grid with the per-row kind chip coloured by `entity_type` (`trial`, `company`, `product`, `marker`, `space`). Header includes a count tag (`X intelligence posts · Y this week`) and entity-type filter chips that filter client-side. Footer surfaces a `View all intelligence` link to `/t/:tenantId/s/:spaceId/intelligence`. Falls back to a dashed empty state when there are no rows.
- **Recent materials** (below feed): renders `<app-recent-materials-widget>` against `list_recent_materials_for_space`. Hidden automatically when there are no materials and no error.

**Onboarding tooltip.** First post-deploy load shows a one-time tooltip pinned to the Timeline tab in the topbar: "Your timeline is now under the Timeline tab." Dismissed by clicking the inline button or by clicking the Timeline tab itself. Persists in localStorage at `clint.engagement-landing.onboarding-tooltip-seen`.

**Routing change details.** Inside the space-scoped router, the engagement landing matches the empty path with `pathMatch: 'full'`, and the LandscapeShellComponent stays mounted for `timeline`, `bullseye`, `positioning`, and `catalysts` as siblings. Existing bookmarks to the timeline keep working via the new `/timeline` route. The topbar nav for the Landscape section is now `Home / Timeline / Bullseye / Positioning / Catalysts`.

**Stats RPC.** `get_space_landing_stats(p_space_id uuid)` returns a single jsonb object with `active_trials` (excludes recruitment_status in `completed`/`withdrawn`/`terminated`), `companies` (distinct company_id on products in the space), `programs` (count of products), `catalysts_90d` (markers within today + 90 days), and `intelligence_total` (count of published rows in `primary_intelligence`). Gated on `has_space_access`; security definer; language sql stable.

**Drafts RPC.** `list_draft_intelligence_for_space(p_space_id uuid, p_limit int default 3)` returns up to `p_limit` draft `primary_intelligence` rows, recency-ordered. Visibility is gated by the `primary_intelligence_view_drafts` RLS policy (agency members of the space only); non-agency callers receive an empty array.

## Capabilities

```yaml
- id: engagement-landing-pulse-header
  summary: Pulse header with tracked eyebrow, engagement title, active-since subline, and five stat tiles linking to browse pages.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables:
    - spaces
    - trials
    - products
    - companies
    - markers
    - primary_intelligence
  related: []
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-today-brief
  summary: Optional teal-accented one-line banner with date plus catalyst-this-week and drafts-in-progress clauses.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_space_landing_stats
  tables: []
  related:
    - engagement-landing-pulse-header
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-what-changed
  summary: Three-up panel showing top five high-signal change events from the past seven days.
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
- id: engagement-landing-next-14-days
  summary: Inline calendar of up to seven upcoming markers within 14 days, derived client-side from the shared dashboard feed.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - get_dashboard_data
  tables:
    - markers
    - marker_types
  related: []
  user_facing: true
  role: viewer
  status: active
- id: engagement-landing-drafts-widget
  summary: Agency-only panel listing in-progress draft intelligence rows, with amber accent and empty-state preservation.
  routes:
    - /t/:tenantId/s/:spaceId
  rpcs:
    - list_draft_intelligence_for_space
  tables:
    - primary_intelligence
  related:
    - primary-intelligence-drawer
  user_facing: true
  role: agency
  status: active
- id: engagement-landing-latest-from-stout
  summary: Full-width feed of most-recently-published primary intelligence rows, with featured first item and entity-type filter chips.
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
