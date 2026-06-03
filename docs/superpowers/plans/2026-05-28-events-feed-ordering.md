# Events Feed Ordering and Time Display Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Events page feed deterministically time-ordered by arrival, show date + time-of-day in the leftmost column, and move each leg's underlying date into the row title so column meaning is consistent across all three feed legs.

**Architecture:** Server-side, the `get_events_page_data` RPC gets a new `feed_ts` (`timestamptz`) column on each leg (events: `created_at`, markers: `created_at`, detected: `coalesce(observed_at, occurred_at)`); ORDER BY and date-range filtering both switch to `feed_ts`. The marker change-events trigger payload gains `event_date` for `marker_updated` and `marker_reclassified` so the client formatter can render the catalyst date suffix consistently across all marker-related detected rows. Client-side, `FeedItem` gets `feed_ts`, the events table renames its date column to "Logged" and stacks date over time, and event/marker rows inline `· {event_date}` into the title when it differs from the logged date.

**Tech Stack:** PostgreSQL (Supabase migrations), Angular 19 standalone, PrimeNG 21, Vitest for pure-helper unit tests, inline `DO $$` smoke tests in migrations.

**Spec:** `docs/superpowers/specs/2026-05-28-events-feed-ordering-design.md`

---

## File map

**Create:**
- `supabase/migrations/20260528120000_marker_change_payload_event_date.sql` — re-declares `fn_record_marker_change` to add `event_date` to `marker_updated` and `marker_reclassified` payloads; inline smoke asserts both fields appear.
- `supabase/migrations/20260528120100_events_feed_sort_by_feed_ts.sql` — `create or replace function public.get_events_page_data(...)` with `feed_ts` column per leg, new ORDER BY, shifted date-range filter, and new field in the returned jsonb; inline smoke asserts within-day ordering follows `feed_ts`.
- `src/client/src/app/shared/utils/change-event-summary.spec.ts` — new Vitest suite covering the `marker_added`, `marker_updated`, `marker_reclassified`, `projection_finalized` rendering, with one test each that asserts `· {event_date}` appears (or is absent when payload is missing the field).

**Modify:**
- `src/client/src/app/shared/utils/change-event-summary.ts:454-468` — `marker_updated` case pushes `markerContextSegments(e, p)`.
- `src/client/src/app/shared/utils/change-event-summary.ts:470-484` — `marker_reclassified` case pushes `markerContextSegments(e, p)`.
- `src/client/src/app/core/models/event.model.ts:63-86` — add `feed_ts: string` to `FeedItem`.
- `src/client/src/app/features/events/events-page.component.ts:130-188` — change column `field: 'event_date'` to `field: 'feed_ts'`, header `'Date'` to `'Logged'`, and `defaultSort.field` from `'event_date'` to `'feed_ts'`.
- `src/client/src/app/features/events/events-page.component.ts:223-246` — update `getDetectedSummary` stub to source `observed_at` from `item.feed_ts` when populated.
- `src/client/src/app/features/events/events-page.component.html:30-33` — change the date `<th>` `pSortableColumn` and `p-column-filter` `field` from `event_date` to `feed_ts`, header text to `Logged`.
- `src/client/src/app/features/events/events-page.component.html:118-124` — replace the single-line date cell with a stacked date + time block; add a small `formatLoggedSuffix(item)` helper invocation for event/marker titles that injects `· {event_date}` when it differs from `feed_ts::date`.
- `src/client/src/app/features/events/events-page.component.ts` — add the `formatLoggedSuffix` protected helper.

**Do not touch:**
- `src/client/src/app/features/events/event-detail-panel.component.ts` — right rail; spec marks it unchanged.
- `src/client/src/app/core/services/event.service.ts` — RPC param shape is unchanged; only the returned row picks up the new `feed_ts` field.

---

## Task 1: Extend marker change-events trigger payload

Adds `event_date` to `marker_updated` and `marker_reclassified` payloads so the client formatter has the value to render. The trigger function is replaced in full because Postgres functions are immutable in place; the existing `20260502120700_marker_changes_trigger.sql` stays untouched.

**Files:**
- Create: `supabase/migrations/20260528120000_marker_change_payload_event_date.sql`

