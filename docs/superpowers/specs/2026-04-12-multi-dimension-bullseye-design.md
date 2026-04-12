# Multi-Dimension Bullseye

## Summary

Generalize the landscape bullseye chart so it can be scoped to any of four dimensions -- Therapeutic Area, Company, Mechanism of Action, or Route of Administration -- instead of being hardcoded to Therapeutic Area. Concentric rings always represent development phase. Spokes represent the grouping axis for the chosen dimension, with a toggle to switch between grouped spokes and flat product spokes.

## Goals

- Let users enter the bullseye from any of four dimensions (TA, Company, MOA, ROA)
- Provide a sidebar within the landscape feature for dimension navigation
- Support a Companies/Products (or TAs/Products) spoke toggle on every bullseye view
- Adapt the filter bar to hide the redundant filter for the current scope
- Adapt the detail panel to emphasize context relevant to the active dimension
- Reuse the existing bullseye rendering with minimal refactoring

## Non-Goals

- Competitive spheres / Venn diagram visualization (separate initiative)
- Changing what concentric rings represent (always development phase)
- Drill-down / hierarchical navigation within a bullseye
- Persisting dimension or filter selections across sessions
- Adding new data fields to products or trials

## Decisions Log

| Decision | Choice | Rationale |
|---|---|---|
| Ring semantics | Always development phase | Preserves mental model across all views |
| Entry point | Sidebar nav within landscape feature | Each dimension gets a clear, dedicated entry |
| Spoke toggle | Switchable (grouped vs. products) | Consistent pattern, no drill-down complexity |
| Spoke toggle per dimension | TA: Companies/Products, Company: TAs/Products, MOA: Companies/Products, ROA: Companies/Products | Products is always the alternate; predictable |
| Architecture | Generalized bullseye component | Single chart primitive, dimension-agnostic |
| Redundant filters | Hide (not disable) | Clean, no dead controls |
| Detail panel | Adapts emphasis per dimension | Contextual relevance |

---

## 1. Data Model

### 1.1 New Types

```typescript
type BullseyeDimension = 'therapeutic-area' | 'company' | 'moa' | 'roa';

type SpokeMode = 'grouped' | 'products';

interface BullseyeScope {
  id: string;
  name: string;
  abbreviation?: string;
}

interface BullseyeSpoke {
  id: string;
  name: string;
  display_order: number;
  highest_phase_rank: number;
  products: BullseyeProduct[];
}

interface BullseyeData {
  dimension: BullseyeDimension;
  scope: BullseyeScope;
  ring_order: RingPhase[];
  spokes: BullseyeSpoke[];         // replaces companies[]
  spoke_label: string;             // "Companies", "Therapeutic Areas", etc.
}
```

### 1.2 Renamed / Replaced Types

| Old | New | Notes |
|---|---|---|
| `BullseyeCompany` | `BullseyeSpoke` | Same shape, semantic rename |
| `BullseyeData.companies` | `BullseyeData.spokes` | Array field rename |
| `BullseyeData.therapeutic_area` | `BullseyeData.scope` | Generalized scope entity |
| (none) | `BullseyeData.dimension` | New field to identify active dimension |
| (none) | `BullseyeData.spoke_label` | New field for UI labeling |

### 1.3 Unchanged Types

`BullseyeProduct`, `BullseyeTrial`, `BullseyeMarker`, `LandscapeFilters`, `RingPhase` -- all unchanged.

### 1.4 Landscape Index Generalization

```typescript
interface LandscapeIndexEntry {
  entity: BullseyeScope;           // replaces therapeutic_area
  product_count: number;
  secondary_count: number;         // companies for TA/MOA/ROA; TAs for Company
  secondary_label: string;         // "companies" or "therapeutic areas"
  highest_phase_present: RingPhase | null;
  products_missing_phase: number;
}
```

---

## 2. Database Layer

### 2.1 New RPC Functions

Three new Supabase RPC functions, mirroring the existing `get_bullseye_data` pattern but scoped differently:

**`get_bullseye_by_company(p_space_id uuid, p_company_id uuid)`**
- Returns all products for the given company across all TAs
- Spokes = therapeutic areas the company operates in
- Each spoke contains products in that TA with their phase, trials, markers, MOAs, ROAs

**`get_bullseye_by_moa(p_space_id uuid, p_moa_id uuid)`**
- Returns all products with the given mechanism of action
- Spokes = companies that have products with this MOA
- Each spoke contains products matching the MOA

**`get_bullseye_by_roa(p_space_id uuid, p_roa_id uuid)`**
- Returns all products with the given route of administration
- Spokes = companies that have products with this ROA
- Each spoke contains products matching the ROA

