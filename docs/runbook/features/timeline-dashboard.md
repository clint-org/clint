---
surface: Timeline Dashboard
spec: docs/specs/clinical-trial-dashboard/spec.md
---

# Timeline Dashboard

The primary view of the engagement once the user clicks past the home page. Displays a grid where rows represent clinical trials and columns represent time. Reachable at `/t/:tenantId/s/:spaceId/timeline`. The grid is organized hierarchically:

```
Company
  +-- Asset
        +-- Indication (with development_status)
              +-- Trial (with phase bars and event markers)
```

**Multi-asset trials (master protocols).** A trial can test more than one asset (e.g. a master-protocol NCT with separate experimental arms). Membership lives in the `trial_assets` join table; `trials.asset_id` is a maintained cache of the trial's primary asset. `get_dashboard_data` nests such a trial under EVERY asset it tests (for the matching indication), and its indication/development_status derives onto each member asset. The same per-asset attribution applies to positioning and bullseye; landscape index views pivot on `asset_indications` and inherit it. Deleting an asset only removes a trial if that was its last asset; otherwise the trial survives with a repointed primary. See `docs/superpowers/specs/2026-06-04-trial-multi-asset-design.md`.

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

**Entity-page surfaces.** The timeline now mounts on trial, asset, and company detail pages with a per-page `LandscapeStateService` instance whose filters are locked to that entity and persistence is disabled. Each page also embeds `EntityEventsPanelComponent`, which lists external events scoped to the same entity via the hierarchical `get_events_page_data` RPC (trial -> product -> company rollup). Company detail passes explicit `[startYear]` / `[endYear]` for a forward-2-year window; trial and product pages use the default window. See `docs/superpowers/specs/2026-05-10-catalysts-events-on-entity-pages-design.md` for full design context.

## Timeline Zoom

Four zoom levels let users control the time granularity. The `TimelineService` defines pixel-per-year ratios for each:

| Zoom | Pixels/Year | Column Unit | Use Case |
|---|---|---|---|
| Yearly | 200 px | 1 year | 5-10 year pipelines |
| Quarterly | 600 px (150/quarter) | 1 quarter | 2-3 year views |
| Monthly | 1200 px (100/month) | 1 month | Near-term tracking |
| Daily | 1460 px (4/day) | 1 day | Precise event placement |

The `TimelineService` provides `dateToX()` and `xToDate()` methods for converting between pixel positions and ISO dates, plus `getColumns()` for generating hierarchical column headers with sub-columns.

## Auto-scroll to Earliest Event

When the grid mounts, `DashboardGridComponent` computes the X position of the earliest event (phase start date or marker date) across all visible trials and scrolls the container to 80 px before that position. This keeps the viewport anchored to real data instead of starting at the far-left padding year. The scroll re-fires when the dataset, zoom level, or year range changes.

## Filtering

The `FilterPanelComponent` lets users narrow the dashboard to:

- **Companies** -- show only selected companies
- **Assets** -- show only selected assets
- **Indications** -- filter by indication (Oncology, Cardiology, etc.)
- **Date Range** -- clamp the visible timeline window (start year / end year)
- **Recruitment Status** -- Active, Completed, Suspended, etc.
- **Study Type** -- Interventional, Observational, Expanded Access
- **Phase** -- P1, P2, P3, P4, Observational

All filter values are passed as arrays to the `get_dashboard_data()` RPC function.

## Insight Strip

A horizontal strip (`TimelineInsightStripComponent`) between the filter bar and the grid that surfaces three sections:

- **READ** -- auto-generated competitive intelligence one-liner computed by `buildCompetitiveRead()` in `competitive-read.ts`. Identifies the leader (most late-stage trials), deepest P3 pipeline, and most active company (by recent changes count). Handles edge cases: single company shows a sole-entrant summary; suppresses duplicate names when one company wins both deepest and most-active.
- **STATS** -- company, asset, trial, and catalyst counts. Catalyst count covers markers with `event_date` in the next 90 days, computed by `computeTimelineStats()`.
- **COLUMNS** -- checkbox toggles for MOA, ROA, and Notes column visibility. These signals live on `LandscapeStateService` (`showMoaColumn`, `showRoaColumn`, `showNotesColumn`) and are persisted to sessionStorage alongside other landscape state. `DashboardGridComponent` reads column visibility from the service via optional injection (falls back to all-visible when used outside the landscape shell, e.g. on entity detail pages).

## Legend

A grouped reference panel (`LegendComponent`) showing all marker types with their SVG icons and labels. Organized by category. Collapsible for more dashboard space.

## Capabilities

```yaml
- id: timeline-grid
  summary: Hierarchical Company / Asset / Indication / Trial grid with phase bars and event markers across a configurable time window.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - assets
    - indications
    - asset_indications
    - trials
    - markers
    - marker_types
    - trial_notes
  related:
    - timeline-zoom
    - timeline-filtering
    - timeline-legend
  user_facing: true
  role: viewer
  status: active
- id: timeline-phase-bars
  summary: Color-coded horizontal phase bands (P1 slate, P2 cyan, P3 teal, P4 violet, OBS amber) spanning trial phase windows.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - trials
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: timeline-event-markers
  summary: SVG event markers (circles, diamonds, flags, arrows, bars, X) placed at marker dates with category-driven colors.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - markers
    - marker_types
    - marker_categories
  related:
    - timeline-grid
    - timeline-legend
  user_facing: true
  role: viewer
  status: active
- id: timeline-trial-notes
  summary: Free-text trial annotations rendered inline on timeline rows.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - trial_notes
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: timeline-entity-page-mount
  summary: Timeline embedded on trial, asset, and company detail pages with filters locked to the entity and persistence disabled.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
  rpcs:
    - get_dashboard_data
    - get_events_page_data
  tables:
    - trials
    - assets
    - companies
    - events
  related:
    - timeline-grid
    - events-feed
  user_facing: true
  role: viewer
  status: active
- id: timeline-insight-strip
  summary: Horizontal strip above the grid with competitive read (leader, deepest pipeline, most active), summary stats (companies, assets, trials, catalysts in 90d), and column visibility toggles (MOA, ROA, Notes).
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - assets
    - trials
    - markers
  related:
    - timeline-grid
    - competitive-read-bar
  user_facing: true
  role: viewer
  status: active
- id: timeline-zoom
  summary: Four zoom levels (yearly, quarterly, monthly, daily) with per-zoom pixel-per-year ratios and pixel-to-date conversion.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables: []
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: timeline-filtering
  summary: Filter panel for company, asset, indication, date range, recruitment status, study type, and phase.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - assets
    - indications
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: timeline-legend
  summary: Collapsible grouped reference panel listing all marker types with SVG icons, organized by category.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables:
    - marker_types
    - marker_categories
  related:
    - timeline-event-markers
    - in-app-help-markers
  user_facing: true
  role: viewer
  status: active
```
