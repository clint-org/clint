---
id: spec-2026-trial-multi-asset
title: Trials spanning multiple assets (master-protocol support)
slug: trial-multi-asset
status: draft
created: 2026-06-04
updated: 2026-06-04
related:
  - 2026-05-21-source-ingestion-design.md
  - 2026-05-28-atomic-join-table-rpcs-design.md
  - 2026-05-30-import-review-redesign-design.md
---

# Trials spanning multiple assets

## Summary

Today a trial belongs to exactly one asset: `public.trials.asset_id` is a single
`NOT NULL` foreign key. Master-protocol studies break this. A single NCT such as
SYNERGY-Outcomes (NCT07165028) tests tirzepatide and retatrutide in separate
experimental arms, so it relates to two distinct assets at once. The current
model cannot represent that: the import extractor cannot pick a single
`asset_ref`, leaves it null, and the trial is dropped from the import review grid
(now surfaced as an "Unlinked trial" after the prior fix, but still unresolvable
because it has nowhere to live).

This spec introduces a many-to-many relationship between trials and assets via a
new `trial_assets` join table, while keeping `trials.asset_id` as a maintained
cache of the trial's primary asset. The join table is the source of truth for the
full set of assets a trial tests; `asset_id` caches which member is primary, so
the many existing "headline asset / company" lookups keep working unchanged and
only the grouping and counting read paths change. A multi-asset trial then
appears under every asset it tests across the dashboard hierarchy, landscape and
bullseye rollups, and positioning, without inflating the global trial count.

The work is delivered as one design with a staged implementation plan so the
model stays coherent while landing in verifiable increments.

## Motivation and prior art

- `trials.asset_id` is read in 13+ SQL sites and assumed single across the
  frontend models and services. A full normalization (dropping `asset_id`) would
  touch every read path and the frontend at once, including the lookups that only
  need the single headline asset, for no gain on the single-asset majority. We
  reject that in favor of the join-plus-cached-primary model below.
- The codebase already models many-to-many off trials with `trial_conditions`
  and `marker_assignments`, and already enforces atomic multi-row writes through
  SECURITY DEFINER RPCs (see `2026-05-28-atomic-join-table-rpcs-design.md`).
  `trial_assets` follows those patterns exactly.
- Two adjacent cases are already handled and stay unchanged: fixed-dose
  combinations become a single combination asset (named by the arm label), and
  co-development duplicates the asset per sponsor. Neither duplicates the trial.
- Duplicating the trial per arm was rejected: it collides on `trials.identifier`
  (the NCT id), fights the in-batch duplicate detection
  (`duplicateTrialIndexes`), has no correct home for study-level events and
  markers, and inflates the global trial count.

## Data model

New table:

```sql
create table public.trial_assets (
  trial_id   uuid not null references public.trials(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  is_primary boolean not null default false,
  source     text not null default 'analyst',
  created_at timestamptz not null default now(),
  created_by uuid not null default auth.uid(),
  primary key (trial_id, asset_id)
);
create index idx_trial_assets_trial_id on public.trial_assets(trial_id);
create index idx_trial_assets_asset_id on public.trial_assets(asset_id);
-- exactly one primary per trial
create unique index uq_trial_assets_one_primary
  on public.trial_assets(trial_id) where is_primary;
```

RLS is derived from the parent trial's `space_id`, exactly as `trial_conditions`
and `marker_assignments` do (select/insert/delete gated by `has_space_access` via
an `exists` check on `public.trials`).

Invariants:

1. Every trial has at least one `trial_assets` row.
2. Exactly one of those rows has `is_primary = true` (enforced by the partial
   unique index above plus the RPC and trigger logic).
3. `trials.asset_id` always equals the `is_primary` member.

`trials.asset_id` stays `NOT NULL`. It is a denormalized cache of the primary
member. The join table is authoritative for the set; `asset_id` is authoritative
for nothing on its own and is reconciled by the sync trigger below.

### Sync trigger

A single trigger keeps `trials.asset_id` equal to the primary member. Direction
is one way: `trial_assets.is_primary` drives `trials.asset_id`, never the
reverse.

- `after insert or update of is_primary or delete on trial_assets`: recompute the
  affected trial's primary and write it to `trials.asset_id`.