All three return the same `BullseyeData` JSON shape with `dimension`, `scope`, `spokes`, `spoke_label`, and `ring_order`.

### 2.2 New Index RPC Functions

Three new index functions mirroring `get_landscape_index`:

**`get_landscape_index_by_company(p_space_id uuid)`**
- Returns companies in the space with product counts, TA counts, highest phase

**`get_landscape_index_by_moa(p_space_id uuid)`**
- Returns MOAs in the space with product counts, company counts, highest phase

**`get_landscape_index_by_roa(p_space_id uuid)`**
- Returns ROAs in the space with product counts, company counts, highest phase

### 2.3 Existing RPC Updates

**`get_bullseye_data`** -- update return shape to include `dimension: 'therapeutic-area'`, `scope` (from `therapeutic_area`), `spoke_label: 'Companies'`, and rename `companies` to `spokes` in the JSON output.

**`get_landscape_index`** -- update return shape to wrap `therapeutic_area` as `entity`.

---

## 3. Service Layer

### 3.1 LandscapeService Updates

```typescript
class LandscapeService {
  // Existing (updated signatures)
  async getLandscapeIndex(spaceId: string, dimension: BullseyeDimension): Promise<LandscapeIndexEntry[]>
  async getBullseyeData(spaceId: string, dimension: BullseyeDimension, entityId: string): Promise<BullseyeData>
}
```

The service routes to the correct RPC based on `dimension`:

| Dimension | Index RPC | Bullseye RPC |
|---|---|---|
| `therapeutic-area` | `get_landscape_index` | `get_bullseye_data` |
| `company` | `get_landscape_index_by_company` | `get_bullseye_by_company` |
| `moa` | `get_landscape_index_by_moa` | `get_bullseye_by_moa` |
| `roa` | `get_landscape_index_by_roa` | `get_bullseye_by_roa` |

---

## 4. Routing

### 4.1 New Route Structure

```
/t/:tenantId/s/:spaceId/landscape                          -> LandscapeShellComponent (with sidebar)
/t/:tenantId/s/:spaceId/landscape/by-therapy-area           -> LandscapeIndexComponent (dimension=therapeutic-area)
/t/:tenantId/s/:spaceId/landscape/by-therapy-area/:entityId -> LandscapeComponent (dimension=therapeutic-area)
/t/:tenantId/s/:spaceId/landscape/by-company                -> LandscapeIndexComponent (dimension=company)
/t/:tenantId/s/:spaceId/landscape/by-company/:entityId      -> LandscapeComponent (dimension=company)
/t/:tenantId/s/:spaceId/landscape/by-moa                    -> LandscapeIndexComponent (dimension=moa)
/t/:tenantId/s/:spaceId/landscape/by-moa/:entityId          -> LandscapeComponent (dimension=moa)
/t/:tenantId/s/:spaceId/landscape/by-roa                    -> LandscapeIndexComponent (dimension=roa)
/t/:tenantId/s/:spaceId/landscape/by-roa/:entityId          -> LandscapeComponent (dimension=roa)
```

The base `/landscape` route redirects to `/landscape/by-therapy-area` (default dimension).

Query param `?product=<id>` continues to work for deep-linking product selection.

### 4.2 Backwards Compatibility

The old route `/landscape/:therapeuticAreaId` should redirect to `/landscape/by-therapy-area/:therapeuticAreaId` so existing bookmarks and links continue to work.

---

## 5. Component Architecture

### 5.1 New: LandscapeShellComponent

Container component that provides the sidebar and `<router-outlet>` for the landscape feature.

**Responsibilities:**
- Render the sidebar with four dimension links
- Highlight the active dimension based on the current route
- Provide `<router-outlet>` for index and bullseye views

**Sidebar items:**
| Label | Route segment | Icon (PrimeNG) |
|---|---|---|
| Therapy Area | `by-therapy-area` | `pi-th-large` |
| Company | `by-company` | `pi-building` |
| Mechanism of Action | `by-moa` | `pi-sitemap` |
| Route of Admin | `by-roa` | `pi-directions` |

**Layout:** Fixed ~200px left sidebar with labels + main content area. The sidebar replaces the TA selector dropdown for dimension navigation.

### 5.2 Updated: LandscapeIndexComponent

Now parameterized by dimension. Receives dimension from the route segment and calls `LandscapeService.getLandscapeIndex(spaceId, dimension)`.

**Changes:**
- Read dimension from route (`by-therapy-area` -> `therapeutic-area`, etc.)
- Card grid shows entities for the active dimension
- Card labels adapt: "X products, Y companies" for TA/MOA/ROA; "X products, Y therapeutic areas" for Company
- Card click navigates to bullseye for that entity within the dimension

