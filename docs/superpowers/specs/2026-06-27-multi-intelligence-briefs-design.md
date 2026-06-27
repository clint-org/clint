# Multi-Intelligence-Briefs Design

**Date:** 2026-06-27
**Status:** Approved (brainstorming) — pending implementation plan
**Worktree:** `.worktrees/multi-intelligence-briefs` (branch `feat/multi-intelligence-briefs` off `develop`)

## Problem

Today an entity (engagement/space, company, asset, trial) can own exactly **one**
primary-intelligence brief. The constraint is structural: the "anchor" that owns
versions is the entity triple `(space_id, entity_type, entity_id)`, enforced by a
partial unique index `primary_intelligence_one_published (space_id, entity_type,
entity_id) WHERE state = 'published'`. Every per-anchor rule (version numbering,
archive-on-republish, change-note-required, history fetch) keys on those three
columns.

Analysts need to author **many** distinct briefs per entity — a drawer of
intelligence entries — each an independent deliverable with its own lifecycle and
history, not just successive revisions of one brief.

## Goal

Change the cardinality from one-brief-per-entity to many-briefs-per-entity, while
**keeping the existing per-brief lifecycle and versioning machinery intact**.

This is a greenfield project: there is no production intelligence data to preserve,
so the schema is designed for the clean end state (full normalization), and seed
migrations are rewritten rather than backfilled.

## Decisions (from brainstorming)

1. **Per-brief lifecycle: keep all 4 states unchanged.** Each brief independently
   moves through `draft -> published`, auto-archives the prior published version on
   republish (version history), and supports `withdraw`. Keeping the state machine
   as-is is the *least* surface area; modifying it would touch triggers, guards, the
   history panel, and diff logic that all work today.
2. **Brief identity: headline + manual sort + a pinned "lead".** Briefs are
   distinguished by headline and ordered manually. One brief per entity may be
   pinned as the **lead** — it surfaces first on the entity detail page and feeds the
   landscape presence flags. No taxonomy / "kind" tags (YAGNI).
3. **Scope: the four current owner types** — engagement (`space`), `company`, asset
   (`product`), `trial`. Markers are **not** owners today (the frontend intentionally
   treats them as link targets only); they stay link-only. No new branching.