- The trigger only writes `asset_id` when a primary row exists, so it never
  attempts to set `asset_id` to null during a transient zero-state. This avoids
  the AFTER-trigger-on-zero-state hazard documented in
  `2026-05-28-atomic-join-table-rpcs-design.md`: because all membership writes go
  through the RPCs below in one transaction, there is no externally visible point
  where a trial has rows but no primary.

### Backfill

For every existing trial, insert one `trial_assets` row from its current
`asset_id` with `is_primary = true` and `source = 'backfill'`. This is a pure
addition: `trials.asset_id` is unchanged, so all existing reads behave
identically. A smoke assertion verifies a one-to-one mapping after backfill
(every trial has exactly one primary member equal to its `asset_id`).

## Mutation path (atomic, RPC-only)

All membership writes go through SECURITY DEFINER RPCs. The client never issues a
DELETE+INSERT against `trial_assets` over PostgREST, because that would be two
transactions and could leave a trial with no primary between them.

- `create_trial(... , p_asset_ids uuid[], p_primary_asset_id uuid, ...)` replaces
  the scalar `p_asset_id`. It inserts the trial, inserts one `trial_assets` row
  per id with `is_primary` set on `p_primary_asset_id`, and lets the trigger set
  `trials.asset_id`. `p_primary_asset_id` must be a member of `p_asset_ids`
  (validated; defaults to the first element if omitted). Behavior for a
  single-element array is identical to today.
- `set_trial_assets(p_trial_id uuid, p_asset_ids uuid[], p_primary_asset_id uuid)`
  reconciles membership for an existing trial in one transaction: it computes the
  add and remove sets, applies them, sets the primary, and relies on the trigger
  to re-sync `asset_id`. Used by the trial-edit dialog (Phase 3) and available to
  the import commit if it needs to update an existing trial. Rejects an empty
  `p_asset_ids` (a trial must keep at least one asset).
- The Angular CRUD callers of `create_trial` migrate to the array signature;
  single-asset callers pass a one-element array.

Both RPCs record audit fields server-side (created_by via `auth.uid()`), never
trusting client-supplied values, per project convention.

## Import pipeline

### Extraction schema and prompt

