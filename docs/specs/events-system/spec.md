# Events System

**Status:** Draft
**Date:** 2026-04-13

## Overview

A system for analysts to capture competitive intelligence events at any level of the entity hierarchy (space, company, product, trial). Events are separate from markers -- markers stay on the timeline, events live on a dedicated events page. The events page is the unified chronological feed that shows both events and markers together.

## Core Concepts

### Events vs. Markers

- **Markers** are structured data points on the timeline. They have a type (from 21 system types), a category, a projection, visual properties (shape, color, fill), and are assigned to trials. Markers are the formal analytical layer and are unchanged by this feature.
- **Events** are analyst annotations capturing competitive intelligence. They are more flexible than markers: free-form title, description, tags, and multiple source URLs. Events never appear on the timeline. Events live only on the events page.
- **The events page** is the unified chronological feed. It shows both events and markers together, sorted by date. Each item is tagged as either "event" or "marker." Markers are always present on the events page and can be filtered out.

### Entity Levels

Events attach to one of four levels:

1. **Space (industry-wide):** Not tied to any specific company. Example: "FDA issues new guidance on accelerated approval pathway."
2. **Company:** Tied to a specific company. Example: "Lilly fires CEO."
3. **Product:** Tied to a specific product. Example: "Verzenio manufacturing issues reported."
4. **Trial:** Tied to a specific trial. Example: "NCT12345 enrollment paused."

Events live only at the level they are created. No cascading up or down the hierarchy.

### Categorization

Events use a two-layer categorization system:

- **Fixed categories:** A small set of predefined system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial. Spaces can add custom categories.
- **Free-form tags:** Optional text tags for additional specificity. Example: category "Leadership", tags: "CEO termination", "board shake-up". Tags autocomplete from existing tags in the space.

### Priority

Two levels: **high** and **low** (default). Same model as marker notifications.

### Event Linking

Two types of relationships between events:

- **Threads:** Sequential narrative chains. A thread has a title (e.g., "Lilly CEO Succession") and contains ordered events telling a story over time. Example: "CEO fired" -> "Interim CEO appointed" -> "New CEO announced."
- **Links:** Ad-hoc bidirectional connections between events that are related but not sequential. Example: linking "Lilly fires CEO" to "Pfizer poaches Lilly's head of oncology." Displayed as a "Related events" section.

## Data Model

### `event_categories` table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | Fixed UUIDs for system categories |
| space_id | uuid FK -> spaces | NULL for system defaults |
| name | text NOT NULL | e.g., "Leadership", "Regulatory" |
| display_order | int NOT NULL | Sort order in UI |
| is_system | boolean NOT NULL DEFAULT false | true = immutable system default |
| created_by | uuid FK -> auth.users | NULL for system categories |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

**System categories (seeded):** Leadership, Regulatory, Financial, Strategic, Clinical, Commercial.

### `event_threads` table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| space_id | uuid FK -> spaces | ON DELETE CASCADE, RLS scope |
| title | text NOT NULL | e.g., "Lilly CEO Succession" |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz NOT NULL DEFAULT now() | |

### `events` table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| space_id | uuid FK -> spaces | ON DELETE CASCADE, always set, RLS scope |
| company_id | uuid FK -> companies | ON DELETE CASCADE, set for company-level events |
| product_id | uuid FK -> products | ON DELETE CASCADE, set for product-level events |
| trial_id | uuid FK -> trials | ON DELETE CASCADE, set for trial-level events |
| category_id | uuid FK -> event_categories | NOT NULL |
| thread_id | uuid FK -> event_threads | ON DELETE SET NULL, optional |
| thread_order | int | Position within thread, NULL if not in a thread |
| title | text NOT NULL | Brief description |
| event_date | date NOT NULL | When it happened |
| description | text | Longer notes/context |
| priority | text NOT NULL DEFAULT 'low' | CHECK (priority IN ('high', 'low')) |
| tags | text[] NOT NULL DEFAULT '{}' | Postgres array of free-form tags |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| updated_at | timestamptz NOT NULL DEFAULT now() | |

