# Unified "recent change" indicator — design

Date: 2026-05-29
Status: Approved (brainstorm), pending implementation plan

## Problem

The product shows a "recent change" affordance on multiple surfaces, but it is two
unrelated mechanisms that look identical to the user:

1. **Trial dot** (timeline grid, catalysts table, bullseye detail panel) — a slate/red
   dot driven by `get_dashboard_data()`, counting rows in `trial_change_events` within a
   **7-day** window, carrying a `most_recent_change_type` and a red/slate priority split.
2. **Bullseye asset activity flag** — a boolean `has_recent_activity` from
   `get_bullseye_assets()`, computed from the latest **marker** event date within a
   **30-day** window. No type, no priority.

The two diverge on every axis: window (7 vs 30 days), data source (`trial_change_events`
vs raw marker dates), shape (count+type vs boolean), and richness (priority vs none).
An analyst sees what looks like the same "recent" signal mean different things on
different screens. For an instrument that sells itself on precision against Bloomberg /
Evaluate / Citeline, an inconsistent "recent" is a credibility leak.

There is also a real gap: **asset-level changes are not tracked anywhere.**
`trial_change_events` is strictly trial-scoped (`trial_id not null`, no `asset_id`), fed
only by CT.gov diffs and marker edits. Asset field edits (mechanism, route, name) go
through `update_asset_*` RPCs that log nothing to any change stream. The only timestamped
asset-native signal is published intelligence notes (`primary_intelligence`,
`entity_type = 'asset'`).

## Goal

One definition of "recent," computed server-side, rendered by one shared neutral dot, so
the signal means exactly the same thing on every surface.

The indicator's job is triage: it directs the analyst's eye to "what moved since I last
looked" before they read anything. It is not a priority classifier and not an audit log.

## Definition

**Recent = within 14 days.** What counts as a change is uniform across entities:

> A material change event on the entity (`trial_change_events`) **OR** a published
> intelligence note about the entity (`primary_intelligence`, `state = 'published'`),
> with timestamp within the window.

Applied per entity:

- **Trial** (timeline, catalysts, bullseye detail panel):
  `trial_change_events` for the trial **+** published `primary_intelligence` where
  `entity_type = 'trial'` and `entity_id = trial.id`.
- **Asset** (bullseye rings / tooltip): the full rollup of everything beneath the asset:
  - `trial_change_events` for all of the asset's trials, **plus**
  - published `primary_intelligence` for all of the asset's trials
    (`entity_type = 'trial'`, `entity_id in (asset's trial ids)`), **plus**
  - published `primary_intelligence` for the asset itself
    (`entity_type = 'asset'`, `entity_id = asset.id`).

The asset count therefore equals the sum of its trials' counts plus its own asset-level
published intel — a clean rollup with no double counting.

### Decisions locked during brainstorm

- **Window:** 14 days everywhere (compromise between the old 7-day trial and 30-day
  bullseye windows; survives a two-week review gap without 30-day noise).
- **No priority:** the red/slate "act now" split is removed. The dot is a single neutral
  slate dot everywhere. (This removes existing timeline/catalysts behavior, intentionally.)
- **Count only:** the signal is a count + an informational most-recent type for the
  tooltip. No boolean-only surface remains.
- **Published intel only:** draft notes do not light the dot. (The separate
  `intelligence_count` metric on the bullseye still counts drafts; that is out of scope
  and unchanged.)
- **Symmetry:** trial-level published intel counts toward a trial's dot, so the rule is
  uniform across trials and assets rather than "trials = detected changes only, assets =
  changes + intel."

## Architecture

### 1. Single source of truth for the window

```sql
create function public.recent_change_window()
  returns interval
  language sql
  immutable
as $$ select interval '14 days' $$;
```

Both RPCs reference `now() - public.recent_change_window()`. Changing the window later is
a one-line edit, not a hunt across subsystems. The window is computed server-side only;
no client-side constant is needed because the count is always returned by the RPC.

### 2. `get_dashboard_data()` — trial counts (timeline / catalysts / bullseye detail)

The existing `recent` lateral over `trial_change_events` is extended to add published
trial-level intel and to use the window function:

```sql
left join lateral (
  select
    (
      coalesce((
        select count(*)
        from public.trial_change_events e
        where e.trial_id = t.id
          and e.observed_at >= now() - public.recent_change_window()
      ), 0)
      +
      coalesce((
        select count(*)
        from public.primary_intelligence pi
        where pi.entity_type = 'trial'
          and pi.entity_id = t.id
          and pi.space_id = t.space_id
          and pi.state = 'published'
          and pi.updated_at >= now() - public.recent_change_window()
      ), 0)
    ) as recent_changes_count,
    -- most recent type across both sources; intel rows report a synthetic
    -- 'intelligence_published' type so the tooltip can label them.
    ( ... most-recent-across-both ... ) as most_recent_change_type
  ...
) recent on true
```

`recent_changes_count` and `most_recent_change_type` field names and JSON shape are
unchanged, so no consumer model changes are required for trials.

`most_recent_change_type` resolution: take the most recent row across the two sources by
timestamp (`observed_at` for change events, `updated_at` for intel). Intel rows surface a
synthetic type `intelligence_published` mapped to the label "New intelligence" in the
badge component.

### 3. `get_bullseye_assets()` — asset rollup

