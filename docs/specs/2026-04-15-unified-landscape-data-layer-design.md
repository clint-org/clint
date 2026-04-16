# Unified Landscape Data Layer

## Problem

The timeline and catalysts features display the same underlying data (markers on trials) but fetch it through separate RPCs, use different filter mechanisms (server-side IDs vs. client-side name strings), and live in different navigation contexts. This makes cross-navigation awkward and filtering slower than it needs to be.

## Solution

Move catalysts into the landscape shell as a 4th tab, fetch the full dataset once, filter client-side, and share both data and UI state (filters, detail panel) across all views.

## Design

### 1. Tab Structure and Routing

Catalysts becomes the 4th tab in the landscape shell: **Timeline | Bullseye | Positioning | Catalysts**.

| Change | Before | After |
|---|---|---|
| Route | `/t/:tenantId/s/:spaceId/catalysts` (standalone) | `/t/:tenantId/s/:spaceId/catalysts` (landscape shell child) |
| Navigation section | Intelligence (Events + Catalysts) | Intelligence (Events only) |
| Filter source | Own filter bar (category multiselect, company select) | Landscape filter panel |

The URL stays the same so bookmarks don't break. The catalysts route moves from a standalone lazy-loaded route to a child of the landscape shell, matching how timeline/bullseye/positioning work today.

### 2. LandscapeStateService as Data Hub

`LandscapeStateService` gains a `resource()` that calls `get_dashboard_data` with all-null filters on init, fetching the full dataset once per space.

New signals and methods on LandscapeStateService:

```
// Raw data (unfiltered)
rawData: resource<DashboardData>

// Filtered views (computed from rawData + filters)
filteredCompanies: computed<Company[]>       -- for timeline
filteredCatalysts: computed<FlatCatalyst[]>  -- for catalysts table (event_date >= today, flattened, sorted chronologically)

// Shared detail panel state
selectedMarkerId: signal<string | null>
selectedDetail: signal<CatalystDetail | null>
detailLoading: signal<boolean>
selectMarker(id: string): Promise<void>     -- fetches detail via get_catalyst_detail RPC
clearSelection(): void
```

Bullseye and positioning continue with their own RPCs. They return server-computed aggregations (ring positions, bubble groupings) that are impractical to derive client-side. They share the filter state but not the dataset.

### 3. Client-Side Filtering

The `filteredCompanies` computed signal applies `LandscapeFilters` to the raw dataset:

- **companyIds** -- include only matching companies
- **productIds** -- include only matching products
- **therapeuticAreaIds** -- include only trials with matching TA
- **mechanismOfActionIds** -- include only products with matching MOA
- **routeOfAdministrationIds** -- include only products with matching ROA
- **phases** -- include only trials with a matching phase type
- **recruitmentStatuses** -- include only trials with matching recruitment status
- **studyTypes** -- include only trials with matching study type
- **markerCategoryIds** -- (new) include only markers in matching categories

The `filteredCatalysts` computed flattens the filtered hierarchy into a flat list:
1. Walk filtered companies > products > trials > markers
2. Keep only markers where `event_date >= today`
3. Attach company_name, product_name, trial_name, trial_phase, category_name, marker_type metadata to each row
4. Sort by event_date ascending
5. Return as `FlatCatalyst[]` for the catalysts table

Filter changes are instant -- no server round-trip.

### 4. Filter Panel Changes

The landscape `FilterPanelComponent` gains a **Marker Category** multi-select (Data, Regulatory, Approval, Clinical Trial, LOE). This applies to the client-side filtered views:
- Timeline: show only markers in selected categories
- Catalysts: already had this as a column filter, now promoted to the shared panel

Bullseye/Positioning RPCs do not currently accept marker category filters; adding that is out of scope.

`LandscapeFilters` gains a new field: `markerCategoryIds: string[]` (default `[]`). `EMPTY_LANDSCAPE_FILTERS` updated accordingly.

The catalysts table keeps `createGridState` for text search (searching titles, company names in-table), sorting, and time-bucket grouping. Structured filters (company, category, phase, etc.) come from the shared filter panel.

### 5. Shared Detail Panel

The `MarkerDetailPanelComponent` (drawer mode) renders once in the landscape shell component, not in individual child views. It reads from the shared state signals:

