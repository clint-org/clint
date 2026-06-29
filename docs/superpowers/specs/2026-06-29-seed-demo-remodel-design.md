# Seed Demo Data Remodel: Correct Event Lane Placement, Dedup, Evergreen Dates, Projection Variety

## Problem

A visual review of a freshly `seed_demo_data`-seeded space found the demo timeline is structurally messy. Grounded by an audit of the actual seeded output (180 events on a fresh space):

1. **Wrong anchor level (root cause).** 163 of 180 events (90%) are trial-anchored. Regulatory/commercial events that belong on the **asset lane** are stuck on trials: 19 Approvals, 8 Launches, 5 LOE Dates, 17 Regulatory Filings are trial-anchored, and one Approval ("Wegovy SELECT label update") is on the company band. Per the unified-events lane taxonomy, those belong on the asset.
2. **Duplication.** The "combined SUMMIT + SURMOUNT-1" filing fans out to two identical Regulatory-Filing markers at one date. `_seed_demo_recent_activity` / `_seed_demo_activity_variety` mint *new* topline events ("... topline expected") for trials that `_seed_demo_markers` already gave "... topline projected" - the same readout twice.
3. **Stale projected dates.** 13 projected events are dated before today (2026-06-29) because the seed hardcodes 2026 dates that have aged into the past, so projected markers render behind the today line.
4. **Approval stacked on topline.** "Jardiance post-MI no longer expected" (Approval) overlaps "EMPACT-MI fails primary" (Topline) on the same trial, same date.
5. **No projection-source variety.** The seed only ever emits `projection='actual'` or `'company'`. The model has four tiers (`actual`, `primary`, `company`, `forecasted`); the demo never shows the plain-hollow `primary` or the dashed/dim `forecasted` (`f`) glyph.

This is a deliberate remodel of the demo seed, not a content refresh. The competitive landscape (companies, assets, trials, the obesity/cardiometabolic story) is correct and stays; what changes is *where* events anchor, *how many* there are, *what dates* they carry, and *which projection tier* they use.

## Goals

- Every event renders on the correct lane: trial = clinical, asset = regulatory/commercial, company = corporate.
- One event per real-world fact: no fan-out duplicates, no duplicate toplines across producers.
- Evergreen dates: projected events always sit ahead of the today line, no matter when the seed runs.
- The full projection vocabulary (`actual` / `primary` / `company` / `forecasted`) appears across anchor levels so the timeline shows the breadth of marker treatments.
- Curated corporate visibility: high-impact company-band events are pinned (glyph on the band); a few stay feed-only to demonstrate that state.

## Non-Goals

- No change to companies/assets/trials/indications/MOA-ROA seeding (the landscape itself is correct).
- No change to the `seed_demo_data` owner-gating or idempotency (already correct; only a date-shift pass is added to the orchestrator).
- The marker-guide **legend** glyph rendering and the **`p`-badge** rendering rule are **frontend** changes, tracked as a separate follow-up task (see "Frontend follow-up"). This spec is the DB seed remodel only.

## Design

### 1. Anchor model (asset-centric re-authoring)

The regulatory/commercial events are **re-authored as asset-anchored from the start**, not mechanically re-pointed from trials (multiple trials map to one asset, so a blind re-anchor would just move the duplication onto the asset).

- **Trial-anchored (clinical):** Trial Start (`a0..011`), Trial End (`a0..012`), Primary Completion (`a0..008`), Topline Data (`a0..013`). One set per trial.
- **Asset-anchored (regulatory/commercial):** Regulatory Filing (`a0..032`), Approval (`a0..035`), Launch (`a0..036`), Distribution (`a0..040`), LOE Date (`a0..020`). Authored **per asset, per real milestone**. An asset may legitimately carry several (e.g. Zepbound: obesity approval, OSA label-expansion approval, launch, distribution) - never the *same* milestone twice. Assets are looked up from `_seed_ids` with `entity_type='product'`; events insert with `anchor_type='asset'`.
- **Company-anchored (corporate):** Financial (`a0..060`), Leadership Change (`a0..050`), Strategic (`a0..070`), and M&A (modeled as Strategic). Unchanged level.

This single rule fixes findings 1 and 4 (the EMPACT-MI Approval moves to the Jardiance asset lane, off the trial topline) and removes the cross-trial fan-out source of finding 2.

### 2. Dedup - one event per fact

- The combined/many-to-many filings collapse to **one** asset-anchored event (e.g. one "Zepbound HFpEF sNDA filing" on the tirzepatide asset, not one per contributing trial).
- `_seed_demo_recent_activity` and `_seed_demo_activity_variety` stop creating *new* topline fact-events that duplicate projected ones. The "upcoming catalysts (next ~14 days)" surface instead reads the handful of projected toplines that the date strategy (section 3) places just ahead of today - single source of truth. The CT.gov change-feed rows in `trial_change_events` (a different table, the Activity feed) are retained; they are not duplicate event markers.
- Invariant after remodel: no two events in a seeded space share the same `title`.

### 3. Evergreen dates (all relative to today)