- [ ] **Step 1: Read the existing trigger function**

Run: `sed -n '60,260p' supabase/migrations/20260502120700_marker_changes_trigger.sql`

Confirm the `marker_updated` branch (around line 248) and `marker_reclassified` branch (around line 204) build `v_payload` without `event_date`.

- [ ] **Step 2: Write the new migration with a `create or replace function` and inline smoke**

```sql
-- 20260528120000_marker_change_payload_event_date.sql
-- Add event_date to marker_updated and marker_reclassified payloads so the
-- events feed can render the catalyst date suffix consistently across all
-- marker-related detected rows. The trigger itself is unchanged; only the
-- jsonb_build_object calls in two branches gain one key each.

create or replace function public.fn_record_marker_change()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  -- (preserve all locals from 20260502120700_marker_changes_trigger.sql)
  v_event_type     text;
  v_payload        jsonb;
  v_secondary      jsonb := '{}'::jsonb;
  v_old            jsonb;
  v_new            jsonb;
  v_old_event_date date;
  v_new_event_date date;
  v_old_end_date   date;
  v_new_end_date   date;
  v_old_proj       text;
  v_new_proj       text;
  v_old_type       uuid;
  v_new_type       uuid;
  v_old_title      text;
  v_new_title      text;
  v_old_descr      text;
  v_new_descr      text;
  v_days_diff      integer;
  v_direction      text;
  v_changed_fields text[];
begin
  -- The full body is identical to the existing function with two changes:
  --
  -- 1. marker_updated branch (originally the `elsif v_old_title is distinct
  --    from v_new_title ...` block) appends event_date to its payload:
  --
  --   v_payload := jsonb_build_object(
  --     'changed_fields', to_jsonb(v_changed_fields),
  --     'event_date',     v_new->>'event_date'
  --   );
  --
  -- 2. marker_reclassified branch (originally the `elsif v_old_type is
  --    distinct from v_new_type` block) appends event_date to its payload:
  --
  --   v_payload := jsonb_build_object(
  --     'from_type_id', v_old_type,
  --     'to_type_id',   v_new_type,
  --     'event_date',   v_new->>'event_date'
  --   );
  --
  -- Copy the rest of the function verbatim from the existing migration.
  -- DO NOT edit any other branch; DO NOT change the trigger registration.
  ...
end;
$$;
```

The placeholder `...` above is intentional — the engineer must paste the unchanged body from `20260502120700_marker_changes_trigger.sql` lines 60-340 (the body of the function) with the two `jsonb_build_object` edits applied. Do NOT introduce other changes. If you find yourself modifying anything else, stop and reread this task.

- [ ] **Step 3: Append an inline smoke test**

Add this `DO $$` block at the end of the same migration file:

```sql
do $$
declare
  v_space_id uuid;
  v_trial_id uuid;
  v_marker_id uuid;
  v_type_a uuid;
  v_type_b uuid;
  v_updated_payload jsonb;
  v_reclassified_payload jsonb;
begin
  -- pick any space/trial/marker_types for the smoke; use the first row each
  select id into v_space_id from public.spaces limit 1;
  select id into v_trial_id from public.trials where space_id = v_space_id limit 1;
  select id into v_type_a from public.marker_types limit 1;
  select id into v_type_b from public.marker_types where id <> v_type_a limit 1;

  if v_space_id is null or v_trial_id is null or v_type_a is null or v_type_b is null then
    raise notice 'marker payload smoke: skipped (seed data not present)';
    return;
  end if;

  insert into public.markers (space_id, marker_type_id, title, projection, event_date, created_by)
  values (v_space_id, v_type_a, 'Smoke marker', 'stout', '2030-01-01', null)
  returning id into v_marker_id;
  insert into public.marker_assignments (marker_id, trial_id)
  values (v_marker_id, v_trial_id);

  -- trigger marker_updated by changing the title
  update public.markers set title = 'Smoke marker 2' where id = v_marker_id;
  select payload into v_updated_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated'
   order by occurred_at desc limit 1;
  if v_updated_payload->>'event_date' is null then
    raise exception 'marker payload smoke FAIL: marker_updated missing event_date in payload';
  end if;

  -- trigger marker_reclassified by changing the marker_type_id
  update public.markers set marker_type_id = v_type_b where id = v_marker_id;
  select payload into v_reclassified_payload
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified'
   order by occurred_at desc limit 1;
  if v_reclassified_payload->>'event_date' is null then
    raise exception 'marker payload smoke FAIL: marker_reclassified missing event_date in payload';
  end if;

  -- cleanup
  delete from public.markers where id = v_marker_id;
  raise notice 'marker payload smoke ok: event_date present on marker_updated and marker_reclassified';
end $$;
```

