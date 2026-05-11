---
surface: Timeline Dashboard
spec: docs/superpowers/specs/2026-04-12-unified-landscape-design.md
---

# Timeline Dashboard

The primary view of an engagement.

## Capabilities

```yaml
- id: timeline-grid
  summary: Hierarchical company to product to trial.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs:
    - get_dashboard_data
  tables:
    - trials
  related: []
  user_facing: true
  role: viewer
  status: active

- id: timeline-zoom
  summary: Four zoom levels.
  routes:
    - /t/:tenantId/s/:spaceId/timeline
  rpcs: []
  tables: []
  related:
    - timeline-grid
  user_facing: true
  role: viewer
  status: active
```
