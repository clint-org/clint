---
surface: Timeline Dashboard
spec: docs/specs/clinical-trial-dashboard/spec.md
---

# Timeline Dashboard

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

**Entity-page surfaces.** The timeline now mounts on trial, product, and company detail pages with a per-page `LandscapeStateService` instance whose filters are locked to that entity and persistence is disabled. Each page also embeds `EntityEventsPanelComponent`, which lists external events scoped to the same entity via the hierarchical `get_events_page_data` RPC (trial -> product -> company rollup). Company detail passes explicit `[startYear]` / `[endYear]` for a forward-2-year window; trial and product pages use the default window. See `docs/superpowers/specs/2026-05-10-catalysts-events-on-entity-pages-design.md` for full design context.

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

## Capabilities

```yaml
- id: timeline-grid
  summary: Hierarchical Company / Product / Trial grid with phase bars and event markers across a configurable time window.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - products
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
  summary: Timeline embedded on trial, product, and company detail pages with filters locked to the entity and persistence disabled.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
    - /t/:tenantId/s/:spaceId/manage/assets/:id
    - /t/:tenantId/s/:spaceId/manage/companies/:id
  rpcs:
    - get_dashboard_data
    - get_events_page_data
  tables:
    - trials
    - products
    - companies
    - events
  related:
    - timeline-grid
    - events-feed
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
  summary: Filter panel for company, product, therapeutic area, date range, recruitment status, study type, and phase.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - products
    - therapeutic_areas
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