```html
<!-- In landscape-shell.component.html -->
<app-marker-detail-panel
  mode="drawer"
  [detail]="state.selectedDetail()"
  [open]="!!state.selectedMarkerId()"
  (panelClose)="state.clearSelection()"
  (markerClick)="state.selectMarker($event)"
/>
```

Cross-navigation behavior:
- Click a catalyst row -> detail panel opens -> switch to Timeline tab -> panel stays open with same marker
- Click a marker on timeline -> detail panel opens -> switch to Catalysts tab -> panel stays open, corresponding row highlighted
- Tab switch preserves all state: filters, detail panel, scroll position within each view

### 6. Data Derivation for Catalysts

The catalysts view no longer calls `get_key_catalysts`. Instead, it derives its data from the shared filtered dataset.

The latest `get_dashboard_data` RPC (updated in `20260414024141_marker_visual_redesign`) already returns the fields needed to build `FlatCatalyst`:

| FlatCatalyst field | Source in dashboard hierarchy |
|---|---|
| `marker_id` | `marker.id` |
| `title` | `marker.title` |
| `event_date`, `end_date` | `marker.event_date`, `marker.end_date` |
| `is_projected`, `projection` | `marker.is_projected`, `marker.projection` |
| `description`, `source_url` | `marker.description`, `marker.source_url` |
| `category_name` | `marker.marker_type.category_name` |
| `category_id` | **missing** -- needs one-line addition to RPC |
| `marker_type_name/icon/color/shape` | `marker.marker_type.*` |
| `company_name`, `company_id` | parent company in hierarchy |
| `product_name`, `product_id` | parent product in hierarchy |
| `trial_name`, `trial_id`, `trial_phase` | parent trial in hierarchy |

**Migration required:** Add `category_id` to the `marker_type` jsonb object in `get_dashboard_data`. One-line change: `'category_id', mt.category_id` added to the marker_type `jsonb_build_object`.

The `filteredCatalysts` computed flattens the hierarchy and produces `FlatCatalyst[]` with time-bucket grouping applied via the existing `group-catalysts.ts` utility.

The `get_catalyst_detail` RPC stays -- it fetches related data (upcoming markers for same trial, related events from the events table) that aren't in the dashboard payload.

### 7. Timeline Client-Side Filtering Migration

The timeline view currently passes filters to `get_dashboard_data` server-side. This changes:

| Before | After |
|---|---|
| `TimelineViewComponent` builds `DashboardFilters` from `LandscapeFilters` and passes to RPC | `LandscapeStateService` fetches unfiltered data once; `filteredCompanies` computed applies filters client-side |
| Filter change triggers RPC call + full re-render | Filter change triggers instant re-computation |
| `dashboardFilters` computed in `TimelineViewComponent` | `filterCompanies()` pure function in `LandscapeStateService` |

The `DashboardFilters` interface and the filter parameters on `get_dashboard_data` remain in place (other consumers may use them), but the landscape module no longer passes them.

### 8. Removed

| Item | Action |
|---|---|
| `get_key_catalysts` RPC | Drop in the same migration that adds `category_id` |
| `CatalystService.getKeyCatalysts()` | Delete method |
| `CatalystService` (if empty after removal) | Delete service if only `getKeyCatalysts` and `getCatalystDetail` remain -- move `getCatalystDetail` into `LandscapeStateService.selectMarker()` |
| `catalysts-page.component` standalone route | Reparented under landscape shell; remove old route entry |
| Catalysts filter bar (category multiselect, company select) | Replaced by landscape filter panel |
| `MarkerDetailDrawerComponent` | Already removed (consolidated into `MarkerDetailPanelComponent`) |
| `CatalystDetailPanelComponent` | Already removed (consolidated into `MarkerDetailPanelComponent`) |
| `DashboardFilters` server-side pass-through | Timeline no longer passes filters to RPC; remove `dashboardFilters` computed from `TimelineViewComponent` |

### 9. Kept Unchanged

| Item | Reason |
|---|---|
| `get_catalyst_detail` RPC | Detail panel needs related data not in dashboard payload |
| `CatalystService.getCatalystDetail()` | Used by `state.selectMarker()` |
| `createGridState` on catalysts table | Text search, sorting, pagination |
| `group-catalysts.ts` time-bucket grouping | Presentation logic for the catalysts table |
| `catalyst-table.component` | Table presenter, just receives different data source |
| `MarkerDetailContentComponent` | Shared detail body, unchanged |
| Bullseye / Positioning RPCs | Server-computed aggregations, impractical client-side |
