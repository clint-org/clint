# Events Page Layout Redesign

**Status:** Draft
**Date:** 2026-04-13

## Overview

Redesign the events page from a single-column card feed with a horizontal filter bar to a data table with a right-side detail panel. The new layout is consistent with the existing manage pages (Trials, Companies, Products) and familiar to pharma analysts who use tabular tools like Bloomberg, Evaluate Pharma, and Citeline.

## Current State

The events page currently uses:
- A horizontal filter bar with 7 dropdowns/date pickers across the top
- A vertical stack of card-based feed items (EventFeedItemComponent)
- Click-to-expand inline detail within each card
- "Load more" pagination

## New Layout

### Page Structure

```
+----------------------------------------------------------+
| Intelligence                              [ + New Event ] |
| Events                                                    |
+----------------------------------------------------------+
| [Search events...]                           32 items     |
+----------------------------------------------------------+
| Date  | Source | Title        | Cat  | Entity  | Pri |   |
|-------|--------|--------------|------|---------|-----|   |
| Dec 18| EVENT  | FDA issues.. | Reg  | BI/...  |  *  |   |  Detail Panel
| Dec 10| EVENT  | Lilly new..  | Lead | Lilly   |  *  |   |  (380px right)
| Nov 28| EVENT  | SOUL-HF pro..| Clin | Novo/.. |  *  |   |  - Category
| Nov 15| EVENT  | FDA draft..  | Reg  | Industry|     |   |  - Title
| Oct 28| MARKER | AZ Q3 earn.. | Fin  | AZ      |     |   |  - Date + Priority
|  ...  |  ...   |  ...         | ...  |  ...    | ... |   |  - Description
+----------------------------------------------------------+  - Sources
| Showing 1-10 of 32          Rows: 10 | 25 | 50           |  - Tags
+----------------------------------------------------------+  - Thread
                                                               - Related events
```

### Table Columns

| Column | Content | Sortable | Filterable |
|--------|---------|----------|------------|
| Date | event_date formatted as "MMM dd, yyyy" | Yes (default: desc) | Yes (date range) |
| Source | Badge: "EVENT" (green) or "MARKER" (slate) | Yes | Yes (dropdown: Event/Marker) |
| Title | Event title. Thread indicator inline if applicable. | Yes | Yes (text search) |
| Category | Category name | Yes | Yes (dropdown from event + marker categories) |
| Entity | Company / Product or Trial name. "Industry" for space-level. | Yes | Yes (text search) |
| Priority | Red dot for high, empty for low. Markers show empty. | Yes | Yes (dropdown: High/Low) |

### Detail Panel

A fixed-width (380px) panel on the right side of the table. Appears when a row is clicked. Closes via an X button in the panel header, returning the table to full width.

**Panel contents (top to bottom):**
1. **Category label** -- uppercase, muted, small
2. **Title** -- large, semibold
3. **Meta row** -- date, priority badge, entity context
4. **Description** -- body text
5. **Sources** -- clickable links with labels
6. **Tags** -- chip badges
7. **Thread** -- if event belongs to a thread, show the thread title and ordered list of events with the current one highlighted
8. **Related events** -- linked events with date, title, category
9. **Created timestamp** -- small, muted footer

For markers, the detail panel shows: title, date, description, source_url, category, and entity. No tags, thread, or linked events.

**Actions in panel header:** Edit button (events only), close button. Delete accessed via row context menu or keyboard shortcut.

### Toolbar

- **Global search** -- text input, searches across title, description, entity name, tags
- **Item count** -- "N items" badge
- **"New Event" button** -- opens the event form modal (unchanged)

### Filters

All filters move from the horizontal filter bar into PrimeNG column filter menus (the funnel icon on each column header). This eliminates the EventFilterBarComponent entirely.

Column filter types:
- **Date:** Date range filter
- **Source:** Dropdown (Event / Marker)
- **Title:** Text contains filter
- **Category:** Multi-select dropdown (event categories + marker categories)
- **Entity:** Text contains filter
- **Priority:** Dropdown (High / Low)

### Pagination

Standard PrimeNG table pagination at the bottom: page size selector (10/25/50), page navigation, total count.

### Row Selection

- Click a row to select it and open the detail panel
- Selected row gets a teal left border and subtle teal background (`bg-teal-50/50`)
- Click the same row again or the panel close button to deselect and hide the panel
- Keyboard: arrow keys to navigate rows, Enter to select

### Empty State

"No events yet. Events capture competitive intelligence -- leadership changes, strategic moves, regulatory shifts -- at any level of your landscape."

## Components to Change

### Remove
- `EventFilterBarComponent` -- filters move to column headers
- `EventFeedItemComponent` -- replaced by table rows
- `EventDetailComponent` -- replaced by the detail panel (new component)

### Create
- `EventDetailPanelComponent` -- right-side detail panel, receives an EventDetail or marker data, shows full context

### Modify
- `EventsPageComponent` -- rewrite template from card feed to p-table + detail panel layout. Use `createGridState` utility for sorting/filtering/search (same as TrialListComponent). Add selected row state and detail panel toggle.
- `events-page.component.html` -- complete rewrite to table layout

### Keep Unchanged
- `EventFormComponent` -- modal form, no changes needed
- All services (EventService, EventCategoryService, EventThreadService)
- All models
- All database tables and RPC functions
- Routing and navigation

## Data Flow

The page still calls `EventService.getEventsPageData()` to get the unified feed. The RPC returns the same FeedItem shape. What changes is how items are rendered:

1. Feed items populate the p-table rows
2. Clicking a row calls `EventService.getEventDetail()` for events (or constructs a simple detail from the FeedItem for markers)
3. Detail panel displays the result
4. Column filters modify the RPC call parameters (same as current filter bar, just triggered differently)

### Client-side vs Server-side Filtering

The current implementation uses server-side filtering via the RPC. With p-table, two approaches:

**Recommended: Client-side with lazy loading.** Load up to 50 items at a time via the RPC. p-table handles sorting and column filtering on the loaded data. When the user paginates beyond loaded data, fetch the next page. This matches how the other manage pages work with `createGridState`.

If the dataset grows large (hundreds of items), the RPC filtering parameters remain available for server-side filtering as needed.

## Non-Goals

- Changing the data model, RPC functions, or services
- Modifying the event form
- Adding new features (this is a layout-only change)
- Mobile responsiveness (desktop-first, per project conventions)
