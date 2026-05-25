---
surface: Landscape Views
spec: docs/superpowers/specs/2026-04-12-unified-landscape-design.md
---

# Landscape Views

The landscape area provides cross-cutting views of the same space dataset -- Timeline, Bullseye, Positioning, and Future Catalysts -- each rendered as a sibling under the shared landscape shell. The filter bar and detail panels are shared across views as described under [Timeline Dashboard](timeline-dashboard.md) and [Future Catalysts](catalysts.md).

## Bullseye

The Bullseye view renders a concentric-ring chart of assets grouped by a user-selected spoke dimension. Scope (which assets appear) is decoupled from grouping (how they arrange into spokes). The chart lives at `/t/:tenantId/s/:spaceId/bullseye` with scope and grouping controlled via query params (`?indications=id1,id2&group=company`). Old dimension routes (`by-company`, `by-moa`, `by-roa`, `by-indication`) redirect to the new query-param format.

Key components:
- **LandscapeComponent**: fetches a flat asset list via `get_bullseye_assets` RPC with multi-select scope filters, then groups client-side via `groupAssetsIntoSpokes()`. Regrouping is instant (no re-fetch). Two-column layout: controls panel left, chart right.
- **BullseyeControlsPanelComponent**: left sidebar (220px) with Group By toggle, competitive read summary, spoke/asset stats, and full legend (phase colors, intelligence ring, activity pulse, duplicate ring indicators).
- **BullseyeChartComponent**: renders SVG radial chart. Dots use a halo ring system: teal ring for intelligence, amber pulse for recent activity, dashed ring for duplicates. Cross-spoke hover highlighting dims non-matching dots to 15%.
- **BullseyeDetailPanelComponent**: right sidebar detail pane shown on dot click. Renders asset name, company, MOA, ROA, trials (with CT.gov field overlays and change badges), and recent markers. An activity callout at the top shows the latest event (type + date) when present. An "Intelligence (N)" section lazy-loads published note rows for the asset and its trials via `get_intelligence_notes_for_asset`; each row shows the headline, an entity type badge (Asset/Trial), and entity name, and navigates to the entity detail page on click.
- **LandscapeFilterBar**: shared filter bar for cross-view scope filters. Group-by toggle lives in the controls panel, not the filter bar.
- **LandscapeStateService**: persists `spokeGrouping` signal to sessionStorage alongside filters.

## Positioning

The Positioning view contrasts assets across two dimensions on a single canvas. It lives at `/t/:tenantId/s/:spaceId/positioning` with five cuts: `by-company`, `by-moa`, `by-roa`, `by-indication`, and `by-moa-indication`.

## Capabilities

```yaml
- id: landscape-shell
  summary: Shared landscape shell hosting Timeline, Bullseye, Positioning, and Future Catalysts tabs with cross-tab filter and detail-panel continuity.
  routes:
    - /t/:tenantId
  rpcs: []
  tables: []
  related:
    - timeline-grid
    - catalysts-list
  user_facing: true
  role: viewer
  status: active
- id: bullseye-chart
  summary: Decoupled scope/grouping bullseye chart. Multi-select scope filters define which assets load; a separate toggle arranges them into spokes by any dimension. Halo ring dots, competitive read bar, cross-spoke hover highlighting.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye
  rpcs:
    - get_bullseye_assets
    - get_intelligence_notes_for_asset
  tables:
    - companies
    - assets
    - trials
    - markers
    - indications
    - asset_indications
    - mechanisms_of_action
    - asset_mechanisms_of_action
    - routes_of_administration
    - asset_routes_of_administration
    - primary_intelligence
  related:
    - landscape-shell
    - competitive-read-bar
  user_facing: true
  role: viewer
  status: active
- id: competitive-read-bar
  summary: Auto-generated one-line competitive summary bar. Identifies leader, deepest late-stage pipeline, and most active spoke from grouped bullseye data.
  routes: []
  rpcs: []
  tables: []
  related:
    - bullseye-chart
  user_facing: true
  role: viewer
  status: active
- id: bullseye-legacy-redirects
  summary: Redirect legacy dimension routes (by-company, by-moa, by-roa, by-indication) to the new query-param-based /bullseye route.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye/by-company
    - /t/:tenantId/s/:spaceId/bullseye/by-moa
    - /t/:tenantId/s/:spaceId/bullseye/by-roa
    - /t/:tenantId/s/:spaceId/bullseye/by-indication
  rpcs: []
  tables: []
  related:
    - bullseye-chart
  user_facing: false
  role: viewer
  status: active
- id: landscape-index
  summary: Browse-style landscape index available as an overlay from the bullseye filter bar. Used for quick entity selection into scope filters.
  routes: []
  rpcs:
    - get_landscape_index
    - get_landscape_index_by_company
    - get_landscape_index_by_moa
    - get_landscape_index_by_roa
  tables:
    - companies
    - assets
    - trials
    - indications
    - asset_indications
  related:
    - bullseye-chart
    - landscape-shell
  user_facing: true
  role: viewer
  status: active
- id: positioning-overview
  summary: Two-dimension contrast canvas for assets at /positioning, with company, MOA, ROA, indication, and combined MOA-by-indication cuts.
  routes:
    - /t/:tenantId/s/:spaceId/positioning
    - /t/:tenantId/s/:spaceId/positioning/by-company
    - /t/:tenantId/s/:spaceId/positioning/by-moa
    - /t/:tenantId/s/:spaceId/positioning/by-roa
    - /t/:tenantId/s/:spaceId/positioning/by-indication
    - /t/:tenantId/s/:spaceId/positioning/by-moa-indication
  rpcs:
    - get_positioning_data
  tables:
    - assets
    - companies
    - mechanisms_of_action
    - routes_of_administration
    - indications
    - asset_indications
  related:
    - landscape-shell
  user_facing: true
  role: viewer
  status: active
```