Author every event date against a fixed reference constant `R := date '2026-06-29'` (the dataset's intended "now", which equals the authoring date), so historical events fall before `R` and projected events after it, preserving the exact intended shape and past/future split. Then a single pass at the end of the orchestrator shifts the whole space:

```sql
update public.events
   set event_date = current_date + (event_date - date '2026-06-29'),
       end_date   = case when end_date is not null
                         then current_date + (end_date - date '2026-06-29')
                         else null end
 where space_id = p_space_id;
```

At seed time today the shift is zero (dates render exactly as authored, and the real historical dates - e.g. Wegovy approval 2021-06-04 - are accurate); on any future day the entire timeline slides forward so projected markers stay ahead of the today line forever. Historical dates drift forward over time (accepted: this is "all relative to today"). Because all producers author against `R` (the recent-activity events become `R + interval`, not `current_date + interval`), the single shift applies uniformly with no double-shift. The shift is the only change to the orchestrator; its gating and idempotency are untouched.

### 4. Projection-source variety

Assign `projection` by provenance so all four tiers appear, across anchor levels:

- **`actual`** - everything historical (filled glyph, no badge).
- **`primary`** - projected dates from a primary source. For trials this is the CT.gov registry estimate (renders as plain hollow, no letter - today's behavior); for **asset/company** events it is a non-registry primary source (a company filing, primary research) and should badge **`p`** (frontend follow-up renders the letter).
- **`company`** - readouts/filings the company has guided to (hollow + `c`). e.g. "Lilly guides ATTAIN-1 topline."
- **`forecasted`** - Clint's own estimates: projected LOE dates, launch windows, far-out toplines (hollow + `f`, dashed, dimmed). Used on asset and company events too.

Concretely a single asset lane (e.g. Zepbound) demonstrates the full vocabulary: a filled `actual` approval, a `c`-guided projected filing, a `p`-sourced projected milestone, and an `f`-forecasted LOE.

### 5. Curated corporate visibility

Company-band events default to low significance = feed-only (no glyph) per the spec. For the demo, **pin** the high-impact corporate events so they glyph on the band (`visibility='pinned'`): the Roche/Carmot acquisition (Strategic/M&A), the major Lilly/Novo financial beats (Financial), one leadership change (Leadership). Leave at least two corporate events **unpinned** (feed-only) so the demo also shows that state. The band stays readable rather than dense.

## Scope and Structure

- **One new migration** in the seed lane, numbered clear of develop's current tip (`20260629070000` is highest; use `20260629080000`+). It `create or replace`s the affected helpers, each based on its **live** `pg_get_functiondef` definition:
  - `_seed_demo_markers` - split into trial-anchored clinical events and asset-anchored regulatory/commercial events; dedup fan-outs; author dates against `R`; assign projection tiers.
  - `_seed_demo_events` - corporate company-band events (curated pinned + feed-only) and any asset-level commercial events; author against `R`; projection variety. Re-anchor the "Wegovy SELECT label update" Approval from company to the Wegovy asset.
  - `_seed_demo_recent_activity` - stop minting duplicate topline fact-events; author against `R`.
  - `_seed_demo_activity_variety` - drop the duplicate topline events; keep the CT.gov `trial_change_events` rows; author any dates against `R`.
  - `seed_demo_data` orchestrator - add only the final date-shift pass (section 3); gating/idempotency unchanged.
- The producers keep their existing inline SECURITY DEFINER insert pattern (they must work for a platform-admin caller, for whom `create_event`'s write-side `has_space_access` check fails). They do **not** call or redefine `create_event`.
- Remote-safe in-file smoke (skips on a non-seeded db, self-cleans its scratch space, no unguarded gated-RPC calls), ending with `notify pgrst, 'reload schema'`.

## Testing

Extend `seed-demo-feature-coverage.spec.ts` to assert the remodel invariants on a fresh owner-seeded space:

- **Lane correctness:** zero Approval/Launch/LOE/Distribution/Regulatory-Filing events anchored to a trial or a company (all must be on assets); zero Financial/Leadership/Strategic events anchored to a trial or asset (all must be on companies); clinical types (Trial Start/End, Primary Completion, Topline) only on trials.
- **No duplicates:** no two events share the same `title` in the space.
- **Evergreen:** zero events with `projection <> 'actual'` and `event_date < current_date`.
- **Projection variety:** at least one event of each tier `primary`, `company`, `forecasted` exists on asset and/or company anchors (specifically: >=1 asset/company event with `projection='primary'`, >=1 with `'forecasted'`).
- **Corporate visibility:** >=1 pinned company event and >=1 feed-only (null-visibility, low-sig) company event.
- **Asset-lane coverage (retained from the merged work):** >=2 assets with both an Approval and a Distribution; a visible approval->distribution gap.

Update `event-producers.integration.spec.ts` to the new anchors (the multi-source business events and any title/anchor assertions move with the re-author). Keep `role-access.spec.ts` green (gating unchanged).

## Frontend follow-up (separate task, not this spec)

Tracked separately so this remains a clean DB change:

1. **Legend glyphs:** the marker-guide legend must render the glyph for every event type, including Commercial/Distribution (hexagon), Financial, Leadership, Strategic.
2. **`p` badge:** `marker-visual.ts` currently renders `null` for all `primary` projections. Change it to emit `p` for `primary` on **non-trial** anchors (asset/company), while trial `primary` stays badge-less (the CT.gov registry default). This makes the `primary` tier visible on asset/company events as the seed now produces them.

## Coordination

Parallel sessions share one local Supabase DB and coordinate via `~/.clint-coordination/` (DB token, migration lanes). Branch off current `origin/develop`, own worktree `.worktrees/seed-demo-remodel`, symlinked `node_modules`. Take the DB token before any `db reset` / integration run; serialize. Number the migration clear of any in-flight lane.
