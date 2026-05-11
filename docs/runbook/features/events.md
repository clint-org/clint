---
surface: Events
spec: docs/specs/events-system/spec.md
---

# Events (Intelligence Feed)

A unified chronological feed showing analyst-created events and timeline markers together. Events capture competitive intelligence at four entity levels: space (industry-wide), company, product, and trial.

**Route:** `/t/:tenantId/s/:spaceId/events`. Honors `?eventId=<id>` to deep-link a specific event into the detail panel on load (used by the command palette).

**Layout:** Data table (p-table) with sortable/filterable columns + a right-side overlay detail panel (340px, absolute-positioned, `@slidePanel` animation) that slides in on row click and hides when nothing is selected.

| Column | Content |
|---|---|
| Date | Event date, sorted descending by default |
| Source | Badge: "EVENT" (green) or "MARKER" (slate) |
| Title | Event title with thread indicator if applicable |
| Category | 6 system categories: Leadership, Regulatory, Financial, Strategic, Clinical, Commercial |
| Entity | Company / Product / Trial name, or "Industry" for space-level |
| Priority | Red dot for high, empty for low |

**Detail panel (340px overlay):** Description, source URLs, tags, thread context (ordered list of events in the narrative), related events (ad-hoc links), and created timestamp.

**Event features:** Free-form tags, multiple source URLs with labels, threads (sequential narrative chains), ad-hoc links between related events, high/low priority.

## Capabilities

```yaml
- id: events-feed
  summary: Unified chronological data table mixing analyst events and timeline markers across four entity levels.
  routes:
    - /t/:tenantId/s/:spaceId/events
  rpcs:
    - get_events_page_data
  tables:
    - events
    - markers
    - event_categories
  related:
    - events-detail-panel
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