4. **Detail layout: lead expanded, rest collapsed.** The lead brief renders fully
   inline (as today's single block); other briefs render below as a collapsed list
   (headline + author + date) that expands in place.
5. **Full normalization (greenfield).** Entity binding lives only on the anchor;
   `primary_intelligence` rows become pure version rows. No denormalized
   `entity_type`/`entity_id` on version rows.

## Architecture

### Hierarchy

```
primary_intelligence_anchors   (the "brief": entity binding, lead, order)
  -> primary_intelligence       (version rows: state, headline, body, version_number)
       -> primary_intelligence_links      (links from a version to other entities)
       -> primary_intelligence_revisions  (per-save snapshots within a version)
```

### New table: `primary_intelligence_anchors`

| column          | type        | notes                                            |
|-----------------|-------------|--------------------------------------------------|
| `id`            | uuid PK     | the stable brief identity                        |
| `space_id`      | uuid FK     | -> spaces                                         |
| `entity_type`   | text CHECK  | `trial \| company \| product \| space`           |
| `entity_id`     | uuid        | polymorphic (no FK, like today's PI columns)     |
| `is_lead`       | boolean     | default false                                     |
| `display_order` | int         | default 0; manual ordering of non-lead briefs    |
| `created_by`    | uuid FK     | -> auth.users (server-side, via trigger/RPC)     |
| `created_at`    | timestamptz | default now()                                     |
| `updated_at`    | timestamptz |                                                  |

Entity binding is **immutable** after creation. `entity_type`/`entity_id` follow the
existing polymorphic pattern (no FK; cleanup via triggers — see G1).

### Changes to `primary_intelligence`

- Add `anchor_id uuid NOT NULL REFERENCES primary_intelligence_anchors(id) ON DELETE CASCADE`.
- **Remove** `entity_type` and `entity_id` (they move to the anchor). All queries that
  filtered PI by entity now join through the anchor.
- Everything else (state, headline, `summary_md`, `implications_md`, `version_number`,
  `published_at`, `withdrawn_at/by`, `last_edited_by`, timestamps) is unchanged.

### Indexes / constraints

- **Drop** `primary_intelligence_one_published (space_id, entity_type, entity_id) WHERE state='published'`.
- **Add** one-published-per-brief: unique index `primary_intelligence (anchor_id) WHERE state='published'`.
- **Add** one-lead-per-entity: unique index `primary_intelligence_anchors (space_id, entity_type, entity_id) WHERE is_lead`.
- Re-point `idx_primary_intelligence_anchor_versions` to key on `anchor_id, version_number desc`.
- Index `primary_intelligence_anchors (space_id, entity_type, entity_id)` for the per-entity brief list.

### Triggers

- `assign_primary_intelligence_version`: change the `max(version_number)+1` subquery
  scope from the entity triple to `anchor_id`. (Each brief versions independently from v1.)
- `guard_primary_intelligence_state`: unchanged (operates per-row).
- `write_primary_intelligence_revision`: unchanged.
- **`_cleanup_polymorphic_refs` (G1):** delete from `primary_intelligence_anchors` by
  `(entity_type, entity_id)` — versions/links/revisions cascade via FK — **and** still
  delete `primary_intelligence_links` rows that *point to* the deleted entity as a link
  target (the marker case). Update the company/product/trial/marker AFTER DELETE triggers
  accordingly.

## Backend / RPCs

- **`upsert_primary_intelligence`** gains `p_anchor_id`:
  - New brief (`p_anchor_id` null + `p_id` null) -> create the anchor (entity binding from
    params, `display_order = max+1`, `is_lead = true` only if the entity has no anchors yet),
    then insert the version row.
  - Editing (`p_id` given) -> resolve the anchor from the row; entity binding immutable.
  - The archive-prior-published and change-note-required rules re-scope from the entity
    triple to `anchor_id`.
- **New `set_intelligence_lead(p_anchor_id)`** — clears `is_lead` on the entity's other
  anchors, sets it here. **Rejected if the anchor has no published version (G2).** Agency-only.
- **New `reorder_intelligence(p_space_id, p_entity_type, p_entity_id, p_anchor_ids uuid[])`**
  — writes `display_order`. **Rejects an `anchor_ids` set that doesn't exactly match the
  entity's anchors (G4).** Agency-only.
- **New `list_intelligence_for_entity(p_space_id, p_entity_type, p_entity_id)`** — ordered
  brief list (lead first, then `display_order`): each entry =
  `{ anchor_id, is_lead, display_order, published_version | null, draft | null, author,
  updated_at, version_count }`. Viewers see only anchors with a published version; agency
  see drafts too. Backs the detail-page drawer.
- **`get_{trial,company,asset}_detail_with_intelligence` + `get_space_intelligence`**
  refactor to return `{ entity, briefs: [...], referenced_in }` instead of a single
  `published/draft`.
- **`get_primary_intelligence_history`** re-keys from the entity triple to `p_anchor_id`
  (history is per brief now).
- **Lead auto-promotion (G2):** `withdraw_primary_intelligence` and
  `purge_primary_intelligence` check whether the removed version was the lead anchor's last
  published version; if so, promote the next most-recently-published anchor to lead. If none
  remain published, the entity has no lead and `has_intelligence` is false.
- **Anchor lifecycle cleanup (G3):** `purge_primary_intelligence(..., p_purge_anchor)` removes
  the anchor row; `delete_primary_intelligence` on the only never-published draft of a fresh
  anchor removes the anchor; `user_redaction_rpc` (deletes a version by id) re-evaluates lead
  afterward.
- **Space deletion (G1):** `permanently_delete_space` and the space-PI cleanup path delete
  anchors by `space_id` (versions cascade via FK).
- **Feed `list_primary_intelligence`** naturally returns multiple rows per entity now (one per
  published anchor); add `is_lead` to the row shape.
- **Landscape `get_dashboard_data` / `get_positioning_data`:** `has_intelligence` = any
  published anchor; `intelligence_headline` = lead anchor's headline; `intelligence_count` per
  entity = number of published anchors (shown as a small "N" when > 1).

## Frontend

- **Model:** add `PrimaryIntelligenceBrief` (anchor + its current published/draft);
  `IntelligenceDetailBundle` becomes `{ entity, briefs[], referenced_in }`.
- **Service:** detail getters return `briefs[]`; `upsert` accepts `anchorId`; add
  `setLead(anchorId)`, `reorder(...)`; `loadHistory(anchorId)`. Cache tags gain the anchor.
- **Detail pages (trial / company / asset / engagement):** lead brief renders fully inline via
  the existing `intelligence-block` (unchanged); other briefs render below as a collapsed list
  via a new small `intelligence-brief-list` presenter that expands in place. An **"Add brief"**
  action opens the editor drawer in new-anchor mode.
- **Pin / order (agency only):** "Pin as lead" per brief (pinned floats to top, renders
  expanded); the rest are manually orderable via drag handles, defaulting to reverse-chron.
- **Compose dialog:** picking an entity always creates a *new* anchor now (the old "edit the one
  existing brief" path goes away).
- **History panel:** keyed by `anchor_id`; each brief has its own history affordance.
- **Terminology (G5):** each brief is an intelligence **"entry"** in UI copy; the drawer header
  reads "Intelligence (N)".

## Testing

### Integration (RPC + DB, local Supabase)

1. First brief -> anchor created, `is_lead=true`, `display_order=0`.
2. Second brief -> new anchor, `is_lead=false`, first stays lead.
3. Edit one brief (`p_id`) leaves the sibling brief untouched.
4. `version_number` is per-anchor (each anchor starts at v1, independent).
5. Republish -> prior archived, v2, change_note required; sibling unaffected.
6. One-published-per-anchor index rejects a 2nd published in same anchor.
7. Two published across *different* anchors of same entity -> allowed.
8. `set_intelligence_lead` flips lead; one-lead-per-entity index holds.
9. `set_intelligence_lead` on a draft-only anchor -> rejected (G2).
10. `reorder_intelligence` writes order; rejects mismatched/cross-entity set (G4).
11. Withdraw lead's last published -> next published anchor auto-promotes (G2).
12. Withdraw a non-lead -> lead unchanged.
13. Purge single version -> version gone, anchor + siblings remain.
14. Purge whole anchor -> anchor+versions+links+revisions gone; lead re-promotes (G3).
15. Delete draft-only fresh anchor -> anchor removed (G3).
16. Delete draft on anchor with published history -> published stays.
17. Delete trial/company/asset -> all its anchors+versions+links+revisions gone (G1).
18. Delete space -> its engagement anchors gone (G1).
19. Delete a marker that a brief links to -> link removed, brief survives (G1).
20. `list_intelligence_for_entity`: lead-first ordering; agency sees drafts, viewer doesn't.
21. `get_*_detail_with_intelligence` returns `briefs[]` + `referenced_in`.
22. `get_primary_intelligence_history(anchor_id)` scoped to that anchor only.
23. Feed `list_primary_intelligence` returns multiple rows per entity, `is_lead` present.
24. Landscape `get_dashboard_data`/`get_positioning_data`: `has_intelligence`, headline=lead,
    count=# published anchors.

### RLS

- Viewer sees only published anchors/versions (no drafts, archived, withdrawn, or draft-only
  anchors); agency sees all; non-member sees nothing; anchors-table policies mirror
  `primary_intelligence`.

### Unit (Vitest)

- Service maps `briefs[]` jsonb -> model (diff both sides of the cast to avoid silent shape
  mismatch); lead resolution; brief-list presenter (collapsed rows + expand); compose-dialog
  new-anchor mode; reorder emits correct order; cache-invalidation tags.

### E2E (Playwright)

- Detail page renders lead expanded + collapsed list; add-brief flow; pin -> becomes lead;
  drag-reorder; per-brief history; empty-state -> add first.

### CI / static gates

- `features:check` maps the new RPCs (rpc-unmapped is an ERROR).
- `grants:check` row for `primary_intelligence_anchors` (anon zero, authenticated per matrix).
- `supabase db advisors --local --type all` clean (no new RLS/security warnings).
- `ng lint && ng build`.
- `npm run docs:arch` regen so the ER diagram picks up the anchor table.

## Non-goals (YAGNI)

- No brief "kind"/taxonomy tags (headline + manual order only).
- No moving a brief between entities.
- No new per-brief permissions (existing space/agency gating stands).
- Marker-ownership DB cleanup is optional and called out, not core.

## Edge cases / invariants (summary)

- **G1** Entity-delete cascade rewired to the anchor table; space-delete deletes anchors by
  `space_id`; link-target cleanup preserved.
- **G2** `is_lead` only valid on an anchor with a published version; auto-promote on loss.
- **G3** Anchor rows cleaned up on whole-anchor purge and on deletion of a fresh anchor's only
  draft; redaction re-evaluates lead.
- **G4** `reorder_intelligence` validates the full anchor set for the entity.
- **G5** UI copy uses "entry"; drawer header "Intelligence (N)".

## Audit

Pin / reorder / upsert are content operations on editorial tables, not Tier-1 admin /
security / governance RPCs, so no `-- @audit:tier1` marker is required (consistent with the
existing `_cleanup_polymorphic_refs` and `upsert_primary_intelligence`).
