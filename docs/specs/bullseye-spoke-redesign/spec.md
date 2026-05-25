---
id: spec-2026-bullseye-spoke-redesign
title: Bullseye Spoke Redesign
slug: bullseye-spoke-redesign
status: approved
created: 2026-05-24
updated: 2026-05-24
depends-on: spec-2026-indication-model
---

# Bullseye Spoke Redesign

## Summary

Decouple scope selection (which assets appear on the chart) from spoke grouping (how those assets are arranged into radial sectors). Today, picking one entity in one dimension (e.g., a single indication) determines both the data set and the spoke axis. The redesign replaces this with two independent controls: multi-select scope filters that define which assets are loaded, and a grouping toggle that arranges those assets into spokes by any dimension. Assets that appear on multiple spokes get a dashed outline (always visible) and cross-spoke hover highlighting. A "Competitive Read" bar auto-generates a one-line summary of the chart's key findings.

Interactive prototype: `docs/prototypes/bullseye-spoke-redesign.html`

## Motivation

### Scope and grouping are coupled

The current bullseye requires users to pick a dimension (Indication, Company, MOA, ROA) and then a single entity within that dimension. Spokes become the cross-dimension automatically. To compare "Oncology + Immunology assets grouped by company," you would need to open two separate bullseye views and mentally merge them. The redesign makes this a single configuration.

### Cross-dimension questions are natural

CI analysts routinely ask questions that span dimensions: "What does Pfizer's oral portfolio look like across indications?" (Company + ROA scope, Indication grouping), "Who's developing PD-1/PD-L1 drugs and how far along?" (MOA scope, Company grouping, then toggle to Indication grouping). These require four steps in the current model and cannot be answered within a single chart.

### The entity index page is an unnecessary gate

Users must navigate through an entity index grid, click one entity, and then arrive at the chart. With decoupled scope, the chart renders immediately and users progressively filter to narrow. The index page can be repurposed as a quick-pick shortcut or removed.

## Goals

- Multi-select scope filters across all dimensions simultaneously (indications, companies, MOAs, ROAs, phases, assets).
- Independent spoke grouping toggle: Company, Indication, MOA, ROA, Asset.
- Client-side regrouping without re-fetching when only the grouping changes.
- Duplicate asset handling: dashed outline on dots appearing in multiple spokes, plus cross-spoke hover highlighting.
- Auto-generated "Competitive Read" bar summarizing the chart's key findings.
- Halo-ring indicator system on dots: teal ring for assets with intelligence, amber pulse for recent activity.
- Intelligence aggregated from both asset-level and trial-level records on each dot.
- Light surface (no dark mode changes).
- Filter bar remains shared across all landscape views (timeline, bullseye, positioning, catalysts).
- Spoke count auto-capped at 16 with overflow collapse ("+ N more").

## Non-Goals

- Dark mode or instrument-surface themes (evaluated, light mode confirmed as best fit for brand).
- Saved/named views (valuable but cross-cutting; separate spec).
- Chart export to PNG/slide (follow timeline export pattern; separate spec).
- Changes to the detail panel component (carries forward with minor updates).
- Positioning view changes (separate grouping model, separate spec if unified).
- Onboarding coach marks or contextual help overlays (deferred).

## Design

### Architecture: scope vs. grouping

```
Scope filters (what data loads)          Grouping (how data arranges)
------------------------------------     ----------------------------
Indication: [Oncology, Immunology]  -->  Group by: Company
Company:    []                           (toggle: Company | Indication |
MOA:        []                            MOA | ROA | Asset)
ROA:        []
Phase:      []
Asset:      []
```

The scope filters determine which assets are fetched from the backend. The grouping toggle is a pure client-side transformation on the fetched data set: it takes the flat asset list and partitions it into `BullseyeSpoke[]` by the selected dimension.

### Data flow

```
1. User sets scope filters
2. Frontend calls new RPC: get_bullseye_assets(p_space_id, filters)
   -> returns flat BullseyeAsset[] with full dimension metadata
3. Client stores flat asset list in signal
4. User selects grouping dimension
5. Client-side groupBy() produces BullseyeSpoke[]
6. BullseyeChartComponent renders (same input shape as today)
7. Regrouping (step 4-6) is instant, no re-fetch
```