Replace the marker-based `asset_activity` CTE entirely:

```sql
asset_activity as (
  select
    fa.asset_id,
    (
      coalesce((
        select count(*)
        from public.trial_change_events e
        join public.trials t on t.id = e.trial_id
        where t.asset_id = fa.asset_id
          and t.space_id = p_space_id
          and e.observed_at >= now() - public.recent_change_window()
      ), 0)
      +
      coalesce((
        select count(*)
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
          and pi.updated_at >= now() - public.recent_change_window()
          and (
            (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
            or (pi.entity_type = 'trial' and pi.entity_id in (
                  select t.id from public.trials t
                  where t.asset_id = fa.asset_id and t.space_id = p_space_id
               ))
          )
      ), 0)
    ) as recent_changes_count,
    ( ... most-recent type across the same union ... ) as most_recent_change_type
  from filtered_assets fa
)
```

Output object changes:
- `has_recent_activity` → `recent_changes_count > 0`.
- Add `recent_changes_count` and `most_recent_change_type`.
- Drop the marker-derived `latest_event_date` / `latest_event_type` from the **activity
  signal**. (If those fields are used elsewhere in the tooltip for non-activity display,
  that usage is migrated to the new fields; see Frontend.)

### 4. `ChangeBadgeComponent` — neutral dot

`src/client/src/app/shared/components/change-badge/change-badge.component.ts`

- Remove `PRIORITY_TYPES` and the priority branch in `dotClass`; the dot is always
  `inline-block w-2 h-2 rounded-full bg-slate-400`.
- Add `intelligence_published: 'New intelligence'` to `TYPE_LABELS`.
- Tooltip: drop the "Priority update in last 7 days" phrasing. Becomes
  `"Recent change"` / `"Recent change: <type label>"`, with `(+N other changes)` when
  count > 1. Wording references the unified concept, not a hardcoded "7 days."
- Inputs (`count`, `type`) and template are otherwise unchanged. It remains purely
  presentational.

### 5. Frontend wiring

- **Timeline** (`dashboard-grid.component.html`), **catalysts**
  (`catalyst-table.component.ts`), **bullseye detail panel**
  (`bullseye-detail-panel.component.html`): no change — they already bind
  `recent_changes_count` / `most_recent_change_type` to `ChangeBadgeComponent`.
- **Bullseye tooltip** (`bullseye-tooltip.component.ts`): the activity line, currently
  driven by `has_recent_activity` + marker `latest_event_type`, is rewired to the new
  `recent_changes_count` / `most_recent_change_type`. Consider rendering the shared
  `ChangeBadgeComponent` here for full visual consistency (decide during implementation).
- **Landscape model** (`landscape.model.ts`): update the asset type to add
  `recent_changes_count` / `most_recent_change_type` and remove the dropped marker
  activity fields if they are no longer referenced.

### Out of scope

- The engagement-landing intelligence feed "X this week" tag
  (`engagement-landing.component.ts`, `recentCount(rows, 7)`). It answers a different
  question (count of feed posts this week) where "week" literally means 7 days. Left
  unchanged.
- Logging asset field edits (mechanism / route / name) into a change-events stream. Rare
  curation edits, low triage value, and would require new infrastructure (an
  `entity_change_events` generalization with triggers). Explicitly deferred.
- The bullseye `intelligence_count` metric (counts drafts) — unrelated, unchanged.

## Performance

- `trial_change_events (trial_id, observed_at desc)` covers the per-trial windowed count.
- `primary_intelligence (entity_type, entity_id)` covers the per-entity intel lookup; the
  `state` and `updated_at` predicates filter a small result set. Adequate at current
  scale; no new index required. If the bullseye asset query becomes hot, an index on
  `(entity_type, entity_id, state, updated_at desc)` is the follow-up.

## Testing

Tests are paired with each change, not deferred.

- **SQL smoke migration** (new, following the existing `*_smoke.sql` pattern):
  - In both RPCs, an event/note dated 13 days ago counts and one dated 15 days ago does
    not (asserts the 14-day window via `recent_change_window()`).
  - The bullseye asset count lights from (a) a trial change event on one of its trials,
    (b) a published asset-level intel note, and (c) a published trial-level intel note on
    one of its trials.
  - A **draft** intel note does **not** light the asset count.
  - The asset count equals the sum of its trials' counts plus its own asset-level intel
    (rollup correctness, no double count).
- **`change-badge` Vitest spec** (`change-badge.component.spec.ts`):
  - count 0 → nothing renders.
  - count > 0 → exactly one dot with `bg-slate-400`; never red under any `type`.
  - `type = 'intelligence_published'` → tooltip reads "New intelligence".
  - count > 1 → tooltip includes the `(+N other changes)` suffix.

## Verification

```bash
cd src/client && ng lint && ng build
supabase db reset            # runs the new smoke migration
supabase db advisors --local --type all
npm run docs:arch            # RPC bodies changed
```

## Runbook / docs impact

- `get_dashboard_data` and `get_bullseye_assets` bodies change → `npm run docs:arch`
  regen (`06-backend-architecture.md`).
- New `recent_change_window()` function appears in the RPC/function inventory.
- If a help page documents the "recent change" dot, update its FAQ/prose (per the help
  drift rules) to state the 14-day, unified, no-priority behavior.