### 5.3 Updated: LandscapeComponent (Main Container)

**Changes:**
- Read `dimension` from route segment
- Remove `TaSelectorComponent` (replaced by sidebar)
- Add `spokeMode: signal<SpokeMode>('grouped')` for the toggle state
- Pass `dimension` and `spokeMode` to child components
- When `spokeMode` is `'products'`, transform `BullseyeData.spokes` into one-spoke-per-product before passing to the chart
- `productMatches()` filter logic unchanged (dimension-agnostic already)

**Spoke mode transformation (products mode):**
When toggle is set to "products", flatten all products from all spokes into individual spokes:
```typescript
const productSpokes: BullseyeSpoke[] = allProducts.map(p => ({
  id: p.id,
  name: p.name,
  display_order: 0,
  highest_phase_rank: p.highest_phase_rank,
  products: [p],
}));
```

### 5.4 Updated: BullseyeChartComponent

**Input changes:**
- `data` type changes from `BullseyeData` (with `companies`) to new `BullseyeData` (with `spokes`)
- All internal references to `companies` rename to `spokes`

**Computed signal renames:**
| Old | New |
|---|---|
| `companies` | `spokes` |
| `totalCompanies` | `totalSpokes` |
| `companyLabels` | `spokeLabels` |
| `sectors` (using company index) | `sectors` (using spoke index) |
| `companyLabelTransform` | `spokeLabelTransform` |

**Center disc text:**
- Line 1: `scope.name` (was hardcoded to TA name)
- Line 2: Product count summary

**No geometry changes.** The geometry functions (`companyAngle`, `sectorWidth`, etc.) are pure math operating on index/total -- they work identically with spokes regardless of what the spokes represent. The function names in `bullseye-geometry.ts` can optionally be renamed for clarity (`companyAngle` -> `spokeAngle`) but this is cosmetic.

### 5.5 Updated: LandscapeFilterBarComponent

**New input:**
- `dimension: input.required<BullseyeDimension>()`

**Behavior change:**
Hide the filter that matches the current scope dimension:

| Dimension | Hidden filter |
|---|---|
| `therapeutic-area` | (none -- current behavior) |
| `company` | Company multiselect |
| `moa` | MOA multiselect |
| `roa` | ROA multiselect |

Implementation: `@if (dimension() !== 'company')` around the company multiselect, etc.

### 5.6 Updated: BullseyeDetailPanelComponent

**New input:**
- `dimension: input.required<BullseyeDimension>()`

**Contextual emphasis rules:**

