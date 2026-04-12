# Unified Landscape Module

**Date:** 2026-04-12
**Status:** approved

## Summary

Merge Dashboard (timeline grid) and Landscape (bullseye charts) into a single "Landscape" module. The top-nav "Dashboard" item is removed. "Landscape" becomes the default route for a space. A segmented control in the content header toolbar switches between view modes (Timeline, Bullseye, future chart types). Filter state is shared across views so users can set filters once and flip between visualizations to see the same data slice from different angles.

## Design Decisions

1. **Segmented control in content header** (not sidebar, not tabs). Maximizes content area for data-dense views. Feels like switching a view mode, not navigating. Most aligned with the Bloomberg-like instrumental aesthetic.

2. **"Landscape" as the umbrella name.** Domain-native, already exists in the nav. Timeline and Bullseye are view modes within it.

3. **Dimension dropdown + entity index** for Bullseye. Dimension selected via dropdown in toolbar. Entity selected via index card grid in the content area (preserves metadata like product count, highest phase). Once an entity is selected, an entity dropdown appears in the toolbar for direct switching between entities.

4. **Shared filter bar** with conditional view-specific controls. Common filters (Company, Product, TA, MOA, ROA, Phase, Status, Study Type) always visible. Zoom and date range appear only for Timeline. Spoke mode appears only for Bullseye. Active dimension filter is hidden contextually.

5. **Filter state persists** across view switches. Set filters, flip between Timeline and Bullseye to compare the same slice.

## Navigation

### Top Nav

- "Dashboard" removed from header
- "Landscape" remains, becomes the default active link for space root route
- Other nav items unchanged (Companies, Products, Trials, Markers, Areas)

### Content Header Toolbar (left to right)

1. **Segmented control** -- pill toggle: `Timeline | Bullseye | [future]`
2. **Dimension dropdown** -- visible only when Bullseye selected. Options: Therapy Area, Company, MOA, ROA
3. **Entity dropdown** -- visible only when a Bullseye entity is selected. Shows current entity name, allows switching or clearing (clear returns to index)
4. **Shared filter bar** -- common filters always shown, view-specific controls conditional
5. Active dimension filter hidden when viewing Bullseye for that dimension

### Content Area

| View State | Content |
|---|---|
| Timeline (default) | Full-width timeline grid |
| Bullseye, no entity | Dimension index card grid |
| Bullseye, entity selected | Bullseye chart + detail panel |

## URL Structure

```
/t/:tenantId/s/:spaceId                              → Timeline (default)
/t/:tenantId/s/:spaceId/bullseye                      → Bullseye, redirects to /bullseye/by-therapy-area
/t/:tenantId/s/:spaceId/bullseye/by-therapy-area      → Bullseye index for therapy area
/t/:tenantId/s/:spaceId/bullseye/by-therapy-area/:id  → Bullseye chart for specific TA
/t/:tenantId/s/:spaceId/bullseye/by-company           → Bullseye index for company
/t/:tenantId/s/:spaceId/bullseye/by-company/:id       → Bullseye chart for specific company
/t/:tenantId/s/:spaceId/bullseye/by-moa               → Bullseye index for MOA
/t/:tenantId/s/:spaceId/bullseye/by-moa/:id           → Bullseye chart for specific MOA
/t/:tenantId/s/:spaceId/bullseye/by-roa               → Bullseye index for ROA
/t/:tenantId/s/:spaceId/bullseye/by-roa/:id           → Bullseye chart for specific ROA
```

### Redirects

- `/t/:tenantId/s/:spaceId/landscape` → `/t/:tenantId/s/:spaceId/bullseye/by-therapy-area`
- `/t/:tenantId/s/:spaceId/landscape/by-therapy-area/:id` → `/t/:tenantId/s/:spaceId/bullseye/by-therapy-area/:id`
- Same pattern for all `/landscape/*` paths → `/bullseye/*`

### Route-Driven UI State

- Segmented control: root path = Timeline active, `/bullseye/**` = Bullseye active
- Dimension dropdown: derived from path segment (`by-therapy-area`, `by-company`, etc.)
- Entity dropdown: derived from `:id` route param
- Filter state: query params (`?companyIds=...&phases=...`)
- Product selection on bullseye: `?product=id` query param

## Component Architecture

### New Components

**LandscapeShellComponent** -- the unified shell that replaces both the current DashboardComponent wrapper and the current LandscapeShellComponent.

Responsibilities:
- Render segmented control, dimension dropdown, entity dropdown
- Render shared filter bar
- Own filter state as signals
- Derive view mode, dimension, entity from route
- Render `<router-outlet>` for child view content

**TimelineViewComponent** -- the timeline grid content extracted from the current DashboardComponent.

Responsibilities:
- Receive filters, zoom level, date range as inputs
- Call DashboardService to fetch data
- Render DashboardGridComponent and its children
- Own zoom control and legend (view-specific UI that sits within the content area, not the toolbar)

### Modified Components

**LandscapeFilterBarComponent** -- refactored to be the unified filter bar.

Changes:
- Absorb filter dimensions from the current dashboard FilterPanelComponent (zoom, date range)
- Render common filters always, view-specific controls conditionally based on active view mode input
- Accept active view mode as input to toggle conditional controls