### New RPC: get_bullseye_assets

Replaces the four dimension-specific RPCs for the bullseye chart. Returns a flat list of assets matching the scope filters, with all dimension metadata attached to each asset.

```sql
create or replace function public.get_bullseye_assets(
  p_space_id uuid,
  p_indication_ids uuid[] default null,
  p_company_ids uuid[] default null,
  p_moa_ids uuid[] default null,
  p_roa_ids uuid[] default null,
  p_phases text[] default null,
  p_asset_ids uuid[] default null
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  -- Returns:
  -- {
  --   "assets": [
  --     {
  --       "id", "name", "generic_name", "logo_url",
  --       "company_id", "company_name",
  --       "highest_phase", "highest_phase_rank",
  --       "indications": [{ "id", "name", "abbreviation" }],
  --       "moas": [{ "id", "name" }],
  --       "roas": [{ "id", "name", "abbreviation" }],
  --       "trials": [{ id, name, identifier, status, ... }],
  --       "recent_markers": [{ id, event_date, ... }],
  --       "intelligence_count": 3,
  --       "has_recent_activity": true,
  --       "latest_event_date": "2026-05-20",
  --       "latest_event_type": "DATA"
  --     }
  --   ]
  -- }
$$;
```

Key differences from the current 4-RPC model:

| Aspect | Current (4 RPCs) | New (1 RPC) |
|--------|-----------------|-------------|
| Scope | One entity in one dimension | Multi-select across all dimensions |
| Grouping | Baked into the RPC response | Client-side transformation |
| Asset metadata | Partial (only relevant cross-dim) | Full (all indications, MOAs, ROAs per asset) |
| Intelligence | Not included | `intelligence_count` summing asset + trial level |
| Activity | Not included | `has_recent_activity`, `latest_event_date`, `latest_event_type` |
| Phase source | `asset_indications.development_status` | Same, but max across all matching indications |

The RPC applies scope filters as WHERE clauses:
- `p_indication_ids`: asset must have at least one matching `asset_indications.indication_id`
- `p_company_ids`: asset's `company_id` must be in the list
- `p_moa_ids`: asset must have at least one matching `asset_mechanisms_of_action.mechanism_of_action_id`
- `p_roa_ids`: asset must have at least one matching `asset_routes_of_administration.route_of_administration_id`
- `p_phases`: asset's highest phase (max across matching indications) must be in the list
- `p_asset_ids`: asset's `id` must be in the list
- All filters are AND-combined. Null/empty means "no filter on this dimension."

### Client-side grouping

```typescript
function groupAssetsIntoSpokes(
  assets: BullseyeAsset[],
  grouping: SpokeGrouping
): BullseyeSpoke[] {
  const groups: Map<string, BullseyeAsset[]> = new Map();

  for (const asset of assets) {
    const keys = getSpokeKeys(asset, grouping);
    for (const { id, name } of keys) {
      if (!groups.has(id)) groups.set(id, []);
      groups.get(id)!.push(asset);
    }
  }

  return [...groups.entries()]
    .map(([id, products]) => ({
      id,
      name: products[0] ? getSpokeLabel(id, grouping, products[0]) : id,
      display_order: 0,
      highest_phase_rank: Math.max(...products.map(p => p.highest_phase_rank)),
      products,
    }))
    .sort((a, b) => b.highest_phase_rank - a.highest_phase_rank);
}
```

When grouping by a multi-valued dimension (indication, MOA, ROA), an asset with multiple values appears in multiple spokes. This is analytically correct. The chart tracks `duplicatedAssetIds: Set<string>` during the groupBy pass.

### Updated model types

```typescript
// New grouping type (replaces BullseyeDimension for spoke arrangement)
type SpokeGrouping = 'company' | 'indication' | 'moa' | 'roa' | 'asset';

// Extended asset with intelligence and activity fields
interface BullseyeAsset {
  // ... existing fields ...
  indications: { id: string; name: string; abbreviation: string | null }[];
  intelligence_count: number;
  has_recent_activity: boolean;
  latest_event_date: string | null;
  latest_event_type: string | null;
}
```