| Dimension | Emphasis behavior |
|---|---|
| `therapeutic-area` | Current behavior (no changes) |
| `company` | Show therapeutic area(s) for the product prominently; de-emphasize company name (it's the scope, already known) |
| `moa` | Highlight the scoped MOA in the MOA pills list (e.g. bold or teal background); show other MOAs normally |
| `roa` | Highlight the scoped ROA in the ROA pills list; show other ROAs normally |

**Implementation:** The `scope` from `BullseyeData` provides the ID to match against. For `company` dimension, add a "Therapeutic Areas" section showing which TAs the product belongs to (this data is available from the product's trials). For `moa`/`roa`, apply a `font-weight: 600` or teal background to the matching pill.

### 5.7 New: Spoke Mode Toggle

A simple UI control rendered in `LandscapeComponent` above the chart (near where the TA selector used to be).

**Appearance:** PrimeNG `SelectButton` with two options:
- Label matching `BullseyeData.spoke_label` (e.g. "Companies") -- value `'grouped'`
- "Products" -- value `'products'`

**Behavior:** Switching toggles the `spokeMode` signal, which triggers recomputation of the data passed to the chart. No new data fetch -- the transformation is client-side.

---

## 6. Geometry

No changes to `bullseye-geometry.ts` math. The functions are already parameterized by index/total and operate on abstract positions. Optional cosmetic renames:

| Current name | Optional rename |
|---|---|
| `companyAngle` | `spokeAngle` |
| `sectorAnnularPath` | unchanged (already generic) |
| `companyLabelTransform` | `spokeLabelTransform` |

---

## 7. Products Spoke Mode -- Crowding Mitigation

When toggled to "products" mode, each product becomes its own spoke. With 30+ products, the chart gets dense. Mitigations:

1. **Label truncation:** Product names longer than ~12 characters truncate with ellipsis in the spoke label. Full name on hover tooltip.
2. **Font scaling:** When spoke count > 20, reduce label font size from 10px to 8px.
3. **Label hiding:** When spoke count > 40, hide spoke labels entirely and rely on hover tooltips and the detail panel for identification.

These thresholds match the existing chart behavior where company labels adapt to count.

---

## 8. Sidebar Design

**Position:** Left side of the landscape feature area, below the main app navigation.

**Style:** Vertical list of dimension links with icons. Active dimension highlighted with teal left border and teal text. Inactive items use slate text.

**Width:** Fixed ~200px. Does not collapse -- the landscape feature has enough horizontal space, and four items don't justify a collapsible pattern.

**Structure:**
```html
<nav class="landscape-sidebar">
  <a routerLink="by-therapy-area" routerLinkActive="active">
    <i class="pi pi-th-large"></i>
    <span>Therapy Area</span>
  </a>
  <a routerLink="by-company" routerLinkActive="active">
    <i class="pi pi-building"></i>
    <span>Company</span>
  </a>
  <a routerLink="by-moa" routerLinkActive="active">
    <i class="pi pi-sitemap"></i>
    <span>Mechanism of Action</span>
  </a>
  <a routerLink="by-roa" routerLinkActive="active">
    <i class="pi pi-directions"></i>
    <span>Route of Admin</span>
  </a>
</nav>
```

---

## 9. Error Handling

- **Empty states:** If a dimension has no entities (e.g. no MOAs defined), the index page shows an empty state message: "No mechanisms of action have been defined yet. Add them in Manage > Mechanisms of Action."
- **Empty bullseye:** If a scoped entity has no products (e.g. a company with no products), show the empty bullseye with center text only and a message in the detail panel.
- **Loading states:** Existing skeleton patterns apply unchanged.
- **RPC errors:** Existing retry pattern in `LandscapeComponent` applies unchanged.

---

## 10. Accessibility

- Sidebar uses `<nav>` with `aria-label="Landscape dimensions"`
- Active sidebar item uses `aria-current="page"`
- Spoke mode toggle uses `aria-label="Group spokes by"` on the SelectButton
- All existing keyboard navigation, focus indicators, ARIA labels on dots/rings carry forward unchanged
- Center disc text updates `aria-label` to reflect scope name and dimension

---

## 11. File Inventory

### New Files
| File | Purpose |
|---|---|
| `features/landscape/landscape-shell.component.ts` | Sidebar + router-outlet shell |
| `features/landscape/landscape-shell.component.html` | Shell template |
| `supabase/migrations/YYYYMMDD_bullseye_by_company.sql` | Company-scoped bullseye RPC |
| `supabase/migrations/YYYYMMDD_bullseye_by_moa.sql` | MOA-scoped bullseye RPC |
| `supabase/migrations/YYYYMMDD_bullseye_by_roa.sql` | ROA-scoped bullseye RPC |
| `supabase/migrations/YYYYMMDD_landscape_index_by_dimension.sql` | Index RPCs for company/moa/roa |
| `supabase/migrations/YYYYMMDD_update_existing_landscape_rpcs.sql` | Update existing RPCs to new return shape |

### Modified Files
| File | Changes |
|---|---|
| `core/models/landscape.model.ts` | New types, rename BullseyeCompany -> BullseyeSpoke, update BullseyeData |
| `core/services/landscape.service.ts` | Add dimension routing to RPCs |
| `features/landscape/landscape.component.ts` | Add spokeMode signal, dimension from route, remove TA selector |
| `features/landscape/landscape.component.html` | Add spoke toggle, remove TA selector, pass dimension |
| `features/landscape/bullseye-chart.component.ts` | Rename companies -> spokes in all signals/computeds |
| `features/landscape/bullseye-chart.component.html` | Rename template references |
| `features/landscape/bullseye-detail-panel.component.ts` | Add dimension input, contextual emphasis logic |
| `features/landscape/bullseye-detail-panel.component.html` | Conditional emphasis rendering |
| `features/landscape/landscape-filter-bar.component.ts` | Add dimension input, conditional filter hiding |
| `features/landscape/landscape-filter-bar.component.html` | `@if` guards on dimension-specific filters |
| `features/landscape/landscape-index.component.ts` | Parameterize by dimension |
| `features/landscape/landscape-index.component.html` | Adapt card labels per dimension |
| `features/landscape/bullseye-geometry.ts` | Optional cosmetic renames |
| `features/landscape/landscape.css` | Add sidebar styles, spoke toggle styles |
| `app.routes.ts` | New route structure with dimension segments |

### Removed Files
| File | Reason |
|---|---|
| `features/landscape/ta-selector.component.ts` | Replaced by sidebar navigation |
| `features/landscape/ta-selector.component.html` | Template for removed component |
