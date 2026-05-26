# Unified Feed Merge: Events + Activity

**Status:** approved
**Date:** 2026-05-26
**Prototype:** `src/client/public/internal/unified-feed-merge.html`

## Overview

Today "what happened" lives in three places: the Events page (human-authored intelligence + markers), a hidden Activity page (automated CT.gov change detection), and the what-changed dashboard widget. A CI professional checking in on Monday morning visits two pages and mentally merges them. This spec merges the standalone Activity page into the Events page as a third source type ("Detected"), so there is one chronological feed for everything.

### Goals

1. One page for "what happened" -- events, markers, and detected changes in a single table
2. Analyst annotations on detected events (the advisory use case: the annotation IS the deliverable)
3. What-changed widget shows entity context per row so it is self-contained without click-through
4. Server-side pagination to handle the volume increase from change events
5. Humanized enum labels throughout (Phase 2 not PHASE2, Active not recruiting not ACTIVE_NOT_RECRUITING)
6. Activity page route removed; `/activity` redirects to `/events?source=detected`

### Out of Scope

- "Generate briefing from filtered feed" export
- Grouping detected events by entity in the main table (simple chronological list, same as events/markers)
- Notification/email alerts for detected events
- Changes to the trial-detail activity card or marker history panel (they keep using ChangeEventService directly)

## Data Model

### New table: `change_event_annotations`

Analyst notes attached to detected change events. One annotation per change event (upsert semantics).

| Column | Type | Notes |
|--------|------|-------|
| id | uuid PK | DEFAULT gen_random_uuid() |
| change_event_id | uuid FK -> trial_change_events | ON DELETE CASCADE, UNIQUE |
| space_id | uuid FK -> spaces | ON DELETE CASCADE, RLS scope |
| body | text NOT NULL | The annotation text |
| created_by | uuid FK -> auth.users | Set by DB trigger, not client |
| created_at | timestamptz | DEFAULT now() |
| updated_at | timestamptz | DEFAULT now() |
| updated_by | uuid FK -> auth.users | Set by DB trigger, not client |

**RLS policies:**
- SELECT: `has_space_access(space_id)` (any space member can read)
- INSERT/UPDATE/DELETE: `has_space_access(space_id, ARRAY['owner','editor'])` (editors and owners can write)

**Indexes:**
- `idx_annotations_change_event_id` on `change_event_id` (unique via constraint)
- `idx_annotations_space_id` on `space_id`

### Modified RPC: `get_events_page_data`

Add a third UNION leg for `trial_change_events`. Return shape changes from `jsonb` (array) to `jsonb` (object with `items` array and `total` count) for server-side pagination.

#### New return shape

```json
{
  "items": [ ...FeedItem[] ],
  "total": 142
}
```

#### Third UNION leg mapping

| FeedItem field | Source from trial_change_events |
|---|---|
| source_type | `'detected'` (literal) |
| id | `ce.id` |
| title | Generated from event_type + payload (SQL CASE: "Phase: Phase 2 -> Phase 3", etc.) |
| event_date | `ce.occurred_at::date` |
| category_name | Derived from event_type group (see category mapping below) |
| category_id | NULL (detected events have no category FK) |
| priority | Computed from high_signal rules (see priority mapping below) |
| entity_level | `'trial'` (always trial-scoped) |
| entity_name | `COALESCE(a.name, t.name)` (asset name preferred, fallback to trial name) |
| entity_id | `ce.trial_id` |
| company_name | `co.name` (joined through trial -> asset -> company) |
| tags | `'{}'::text[]` (empty) |
| has_thread | `false` |
| thread_id | NULL |
| description | NULL |
| source_url | CT.gov URL constructed from trial identifier |
| change_event_type | `ce.event_type` (new field, null for event/marker rows) |
| change_payload | `ce.payload` (new field, null for event/marker rows) |
| change_source | `ce.source` (new field, null for event/marker rows) |
| has_annotation | `EXISTS(SELECT 1 FROM change_event_annotations WHERE change_event_id = ce.id)` |
| observed_at | `ce.observed_at` (new field, null for event/marker rows) |
| company_logo_url | `co.logo_url` (new field, null for event/marker rows without it) |

