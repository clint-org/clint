---
surface: Future Catalysts
spec: docs/specs/future-catalysts-rename/spec.md
---

# Future Catalysts

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

## Capabilities

```yaml
- id: catalysts-list
  summary: Adaptive-bucket dense table of upcoming markers grouped by week, month, and quarter based on distance from today.
  routes:
    - /t/:tenantId/s/:spaceId/catalysts
  rpcs:
    - get_dashboard_data
  tables:
    - markers
    - marker_types
    - marker_categories
    - trials
    - products
    - companies
  related:
    - catalysts-detail-panel
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
- id: catalysts-deep-link
  summary: Query-param markerId opens the detail panel on load, used by the command palette.
  routes:
    - /t/:tenantId/s/:spaceId/catalysts
  rpcs:
    - get_catalyst_detail
  tables:
    - markers
  related:
    - palette-activation-targets
  user_facing: true
  role: viewer
  status: active
- id: catalysts-detail-panel
  summary: Shared landscape detail panel that stays open when switching to the Timeline tab, with cross-tab spatial continuity.
  routes:
    - /t/:tenantId/s/:spaceId/catalysts
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_catalyst_detail
  tables:
    - markers
    - marker_types
  related:
    - catalysts-list
  user_facing: true
  role: viewer
  status: active
- id: catalysts-filtering
  summary: Shared landscape filter panel plus in-table text search, with filters carrying across all landscape tabs.
  routes:
    - /t/:tenantId/s/:spaceId/catalysts
  rpcs:
    - get_dashboard_data
  tables:
    - companies
    - products
    - therapeutic_areas
    - mechanisms_of_action
    - routes_of_administration
  related:
    - timeline-filtering
  user_facing: true
  role: viewer
  status: active
```
