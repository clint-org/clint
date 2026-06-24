# Remove the "high" tier from detected events

**Date:** 2026-06-24
**Status:** Approved (design)

## Problem

In the events feed, detected (CT.gov-derived) change rows are auto-classified as
`priority = 'high'` by an opaque rule in the `get_events_page_data()` RPC. A row is
"high" when it is a phase transition, a trial withdrawal, a sponsor change, a status
change into a terminal state (COMPLETED / TERMINATED / WITHDRAWN / SUSPENDED), or a
date shift of more than 60 days. Everything else is silent.

This reads as inconsistent rather than intentional: a 75-day slip is "high" while a
55-day slip shows nothing, and a non-terminal status change is silent, with no
on-screen explanation of the threshold. The product is competitive intelligence for
pharma analysts who review these rows under time pressure; an arbitrary-looking
machine judgment is worse than none. The decision is that **detected changes should
read uniformly and the analyst decides what matters**. The automated "high" tier on
detected rows is removed.

## Scope

- **In scope:** Remove the `'high'` priority classification from the *detected* leg of
  the feed only, and remove every UI surface that renders that detected "high"
  indicator.
- **Out of scope (unchanged):** Authored events keep their user-settable priority. An
  event author still chooses High/Low via the Priority dropdown in
  `event-form.component.ts` / the `create_event` RPC `p_priority` param, backed by the
  `events.priority` column (`check (priority in ('high','low'))`, default `'low'`).
  The authored "High priority" pill, the red detail-panel banner, and markers (which
  always return `null` priority) are untouched.

## Background: where priority lives today

`get_events_page_data()` (current definition:
`supabase/migrations/20260623130000_fix_detected_date_moved_title.sql`) is a UNION of
three legs:

1. **events** leg — `priority` reads the stored `ev.priority` column (user-settable).
2. **markers** leg — `priority` is always `null`.
3. **detected** (`trial_change_events`) leg — `priority` is computed by a `CASE`
   expression on `event_type` / payload (the block being removed).

The detected "high" indicator is rendered in two components plus the export:

- `events-page.component.html`
  - line ~148: left-border highlight when `source_type === 'detected' && priority === 'high'`
  - lines ~313-315: status-column red "High" pill in the `@case ('detected')` block
- `event-detail-panel.component.html`
  - line ~206: detected-specific "High signal" pill
- `events-export.util.ts` (line ~57): Priority column maps `priority === 'high' ? 'High' : 'Low'`

Priority is not rendered anywhere outside the events feature (no dashboard, trial
detail, catalyst, or global badge references it).

## Design

### 1. SQL — stop computing detected priority

Add a new migration (we never edit applied migrations) that recreates
`get_events_page_data()` as a faithful copy of the current definition in
`20260623130000_fix_detected_date_moved_title.sql`, with one change: the detected
leg's

```sql
case
  when ce.event_type = 'phase_transitioned' then 'high'
  when ce.event_type = 'trial_withdrawn'    then 'high'
  when ce.event_type = 'sponsor_changed'    then 'high'
  when ce.event_type = 'status_changed'
    and upper(ce.payload ->> 'to') in ('COMPLETED','TERMINATED','WITHDRAWN','SUSPENDED')
    then 'high'
  when ce.event_type = 'date_moved'
    and (ce.payload ->> 'days_diff') ~ '^-?\d+$'
    and abs((ce.payload ->> 'days_diff')::int) > 60
    then 'high'
  else null
end::text as priority,
```

becomes

```sql
null::text as priority,
```

The `priority` column stays in the return shape (the events leg still uses it); the
detected leg simply always emits `null`.

The detected leg also has a **second copy** of the same `CASE` in its `WHERE` clause,
implementing the `p_priority` filter (the `and ( p_priority is null or p_priority =
case … end )` block). Since detected rows can no longer carry a priority, this becomes
`and (p_priority is null)` — i.e. detected rows are excluded whenever any priority
filter is active, exactly matching the markers leg (`and (p_priority is null)`). A user
filtering by "high" sees only authored high-priority events; detected rows, having no
priority, correctly drop out.

The function signature (argument list and returned columns) is unchanged, so no
PostgREST schema reload is strictly required, but end the migration with
`notify pgrst, 'reload schema';` per project convention for RPC body changes.

Naming: `YYYYMMDDHHmmss_remove_detected_event_priority.sql`.

### 2. Template — events-page.component.html

- Remove the detected+high left-border rule (line ~148) so detected rows have no
  conditional border.
- In the `@case ('detected')` block, remove the now-unreachable
  `@else if (item.priority === 'high') { <app-detail-panel-pill tone="red">High</app-detail-panel-pill> }`
  branch (lines ~313-315). Keep the `detectedShift()` amber shift chip exactly as is.
- The authored `@default` block's "High" pill is untouched.

### 3. Template — event-detail-panel.component.html

- Remove the detected "High signal" pill (line ~206), which can no longer fire.
- The authored "High priority" metadata pill and red banner are untouched.

### 4. Incidental behavior (no code change)

- `highPriorityCount` (`event-detail-panel.component.ts`) will now count only authored
  high-priority items, since detected rows can no longer be high. This is correct;
  leave it.
- The Excel export maps any non-high priority to `'Low'`, so detected rows will export
  as `'Low'` across the board. This matches today's behavior for the (previously
  majority) non-high detected rows; leave it unchanged.

### 5. Tests

- Update any integration test asserting detected priority is `'high'` to assert
  `null` (search the integration suite for `priority` / `'high'` against detected
  fixtures, e.g. phase_transitioned / date_moved with large `days_diff`).
- Update any component / detail-panel spec that asserts the removed detected pills or
  border.
- Authored-event priority tests stay green and unchanged.

## Net effect

- Date moves still show their magnitude chip ("75d later", "30d earlier") in the
  status column — that is factual data, not a tier.
- Every other detected row shows just its description and type, with no status-column
  pill, no left border, and no detail-panel "High signal" pill.
- Authored events are completely unaffected: authors still set High/Low and it still
  renders as the red "High priority" pill and banner.

## Verification

- `cd src/client && ng lint && ng build`
- `supabase db reset` then `supabase db advisors --local --type all`
- Integration suite for the events feed RPC.
- Manual: load the events feed and a detected `date_moved` detail; confirm no red
  "High"/"High signal" pill on detected rows, shift chip still present, authored
  high-priority event still shows its pill and banner.