#### Category mapping (event_type -> category_name)

| Display category | Event types |
|---|---|
| Trial status | status_changed, trial_withdrawn |
| Timeline | date_moved, projection_finalized |
| Phase | phase_transitioned |
| Protocol design | enrollment_target_changed, arm_added, arm_removed, intervention_changed, outcome_measure_changed, eligibility_criteria_changed, eligibility_changed |
| Catalyst lifecycle | marker_added, marker_removed, marker_updated, marker_reclassified, sponsor_changed |

#### Priority mapping (high_signal rules)

| Condition | Priority |
|---|---|
| phase_transitioned | high |
| trial_withdrawn | high |
| sponsor_changed | high |
| status_changed to COMPLETED, TERMINATED, WITHDRAWN, or SUSPENDED | high |
| date_moved with abs(days_shifted) > 60 | high |
| Everything else | NULL (no priority) |

### New RPCs

#### `upsert_change_event_annotation(p_change_event_id uuid, p_body text)`

SECURITY INVOKER. Inserts or updates the annotation for a change event. Returns the annotation row as jsonb. Raises 42501 if caller lacks editor/owner access to the space. Raises 02000 if the change_event_id does not exist.

#### `delete_change_event_annotation(p_change_event_id uuid)`

SECURITY INVOKER. Deletes the annotation. Raises 42501 if caller lacks editor/owner access. No-op if no annotation exists.

## Frontend Design

### Updated interfaces

#### `FeedItem` (event.model.ts)

```typescript
export interface FeedItem {
  source_type: 'event' | 'marker' | 'detected';
  id: string;
  title: string;
  event_date: string;
  category_name: string;
  category_id: string | null;  // null for detected
  priority: EventPriority | null;
  entity_level: EntityLevel;
  entity_name: string;
  entity_id: string | null;
  company_name: string | null;
  tags: string[];
  has_thread: boolean;
  thread_id: string | null;
  description: string | null;
  source_url: string | null;
  // New fields for detected events (null for event/marker)
  change_event_type: ChangeEventType | null;
  change_payload: Record<string, unknown> | null;
  change_source: ChangeEventSource | null;
  has_annotation: boolean;
  observed_at: string | null;
  company_logo_url: string | null;
}
```

#### `EventsPageFilters` (event.model.ts)

```typescript
export interface EventsPageFilters {
  // ...existing fields...
  sourceType: 'event' | 'marker' | 'detected' | null;
}
```

### Events page changes

1. **Source filter**: Three options (Event, Marker, Detected). `?source=detected` query param pre-sets the filter on load.
2. **Detected row rendering**: Amber "Detected" badge with bolt icon. Title rendered via `summarySegmentsFor()` from the existing `change-event-summary.ts` utility for rich before/after formatting with humanized enum labels. Signal bar (3px amber left border) on high-priority detected rows.
3. **Annotation indicator**: Small teal comment icon (`fa-solid fa-message`) in the Entity column on rows where `has_annotation === true`.
4. **Server-side pagination**: The component calls the RPC with limit/offset from the grid state. `grid.totalRecords()` uses the `total` from the RPC response. No more client-side-only pagination.

### Detail panel: detected branch

Third branch in `event-detail-panel.component` when `source_type === 'detected'`:

1. **Header**: Category label in brand color, close button
2. **Title**: Rich summary rendered via `summarySegmentsFor()` with humanized labels
3. **Signal**: Date, priority dot, "High signal" label (when applicable)
4. **Change detail block**: Structured before/after table (Previous, Current, Detected timestamp) in a slate-50 bordered card
5. **Source provenance**: CT.gov link with external-link icon, or "Analyst" label
6. **Trial entity context**: Company logo + asset/trial name as a navigable link
7. **Analyst note block**: Solid brand-colored border, branded header ("Analyst note" with comment icon). When empty: "Add a note on why this matters." click target. When populated: body text + attribution line. Edit and delete affordances for editors/owners.

