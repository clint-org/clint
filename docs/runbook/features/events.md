---
surface: Events
spec: docs/specs/events-system/spec.md
---

# Events (Intelligence Feed)

A unified chronological feed showing analyst-created events, timeline markers, and detected change events together. Events capture competitive intelligence at four entity levels: space (industry-wide), company, product, and trial. Detected change events (from the trial change feed pipeline) are merged as a third source type.

**Route:** `/t/:tenantId/s/:spaceId/events`. Honors `?eventId=<id>` to deep-link a specific event into the detail panel on load (used by the command palette). Honors `?source=detected` to filter to detected change events (used by the `/activity` redirect and the what-changed widget link). Honors `?entityLevel=<trial|product|company>` + `?entityId=<id>` to scope the feed server-side to one entity and everything beneath it (hierarchical rollup); set by the "See all" link on the entity-events panel embedded in trial / asset / company detail pages, and surfaced as a dismissible scope banner with a "View all events" clear control.

**Layout:** Data table (p-table) with sortable/filterable columns + a right-side overlay detail panel (340px, absolute-positioned, `@slidePanel` animation) that slides in on row click and hides when nothing is selected. The RPC `get_events_page_data` returns `{items, total}` instead of a flat array, enabling server-side pagination.

| Column | Content |
|---|---|
| Date | Event date, sorted descending by default |
| Source | Badge: "EVENT" (green), "MARKER" (slate), or "DETECTED" (amber) |
| Title | Event title with thread indicator if applicable |
| Category | 6 system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial |
| Entity | Company / Product / Trial name, or "Industry" for space-level |
| Priority | Red dot for high, empty for low |

**Detail panel (340px overlay):** For analyst events and markers: description, source URLs, tags, thread context (ordered list of events in the narrative), related events (ad-hoc links), and created timestamp. For detected events: structured change detail with annotation CRUD (create, edit, delete via `AnnotationService`), annotation indicator, and signal bar.

**Event features:** Free-form tags, multiple source URLs with labels, threads (sequential narrative chains), ad-hoc links between related events, high/low priority. Detected events additionally carry `change_event_type`, `change_payload`, `change_source`, `has_annotation`, `observed_at`, and `company_logo_url` fields on the `FeedItem` interface.

## Capabilities

```yaml
- id: events-feed
  summary: Unified chronological data table mixing analyst events, timeline markers, and detected change events across four entity levels. Server-side pagination via {items, total} return shape.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_events_page_data
  tables:
    - events
    - markers
    - event_categories
    - trial_change_events
    - change_event_annotations
  related:
    - events-detail-panel
    - trial-change-feed-unified-events
  user_facing: true
  role: viewer
  status: active
- id: events-deep-link
  summary: Query-param eventId opens the detail panel on load, used by the command palette.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_event_detail
  tables:
    - events
  related:
    - palette-activation-targets
  user_facing: true
  role: viewer
  status: active
- id: events-entity-scope
  summary: Query-params entityLevel + entityId scope the feed server-side (hierarchically rolled up) to one entity and everything beneath it, surfaced via a dismissible banner with a clear control. Set by the "See all" link on the entity-events panel on trial / asset / company detail pages.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_events_page_data
  tables:
    - events
  related:
    - events-feed
    - events-detail-panel
  user_facing: true
  role: viewer
  status: active
- id: events-detail-panel
  summary: 340px sliding overlay with description, source URLs, tags, thread context, related events, and created timestamp.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_event_detail
    - get_event_thread
  tables:
    - events
    - event_sources
    - event_links
    - event_threads
  related:
    - events-feed
  user_facing: true
  role: viewer
  status: active
- id: events-threads
  summary: Sequential narrative chains group related events into ordered threads.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_event_thread
  tables:
    - event_threads
    - events
  related:
    - events-detail-panel
  user_facing: true
  role: viewer
  status: active
- id: events-ad-hoc-links
  summary: Free-form related-event links surfaced in the detail panel.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_event_detail
  tables:
    - event_links
  related:
    - events-detail-panel
  user_facing: true
  role: viewer
  status: active
- id: events-priority
  summary: High vs low priority flag rendered as a red dot in the feed.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs: []
  tables:
    - events
  related: []
  user_facing: true
  role: viewer
  status: active
```