- `TrialSchema.asset_ref: number | null` becomes `asset_refs: number[]` plus
  `primary_asset_ref: number`. `asset_refs` lists every asset the trial tests
  (zero-based indices into the proposal's `assets` array); `primary_asset_ref` is
  the headline asset. An observational study with no intervention yields an empty
  `asset_refs`.
- The NCT prompt builder (`nct-prompt-builder.ts`) is extended: when a master
  protocol has multiple experimental arms naming distinct active drugs, set
  `asset_refs` to all of them and `primary_asset_ref` to the experimental or
  first arm. The existing combination rule (an arm naming two or more active
  drugs becomes one combination asset) and the co-development rule are unchanged
  and take precedence: a combination arm contributes one combination asset_ref,
  not one per component.

### Commit

`commit_source_import` resolves `asset_refs[]` and `primary_asset_ref` against the
asset id map and calls `create_trial` with the array form. The orphan-trials
handling from the prior fix still applies: a trial is "No asset" (blocking) only
when `asset_refs` is empty, not when it has two or more.

### Import review grid

The grouped grid nests a multi-asset trial under each of its assets (the
`trial_assets`-equivalent is the proposal's `asset_refs`). The
`resolveTrialAssetIndex` / `orphanTrialIndexes` helpers generalize to "is this
trial linked to at least one in-range asset"; nesting iterates `asset_refs`. The
trial's inline detail panel gains the Assets control (below).

## Read RPCs (the "everywhere" requirement)

Two groups:

- Switch to `trial_assets` so the trial is attributed to every asset it tests:
  `get_dashboard_data` (company > asset > indication > trial hierarchy, and its
  trial-collection step), `get_positioning_data`, the landscape and bullseye
  family (`get_landscape_index_by_*`, `get_bullseye_*`), and
  `preview_asset_delete`'s trial collection. Grouping changes from
  `t.asset_id = a.id` to an `exists`/join through `trial_assets`. Counts use
  `count(distinct t.id)` per asset so a trial counts once per asset it tests, and
  the global total is not inflated.
- Keep using `trials.asset_id` (headline only, no change): `search_palette` and
  `palette_empty_state` (asset to company for the secondary line),
  `build_intelligence_payload` (trial to asset to company context), and inline
  `asset_id` display fields.

`get_space_inventory_snapshot` includes the per-trial asset set (sorted) in its
hash so import drift detection notices membership changes, not just the primary.

## Delete semantics

- Deleting an asset cascades to its `trial_assets` rows. A trial that still has
  at least one asset survives. If the deleted row was the primary, the trigger
  promotes another member to primary and re-syncs `trials.asset_id`.
- A trial whose last asset is removed is deleted by a trigger
  (`after delete on trial_assets`, when no rows remain for that trial), preserving
  invariant 1 and matching today's behavior where deleting an asset cascades to
  its trials.
- `preview_asset_delete` distinguishes two buckets: trials that will be fully
  deleted (this asset was their only asset) versus trials that merely lose one of
  several assets (they survive). The preview surfaces both counts so the analyst
  understands the blast radius before confirming.

## UI

The control idiom is asset chips with a primary star, matching the review page's
existing inline pickers (CT.gov candidate radios, match-override chip buttons).

```
Assets:  [* Tirzepatide]  [  Retatrutide]  [+ Add asset]
          ^ primary          ^ click star to promote
```

- Import review detail panel (Phase 1): chips for the trial's `asset_refs` with a
  star marking primary, plus add/remove drawn from the proposal's own assets.
  Default primary from `primary_asset_ref`. Editing happens here, not in the tree
  rows.
- Trial edit dialog (Phase 3): the identical Assets field, reused, calling
  `set_trial_assets`.
- Dashboard tree (Phase 2): the trial nests under each asset, display-only, with
  a small "primary" badge on the primary nesting. No editing in the tree.

Edge cases the control enforces:

- Exactly one primary always. Clicking the current star is a no-op; promoting a
  different chip demotes the old primary.
- Removing the primary chip auto-promotes the next remaining member and shows a
  brief confirmation ("Retatrutide is now the primary asset").
- Removing the last asset is disallowed (a trial always keeps at least one
  asset). This is the UI-level expression of invariant 1.

## Testing

- Pure unit tests (`review-grid.logic.spec.ts`): multi-asset proposal nesting
  (a trial appears under each `asset_ref`), primary derivation, and "No asset"
  blocking only when `asset_refs` is empty.
- In-migration SQL smoke tests (following the existing shared-RPC smoke pattern):
  multi-asset `create_trial`, primary-sync trigger correctness, last-asset
  cascade-delete, promote-on-primary-delete, and the post-backfill one-to-one
  assertion.
- Frontend specs for the chip/star control (set primary, add, remove,
  auto-promote on primary removal, last-asset removal disabled).
- After migrations: `supabase db advisors --local --type all` clean, and
  `ng lint && ng build` green.

## Phasing (one spec, staged plan)

1. Phase 1: schema (`trial_assets`, partial unique index, sync trigger,
   backfill), `create_trial` array signature, `set_trial_assets`,
   `commit_source_import` array handling, extraction schema and prompt, and the
   import-review Assets control. The rest of the app keeps working unchanged via
   `trials.asset_id`.
2. Phase 2: convert the grouping and counting read RPCs (dashboard hierarchy,
   landscape, bullseye, positioning, preview_asset_delete) to attribute via
   `trial_assets`. This is where a multi-asset trial becomes visible under each
   asset across the product.
3. Phase 3: trial-edit dialog Assets field, per-asset timelines and events
   surfacing, and the dashboard-tree primary badge.

## Risks and open questions

- Denormalized primary: `trials.asset_id` and `trial_assets` can in principle
  disagree. Mitigation: the one-way sync trigger plus RPC-only writes, covered by
  smoke tests. This is the accepted cost of keeping the migration contained.
- `count(distinct t.id)` per asset is correct for per-asset attribution but means
  the sum of per-asset trial counts can exceed the distinct trial total. This is
  intended (a trial legitimately appears under two assets). Any place that
  presents a single global trial total must count distinct trials, not sum the
  per-asset counts.
- Runbook updates land with each phase: `features/source-import.md` (Phase 1),
  the dashboard and landscape feature docs and `07-database-schema.md` /
  `06-backend-architecture.md` auto-gen regen (Phase 2), trial-edit and timeline
  docs (Phase 3).