### What-changed widget redesign

1. **Entity context on each row**: Two-line layout. Top line: mono-uppercase company/asset label (e.g., `LILLY / ORFORGLIPRON`). Bottom line: event summary with humanized labels.
2. **Summary line**: "N events across M assets, last 7d" instead of "N events, last 7d".
3. **Annotation indicator**: Teal comment icon on rows with analyst notes (requires the widget RPC to join annotations or a new field on get_activity_feed).
4. **Link update**: "View all" links to `/events?source=detected` instead of `/activity`.

### Route changes

1. `/activity` route: Replace with a redirect to `/events?source=detected` using `redirectTo` in `app.routes.ts`.
2. Delete `EngagementActivityPageComponent` and its template.
3. Events page: Read `source` query param on init to pre-set the source filter.

## Connection Points

| Surface | Current | After merge | Effort |
|---|---|---|---|
| Events page RPC | UNION of events + markers | Third UNION leg for trial_change_events + server-side total count | Medium |
| FeedItem model | source_type: event or marker | Gains 'detected' + 6 new optional fields | Small |
| Events page source filter | Two options | Three options + query param deep-link | Small |
| Event detail panel | Two branches (event, marker) | Third branch (detected) with annotation CRUD | Medium |
| What-changed widget | Links to /activity, no entity context | Entity labels, annotation indicator, links to /events?source=detected | Medium |
| Activity page route | Loads EngagementActivityPageComponent | Redirect to /events?source=detected | Small |
| Activity page component | Standalone page | Deleted | Small |
| ChangeEventService | Used by widget, activity page, trial detail | Stays. Widget still uses it for the 3-row preview. Only the standalone page stops using it. | No change |
| Change event row component | Used by widget and activity page | Updated: entity labels, humanized enums. Still used by widget. | Medium |
| Trial detail activity card | Shows trial-scoped change events | No change | No change |
| Change badge component | Recency badges on dashboard/catalysts | No change | No change |
| Database tables | events, markers, trial_change_events | All stay. New change_event_annotations table. | Small |

## Tasks

