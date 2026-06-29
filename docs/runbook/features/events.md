---
surface: Events
spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md
---

# Events

The unified dated-fact entity that powers the timeline, the Intelligence feed,
Future Events, and Activity.

## Capabilities

```yaml
- id: event-authoring
  summary: Create and edit events (the merged marker/event entity) with date model, provenance, significance, anchor, and pin/hide. update_event_links associates an event with additional trial/asset/company anchors.
  routes: []
  rpcs:
    - create_event
    - update_event
    - update_event_links
  tables:
    - events
    - event_types
    - event_type_categories
    - event_changes
  related: []
  user_facing: false
  role: editor
  status: active
- id: event-feed
  summary: Unified events/catalysts feed at /events listing analyst-created events and future milestones, filterable by source, date, company, and type. get_key_catalysts returns a prioritized forward-looking catalyst list for summary surfaces.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_events_page_data
    - get_key_catalysts
  tables:
    - events
    - event_types
    - event_type_categories
    - event_sources
  related:
    - event-authoring
  user_facing: true
  role: viewer
  status: active
- id: event-detail
  summary: Detail panel for a single event; renders date, type, significance, provenance, source citations, and linked materials. get_catalyst_detail and get_event_detail are the two read paths (legacy and canonical names); get_event_thread returns the ordered change history. event_registry_url derives the CT.gov registry link from the event anchor.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_event_detail
    - get_event_thread
    - get_catalyst_detail
    - event_registry_url
  tables:
    - events
    - event_types
    - event_sources
  related:
    - event-feed
  user_facing: true
  role: viewer
  status: active
- id: event-sources
  summary: Citation write path for attaching external URL references to an event; stored in the event_sources table.
  routes: []
  rpcs:
    - update_event_sources
  tables:
    - events
    - event_sources
  related:
    - event-authoring
  user_facing: false
  role: editor
  status: active
- id: event-change-log
  summary: Append-only event-change audit trail written by the _log_event_change trigger on every insert/update/delete of an events row; surfaced on the event detail panel.
  routes: []
  rpcs:
    - _log_event_change
  tables:
    - events
    - event_changes
  related:
    - event-authoring
  user_facing: false
  role: viewer
  status: active
- id: event-formatting-helpers
  summary: Internal SQL helpers that humanize phase and status codes for human-readable display in event summaries and feed rows.
  routes: []
  rpcs:
    - _humanize_phase
    - _humanize_status
  tables: []
  related:
    - event-feed
  user_facing: false
  role: viewer
  status: active
```
