# Key Catalysts Page

## Overview

A standalone page that surfaces all upcoming markers in chronological order, grouped into adaptive time buckets. Gives pharma executives and BD teams a single forward-looking view of clinical trial milestones, data readouts, regulatory dates, approvals, and loss-of-exclusivity events across their competitive landscape.

The page reads from the existing `markers` table -- no new data model. Two new RPC functions provide the feed and enriched detail. The UI is a dense PrimeNG table with sticky group headers and a right-side detail panel.

## Route

```
/t/:tenantId/s/:spaceId/catalysts
```

Lazy-loaded via `loadComponent`. Added to the Intelligence section in the sidebar navigation, below Events.

## Data Layer

### RPC: `get_key_catalysts`

Queries `markers` filtered to `event_date >= CURRENT_DATE`, joined with `marker_types`, `marker_categories`, `marker_assignments`, `trials`, `products`, and `companies`. Returns a flat chronological list sorted by `event_date ASC`.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `p_space_id` | uuid | yes | Scoped to the current space |
| `p_category_ids` | uuid[] | no | Filter by marker category IDs |
| `p_company_id` | uuid | no | Filter by company |
| `p_product_id` | uuid | no | Filter by product |
| `p_search_text` | text | no | Full-text search across title, company, product, marker type |

**Returns (per row):**

| Field | Type | Description |
|-------|------|-------------|
| `marker_id` | uuid | |
| `title` | text | Marker title |
| `event_date` | date | Catalyst date |
| `end_date` | date | End date (if range) |
| `category_name` | text | e.g., Data, Regulatory, Approval |
| `category_id` | uuid | For filtering |
| `marker_type_name` | text | e.g., Topline Data, PDUFA Date |
| `marker_type_icon` | text | Icon identifier |
| `marker_type_color` | text | Hex color |
| `marker_type_shape` | text | circle, diamond, flag, triangle, square |
| `is_projected` | boolean | false = Confirmed, true = Projected |
| `company_name` | text | |
| `company_id` | uuid | |
| `product_name` | text | |
| `product_id` | uuid | |
| `trial_name` | text | |
| `trial_id` | uuid | |
| `trial_phase` | text | e.g., P3 |
| `description` | text | |
| `source_url` | text | |

### RPC: `get_catalyst_detail`

Given a `marker_id`, returns enriched data for the detail panel.

**Parameters:**

| Name | Type | Required | Description |
|------|------|----------|-------------|
| `p_marker_id` | uuid | yes | The marker to fetch detail for |

**Returns:**

| Section | Fields |
|---------|--------|
| Catalyst data | All fields from `get_key_catalysts` row, plus full description |
| Trial context | trial_name, trial_phase, recruitment_status, company_name, product_name |
| Upcoming markers | Next 5 markers for the same trial (marker_id, title, event_date, marker_type_name, is_projected) |
| Related events | Last 10 events scoped to the same trial, product, or company (event_id, title, event_date, category_name) |

### Client-Side Grouping

A pure function `groupCatalystsByTimePeriod(catalysts, referenceDate)` buckets the flat results into adaptive time periods:

| Condition | Bucket label | Example |
|-----------|-------------|---------|
| Within current ISO week | "This Week" | "This Week (Apr 14--20)" |
| Within next ISO week | "Next Week" | "Next Week (Apr 21--27)" |
| 2--8 weeks out | Monthly | "May 2026", "Jun 2026" |
| 2+ months out | Quarterly | "Q3 2026", "Q4 2026" |

Returns: `{ label: string; dateRange: string; catalysts: Catalyst[] }[]`

Date ranges shown alongside weekly labels. Monthly and quarterly labels stand alone.

## Components

### CatalystsPageComponent (smart/page)

Responsibilities:
- Data fetching: calls `MarkerService.getKeyCatalysts()` on init and when server-side filters change
- Grouping: pipes flat results through `groupCatalystsByTimePeriod()`
- Filter state: manages category, company, product selections; passes to RPC
- Search state: manages search text; passes to table for client-side filtering
- Selection state: manages selected catalyst ID; fetches detail on change
- Detail panel: opens/closes based on selection

Uses `ManagePageShellComponent` with:
- `eyebrow="Intelligence"`
- `title="Key Catalysts"`
- `count` = total catalyst count

### CatalystTableComponent (presenter)

Inputs:
- `groups: CatalystGroup[]` -- the bucketed catalyst list
- `selectedId: string | null` -- currently selected catalyst marker_id
- `searchText: string` -- for client-side filtering