```yaml
tasks:
  - id: T1
    title: "Migration: change_event_annotations table + annotation RPCs"
    depends_on: []
    files:
      - supabase/migrations/TIMESTAMP_change_event_annotations.sql
    verification: "cd src/client && supabase db reset && supabase db advisors --local --type all"
    notes: |
      1. Create change_event_annotations table with columns per spec.
      2. RLS policies: SELECT via has_space_access, write via has_space_access(['owner','editor']).
      3. Audit columns (created_by, updated_by) via existing audit_columns_server_side trigger pattern.
      4. upsert_change_event_annotation RPC: INSERT ON CONFLICT (change_event_id) DO UPDATE.
         Validates space access via the change event's space_id. Returns annotation as jsonb.
      5. delete_change_event_annotation RPC: deletes by change_event_id. Validates space access.
      6. Inline smoke tests: insert, upsert idempotency, delete, access denial.

  - id: T2
    title: "Migration: extend get_events_page_data with detected UNION leg + server-side pagination"
    depends_on: [T1]
    files:
      - supabase/migrations/TIMESTAMP_events_rpc_unified_feed.sql
    verification: "cd src/client && supabase db reset && supabase db advisors --local --type all"
    notes: |
      1. DROP and recreate get_events_page_data with new return shape: {items: jsonb, total: bigint}.
      2. Add third UNION leg for trial_change_events:
         - JOIN trials, assets, companies for entity context.
         - LEFT JOIN change_event_annotations for has_annotation flag.
         - CASE on event_type for category_name mapping (5 categories per spec).
         - CASE on event_type + payload for priority (high_signal rules per spec).
         - CASE on event_type + payload for title generation (humanized text).
      3. WHERE clause: filter by p_source_type = 'detected' when provided.
         When p_source_type is NULL, include all three source types.
         When p_source_type = 'event' or 'marker', exclude the detected leg (existing behavior).
      4. Server-side pagination: compute COUNT(*) OVER() for total.
         Apply ORDER BY event_date DESC, id DESC with LIMIT p_limit OFFSET p_offset.
      5. Return jsonb_build_object('items', ..., 'total', ...).
      6. Inline smoke tests: mixed feed returns all three types, source filter works,
         priority mapping correct, annotation indicator joins, total count accurate.

  - id: T3
    title: "Frontend: FeedItem model + EventService + AnnotationService"
    depends_on: [T2]
    files:
      - src/client/src/app/core/models/event.model.ts
      - src/client/src/app/core/services/event.service.ts
      - src/client/src/app/core/services/annotation.service.ts
    verification: "cd src/client && ng lint && ng build"
    notes: |
      1. Update FeedItem interface: add 'detected' to source_type union. Add 6 new optional fields
         (change_event_type, change_payload, change_source, has_annotation, observed_at, company_logo_url).
         Make category_id nullable.
      2. Update EventsPageFilters.sourceType to include 'detected'.
      3. Update EventService.getEventsPageData() to handle the new return shape
         ({items, total} object instead of raw array). Return {items: FeedItem[], total: number}.
      4. Create AnnotationService (providedIn: 'root') with:
         - upsert(changeEventId: string, body: string): Promise<{id, body, ...}>
         - delete(changeEventId: string): Promise<void>
         Cache tags: change_event:<id>:annotation, space:<id>:events

  - id: T4
    title: "Frontend: Events page detected rows + source filter + server-side pagination"
    depends_on: [T3]
    files:
      - src/client/src/app/features/events/events-page.component.ts
      - src/client/src/app/features/events/events-page.component.html
    verification: "cd src/client && ng lint && ng build"
    notes: |
      1. Source filter: add {label: 'Detected', value: 'detected'} to source_type column filter options.
      2. Detected row rendering in the table body template:
         - Amber source badge with bolt icon for source_type === 'detected'.
         - Title cell: when detected, render via summarySegmentsFor() from change-event-summary.ts
           using change_event_type + change_payload. Reuse existing SummarySegment rendering.
         - Signal bar: 3px amber left border on high-priority detected rows.
         - Annotation indicator: teal fa-message icon in Entity column when has_annotation is true.
      3. Server-side pagination:
         - loadInitialData() and loadFeed() now receive {items, total} from EventService.
         - Set feedItems from items, pass total to grid.totalRecords.
         - Wire grid page changes to re-call the RPC with updated offset.
      4. Query param handling: on ngOnInit, read ?source= param and pre-set the grid's
         source_type filter. Support source=detected deep-link from widget and motion strip.
      5. Update grid globalSearchFields to include change_event_type for detected rows.
      6. Vitest unit test: summarySegmentsFor integration renders humanized labels.

  - id: T5
    title: "Frontend: detected detail panel + annotation CRUD"
    depends_on: [T3]
    files:
      - src/client/src/app/features/events/event-detail-panel.component.ts
      - src/client/src/app/features/events/event-detail-panel.component.html
    verification: "cd src/client && ng lint && ng build"
    notes: |
      1. Third branch in the detail panel template for source_type === 'detected'.
      2. Layout per spec:
         - Category header in brand-700.
         - Title via summarySegmentsFor() with rich before/after rendering.
         - Signal row: date, priority dot, "High signal" label.
         - Change detail card: slate-50 bordered block with Previous/Current/Detected rows.
         - Source provenance: CT.gov link (constructed from trial identifier) or "Analyst".
         - Trial context: company logo + asset/trial name as RouterLink to trial detail.
      3. Analyst note block:
         - Solid border-brand-200, bg-brand-50/40 container (NOT dashed/italic).
         - Header: branded "Analyst note" with fa-message icon.
         - Empty state: "Add a note on why this matters." as click target (editors/owners only).
         - Populated state: body text + "Added [date] by [email]" attribution.
         - Edit: inline textarea with Save/Cancel. Uses AnnotationService.upsert().
         - Delete: small icon button, confirms via confirmDelete, uses AnnotationService.delete().
         - Viewer role: annotation visible but no edit/delete affordances.
      4. Wire onRowClick in events-page.component to handle detected items:
         no EventDetail or CatalystDetail fetch needed, all data is in the FeedItem itself.
      5. Vitest unit test: annotation block renders empty/populated states.

  - id: T6
    title: "Frontend: what-changed widget redesign"
    depends_on: [T3]
    files:
      - src/client/src/app/shared/components/what-changed-widget/what-changed-widget.component.ts
      - src/client/src/app/shared/components/what-changed-widget/what-changed-widget.component.html
      - src/client/src/app/shared/components/change-event-row/change-event-row.component.ts
      - src/client/src/app/shared/components/change-event-row/change-event-row.component.html
    verification: "cd src/client && ng lint && ng build"
    notes: |
      1. Widget link: change activityLink computed from /activity to /events?source=detected.
      2. Summary line: "N events across M assets, last 7d". Compute unique asset count from
         events using a Set on asset_name or trial_name.
      3. Change event row redesign:
         - Two-line layout. Top line: mono-uppercase entity label (company / asset).
         - Bottom line: event summary via summarySegmentsFor() with humanized enums.
         - Annotation indicator: teal fa-message icon when the event has an annotation.
      4. For annotation indicator, the get_activity_feed RPC needs to LEFT JOIN
         change_event_annotations. Add has_annotation to the ChangeEvent interface
         and update get_activity_feed to include it.
      5. Vitest unit test: entity label rendering, asset count computation.

  - id: T7
    title: "Frontend: /activity redirect + activity page cleanup"
    depends_on: [T4]
    files:
      - src/client/src/app/app.routes.ts
      - src/client/src/app/features/engagement-activity/engagement-activity-page.component.ts (DELETE)
      - src/client/src/app/features/engagement-activity/engagement-activity-page.component.html (DELETE)
    verification: "cd src/client && ng lint && ng build"
    notes: |
      1. In app.routes.ts, replace the activity loadComponent route with:
         { path: 'activity', redirectTo: '/events?source=detected', pathMatch: 'full' }
         Note: Angular redirectTo with query params requires a relative redirect
         or a canActivate guard that does router.navigate. Use a guard approach if
         redirectTo does not support query params in the route config.
      2. Delete engagement-activity-page.component.ts and .html.
      3. Remove any imports of the deleted component.
      4. Verify no other files import from engagement-activity/.
      5. E2e test: navigating to /activity lands on the events page with source=detected filter active.
```

## Risks

1. **RPC performance.** Adding trial_change_events to the UNION increases row count significantly. The server-side pagination (T2) mitigates this, but the COUNT(*) OVER() window function adds overhead. Monitor query time after deploy; consider a materialized count if it exceeds 200ms on large spaces.

2. **Change event volume.** Spaces with frequent CT.gov syncs may generate hundreds of change events per week. The 7d/30d date filter inherited from the activity page could reduce this, but the default "all time" view on the Events page would load everything. Consider defaulting to 30d when source=detected.

3. **Annotation table size.** One annotation per change event is bounded by change event count. No growth concern.

4. **Breaking RPC contract.** The return shape of `get_events_page_data` changes from `jsonb[]` to `{items, total}`. This is a breaking change for the Angular service. T3 handles the migration. No other consumers exist (verified via grep).