- [ ] **Step 4: Apply the migration locally and verify the smoke notice**

Run: `supabase db reset`
Expected: at the end of the reset output, `NOTICE: marker payload smoke ok: event_date present on marker_updated and marker_reclassified`. If the notice reads `skipped (seed data not present)`, run `supabase db reset` again — seed.sql may not have populated by the time the migration ran in an empty DB; in that case add a self-contained seed inside the smoke (`insert into public.spaces ...`) and rerun.

- [ ] **Step 5: Run the Supabase advisor**

Run: `supabase db advisors --local --type all`
Expected: no new warnings or errors introduced by this migration.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260528120000_marker_change_payload_event_date.sql
git commit -m "Add event_date to marker_updated/reclassified payloads"
```

---

## Task 2: Extend client formatter to render catalyst date on marker_updated and marker_reclassified

Adds the existing `markerContextSegments(...)` call to the two missing cases so all marker-related detected rows render `· {event_date}` (when payload carries the field) consistently with `marker_added`. Adds a Vitest spec covering all four marker cases.

**Files:**
- Create: `src/client/src/app/shared/utils/change-event-summary.spec.ts`
- Modify: `src/client/src/app/shared/utils/change-event-summary.ts:454-484`

- [ ] **Step 1: Write the failing test**

Create `src/client/src/app/shared/utils/change-event-summary.spec.ts`:

```ts
import { describe, expect, it } from 'vitest';
import type { ChangeEvent } from '../../core/models/change-event.model';
import { summarySegmentsFor } from './change-event-summary';

function baseEvent(overrides: Partial<ChangeEvent>): ChangeEvent {
  return {
    id: 'evt-1',
    trial_id: 'trial-1',
    space_id: 'space-1',
    event_type: 'marker_added',
    source: 'ctgov',
    payload: {},
    occurred_at: '2026-05-28T14:00:00Z',
    observed_at: '2026-05-28T14:00:00Z',
    marker_id: 'm-1',
    marker_title: 'Topline Phase 3 readout',
    marker_color: '#0ea5e9',
    marker_type_name: 'Topline readout',
    from_marker_type_name: null,
    to_marker_type_name: null,
    trial_name: 'TRIUMPH-1',
    trial_identifier: 'NCT00000001',
    asset_name: null,
    company_name: 'Novo Nordisk',
    company_logo_url: null,
    ...overrides,
  };
}

function joinText(segments: { text?: string }[]): string {
  return segments.map((s) => s.text ?? '').join('');
}

