---
id: spec-2026-events-feed-ordering
title: Events feed ordering and time display
slug: events-feed-ordering
status: draft
created: 2026-05-28
updated: 2026-05-28
---

# Events feed ordering and time display

## Summary

The Events page's unified feed currently sorts by a date-only column (`event_date`) with a random-UUID tiebreaker. Same-day rows arrive in non-deterministic order, so a `marker_updated` row can appear above the `marker_added` row that produced it. The displayed "Date" column also means three different things across the three feed legs, so users cannot reason about ordering from what they see.

This spec replaces the sort key and the displayed date with a single, leg-consistent feed timestamp (`feed_ts`), shows time-of-day alongside the date, and moves each leg's domain date (event date, catalyst date) into the title where it is already done for detected rows.

## Motivation

1. **Ordering correctness.** Within a single calendar day the current `ORDER BY uf.event_date DESC, uf.id DESC` produces effectively random order, because ids are random UUIDs (not UUIDv7) and `event_date` is `date`, not `timestamptz`. Three rows triggered by one user editing a marker show up scrambled.
2. **Visible reason for the order.** Every detected row in the screenshot shows `May 28, 2026` with no further granularity. Users cannot tell from the UI why one beats another.
3. **One column, three meanings.** The "Date" column today holds `ev.event_date` for events, `m.event_date` for markers, and `ce.occurred_at::date` for detected rows. These are different concepts (a future meeting date, a future catalyst date, the date a CT.gov change was observed). The column header gives no hint of which.

## Scope

- The unified feed RPC `get_events_page_data`. The current definition is `supabase/migrations/20260528050000_feed_rpcs_prefer_trial_acronym.sql` (which supersedes `20260527120100_events_rpc_unified_feed.sql`). The new migration in this spec must come after it and replace the function in full (`create or replace`), not edit either file.
- The marker change-events trigger in `supabase/migrations/20260502120700_marker_changes_trigger.sql` (payload additions for `marker_updated` and `marker_reclassified`, applied via a new migration).
- The Events page Angular component:
  - `src/client/src/app/features/events/events-page.component.ts` (sort field, FeedItem mapping)
  - `src/client/src/app/features/events/events-page.component.html` (date column rendering)