Outputs:
- `rowSelect: EventEmitter<string>` -- emits marker_id on row click

Implementation:
- PrimeNG `p-table` with `rowGroupMode="subheader"` and `groupRowsBy` bound to computed time bucket field
- Sticky group headers: teal left border for "This Week", slate for others
- Columns:
  - **Date** -- monospace, formatted as "Apr 15"
  - **Category** -- marker shape/color dot + category name
  - **Catalyst** -- title, bold weight
  - **Company / Product** -- "COMPANY -- Product" format, uppercase company
  - **Status** -- "CONFIRMED" badge (green) or "PROJECTED" badge (amber)
- Selected row highlighted with teal tint background
- Client-side search filters across title, company_name, product_name, marker_type_name, category_name
- Column filters: category (multi-select), company (text search), status (select)
- Empty state: "No upcoming catalysts match your filters" with "Clear filters" link

### CatalystDetailPanelComponent (presenter)

Inputs:
- `detail: CatalystDetail | null`

Outputs:
- `panelClose: EventEmitter<void>`

Layout (380px right panel):

**Tier 1 -- Catalyst Data**
- Category + type label in teal uppercase (e.g., "REGULATORY -- PDUFA DATE")
- Title (bold, 16px)
- Date and status side by side
- Description (if present)
- Source link (clickable, truncated URL)

**Tier 2 -- Trial Context**
- Trial name, phase, recruitment status
- Company and product names

**Tier 3 -- Related Timeline**
- "Upcoming for this trial" -- next 5 markers for the same trial, ordered by date. Each shows date, type, title. Clicking one switches detail panel to that catalyst.
- "Related Events" -- last 10 events for the same trial/product/company, ordered by date desc. Each shows date and title. Read-only.

Panel behavior:
- Opens on row click, closes on X button or clicking the same row again
- Loading spinner while `get_catalyst_detail` RPC is in flight
- Same panel pattern as `EventDetailPanelComponent`

## Filters

Horizontal filter bar between page shell header and table.

| Filter | Component | Source | Execution | Default |
|--------|-----------|--------|-----------|---------|
| Category | `p-multiselect` | `marker_categories` table | Server-side (RPC param) | All selected |
| Company | `p-select` with search | Companies in space | Server-side (RPC param) | All |
| Product | `p-select` with search | Products in space; cascades from company | Server-side (RPC param) | All |
| Search | `pInputText`, debounced 300ms | User input | Client-side | Empty |

When filters produce zero results, show centered empty state with "Clear filters" action.

## Service Additions

Add to `MarkerService` (or create `CatalystService` if preferred for separation):

```typescript
getKeyCatalysts(spaceId: string, filters: CatalystFilters): Promise<Catalyst[]>
getCatalystDetail(markerId: string): Promise<CatalystDetail>
```

## TypeScript Interfaces

```typescript
interface Catalyst {
  marker_id: string;
  title: string;
  event_date: string;
  end_date: string | null;
  category_name: string;
  category_id: string;
  marker_type_name: string;
  marker_type_icon: string;
  marker_type_color: string;
  marker_type_shape: string;
  is_projected: boolean;
  company_name: string;
  company_id: string;
  product_name: string;
  product_id: string;
  trial_name: string;
  trial_id: string;
  trial_phase: string;
  description: string | null;
  source_url: string | null;
}

interface CatalystDetail {
  catalyst: Catalyst;
  trial_context: {
    trial_name: string;
    trial_phase: string;
    recruitment_status: string;
    company_name: string;
    product_name: string;
  };
  upcoming_markers: {
    marker_id: string;
    title: string;
    event_date: string;
    marker_type_name: string;
    is_projected: boolean;
  }[];
  related_events: {
    event_id: string;
    title: string;
    event_date: string;
    category_name: string;
  }[];
}

interface CatalystFilters {
  category_ids?: string[];
  company_id?: string;
  product_id?: string;
  search_text?: string;
}

interface CatalystGroup {
  label: string;
  date_range: string;
  catalysts: Catalyst[];
}
```

## Accessibility

- Table rows keyboard navigable with visible focus indicators
- Group headers use `role="row"` with `aria-label` for screen readers
- Detail panel: focus trapped when open, Escape to close
- Filter controls have associated labels
- Status badges use text labels (not color alone)
- `aria-live="polite"` on the table region for filter result count changes
