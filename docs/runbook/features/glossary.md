---
surface: Glossary
spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md
---

# Glossary

Authoritative definitions for terms used across the runbook, specs, and codebase.
The user-facing label renames (the "markers" -> "events" IA rename in the UI, routes,
and in-app help) shipped in Stage 3
(`docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md`): the product now
speaks "Event", "Future Events", and "Activity"; "catalyst" and user-facing "marker" are
retired.

---

## Event

The unified dated-fact entity introduced by the event-model cutover. An event
represents a single meaningful fact about a drug program at a point in time: a data
readout, regulatory milestone, clinical trial date, or analyst observation.

**Date model.** `event_date` (required), `end_date` (optional, for range events),
`date_precision` (exact / month / quarter / half / year), and `projection`
(`actual` / `forecasted` / `company` / `primary`). The `is_projected` boolean is a
generated column, true whenever `projection` is not `actual`. Analyst events may have a
fuzzy date (month, quarter, half, or year precision); CT.gov-seeded events carry the
precision string from the CT.gov source.

**Provenance.** There is no `events.source_type` column. Provenance is carried in
`metadata->>'source'` (`analyst` for analyst-authored, `ctgov` for CT.gov-seeded events)
and by `source_doc_id`, the FK to the originating `source_documents` row for AI-imported
events. (`source_type` is only a feed-filter *parameter* on `get_events_page_data`, with
values `event` / `marker` / `detected`.)

**Significance.** `significance` (high / low) drives rendering weight; null inherits the event type's default_significance.

**Anchor.** Every event has exactly one anchor, held by the polymorphic `anchor_type`
column (one of `space`, `company`, `asset`, or `trial`) and the `anchor_id` UUID. There
are no secondary anchors.

**Pin / hide.** `visibility` is a single nullable column on the event row
(`pinned` / `hidden`; null = inherit the default). Pinned events are promoted in timeline
rendering; hidden events are excluded from default views.

**Sources model.** Three orthogonal things:
- Attached citations live in the `event_sources` side table (zero or more per event;
  `url NOT NULL`, `label NULL`, `sort_order`). The legacy `events.source_url` column is
  retained but is no longer the source of truth for citations.
- The CT.gov registry link is derived at read time from the anchor trial's identifier
  via `event_registry_url` (SQL) / `ctgovRegistryUrl` (TypeScript); it is never stored.
- AI-ingest provenance is `source_doc_id` on the events row, orthogonal to citations.

**Audit trail.** Every INSERT / UPDATE / DELETE on `events` is logged by the
`_log_event_change` trigger to the `event_changes` table (append-only).

**Key tables:** `events`, `event_types`, `event_type_categories`, `event_sources`,
`event_changes`.

**Key RPCs:** `create_event`, `update_event`, `update_event_sources`,
`get_event_detail`, `get_events_page_data`, `get_activity_feed`, `event_registry_url`.
(`get_key_catalysts` was dropped by the Stage 3 RPC rename.)

---

## Marker

In the current schema, **marker** refers to the visual glyph that renders an event on
the timeline -- the colored dot or flag icon drawn at the event's date position. It is
not a separate database table. The `markers`, `marker_assignments`, `marker_types`,
`marker_categories`, and `marker_changes` tables were dropped by the event-model
cutover and replaced by `events`, `event_types`, `event_type_categories`, and
`event_changes`.

The user-facing label was unified in Stage 3: the UI, navigation, and in-app help now
speak "Event". "Marker" survives only as the internal name for the glyph primitive and
its rendering components (`MarkerIconComponent`, `marker-visual.ts`, `GLYPH_RATIOS`); it
is no longer shown to users. The glyph fields it draws (shape, color, inner mark) now
live on `event_types`.

---

## Intelligence

An authored analytical read on a drug program -- the deliverable a CI analyst writes.
Stored in `primary_intelligence` with anchors in `primary_intelligence_anchors` and
entity links in `primary_intelligence_links`. Sometimes called "Primary intelligence"
in UI copy (two-tier: "Intelligence" for the item, "Primary intelligence" for the
collection). Intelligence is distinct from Activity (detected changes) and from Events
(dated facts).

---

## Activity

Detected changes only: CT.gov field diffs pulled by the daily Cloudflare Worker and
analyst event edits, all stored in `trial_change_events`. CT.gov diffs are classified
by the ingest pipeline; analyst event edits emit a `trial_change_events` row via the
`update_event` RPC (which captures the old date/anchor before the update). The
`_log_event_change` trigger is a separate per-event change log that writes
`event_changes` (append-only audit trail for every INSERT/UPDATE/DELETE on `events`);
it does not write `trial_change_events`. Activity rows are classified by type
(`phase_transitioned`, `status_changed`, etc.) and surfaced on the read-only Activity
page at `/activity`, backed by `get_activity_feed` over `trial_change_events`. Activity is
the automated, system-generated side of the event stream; Events are the analyst-authored
side. (Before Stage 3 the two shared one page and `/activity` redirected to
`/events?source=detected`; Stage 3 split them, retired that redirect, and `/events` now
redirects to `/activity`.)

## Capabilities

```yaml
[]
```