### Dot visual system: halo rings

All dots use the halo ring indicator system (style B from prototyping):

| Indicator | Visual | Size |
|-----------|--------|------|
| Base dot | Filled circle, phase-colored | 7px radius |
| Intelligence attached | Teal ring around dot | 12px radius, 2px stroke |
| Recent activity | Amber pulsing ring (2.5s cycle) | 12px expanding to 22px |
| Duplicate (multi-spoke) | Dashed slate ring | 12px or 17px radius if intel ring present |
| Hover (cross-spoke) | All copies highlighted, all other dots dim to 15% | N/A |

Intelligence count is the sum of:
- Asset-level primary intelligence records
- Trial-level primary intelligence records for all trials belonging to that asset

On hover tooltip, show: asset name, company, phase, and if recent activity exists, the event type and date (e.g., "DATA -- May 20, 2026").

### Competitive Read bar

A `<div>` between the filter bar and the chart that auto-generates a one-line competitive summary. Updates reactively when scope or grouping changes.

Generation logic (in order of priority):
1. **Leader**: spoke with the most launched assets, or most approved, or highest max phase.
2. **Deepest late-stage**: spoke (excluding leader) with the most P3+ assets.
3. **Most active**: spoke with the most assets flagged `has_recent_activity`.

Format: `**Pfizer** leads with 2 launched assets | **Merck** deepest P3 pipeline (4) | **Lilly** most active (3 events)`

When no scope filters are active and no assets are loaded, show: "Filter by indication, company, or mechanism to see the competitive read."

### Spoke overflow

When the grouping produces more than 16 spokes:
1. Sort spokes by highest_phase_rank descending, then by asset count descending.
2. Keep the top 15.
3. Collapse the rest into a "+ N more" label (no dots rendered for the overflow spoke).
4. The badge bar shows the full count: "15 of 23 spokes shown."

### URL and state persistence

Scope filters and grouping are encoded in query params:

```
/t/:tenantId/s/:spaceId/bullseye
  ?indications=id1,id2
  &companies=id3
  &group=company
```

- Filter changes use `replaceUrl: true` (no back-button entry per filter toggle).
- Grouping changes use `replaceUrl: true` as well.
- `LandscapeStateService` persists scope + grouping to sessionStorage (same pattern as today).
- The filter bar state is shared across all landscape views. Switching from bullseye to timeline preserves the active scope filters.

### Routing changes

| Current | New |
|---------|-----|
| `/bullseye/by-indication/:entityId` | `/bullseye?indications=:id&group=company` |
| `/bullseye/by-company/:entityId` | `/bullseye?companies=:id&group=indication` |
| `/bullseye/by-moa/:entityId` | `/bullseye?moas=:id&group=company` |
| `/bullseye/by-roa/:entityId` | `/bullseye?roas=:id&group=company` |
| `/bullseye/by-indication` (index) | `/bullseye` (chart renders directly) |

Old routes redirect to the new query-param format for backward compatibility.

### Entity index page

The index page (`LandscapeIndexComponent`) becomes a quick-pick overlay accessible via a "Browse" button in the filter bar. Clicking an entity card sets the corresponding scope filter and closes the overlay. The full-page index route is removed; the bullseye route renders the chart directly.

### Filter bar changes

The filter bar gains:
- **Asset** dropdown (searchable, uses `AssetService`).
- All dropdowns become multi-select by default (most already are).
- The "Grouped / Assets" spoke mode toggle is replaced by the grouping toggle row (Company | Indication | MOA | ROA | Asset).
- When the grouping dimension matches a scope filter, the filter is visually de-emphasized but not hidden (e.g., grouping by Company while Company filter is active still works, just shows a single spoke).

### Migration path