describe('summarySegmentsFor marker-related events', () => {
  it('marker_added inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_added',
        payload: { event_date: '2026-05-29' },
      }),
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('marker_updated inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['description'], event_date: '2026-05-29' },
      }),
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('marker_updated omits the date suffix when payload.event_date is absent', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['description'] },
      }),
    );
    expect(joinText(result.segments)).not.toContain('2026');
  });

  it('marker_reclassified inlines the catalyst date when payload.event_date is present', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_reclassified',
        from_marker_type_name: 'Topline readout',
        to_marker_type_name: 'Interim readout',
        payload: { from_type_id: 'a', to_type_id: 'b', event_date: '2026-05-29' },
      }),
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });

  it('projection_finalized still inlines the catalyst date (regression guard)', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'projection_finalized',
        payload: { from: 'projected', to: 'actual', event_date: '2026-05-29' },
      }),
    );
    expect(joinText(result.segments)).toContain('May 29, 2026');
  });
});
```

- [ ] **Step 2: Run the new spec; expect failures on the marker_updated and marker_reclassified cases**

Run: `cd src/client && npm run test:units -- src/app/shared/utils/change-event-summary.spec.ts`
Expected: 3 PASS (marker_added, marker_updated absent, projection_finalized), 2 FAIL (marker_updated with date, marker_reclassified with date).

- [ ] **Step 3: Update `marker_updated` and `marker_reclassified` cases to call `markerContextSegments`**

Edit `src/client/src/app/shared/utils/change-event-summary.ts`. Replace the `marker_updated` block (lines 454-468):

```ts
    case 'marker_updated': {
      const raw = (p['changed_fields'] as string[] | undefined) ?? [];
      const fields = raw
        .map((f) => MARKER_FIELD_LABELS[f] ?? f.replace(/_/g, ' '))
        .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
        .join(', ');
      const segments: SummarySegment[] = fields
        ? [
            { kind: 'plain', text: 'Marker edited: ' },
            { kind: 'plain', text: fields },
          ]
        : [{ kind: 'plain', text: 'Marker edited' }];
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

Replace the `marker_reclassified` block (lines 470-484):

```ts
    case 'marker_reclassified': {
      const from = e.from_marker_type_name;
      const to = e.to_marker_type_name;
      const segments: SummarySegment[] =
        from && to
          ? [
              { kind: 'plain', text: 'Reclassified: ' },
              { kind: 'old', text: from },
              { kind: 'arrow' },
              { kind: 'new', text: to },
            ]
          : [{ kind: 'plain', text: 'Reclassified' }];
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

- [ ] **Step 4: Re-run the spec; all should pass**

Run: `cd src/client && npm run test:units -- src/app/shared/utils/change-event-summary.spec.ts`
Expected: 5 PASS, 0 FAIL.

- [ ] **Step 5: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors, 0 new warnings.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/shared/utils/change-event-summary.ts src/client/src/app/shared/utils/change-event-summary.spec.ts
git commit -m "Inline catalyst date on marker_updated and marker_reclassified rows"
```

---

## Task 3: Server-side feed timestamp and ORDER BY

Adds `feed_ts` per leg in the unified feed CTE, switches sort and date-range filter to it, returns the new field in the jsonb payload, and asserts within-day ordering via inline smoke. The migration uses `create or replace function` to replace the function defined in `20260528050000_feed_rpcs_prefer_trial_acronym.sql`. Do not edit that file.

**Files:**
- Create: `supabase/migrations/20260528120100_events_feed_sort_by_feed_ts.sql`

- [ ] **Step 1: Read the current function definition**

Run: `cat supabase/migrations/20260528050000_feed_rpcs_prefer_trial_acronym.sql`

Skim the full `get_events_page_data` function; locate the three leg projections, the ORDER BY (currently `uf.event_date desc, uf.id desc`), the date filters (`ev.event_date`, `m.event_date`, `ce.occurred_at::date`), and the final `jsonb_build_object` that serializes each row.

- [ ] **Step 2: Write the new migration**

Create `supabase/migrations/20260528120100_events_feed_sort_by_feed_ts.sql`. Start from a verbatim copy of the function body in `20260528050000_feed_rpcs_prefer_trial_acronym.sql` and apply these edits:

1. **Events leg projection** — add one line after `ev.created_at,`:
   ```sql
   ev.created_at as feed_ts,
   ```
2. **Markers leg projection** — add one line after `m.created_at,`:
   ```sql
   m.created_at as feed_ts,
   ```
3. **Detected leg projection** — add one line after `ce.observed_at as created_at,`:
   ```sql
   coalesce(ce.observed_at, ce.occurred_at) as feed_ts,
   ```
4. **Date filters** — replace each leg's `event_date` predicate with `feed_ts`:
   - Events leg: `and (p_date_from is null or ev.created_at::date >= p_date_from)` and matching `<=`.
   - Markers leg: `and (p_date_from is null or m.created_at::date >= p_date_from)` and matching `<=`.
   - Detected leg: `and (p_date_from is null or coalesce(ce.observed_at, ce.occurred_at)::date >= p_date_from)` and matching `<=`.
5. **ORDER BY** — replace `order by uf.event_date desc, uf.id desc` with `order by uf.feed_ts desc, uf.id desc`.
6. **Result jsonb** — add `'feed_ts', r.feed_ts,` to the per-row `jsonb_build_object(...)` near the bottom of the function. Place it next to the existing `'event_date', r.event_date,` line.

Begin the migration file with this header (the function body follows after):

```sql
-- 20260528120100_events_feed_sort_by_feed_ts.sql
-- Sort the unified events feed by a full timestamptz (feed_ts) so same-day
-- rows order deterministically by arrival, not by random UUID tiebreaker.
-- Each leg's feed_ts:
--   events:   ev.created_at
--   markers:  m.created_at
--   detected: coalesce(ce.observed_at, ce.occurred_at)
-- Date-range filters (p_date_from, p_date_to) also shift to feed_ts so the
-- "Logged" column header in the UI matches its filter semantics.

create or replace function public.get_events_page_data(
  -- (preserve the existing parameter list verbatim from
  --  20260528050000_feed_rpcs_prefer_trial_acronym.sql)
)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  -- (paste the existing CTE body with the six edits described above)
$$;
```

- [ ] **Step 3: Append an inline smoke that asserts within-day ordering**

Append to the same migration:

```sql
do $$
declare
  v_space_id uuid;
  v_result jsonb;
  v_first_ts timestamptz;
  v_second_ts timestamptz;
begin
  select id into v_space_id from public.spaces limit 1;
  if v_space_id is null then
    raise notice 'events feed sort smoke: skipped (no spaces in seed)';
    return;
  end if;

  v_result := public.get_events_page_data(
    p_space_id    => v_space_id,
    p_limit       => 10,
    p_offset      => 0,
    p_date_from   => null,
    p_date_to     => null,
    p_source_type => null,
    p_priority    => null,
    p_tags        => null,
    p_category_ids => null,
    p_entity_level => null,
    p_entity_id   => null
  );

  if jsonb_array_length(v_result->'items') < 2 then
    raise notice 'events feed sort smoke: skipped (fewer than 2 rows in feed)';
    return;
  end if;

  v_first_ts  := (v_result->'items'->0->>'feed_ts')::timestamptz;
  v_second_ts := (v_result->'items'->1->>'feed_ts')::timestamptz;

  if v_first_ts < v_second_ts then
    raise exception 'events feed sort smoke FAIL: rows not ordered by feed_ts desc (first=% second=%)',
      v_first_ts, v_second_ts;
  end if;

  raise notice 'events feed sort smoke ok: feed_ts present and ordered desc';
end $$;
```

- [ ] **Step 4: Apply locally and verify smoke**

Run: `supabase db reset`
Expected: `NOTICE: events feed sort smoke ok: feed_ts present and ordered desc` near the tail. A `skipped` notice is acceptable only if the seed truly has fewer than two feed rows — in that case manually insert two test events with distinct `created_at` timestamps in the same calendar day and rerun.

- [ ] **Step 5: Advisor pass**

Run: `supabase db advisors --local --type all`
Expected: no new warnings or errors.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/20260528120100_events_feed_sort_by_feed_ts.sql
git commit -m "Sort events feed by feed_ts and shift date filter to match"
```

---

## Task 4: Add `feed_ts` to the client FeedItem type

Single-line type change so subsequent client tasks compile.

**Files:**
- Modify: `src/client/src/app/core/models/event.model.ts:63-86`

- [ ] **Step 1: Add the field to the interface**

Edit `src/client/src/app/core/models/event.model.ts`. In the `FeedItem` interface, add `feed_ts` immediately above `event_date`:

```ts
export interface FeedItem {
  source_type: 'event' | 'marker' | 'detected';
  id: string;
  title: string;
  feed_ts: string;
  event_date: string;
  // ...remaining fields unchanged
}
```

- [ ] **Step 2: Verify the build still compiles (no consumers yet read feed_ts)**

Run: `cd src/client && ng build`
Expected: 0 errors.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/event.model.ts
git commit -m "Add feed_ts to FeedItem type"
```

---

## Task 5: Render "Logged" column with date + time and switch sort to feed_ts

Renames the leftmost date column to "Logged", stacks the date over a small mono time caption, switches both sort and filter fields to `feed_ts`, and updates `defaultSort`.

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.ts:130-188`
- Modify: `src/client/src/app/features/events/events-page.component.ts:223-246` (getDetectedSummary stub)
- Modify: `src/client/src/app/features/events/events-page.component.html:30-33` (header)
- Modify: `src/client/src/app/features/events/events-page.component.html:118-124` (body cell)

- [ ] **Step 1: Update the grid column definition**

In `src/client/src/app/features/events/events-page.component.ts`, replace the first column entry (lines 132-137) with:

```ts
      {
        field: 'feed_ts',
        header: 'Logged',
        filter: { kind: 'date' },
      },
```

And update `defaultSort` (line 185):

```ts
    defaultSort: { field: 'feed_ts', order: -1 },
```

- [ ] **Step 2: Update the getDetectedSummary stub to source observed_at from feed_ts**

In the same file, replace the `observed_at` assignment in `getDetectedSummary` (line 232):

```ts
      observed_at: item.feed_ts ?? item.observed_at ?? item.event_date,
```

`item.feed_ts` is now the canonical arrival timestamp; the chain falls back to the legacy `observed_at` for any synthetic FeedItems lacking feed_ts, then to `event_date` as a last resort.

- [ ] **Step 3: Update the header markup**

In `src/client/src/app/features/events/events-page.component.html`, replace the date `<th>` (lines 30-33):

```html
            <th pSortableColumn="feed_ts" class="col-date">
              Logged <p-sortIcon field="feed_ts" />
              <p-column-filter type="date" field="feed_ts" display="menu" />
            </th>
```

- [ ] **Step 4: Update the body cell to stack date over time**

Replace the date `<td>` (around lines 118-120):

```html
            <td class="col-date text-xs tabular-nums text-slate-500">
              <div>{{ item.feed_ts | date: 'MMM d, y' }}</div>
              <div class="text-[10px] uppercase tracking-wider text-slate-400">
                {{ item.feed_ts | date: 'h:mm a' }}
              </div>
            </td>
```

- [ ] **Step 5: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors. No new ESLint warnings.

- [ ] **Step 6: Run the dev server and visually confirm**

Run: `cd src/client && npm run start`
Open the Events page in the browser. Confirm:
1. Header reads **Logged**, not Date.
2. Each row's first cell shows two lines: date and time-of-day (e.g. `May 28, 2026` / `2:34 PM`).
3. Newest row is at the top; clicking the header reverses to oldest-first.
4. Same-day rows that were previously scrambled now appear in time order (no random UUID effect).

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/events/events-page.component.ts src/client/src/app/features/events/events-page.component.html
git commit -m "Events feed: sort and label by feed_ts, stack date over time"
```

---

## Task 6: Append underlying date to event and marker row titles

Events and markers carry their domain date (meeting date, catalyst date) in `event_date`. When that date differs from the logged date, append `· {event_date}` to the title so the row still surfaces the underlying date. Detected rows already do this via `summarySegmentsFor` and were extended in Task 2.

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.ts` — add `formatEventDateSuffix` helper.
- Modify: `src/client/src/app/features/events/events-page.component.html` — use it in the title cell for event/marker rows.

- [ ] **Step 1: Add the helper to the component**

In `src/client/src/app/features/events/events-page.component.ts`, add this protected method near `getEntityDisplay` (after line 254):

```ts
  protected formatEventDateSuffix(item: FeedItem): string {
    if (item.source_type === 'detected') return '';
    if (!item.event_date || !item.feed_ts) return '';
    const eventDay = item.event_date.slice(0, 10);
    const loggedDay = item.feed_ts.slice(0, 10);
    if (eventDay === loggedDay) return '';
    const parsed = new Date(`${item.event_date}T00:00:00`);
    if (Number.isNaN(parsed.getTime())) return '';
    const formatted = parsed.toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    });
    return ` · ${formatted}`;
  }