- The shared change-event title formatter:
  - `src/client/src/app/shared/utils/change-event-summary.ts` (already inlines context for many types; extend marker_added/marker_updated to include the marker's catalyst date)
- The events-detail right rail is unchanged. It renders its own layout from the selected row's full record and does not depend on the table's sort key or column rendering.

## Design

### Server: introduce `feed_ts` as the sort column

Add a new column to each leg's projection in the `unified_feed` CTE. The existing `event_date` column stays in the result for backward compatibility with date-range filters and any consumer reading it.

| Leg | Existing `event_date` source (kept) | New `feed_ts` source |
|---|---|---|
| events | `ev.event_date` (date) | `ev.created_at` (timestamptz) |
| markers | `m.event_date` (date) | `m.created_at` (timestamptz) |
| detected | `ce.occurred_at::date` (date) | `ce.observed_at` (timestamptz) |

Change the sort:

```sql
order by uf.feed_ts desc, uf.id desc
```

`id` remains as a deterministic tiebreaker for sub-microsecond ties.

`p_date_from` / `p_date_to` change to filter on `feed_ts::date` for all three legs, so the filter agrees with the column it sits under ("Logged"). A user picking May 28 from the date filter means "rows logged on May 28", matching the column meaning. The filter UI itself (PrimeNG `p-column-filter type="date"`) is unchanged; only the field it binds to and the RPC's WHERE clause shift.

### Server: trigger payload additions

The detected title rendering happens client-side via `summarySegmentsFor` from `change_payload`. The RPC's own `case ce.event_type ... end as title` fallback is only used by callers that don't render rich segments and is not changed here.

The marker change-events trigger needs payload additions so the client can render the catalyst date on `marker_updated` and `marker_reclassified` rows (see the Client section below for the matching formatter change):

```sql
-- in 20260502120700_marker_changes_trigger.sql, superseded by a new migration:
-- marker_updated branch:
v_payload := jsonb_build_object(
  'changed_fields', to_jsonb(v_changed_fields),
  'event_date',     v_new->>'event_date'
);
-- marker_reclassified branch:
v_payload := jsonb_build_object(
  'from_type_id', v_old_type,
  'to_type_id',   v_new_type,
  'event_date',   v_new->>'event_date'
);
```

Existing rows in `trial_change_events` whose payloads predate this change will simply render without the date suffix; the formatter handles a missing `payload.event_date` by returning an empty segment list. No backfill required.

### Client: rename sort field, render date + time

`events-page.component.ts`:

- `defaultSort` field changes from `event_date` to `feed_ts`. Order stays `-1` (descending).
- `FeedItem` gets a `feed_ts: string` field. The existing `event_date` field is retained.
- `getDetectedSummary` builds its stub from `feed_ts` for `observed_at` (instead of `event_date`), since the stub's purpose is to feed `summarySegmentsFor`, which uses `occurred_at` for context but does not rely on `event_date` for layout.

`events-page.component.html`:

- The date `<th>` sortable field and column-filter field both become `feed_ts`; the label becomes **Logged**.
- The body cell stacks date over time:

  ```html
  <td class="col-date text-xs tabular-nums text-slate-500">
    <div>{{ item.feed_ts | date: 'MMM d, y' }}</div>
    <div class="text-[10px] uppercase tracking-wider text-slate-400">
      {{ item.feed_ts | date: 'h:mm a' }}
    </div>
  </td>
  ```

  The time line uses the brand's mono/tabular caption style, matching the data-instrument aesthetic.

### Client: move domain date into the title

For events and markers, the user-supplied `event_date` is currently visible only via the date column. Once that column shows feed time, the domain date needs a new home.

- For **events** (source_type = 'event'), append `· {{ event_date | shortDate }}` to the title in the table body cell when `event_date` differs from `feed_ts::date`. When they are the same day, omit the suffix to avoid noise.
- For **markers** (source_type = 'marker'), same treatment with the catalyst date.
- For **detected** rows, the existing `markerContextSegments` helper in `change-event-summary.ts` (line 221) already renders `· {{ payload.event_date }}` as a muted segment. Today it is invoked by `marker_added`, `marker_removed`, and `projection_finalized`. Two gaps:
  1. **Formatter:** `marker_updated` (line 454) and `marker_reclassified` (line 470) cases do **not** call `markerContextSegments`. Extend both to push its segments before returning.
  2. **Trigger payload:** `supabase/migrations/20260502120700_marker_changes_trigger.sql` builds the `marker_updated` payload (line 249) with only `changed_fields`, and `marker_reclassified` (line 206) with only `from_type_id`/`to_type_id`. Add `'event_date': v_new->>'event_date'` to both. The trigger updates require a new migration, not edits to the existing one.

After both changes, "Marker edited: description · May 29, 2026" and "Reclassified: X → Y · May 29, 2026" render consistently with the existing marker_added rows.

### Edge cases

1. **Missing `observed_at` on legacy detected rows.** Older `trial_change_events` may have a null `observed_at` if the column was added after the row. Fall back to `occurred_at` (already a non-null timestamptz on every detected row). Encode this in the RPC: `coalesce(ce.observed_at, ce.occurred_at) as feed_ts`.
2. **Timezone.** All three legs store timestamptz. Render in the browser's local zone via Angular's date pipe (default). No server-side zone math.
3. **Same-second ties across legs.** The `id desc` tiebreaker remains. Tied rows order deterministically, even if not semantically. Sub-second ties are not user-perceivable.
4. **Date-range filter semantics shift.** The filter now means "logged on this date" instead of "event date is on this date". This is the intentional consequence of the column-meaning change and matches what users will expect from a column labeled "Logged".

## Verification

```bash
cd src/client && ng lint && ng build
supabase db reset
supabase db advisors --local --type all
```

Manual checks on the Events page:

1. Trigger a marker add followed by a marker edit within the same minute. Confirm the edit row appears above the add row when sorting newest-first, and below when sorting oldest-first.
2. For an `events` leg row whose `event_date` is in the future (e.g., an FDA AdCom logged today), confirm the `Logged` column shows today's timestamp and the title includes `· Jun 12, 2026` (or whatever the meeting date is).
3. Apply a date-range filter that includes the logged date but excludes the event_date (e.g. for an event logged today with event_date next month). Confirm the row appears, since the filter is on feed_ts.
4. Hover the column header sort indicator: it must read **Logged**, not Date.

## Out of scope

- Changing the event-detail right rail.
- Backfilling `observed_at` for legacy `trial_change_events`. The coalesce in `feed_ts` covers them.
- Showing relative times ("2 min ago"). Absolute times match the precise/authoritative voice of the brand.