1. The new `get_bullseye_assets` RPC coexists with the existing 4 RPCs during migration.
2. `LandscapeComponent` is updated to call the new RPC and perform client-side grouping.
3. Old routes redirect to new query-param routes.
4. Once stable, the 4 dimension-specific bullseye RPCs are deprecated (not dropped immediately, in case other consumers exist).

## Related capabilities

Adjacent features surfaced by `npm run features:near`:
- **Primary intelligence** (asset + trial level): intelligence_count field aggregates from existing `primary_intelligence` records.
- **Timeline export**: export pattern to follow for future bullseye export (separate spec).
- **Positioning view**: shares the filter bar; grouping model could be unified in a future spec.

## Tasks

```yaml
tasks:
  - id: rpc
    title: Create get_bullseye_assets RPC
    domain: database
    description: |
      New RPC that returns flat asset list with full dimension metadata,
      intelligence count, and activity indicators. Accepts multi-select
      filter params for all dimensions. Coexists with existing 4 RPCs.
    estimate: large
    depends_on: []

  - id: model
    title: Update landscape model types
    domain: frontend
    description: |
      Add SpokeGrouping type. Extend BullseyeAsset with indications array,
      intelligence_count, has_recent_activity, latest_event_date,
      latest_event_type. Add groupAssetsIntoSpokes utility function.
    estimate: small
    depends_on: []

  - id: service
    title: Update LandscapeService for new RPC
    domain: frontend
    description: |
      Add getBullseyeAssets method calling the new RPC with scope filter
      params. Keep existing getBullseyeData for backward compat during
      migration. Update cache tags.
    estimate: small
    depends_on: [rpc, model]

  - id: state
    title: Update LandscapeStateService for scope + grouping
    domain: frontend
    description: |
      Add spokeGrouping signal (replaces spokeMode for bullseye).
      Persist grouping to sessionStorage. Scope filters already exist
      in LandscapeFilters. Remove spokeMode (replaced by grouping).
    estimate: small
    depends_on: [model]

  - id: component
    title: Rewrite LandscapeComponent for decoupled scope/grouping
    domain: frontend
    description: |
      Replace entity-scoped resource with scope-filtered resource calling
      getBullseyeAssets. Add client-side grouping computed. Track
      duplicatedAssetIds. Feed grouped data to BullseyeChartComponent
      (same BullseyeData shape). Wire up hover cross-highlighting.
    estimate: medium
    depends_on: [service, state]

  - id: chart-dots
    title: Implement halo ring dot system in BullseyeChartComponent
    domain: frontend
    description: |
      Replace current dot rendering with halo ring system. Base dot 7px.
      Teal ring for intelligence. Amber pulse for activity. Dashed ring
      for duplicates. Cross-spoke hover highlighting (dim all other dots
      to 15%, highlight all copies of hovered asset).
    estimate: medium
    depends_on: [component]

  - id: read-bar
    title: Add Competitive Read bar component
    domain: frontend
    description: |
      New component between filter bar and chart. Auto-generates one-line
      competitive summary from grouped data. Identifies leader, deepest
      late-stage, most active. Updates reactively on scope/grouping change.
    estimate: small
    depends_on: [component]

  - id: filter-bar
    title: Update filter bar for spoke redesign
    domain: frontend
    description: |
      Add Asset dropdown (searchable). Replace Grouped/Assets toggle with
      grouping toggle row. Add "Browse" button that opens entity index as
      overlay. Ensure grouping toggle is visible only in bullseye view.
    estimate: medium
    depends_on: [state]

  - id: routing
    title: Update routing for query-param-based bullseye
    domain: frontend
    description: |
      Remove /bullseye/by-{dimension}/:entityId routes. Add /bullseye
      route with query param parsing. Add redirects from old routes to
      new format. Update landscape-shell dimension tab behavior.
    estimate: medium
    depends_on: [component, filter-bar]

  - id: tooltip
    title: Enhance dot tooltip with temporal data
    domain: frontend
    description: |
      On hover, show asset name, company, phase. If has_recent_activity,
      show latest_event_type and latest_event_date. If intelligence_count
      > 0, show count. If duplicate, show spoke count.
    estimate: small
    depends_on: [chart-dots]
```