```

Slicing the first 10 characters of an ISO timestamp gives `YYYY-MM-DD` reliably for both `date` (already in that form) and `timestamptz` ISO strings, avoiding timezone-conversion bugs when comparing same-day status.

- [ ] **Step 2: Use the helper in the title cell**

In `src/client/src/app/features/events/events-page.component.html`, find the title rendering block for non-detected rows (the branch with the plain text title). Append the suffix:

```html
                @if (item.source_type !== 'detected') {
                  <span class="truncate text-sm text-slate-900">
                    {{ item.title }}{{ formatEventDateSuffix(item) }}
                  </span>
                }
```

Match the exact existing `@if`/`@else` structure of the title cell; only the inner span content for non-detected rows changes.

- [ ] **Step 3: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors. The lint config flags template call expressions at `warn` (`template/no-call-expression`); accept the warning here — `formatEventDateSuffix` is a pure synchronous helper and the per-row overhead is trivial. If the warning blocks at `error` in your branch's lint config, move the suffix into the FeedItem mapping in `event.service.ts` instead and store it as `title_suffix: string` on the row.

- [ ] **Step 4: Visually confirm in the browser**

Run: `cd src/client && npm run start`
1. Find an event whose `event_date` is in the future (e.g., an FDA AdCom logged today for a meeting next month). Confirm its title now reads `FDA AdCom for Cagrilintide · Jun 12, 2026` (date depending on data).
2. Find a marker whose `event_date` differs from when it was logged. Confirm the same `· {date}` suffix.
3. Find an event whose `event_date` equals the logged date. Confirm no suffix appears (no `· May 28, 2026` redundancy).

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/events/events-page.component.ts src/client/src/app/features/events/events-page.component.html
git commit -m "Append event_date suffix to event and marker row titles"
```