**CHECK constraint:** At most one of company_id, product_id, trial_id is set. None set = space-level event.

**Indexes:** space_id, event_date, category_id, company_id, product_id, trial_id, priority. Partial index on thread_id WHERE thread_id IS NOT NULL.

### `event_sources` table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| event_id | uuid FK -> events | ON DELETE CASCADE |
| url | text NOT NULL | |
| label | text | Optional display label (e.g., "Press Release", "SEC Filing") |
| created_at | timestamptz NOT NULL DEFAULT now() | |

**Index:** event_id.

### `event_links` table

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | |
| source_event_id | uuid FK -> events | ON DELETE CASCADE |
| target_event_id | uuid FK -> events | ON DELETE CASCADE |
| created_by | uuid FK -> auth.users | |
| created_at | timestamptz NOT NULL DEFAULT now() | |
| UNIQUE(source_event_id, target_event_id) | | Prevents duplicates |

**Indexes:** source_event_id, target_event_id.

Bidirectional: querying linked events checks both source and target columns.

## RLS Policies

All policies scoped by space_id using the existing `has_space_access()` helper function.

### `event_categories`

- **SELECT:** All authenticated users see system categories (is_system = true). Space members see custom categories in their space.
- **INSERT/UPDATE/DELETE:** Editors and owners for non-system categories only.

### `events`

- **SELECT:** Space members can view.
- **INSERT/UPDATE/DELETE:** Editors and owners only.

### `event_sources`

- **SELECT:** Derived from parent event's space membership.
- **INSERT/UPDATE/DELETE:** Editors and owners (checked via subquery to parent event).

### `event_threads`

- **SELECT:** Space members can view.
- **INSERT/UPDATE/DELETE:** Editors and owners only.

### `event_links`

- **SELECT:** Space members can view.
- **INSERT/DELETE:** Editors and owners only. No update -- links are created or removed, not edited.

## RPC Functions

### `get_events_page_data`

Primary query for the events page. Returns the unified chronological feed.

**Parameters:**

| Parameter | Type | Required | Notes |
|-----------|------|----------|-------|
| p_space_id | uuid | Yes | |
| p_date_from | date | No | |
| p_date_to | date | No | |
| p_entity_level | text | No | 'space', 'company', 'product', 'trial' |
| p_entity_id | uuid | No | Specific company/product/trial |
| p_category_ids | uuid[] | No | |
| p_tags | text[] | No | |
| p_priority | text | No | 'high', 'low' |
| p_source_type | text | No | 'event', 'marker' |
| p_limit | int | No | Default 50 |
| p_offset | int | No | Default 0 |

**Return shape:**

| Field | Type | Notes |
|-------|------|-------|
| source_type | text | 'event' or 'marker' |
| id | uuid | |
| title | text | |
| event_date | date | |
| category_name | text | |
| category_id | uuid | |
| priority | text | Events: 'high'/'low'. Markers: null. |
| entity_level | text | 'space'/'company'/'product'/'trial' |
| entity_name | text | Display name of attached entity |
| entity_id | uuid | |
| company_name | text | Always resolved, even for product/trial level |
| tags | text[] | Events: tags array. Markers: empty array. |
| has_thread | boolean | |
| thread_id | uuid | |
| description | text | |
| source_url | text | Markers: source_url. Events: null (sources fetched separately). |

The function internally does a UNION ALL of an events query and a markers query, both filtered by the parameters, sorted by event_date descending with pagination.

**Filter behavior notes:**
- `p_tags` applies only to events (markers have no tags). When tags are filtered, markers are excluded from results.
- `p_priority` applies only to events. When priority is filtered, markers are excluded from results.
- `p_category_ids` matches against `event_categories` for events and `marker_categories` for markers.
- `p_source_type` controls which half of the UNION is included.

### `get_event_detail`

Returns full event data including sources, thread context, and linked events.

### `get_event_thread`

Returns all events in a thread, ordered by thread_order.

### `get_space_tags`

Returns distinct tags used in a space, for autocomplete in the event form.

## Angular Components

### Routing

