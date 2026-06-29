---
surface: Events
spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md
---

# Events

The unified dated-fact entity that powers the timeline, the Intelligence feed,
Future Events, and Activity.

## Event sources

Sources are three orthogonal things, not one field.

**Attached citations (`event_sources` table).** An event has zero or more labeled
citations added by an analyst or AI import. Each citation is a row in `event_sources`
(`event_id` FK -> `events(id) ON DELETE CASCADE`, `url NOT NULL`, `label NULL`,
`sort_order`). There is no `events.source_url` column; it was removed. Where a
compact display needs a single primary link, take the first `event_sources` row by
`(sort_order, created_at)`. Write paths: `create_event` accepts an optional
`p_sources jsonb` array of `{url, label}` objects and writes `event_sources` rows
atomically in the same SECURITY DEFINER transaction. `update_event_sources` replaces
an event's full citation set. `event_sources` inherits space-level RLS from its
parent event (SELECT = `has_space_access`; write = owner/editor only).

**CT.gov registry link (derived, never stored).** The CT.gov page for a trial-anchored
event is `https://clinicaltrials.gov/study/<trial.identifier>`. It is identical for
every event on a trial, so it is never stored in `event_sources` or any column. The
CT.gov ingest producer writes zero source rows. Readers derive the link at render time
from the anchor trial's identifier. The SQL helper `event_registry_url` and the
TypeScript util `ctgovRegistryUrl` are the single homes for this format; the link is
shown alongside the `event_sources` citation list, not inside it.

**Ingest provenance (`source_doc_id`).** The AI-ingest provenance pointer (which source
document an event was extracted from) is orthogonal to citations and is stored directly
on the `events` row. It is unchanged by the sources model.

## Capabilities

```yaml
- id: event-authoring
  summary: Create and edit events (the merged marker/event entity) with date model, provenance, significance, anchor, and pin/hide.
  routes: []
  rpcs:
    - create_event
    - update_event
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
  summary: Detail panel for a single event; renders date, type, significance, provenance, source citations, and linked materials. get_catalyst_detail is the read path; event_registry_url derives the CT.gov registry link from the event anchor.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
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
