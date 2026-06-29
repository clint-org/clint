# Event-model Stage 3 spec refinement - kickoff prompt

Stage 3 of the event-model program is the IA/terminology rename + merged Event
form + taxonomy admin. The spec ALREADY EXISTS and is substantial
(`docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md`, ~472 lines).
This session is a REFINEMENT pass: fold in three decisions just locked with the
user, and reconcile the spec against what the cutover actually shipped. It is
PURE DESIGN/DOC work - no code, no DB, no migrations. It runs safely in parallel
with the cutover (which is finishing Phase E on `feat/event-model`).

Paste the block below into a fresh session.

```
Refine the Event-model Stage 3 spec at
  docs/superpowers/specs/2026-06-28-event-model-stage-3-ia-rename.md
This is a DESIGN/DOC-ONLY task (no code, no migrations, no DB). Use superpowers:brainstorming
to pressure-test the changes against the existing spec before editing, then update the spec.

Setup:
  1. Create a NEW worktree off feat/event-model (it has the spec + all cutover context that the
     spec must align to), on a NEW branch `spec/event-model-stage-3`. Do NOT work on feat/event-model
     itself (the cutover is mid-flight there) and do NOT touch any file other than the Stage 3 spec
     (and, if helpful, a short companion note). symlink src/client/node_modules from the main checkout
     only if you need to run anything (you should not - this is doc-only).
  2. Read the existing Stage 3 spec end to end first. It already covers: route renames + redirects,
     nav/topbar/breadcrumb maps, component/file/dir renames, RPC-name frontend refs, routerLink-array
     hotspots, copy literals, help pages, the Events->Activity split, the merged Event form
     (anchor model, field-to-column mapping, type-conditional + CT.gov lock, entry points, save path),
     the taxonomy admin (Event Categories + Event Types tabs), the rename-guard method, the acceptance
     matrix, the testing plan, and the blast-radius checklist. Your job is to REFINE, not rewrite.

THREE LOCKED DECISIONS to fold in (confirmed by the user this session):

  D1 - Sources display in the UI (the cutover delivered events.sources[] via the event_sources table
       + a DERIVED CT.gov registry_url; there is NO events.source_url column). Locked UX:
       - DETAIL PANEL: render the citations as a STACKED LABELED LIST (each row: source label + an
         external-link affordance). Render the derived CT.gov registry link as a SEPARATE, distinct
         affordance (it is a registry pointer, not a citation - do not fold it into the sources list).
       - COMPACT SURFACES (timeline marker tooltip, feed row): show the PRIMARY source only (first
         event_sources row by sort_order) + a "+N" count for the rest.
       Update the merged-form section (multi-source authoring: a repeater of {label, url} rows) and add
       a short "Sources rendering" subsection to the detail-panel/feed design. The cutover already
       built: create_event(p_sources jsonb), update_event_sources (replace-all), the event_sources
       table (FK->events cascade, url/label/sort_order), the SQL helper event_registry_url + TS util
       ctgovRegistryUrl. Stage 3 only designs the multi-source AUTHORING repeater + the display.

  D2 - Event taxonomy name-uniqueness. The new event_types / event_type_categories tables currently
       have NO unique(space_id, name) constraint (only a pkey) - the old marker_types/event_categories
       had unique(space_id, name) PLUS a partial unique index for system rows (where space_id is null).
       DECISION: restore both, delivered WITH the Stage 3 taxonomy admin (since that admin is what first
       lets a user create space-custom types). Add to section 4 (Taxonomy admin / Event Types + Event
       Categories tabs): the migration adds unique(space_id, name) + the partial system-row unique index
       to BOTH event_types and event_type_categories, and the admin UI surfaces a friendly duplicate-name
       error. Model reminder: event_types is two-tier - system types (space_id IS NULL, the 12 shared
       seeded defaults, global to every space) + space-custom types (space_id set, private to one space);
       a space-custom type MAY reuse a system type's name (different space_id), but no two custom types
       within a space, and no two system types, may share a name.

  D3 - Vocabulary/route lock (CONFIRMED as-specced; make sure the spec matches it exactly):
       - Entity: Event (the dated fact) / Marker (the glyph). "Catalyst" is RETIRED.
       - Significance: high (on timeline by default) / low (feed-only).
       - Provenance order: actual > company > primary > forecasted. NOTE: the projection tier value was
         renamed stout -> estimate -> FORECASTED (the cutover shipped 'forecasted'; label "Forecasted").
         Ensure the spec says 'forecasted', not 'estimate'/'stout', anywhere it lists projection values.
       - Routes: /future-events "Future Events" (was /catalysts); /activity "Activity" (was the Events
         page); /intelligence "Intelligence" (unchanged). The "Intelligence" sidebar group holds
         "Activity" + "Intelligence Feed".

RECONCILE the spec against what the cutover ACTUALLY shipped (so Stage 3 does not re-specify done work
or contradict reality). Read the cutover ledger `.superpowers/sdd/progress.md` and the parent spec
`docs/superpowers/specs/2026-06-28-unified-events-timeline-design.md`. Key cutover facts to align to:
  - Tables markers / marker_assignments / marker_types / marker_categories / event_categories /
    event_links / event_threads are DROPPED. Live: events, event_types, event_type_categories,
    event_changes, event_sources, trial_change_events. Events carry a SINGLE polymorphic anchor
    (anchor_type in space|company|asset|trial + anchor_id) - NO join table, NO secondary anchors.
  - primary_intelligence_links entity_type now uses 'event' (NOT 'marker'); the linked-entities-picker
    writes 'event'. The Stage 3 rename inventory should drop any 'marker' entity_type rename rows that
    are already done.
  - The marker glyph code, marker.service (now writes events via create_event), marker-form
    (single-anchor), and the help pages still carry "marker" VOCAB on purpose - Stage 3 owns that rename.
    But event_links/event_threads + update_event_links/get_event_thread are dropped/retired Stage-3
    machinery (the update_event_links fn still exists but references the dropped event_links table); if
    Stage 3 reintroduces event-to-event links, it must re-create the table + fix the fn. Flag this.
  - Activity write-paths: update_event RPC writes the analyst trial_change_events row on event edit;
    the _log_event_change trigger writes event_changes (per-event change log), NOT trial_change_events.
    The merged-form save path + the Activity section should reflect this.
  - Glossary already exists at docs/runbook/features/glossary.md (Event/Marker/Intelligence/Activity).
    Stage 3 should point help pages + the deck at it, not duplicate it.

Deliverable: the refined spec on branch spec/event-model-stage-3, committed (no emojis, no em dashes,
no Claude attribution), with a short changelog at the top of your edits noting D1/D2/D3 + the
reconciliation. Open a PR to develop (or leave for review) - do NOT merge. Do NOT touch the cutover's
files or branch. When done, report the sections you changed and any open design question you could not
resolve.
```

## Why this is safe to parallelize
Doc-only, on its own branch in its own worktree, touching only the Stage 3 spec file. It never
runs a DB reset, never edits a migration/RPC/service/component, and never touches the cutover's
test files. The only shared input is read-only context (the parent spec + the ledger).