New lazy-loaded route: `/events` under `src/client/src/app/features/events/`.

Add "Events" to main app navigation alongside existing dashboard and manage routes.

### Components

**`EventsPageComponent`** (page component)
- Handles routing, calls `EventService.getEventsPageData()` with filter state
- Manages filter bar state as signals
- Pagination via load-more or infinite scroll

**`EventFilterBarComponent`** (presenter)
- Inputs: current filter values, category list, tag list
- Outputs: filter change events
- Uses PrimeNG form components: `p-select` for dropdowns, `p-multiselect` for categories/tags, `p-datepicker` for date range

**`EventFeedItemComponent`** (presenter)
- Inputs: single feed item (event or marker)
- Displays: source badge, date, title, entity context, category, priority, tags
- Click to expand inline detail

**`EventDetailComponent`** (presenter)
- Inputs: full event detail (description, sources, thread, links)
- Shows expanded view within the feed

**`EventFormComponent`** (presenter)
- Inputs: optional pre-filled entity, optional existing event for editing
- Outputs: save/cancel events
- Rendered in a `p-dialog` modal
- Uses PrimeNG form components throughout

**`EventThreadComponent`** (presenter)
- Inputs: thread with ordered events
- Displays the sequential narrative with current event highlighted

### Services

- **`EventService`** -- CRUD for events, calls `get_events_page_data` RPC
- **`EventCategoryService`** -- list categories for the space
- **`EventThreadService`** -- thread CRUD

## Events Page Layout

### Feed Items

Each item in the feed shows:
- **Source badge:** "Event" or "Marker"
- **Date**
- **Title**
- **Entity context:** What it's attached to (e.g., "Lilly" for company-level, "Lilly / Verzenio" for product-level, "Lilly / Verzenio / NCT12345" for trial-level, "Industry" for space-level)
- **Category** with color
- **Priority indicator** for high-priority events
- **Tags** as small chips
- **Expandable detail:** Click to see description, source URLs, thread context, and linked events

Marker items pull equivalent data from the markers table: title, date, category (from marker_categories), entity (via marker_assignments -> trial -> product -> company), and source_url.

### Filter Bar

Across the top of the page:
- Date range picker
- Entity level dropdown (All / Industry / Company / Product / Trial)
- Entity search (type-ahead to pick a specific company, product, or trial)
- Category multi-select (shows event categories and marker categories together, labeled by source)
- Tag multi-select (populated from tags in the current space; applies to events only since markers have no tags)
- Priority toggle (All / High / Low)
- Source type toggle (All / Events / Markers)

### Thread Display

When an event belongs to a thread, it shows a thread indicator. Clicking it expands the full thread inline, showing all events in order with the current one highlighted.

### Empty State

"No events yet. Events capture competitive intelligence -- leadership changes, strategic moves, regulatory shifts -- at any level of your landscape."

## Event Creation Entry Points

1. **"New Event" button** on the events page
2. **Context menu** on company/product/trial rows in the dashboard (pre-fills the entity)

## Event Form Fields

- **Entity level picker:** Space / Company / Product / Trial, then type-ahead to select the specific entity
- **Title:** Required, short text
- **Date:** Required, date picker
- **Category:** Required, dropdown from event_categories
- **Priority:** High / Low toggle, defaults to low
- **Description:** Optional, multi-line text
- **Tags:** Optional, free-form text input creating tag chips. Autocomplete suggests existing tags in the space.
- **Source URLs:** Optional, add multiple. Each has a URL field and optional label field.
- **Thread:** Optional. "Add to existing thread" (dropdown) or "Start new thread" (enter title). Auto-placed at end of thread.
- **Links:** Optional, type-ahead search to find and link other events.

## Deleting Events

Confirmation dialog. Cascading deletes handle event_sources and event_links. If the event is the last one in a thread, the thread is also deleted (enforce via trigger or application logic).

## Non-Goals

- Events on the timeline (events never appear on the timeline)
- File/document attachments
- Email notifications for events
- Real-time collaboration / live updates
- Cascading events across entity levels
- Mobile-optimized layout