---

## Task 7: Full verification pass

End-to-end check that nothing else broke.

- [ ] **Step 1: Run all client tests**

Run: `cd src/client && npm run test:units`
Expected: all pass. The new `change-event-summary.spec.ts` runs alongside existing specs.

- [ ] **Step 2: Run lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors.

- [ ] **Step 3: Reset DB and re-run advisor**

Run: `supabase db reset && supabase db advisors --local --type all`
Expected: both migration smokes log their `ok` notices; advisor reports no new findings.

- [ ] **Step 4: Manual scenario — same-second tie**

Open the Events page. Add a marker and immediately edit its description (within the same minute). Refresh the feed. Confirm the "Marker edited" row appears directly above "Marker added" (newest-first), and that both rows show times within the same minute.

- [ ] **Step 5: Manual scenario — date filter agrees with the column**

Pick a date with at least one row whose `event_date` differs from its `feed_ts`. Apply the date filter for the logged day. Confirm the row appears (filter is on logged date now), and applying for the event_date day excludes it.

- [ ] **Step 6: Regenerate runbook**

Run: `cd src/client && npm run docs:arch`
Expected: AUTO-GEN blocks in `06-backend-architecture.md` and `07-database-schema.md` regenerate to pick up the new function definition. Commit any regen as part of the same change set, per the runbook drift rule.

