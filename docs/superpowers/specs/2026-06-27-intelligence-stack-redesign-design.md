# Intelligence Stack Redesign — Design

Date: 2026-06-27
Status: Approved (design); implementation plan pending
Related: `8fe2a3f9 feat(intelligence): many briefs per entity (anchors) (#131)`

## Problem

The "many briefs per entity (anchors)" feature added the ability to hold multiple
intelligence entries (briefs) per entity, with one pinned as the lead. The UX was
not thought through. Two concrete failures:

1. **History has one home for N briefs.** There is a single
   `intelligence-history-panel` in a shared slot at the bottom of the profile. It
   shows exactly one anchor's timeline at a time. It defaults to the lead's
   history, but clicking "Version history" on any secondary brief *swaps* that one
   slot to the clicked brief — with no affordance to return to the lead's history.
   History is conceptually per-brief, but the UI gives it a single global home.

2. **Reorder is structurally broken.** The accordion list
   (`intelligence-brief-list`) renders only non-lead briefs and emits only their
   anchor ids on drag. `reorder_intelligence` validates that the supplied id set
   *exactly equals the entity's full anchor set* (lead included). The lead is
   therefore always missing from what the client sends, so the count never matches
   and every reorder fails with `anchor set does not match the entity's anchors`.

Secondary issue: the lead renders as a large hero card (`intelligence-block`)
while other briefs render as a thin accordion, so affordances (pin, edit, reorder,
history) are scattered across two different visual treatments.

## Goals

- One consistent presentation for all briefs; the lead is the same card shape,
  distinguished by state, not by a separate component.
- History belongs to each brief, inline, with nothing swapped or hijacked.
- Reorder works.
- Reuse existing capabilities (sequential version diffs, lifecycle RPCs). No new
  diff engine, no new tables, no new RPCs.

## Non-goals

- Arbitrary cross-version comparison. Only the existing sequential
  "Changes vs v(N-1)" diff (driven by `diff_base_id`) is shown. We are not building
  a version picker.
- Per-user persistence of expanded/collapsed state.
- A separate deep/standalone "full history" view. Inline-per-card is the only
  history surface.
- Changing the anchor / lead / versioning data model.

## Chosen direction

**Direction A — unified stack with inline history.** Selected over a hero+drawer
variant (B) and a segmented-switcher variant (C) because it removes the
dual-treatment inconsistency entirely and keeps history in context.

### Layout

A single stacked list of brief cards, rendered by one component, replacing the
three-part layout of `intelligence-block` (lead hero) + `intelligence-brief-list`
(accordion) + bottom `intelligence-history-panel` (shared).

```
INTELLIGENCE (3)                                      + Add entry
┌───────────────────────────────────────────────────────────────┐
│ ⠿(locked)  [Lead] ● Published  [Draft pending]   Title  …  ✎ ⋯ │  ← lead, expanded by default
│   SUMMARY / IMPLICATIONS / LINKED ENTITIES                      │
│   ▾ Version history (2 versions)                                │
│       v2 Published · Jun 27 · Aaditya            current        │
│       v1 Published · Jun 27 · Aaditya     ▸ Changes vs —        │
├───────────────────────────────────────────────────────────────┤
│ ⠿  ▸  Title              Aaditya · Jun 27   v2   📌 ✎ ⋯         │  ← other, collapsed
├───────────────────────────────────────────────────────────────┤
│ ⠿  ▸  Title              Aaditya · Jun 27        📌 ✎ ⋯         │
└───────────────────────────────────────────────────────────────┘
```

(ASCII above is a layout sketch for this doc only; the implementation uses the
existing slate/teal tokens and mono uppercase section labels.)

### Per-card anatomy

Header row: drag grip · expand chevron · title · author·date · version chip (when
> 1 version) · pin toggle · edit · ⋯ overflow.

Expanded body: `SUMMARY`, `IMPLICATIONS`, `LINKED ENTITIES` (grouped by
relationship, same as today), then a `Version history` disclosure.

State decorations:
- Lead card: "Lead" badge, filled pin, published-state dot, expanded by default,
  drag grip locked (greyed, non-draggable).
