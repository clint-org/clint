---
surface: Landscape Views
spec: docs/superpowers/specs/2026-04-12-unified-landscape-design.md
---

# Landscape Views

The landscape area provides three cross-cutting cuts of the same space dataset — Timeline, Bullseye, and Positioning — each rendered as a sibling under the shared landscape shell. The landscape index pages and dimension drilldowns (by company, by MOA, by ROA, by therapy area) reuse the shared filter panel and detail panels described under [Timeline Dashboard](timeline-dashboard.md) and [Future Catalysts](catalysts.md).

## Bullseye

The Bullseye view renders a concentric-ring composition of assets and markers grouped by competitive dimension. It lives at `/t/:tenantId/s/:spaceId/bullseye` with four dimension cuts (`by-company`, `by-moa`, `by-roa`, `by-therapy-area`) and per-entity drilldown routes.

## Positioning

The Positioning view contrasts assets across two dimensions on a single canvas. It lives at `/t/:tenantId/s/:spaceId/positioning` with five cuts: `by-company`, `by-moa`, `by-roa`, `by-therapy-area`, and `by-moa-therapy-area`.

## Landscape Index

The landscape index at `/t/:tenantId/s/:spaceId/landscape` and its dimension routes expose the same dataset under each grouping for browse-style navigation. The therapeutic-area drill-in opens at `/t/:tenantId/s/:spaceId/landscape/:therapeuticAreaId`.

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
- id: bullseye-overview
  summary: Concentric-ring landscape view of assets and markers at /bullseye, with company, MOA, ROA, and therapy-area dimension cuts.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye
  rpcs:
    - get_bullseye_data
  tables:
    - companies
    - products
    - trials
    - markers
  related:
    - landscape-shell
  user_facing: true
  role: viewer
  status: active
- id: bullseye-by-company
  summary: Company-grouped bullseye list and per-company drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye/by-company
    - /t/:tenantId/s/:spaceId/bullseye/by-company/:entityId
  rpcs:
    - get_bullseye_by_company
  tables:
    - companies
    - products
    - trials
  related:
    - bullseye-overview
  user_facing: true
  role: viewer
  status: active
- id: bullseye-by-moa
  summary: Mechanism-of-action-grouped bullseye list and per-MOA drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye/by-moa
    - /t/:tenantId/s/:spaceId/bullseye/by-moa/:entityId
  rpcs:
    - get_bullseye_by_moa
  tables:
    - mechanisms_of_action
    - product_mechanisms_of_action
    - products
  related:
    - bullseye-overview
  user_facing: true
  role: viewer
  status: active
- id: bullseye-by-roa
  summary: Route-of-administration-grouped bullseye list and per-ROA drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye/by-roa
    - /t/:tenantId/s/:spaceId/bullseye/by-roa/:entityId
  rpcs:
    - get_bullseye_by_roa
  tables:
    - routes_of_administration
    - product_routes_of_administration
    - products
  related:
    - bullseye-overview
  user_facing: true
  role: viewer
  status: active
- id: bullseye-by-therapy-area
  summary: Therapeutic-area-grouped bullseye list and per-area drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/bullseye/by-therapy-area
    - /t/:tenantId/s/:spaceId/bullseye/by-therapy-area/:entityId
  rpcs:
    - get_bullseye_data
  tables:
    - therapeutic_areas
    - products
  related:
    - bullseye-overview
  user_facing: true
  role: viewer
  status: active
- id: landscape-index
  summary: Browse-style landscape index across the space dataset, with therapeutic-area drill-in.
  routes:
    - /t/:tenantId/s/:spaceId/landscape
    - /t/:tenantId/s/:spaceId/landscape/:therapeuticAreaId
  rpcs:
    - get_landscape_index
  tables:
    - companies
    - products
    - trials
    - therapeutic_areas
  related:
    - landscape-shell
  user_facing: true
  role: viewer
  status: active
- id: landscape-index-by-company
  summary: Company-grouped landscape index and per-company drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/landscape/by-company
    - /t/:tenantId/s/:spaceId/landscape/by-company/:entityId
  rpcs:
    - get_landscape_index_by_company
  tables:
    - companies
    - products
    - trials
  related:
    - landscape-index
  user_facing: true
  role: viewer
  status: active
- id: landscape-index-by-moa
  summary: Mechanism-of-action-grouped landscape index and drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/landscape/by-moa
    - /t/:tenantId/s/:spaceId/landscape/by-moa/:entityId
  rpcs:
    - get_landscape_index_by_moa
  tables:
    - mechanisms_of_action
    - product_mechanisms_of_action
  related:
    - landscape-index
  user_facing: true
  role: viewer
  status: active
- id: landscape-index-by-roa
  summary: Route-of-administration-grouped landscape index and drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/landscape/by-roa
    - /t/:tenantId/s/:spaceId/landscape/by-roa/:entityId
  rpcs:
    - get_landscape_index_by_roa
  tables:
    - routes_of_administration
    - product_routes_of_administration
  related:
    - landscape-index
  user_facing: true
  role: viewer
  status: active
- id: landscape-index-by-therapy-area
  summary: Therapeutic-area-grouped landscape index and drilldown.
  routes:
    - /t/:tenantId/s/:spaceId/landscape/by-therapy-area
    - /t/:tenantId/s/:spaceId/landscape/by-therapy-area/:entityId
  rpcs:
    - get_landscape_index
  tables:
    - therapeutic_areas
    - products
  related:
    - landscape-index
  user_facing: true
  role: viewer
  status: active
- id: positioning-overview
  summary: Two-dimension contrast canvas for assets at /positioning, with company, MOA, ROA, therapy-area, and combined MOA-by-therapy cuts.
  routes:
    - /t/:tenantId/s/:spaceId/positioning
    - /t/:tenantId/s/:spaceId/positioning/by-company
    - /t/:tenantId/s/:spaceId/positioning/by-moa
    - /t/:tenantId/s/:spaceId/positioning/by-roa
    - /t/:tenantId/s/:spaceId/positioning/by-therapy-area
    - /t/:tenantId/s/:spaceId/positioning/by-moa-therapy-area
  rpcs:
    - get_positioning_data
  tables:
    - products
    - companies
    - mechanisms_of_action
    - routes_of_administration
    - therapeutic_areas
  related:
    - landscape-shell
  user_facing: true
  role: viewer
  status: active
```