**LandscapeComponent** (bullseye view) -- refactored to receive filters from shell.

Changes:
- Remove internal filter bar rendering (moved to shell)
- Receive filters as input from shell
- Keep bullseye chart, detail panel, product selection logic

**LandscapeIndexComponent** -- mostly unchanged.

Changes:
- Minor: may need to accept dimension from shell instead of reading route directly, depending on routing structure

### Removed Components

- `DashboardComponent` -- split into LandscapeShellComponent (toolbar/filters) and TimelineViewComponent (grid content)
- Current `LandscapeShellComponent` (the sidebar version) -- replaced by unified shell
- `FilterPanelComponent` (dashboard) -- merged into unified LandscapeFilterBarComponent

### Unchanged Components

- `BullseyeChartComponent` -- SVG rendering, no changes
- `BullseyeDetailPanelComponent` -- product details, no changes
- `DashboardGridComponent` and children (grid-header, phase-bar, marker, marker-tooltip, row-notes) -- no changes
- `ZoomControlComponent` -- rendered by the shared filter bar conditionally when Timeline is active (view-specific control)
- `LegendComponent` -- rendered by TimelineViewComponent in the content area
- `ExportDialogComponent` -- stays with timeline view

## Data Flow

```
LandscapeShellComponent
  ├── Signals: filters, viewMode (from route), dimension (from route), entityId (from route)
  ├── Shared filter bar reads/writes filter signals
  ├── <router-outlet> renders one of:
  │
  ├── TimelineViewComponent
  │     ├── Inputs: filters
  │     ├── Own state: zoom, date range (view-specific, in toolbar or content area)
  │     ├── Calls: DashboardService.getDashboardData(spaceId, filters)
  │     └── Renders: grid, legend, zoom control, export dialog
  │
  ├── LandscapeIndexComponent
  │     ├── Inputs: dimension
  │     ├── Calls: LandscapeService.getLandscapeIndex(spaceId, dimension)
  │     └── Renders: entity card grid
  │
  └── LandscapeComponent (bullseye)
        ├── Inputs: filters, dimension, entityId
        ├── Own state: selectedProduct, spokeMode, hover
        ├── Calls: LandscapeService.getBullseyeData(spaceId, dimension, entityId)
        └── Renders: bullseye chart + detail panel
```

## Services

No new services. Existing services remain:

- **DashboardService** -- used by TimelineViewComponent
- **LandscapeService** -- used by LandscapeIndexComponent and LandscapeComponent
- **TimelineService** -- used by TimelineViewComponent for zoom/column layout
- Shared services (CompanyService, ProductService, etc.) -- used by filter bar for dropdown options

## Filter Specification

### Common Filters (all views)

| Filter | Type | Widget |
|---|---|---|
| Company | multi-select | PrimeNG MultiSelect |
| Product | multi-select | PrimeNG MultiSelect |
| Therapeutic Area | multi-select | PrimeNG MultiSelect |
| Mechanism of Action | multi-select | PrimeNG MultiSelect |
| Route of Administration | multi-select | PrimeNG MultiSelect |
| Phase | multi-select | PrimeNG SelectButton |
| Recruitment Status | multi-select | PrimeNG MultiSelect |
| Study Type | multi-select | PrimeNG MultiSelect |

### View-Specific Controls

| Control | View | Widget |
|---|---|---|
| Zoom level (yearly/quarterly/monthly/daily) | Timeline | ZoomControlComponent or PrimeNG SelectButton |
| Date range (start year, end year) | Timeline | PrimeNG InputNumber or Select |
| Spoke mode (grouped/products) | Bullseye | PrimeNG SelectButton |
| Export | Timeline | Button triggering ExportDialogComponent |

### Contextual Hiding

When viewing Bullseye by a specific dimension, the corresponding filter is hidden:
- by-therapy-area: hide TA filter
- by-company: hide Company filter
- by-moa: hide MOA filter
- by-roa: hide ROA filter

## Migration Phases

### Phase 1: Scaffold Shell and Routes

- Create new LandscapeShellComponent with segmented control
- Set up new route tree: root = Timeline (lazy), `/bullseye/**` = Bullseye routes (lazy)
- Wire redirects from `/landscape/*` to `/bullseye/*`
- Update header: remove "Dashboard" link, make "Landscape" active for space root

### Phase 2: Extract Timeline View

- Create TimelineViewComponent by extracting grid/visualization from DashboardComponent
- Move filter state management to the shell
- TimelineViewComponent receives filters as inputs, owns zoom/legend/export internally

### Phase 3: Unify Filter Bar

- Merge dashboard FilterPanelComponent and landscape LandscapeFilterBarComponent
- Add view mode input for conditional rendering of view-specific controls
- Wire filter signals from shell through to unified filter bar

### Phase 4: Integrate Bullseye

- Move bullseye routes under new shell
- Add dimension dropdown and entity dropdown to shell toolbar
- Bullseye views receive filters from shell instead of managing their own
- Preserve product selection, spoke mode, hover behavior

### Phase 5: Cleanup

- Remove old DashboardComponent
- Remove old LandscapeShellComponent (sidebar version)
- Remove old FilterPanelComponent
- Remove "Dashboard" from header navigation
- Verify all redirects work
- Run lint and build
