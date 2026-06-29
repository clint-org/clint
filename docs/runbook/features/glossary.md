---
surface: Glossary
spec: docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md
---

# Glossary

Authoritative definitions for terms used across the runbook, specs, and codebase.
User-facing label renames (the "markers" -> "events" IA rename in the UI, routes, and
in-app help) land in Stage 3
(`docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md`).

---

## Event

The unified dated-fact entity introduced by the event-model cutover. An event
represents a single meaningful fact about a drug program at a point in time: a data
readout, regulatory milestone, clinical trial date, or analyst observation.

**Date model.** `event_date` (required), `date_end` (optional, for range events),
`date_precision` (exact / month / year), and `is_projected` (boolean). Analyst events
may have a fuzzy date (month or year precision); CT.gov-seeded events carry the
precision string from the CT.gov source.

**Provenance.** `source_type` distinguishes analyst-authored (`analyst`) from
AI-imported (`source_import`) and CT.gov-seeded (`ctgov`) events. `source_doc_id` FK
points to the originating `source_documents` row for AI-imported events.

**Significance.** `significance` (high / medium / low / none) drives rendering weight
and is optional (null = unset).

**Anchor.** Every event has exactly one primary anchor -- a single trial, asset, or
company -- held by the polymorphic `anchor_trial_id` / `anchor_asset_id` /
`anchor_company_id` columns (exactly one non-null). Additional secondary anchors are
in the `event_links` side table (via `update_event_links`).

**Pin / hide.** `is_pinned` and `is_hidden` are viewer-level display controls stored
on the event row. Pinned events are promoted in timeline rendering; hidden events are
excluded from default views.

**Sources model.** Three orthogonal things:
- Attached citations live in the `event_sources` side table (zero or more per event;
  `url NOT NULL`, `label NULL`, `sort_order`). No `events.source_url` column exists.
- The CT.gov registry link is derived at read time from the anchor trial's identifier
  via `event_registry_url` (SQL) / `ctgovRegistryUrl` (TypeScript); it is never stored.
- AI-ingest provenance is `source_doc_id` on the events row, orthogonal to citations.

**Audit trail.** Every INSERT / UPDATE / DELETE on `events` is logged by the
`_log_event_change` trigger to the `event_changes` table (append-only).

**Key tables:** `events`, `event_types`, `event_type_categories`, `event_sources`,
`event_changes`, `event_links`.

**Key RPCs:** `create_event`, `update_event`, `update_event_links`,
`update_event_sources`, `get_event_detail`, `get_events_page_data`,
`get_key_catalysts`, `event_registry_url`.

---

## Marker

In the current schema, **marker** refers to the visual glyph that renders an event on
the timeline -- the colored dot or flag icon drawn at the event's date position. It is
not a separate database table. The `markers`, `marker_assignments`, `marker_types`,
`marker_categories`, and `marker_changes` tables were dropped by the event-model
cutover and replaced by `events`, `event_types`, `event_type_categories`, and
`event_changes`.

The user-facing label ("Marker" vs. "Event" in the UI, navigation, and in-app help)
is being unified in Stage 3.

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
analyst edit rows written by the `_log_event_change` trigger, all stored in
`trial_change_events`. Activity rows are classified by type (`phase_transitioned`,
`status_changed`, etc.) and surfaced on the unified Events page with
`source_type='detected'`. Activity is the automated, system-generated side of the
event stream; Events are the analyst-authored side. The standalone `/activity` route
redirects to `/events?source=detected`.

## Capabilities

```yaml
[]
```
