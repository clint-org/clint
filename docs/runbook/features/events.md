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
```