- "Draft pending" chip on any card where a draft exists alongside the published
  record (carried over from `intelligence-block`'s existing behavior).

Default expand state: **lead expanded, others collapsed.**

### History, inline and lazy

The `Version history` disclosure embeds the existing
`intelligence-history-panel`, scoped to that card's anchor. On first open it
fetches `get_primary_intelligence_history(anchor_id)` and caches the payload in a
per-anchor map keyed by `anchor_id`; subsequent opens read the cache. The cache is
invalidated when that anchor mutates (edit/publish/withdraw/purge).

The panel renders unchanged: collapsed lifecycle events that expand to the
existing sequential "Changes vs v(N-1)" diff (word-level for headline/summary/
implications; added/removed/changed for linked entities). No new diff code.

The single shared bottom history slot is removed. Each detail component stops
calling `historyHost.load(...)` against a global slot.

### Pinning

The pin toggle on a non-lead brief calls `set_intelligence_lead(anchor_id)`
(unchanged; it already requires a published version and clears the prior lead).
The promoted brief moves to index 0; the old lead drops into the stack. The lead's
grip is locked, so pinning is the only way to change the lead — one gesture, one
meaning.

### Reorder fix

Root cause: the client emitted a subset (non-lead only); the RPC requires the full
set. The unified list holds *all* briefs, so the reorder emit now includes the
lead at index 0. The array the client sends matches the entity's full anchor set
and `reorder_intelligence`'s exact-set check passes.

- The lead stays pinned at index 0 and is not draggable; only the other cards
  move (`moveItemInArray` over the full array with the lead fixed at 0, or a
  disabled-drag lead item — implementation detail for the plan).
- `reorder_intelligence` is left as-is: the exact-set validation is a correct
  guard now that the client sends the complete set. We add a regression test
  asserting (a) the full ordered set succeeds and (b) a subset is still rejected.

### Lifecycle actions

- Inline icons: pin, edit.
- ⋯ overflow menu: Withdraw, Purge version, Purge entry. (No "View full history"
  item — history is inline-only.)
- The `withdraw` / `purgeVersion` / `purgeAnchor` outputs currently emitted by
  `intelligence-history-panel` are additionally surfaced from the card's ⋯ menu
  and wired to the same service calls. The history panel keeps emitting its own
  version-level purge from within the inline timeline where that is the natural
  locus.

## Components

| Unit | Change |
|---|---|
| Unified stack component (new; replaces/renames `intelligence-brief-list`) | Renders all briefs as one card list. Owns expand/collapse state, per-anchor history cache + lazy load, drag-reorder over the full set with lead locked at 0, and emits pin/edit/reorder/withdraw/purge. |
| `intelligence-block` (lead hero) | Removed. Its lead rendering + draft-pending logic folds into the unified card's lead state. |
| `intelligence-history-panel` | Kept and reused **inline per card**, scoped to one anchor. No longer mounted in a shared bottom slot. |
| `intelligence-drawer` (edit/create) | Unchanged. Edit and Add Entry continue to open it. |
| asset / trial / company / engagement detail components | Each replaces the three-part wiring (block + list + bottom panel) with the single unified component. `refreshHistory()` against the global slot is removed; history loads lazily inside the stack. |
| `primary-intelligence.service.ts` | Add/confirm a per-anchor history fetch + cache-invalidation entry point usable by the stack. `reorder`, `setLead`, withdraw/purge methods unchanged. |

## Data flow

1. Detail component fetches the entity's `IntelligenceDetailBundle` (briefs ordered
   `is_lead desc, display_order asc`) as today and passes `briefs` to the unified
   stack.
2. Stack renders cards; lead (index 0) expanded, others collapsed.
3. Opening a card's history disclosure → service fetches that anchor's history
   (cached) → inline `intelligence-history-panel` renders it.
4. Pin → `set_intelligence_lead` → bundle refetch → stack re-renders with new lead
   at top.
5. Drag → emit full ordered anchor-id array (lead at 0) → `reorder_intelligence` →
   bundle refetch.
6. Edit/Withdraw/Purge → existing service calls → bundle refetch + invalidate the
   affected anchor's cached history.

## Error handling

- Reorder failure: optimistic local order reverts; toast names the failure
  (existing pattern). With the full-set fix the prior error path no longer fires
  for the normal case.
- History fetch failure for one card: that card's disclosure shows an inline error
  with retry; it does not block the page or other cards (mirrors today's
  panel-load tolerance).
- Pin on a brief with no published version: blocked at the RPC (`22023`) and the
  pin control is disabled in the UI for draft-only briefs to avoid a
  permission-style toast after click.

## Testing

Tests are paired with each unit (no deferred test phase):

- Unified stack component (Vitest):
  - lead expanded, others collapsed on load;
  - expand/collapse toggles independently;
  - pin emits `set_intelligence_lead` for the right anchor and is disabled for
    draft-only briefs;
  - **reorder emits the full ordered anchor set including the lead at index 0**;
  - history disclosure lazy-loads once and caches; mutation invalidates the cache.
- `reorder_intelligence` SQL regression (in-migration or integration):
  full ordered set succeeds; subset is still rejected with `22023`.
- Existing `intelligence-history-panel`, links-diff, and history-timeline specs
  carry over unchanged (the panel's internals are untouched).

## Migration / drift

- No schema change; no new RPC. `reorder_intelligence`, `set_intelligence_lead`,
  `get_primary_intelligence_history` signatures are unchanged, so no PostgREST
  reload or feature-manifest mapping is required.
- In-app help / runbook: no marker/phase/role data changes. If the intelligence
  help copy references the old hero+accordion+bottom-panel layout, update it in the
  same change set.

## Open questions

None blocking. Implementation-level choice (lead as disabled-drag item vs.
`moveItemInArray` with index 0 fixed) is left to the plan.