- [ ] **Step 7: Final commit and push**

```bash
git add docs/runbook
git commit -m "Regen runbook for events feed feed_ts change" || echo "no runbook drift"
git push
```

---

## Self-review

**Spec coverage:**
- Server-side `feed_ts` per leg + ORDER BY + date filter shift → Task 3.
- Trigger payload additions for `marker_updated` and `marker_reclassified` → Task 1.
- Formatter additions for the same two cases → Task 2.
- `FeedItem.feed_ts` type field → Task 4.
- Column rename + date/time stacking + sort field rename → Task 5.
- Event/marker title suffix → Task 6.
- Verification (lint, build, advisor, manual) → Task 7.

**Placeholder scan:** Task 1 Step 2 and Task 3 Step 2 both ask the engineer to copy the existing function body verbatim. This is intentional — Postgres `create or replace function` requires the complete body, and pasting the spec's edits onto a verbatim copy is the safe approach. Each edit is described to the line. The `...` inside the SQL block is the only marker and is explicitly called out.

**Type consistency:** `feed_ts` is `timestamptz` on the server, serialized as an ISO string, typed `string` on the client. `formatEventDateSuffix` returns `string`. The `getDetectedSummary` stub chain `item.feed_ts ?? item.observed_at ?? item.event_date` agrees with all three being string-typed.

**Migration ordering:** `20260528120000` (trigger payload) runs before `20260528120100` (RPC). The RPC change does not depend on the trigger change, but the inline smoke in 120100 is happier if the seed has been re-applied with the trigger active so historical rows include `event_date` where applicable. Either order works for correctness; this ordering keeps related changes adjacent.
