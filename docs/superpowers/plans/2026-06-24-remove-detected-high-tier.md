# Remove the "high" tier from detected events — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop auto-classifying detected (CT.gov-derived) feed rows as `priority = 'high'`, and remove every UI surface that renders that detected "high" indicator, so detected changes read uniformly and the analyst decides what matters.

**Architecture:** A new Supabase migration recreates `get_events_page_data()` with the detected leg's two priority `CASE` expressions neutralized (select-list emits `null`; the `p_priority` filter matches the markers leg). Two Angular templates drop the detected "High" pill, the detected highlight border, and the detected "High signal" detail pill. Authored events and markers are untouched.

**Tech Stack:** PostgreSQL (Supabase migrations, `plpgsql`), Angular 19 standalone components, Vitest integration tests against local Supabase.

## Global Constraints

- No emojis, no em dashes anywhere (UI, SQL comments, commit messages).
- Migrations are append-only: never edit an applied migration; add a new timestamped file `YYYYMMDDHHmmss_<desc>.sql`. Latest existing migration is `20260623130000`; the new file must sort after it.
- End any migration that changes an RPC body with `notify pgrst, 'reload schema';`.
- Angular: native control flow only (`@if`/`@for`/`@switch`), `class`/`style` bindings (no `ngClass`/`ngStyle`), OnPush, signals. Keep new/edited code lint-clean (`eslint.config.js` is fully ratcheted to `error`).
- Authored-event priority (`events.priority`, the user-settable High/Low) and markers (always `null` priority) must remain fully intact. Only the *detected* leg changes.
- Integration tests require local Supabase running (`supabase start`); apply new migrations with `supabase db reset`.

---

### Task 1: Neutralize detected priority in the RPC

**Files:**
- Create: `supabase/migrations/20260624120000_remove_detected_event_priority.sql`
- Test: `src/client/integration/tests/events-detected-date-moved-title.spec.ts:158-164` (modify existing test)

**Interfaces:**
- Consumes: nothing from earlier tasks.
- Produces: `public.get_events_page_data(...)` with an unchanged signature and returned columns. The `priority` field of every `source_type = 'detected'` item is now always `null` (JSON `null`). Authored (`source_type = 'event'`) items still carry their stored `'high' | 'low'`; markers still carry `null`. This is what Task 2's templates rely on.

- [ ] **Step 1: Update the failing test**

In `src/client/integration/tests/events-detected-date-moved-title.spec.ts`, replace the existing test block at lines 158-164:

```typescript
  it('flags >60-day shifts as high priority and leaves smaller shifts normal', async () => {
    const items = await detectedItems();
    const big = items.find((i) => i.title.includes('369 days'));
    const small = items.find((i) => i.title.includes('52 days'));
    expect(big?.priority).toBe('high');
    expect(small?.priority ?? null).toBeNull();
  });
```

with a version asserting no detected row carries a priority (the auto high tier is gone):

```typescript
  it('never assigns a priority to detected rows (no auto high tier)', async () => {
    const items = await detectedItems();
    const big = items.find((i) => i.title.includes('369 days'));
    const small = items.find((i) => i.title.includes('52 days'));
    expect(big).toBeDefined();
    expect(small).toBeDefined();
    expect(big?.priority ?? null).toBeNull();
    expect(small?.priority ?? null).toBeNull();
    expect(items.every((i) => (i.priority ?? null) === null)).toBe(true);
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd src/client && npx vitest run integration/tests/events-detected-date-moved-title.spec.ts -t "never assigns a priority"`
Expected: FAIL — `big?.priority` is still `'high'` because the current migration's detected leg classifies a 369-day shift as high.

- [ ] **Step 3: Write the migration**

Create `supabase/migrations/20260624120000_remove_detected_event_priority.sql`. It recreates `get_events_page_data()` as a verbatim copy of the body in `supabase/migrations/20260623130000_fix_detected_date_moved_title.sql` with exactly two changes in the detected leg (leg 3):

1. The select-list priority `CASE` (currently at lines 245-257 of the 20260623130000 file) becomes `null::text as priority`.
2. The `p_priority` filter `CASE` (currently at lines 308-323) becomes `and (p_priority is null)`, matching the markers leg.

Copy the rest of the function unchanged. Full file content:

```sql
-- Remove the auto "high" priority tier from detected (CT.gov-derived) feed rows.
--
-- The detected leg of get_events_page_data() classified phase transitions, trial
-- withdrawals, sponsor changes, terminal status changes, and >60-day date shifts as
-- priority = 'high'. The threshold read as arbitrary and inconsistent to analysts, so
-- the product decision is that detected changes carry no priority; the analyst judges
-- relevance. This redefinition is the body from 20260623130000 verbatim EXCEPT the
-- detected leg now emits null priority and its p_priority filter matches the markers
-- leg (detected rows drop out whenever a priority filter is active). Authored events
-- (ev.priority) and markers are untouched. Signature unchanged.

create or replace function public.get_events_page_data(
  p_space_id      uuid,
  p_date_from     date     default null,
  p_date_to       date     default null,
  p_entity_level  text     default null,
  p_entity_id     uuid     default null,
  p_category_ids  uuid[]   default null,
  p_tags          text[]   default null,
  p_priority      text     default null,
  p_source_type   text     default null,
  p_limit         int      default 50,
  p_offset        int      default 0,
  p_change_event_id uuid   default null,
  p_search        text     default null,
  p_sort_field    text     default 'feed_ts',
  p_sort_dir      text     default 'desc'
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_tags = '{}' then p_tags := null; end if;
  if p_search is not null and btrim(p_search) = '' then p_search := null; end if;

  with unified_feed as (
    -- leg 1: events (human-authored)
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.priority,
      case
        when ev.trial_id is not null then 'trial'
        when ev.asset_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.acronym, t.name, a.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.asset_id, ev.company_id) as entity_id,
      coalesce(co.name, co_via_asset.name, co_via_trial.name) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at,
      ev.created_at as feed_ts,
      null::text as change_event_type,
      null::jsonb as change_payload,
      null::text as change_source,
      false as has_annotation,
      null::text as observed_at,
      null::text as company_logo_url,
      coalesce(ev.company_id, co_via_asset.id, co_via_trial.id) as company_id,
      coalesce(ev.asset_id, a_via_trial.id) as asset_id,
      coalesce(a.name, a_via_trial.name) as asset_name,
      ev.trial_id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      null::boolean as is_projected,
      null::text as marker_type_shape,
      null::text as marker_type_color,
      null::text as marker_type_inner_mark,
      null::text as category_color
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.assets a on a.id = ev.asset_id
    left join public.companies co_via_asset on a.id is not null and co_via_asset.id = a.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.assets a_via_trial on t.id is not null and a_via_trial.id = t.asset_id
    left join public.companies co_via_trial on a_via_trial.id is not null and co_via_trial.id = a_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and p_change_event_id is null
      and (p_date_from is null or ev.created_at::date >= p_date_from)
      and (p_date_to is null or ev.created_at::date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.asset_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and (ev.company_id is not null or ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level in ('product', 'asset') and (ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        or ev.company_id = p_entity_id
        or ev.asset_id = p_entity_id
        or ev.trial_id   = p_entity_id
        or (p_entity_level in ('product', 'asset') and exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id))
        or (p_entity_level = 'company' and (co_via_asset.id = p_entity_id or co_via_trial.id = p_entity_id))
      )

    union all

    -- leg 2: markers
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      coalesce(t.acronym, t.name) as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at,
      m.created_at as feed_ts,
      null::text as change_event_type,
      null::jsonb as change_payload,
      null::text as change_source,
      false as has_annotation,
      null::text as observed_at,
      null::text as company_logo_url,
      co.id as company_id,
      a.id as asset_id,
      a.name as asset_name,
      t.id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      m.is_projected as is_projected,
      mt.shape::text as marker_type_shape,
      mt.color::text as marker_type_color,
      mt.inner_mark::text as marker_type_inner_mark,
      mt.color::text as category_color
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.assets a on a.id = t.asset_id
    join public.companies co on co.id = a.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and p_change_event_id is null
      and (p_date_from is null or m.created_at::date >= p_date_from)
      and (p_date_to is null or m.created_at::date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_entity_level is null or p_entity_level in ('trial', 'product', 'asset', 'company'))
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id)
        or co.id = p_entity_id
      )

    union all

    -- leg 3: trial_change_events (detected CT.gov changes)
    select
      'detected'::text as source_type,
      ce.id,
      case ce.event_type
        when 'phase_transitioned' then
          'Phase: ' || public._humanize_phase(ce.payload ->> 'from')
          || ' -> ' || public._humanize_phase(ce.payload ->> 'to')
        when 'status_changed' then
          'Status: ' || public._humanize_status(ce.payload ->> 'from')
          || ' -> ' || public._humanize_status(ce.payload ->> 'to')
        when 'date_moved' then
          concat_ws(
            ' ',
            case
              when ce.payload ->> 'which_date' = 'event_date'
                and nullif(ce.payload ->> 'marker_title', '') is not null
                then (ce.payload ->> 'marker_title') || ': event date'
              else initcap(replace(coalesce(ce.payload ->> 'which_date', 'date'), '_', ' '))
            end,
            case when ce.payload ->> 'direction' = 'accelerate'
              then 'pulled forward' else 'delayed' end,
            case when (ce.payload ->> 'days_diff') ~ '^-?\d+$'
              then abs((ce.payload ->> 'days_diff')::int)::text || ' days' end
          )
        when 'trial_withdrawn' then
          'Trial withdrawn from CT.gov'
        when 'enrollment_target_changed' then
          'Enrollment target: '
          || coalesce(ce.payload ->> 'from', '?')
          || ' -> ' || coalesce(ce.payload ->> 'to', '?')
        when 'sponsor_changed' then
          'Sponsor: '
          || coalesce(ce.payload ->> 'from', '?')
          || ' -> ' || coalesce(ce.payload ->> 'to', '?')
        else
          initcap(replace(ce.event_type, '_', ' '))
      end as title,
      ce.occurred_at::date as event_date,
      case ce.event_type
        when 'status_changed'              then 'Trial status'
        when 'trial_withdrawn'             then 'Trial status'
        when 'date_moved'                  then 'Timeline'
        when 'projection_finalized'        then 'Timeline'
        when 'phase_transitioned'          then 'Phase'
        when 'enrollment_target_changed'   then 'Protocol design'
        when 'arm_added'                   then 'Protocol design'
        when 'arm_removed'                 then 'Protocol design'
        when 'intervention_changed'        then 'Protocol design'
        when 'outcome_measure_changed'     then 'Protocol design'
        when 'eligibility_criteria_changed' then 'Protocol design'
        when 'eligibility_changed'         then 'Protocol design'
        when 'marker_added'                then 'Catalyst lifecycle'
        when 'marker_removed'              then 'Catalyst lifecycle'
        when 'marker_updated'              then 'Catalyst lifecycle'
        when 'marker_reclassified'         then 'Catalyst lifecycle'
        when 'sponsor_changed'             then 'Catalyst lifecycle'
        else 'Other'
      end as category_name,
      null::uuid as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      coalesce(t.acronym, t.name) as entity_name,
      ce.trial_id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      null::text as description,
      case when t.identifier is not null
        then 'https://clinicaltrials.gov/study/' || t.identifier
        else null
      end as source_url,
      ce.observed_at as created_at,
      coalesce(ce.observed_at, ce.occurred_at) as feed_ts,
      ce.event_type::text as change_event_type,
      ce.payload as change_payload,
      ce.source::text as change_source,
      exists(
        select 1
        from public.change_event_annotations ann
        where ann.change_event_id = ce.id
      ) as has_annotation,
      ce.observed_at::text as observed_at,
      co.logo_url::text as company_logo_url,
      co.id as company_id,
      t.asset_id as asset_id,
      a.name as asset_name,
      ce.trial_id as trial_id,
      coalesce(t.acronym, t.name) as trial_name,
      null::boolean as is_projected,
      null::text as marker_type_shape,
      null::text as marker_type_color,
      null::text as marker_type_inner_mark,
      null::text as category_color
    from public.trial_change_events ce
    join public.trials t on t.id = ce.trial_id
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on a.id is not null and co.id = a.company_id
    where ce.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'detected')
      and (p_change_event_id is null or ce.id = p_change_event_id)
      and (p_date_from is null or coalesce(ce.observed_at, ce.occurred_at)::date >= p_date_from)
      and (p_date_to is null or coalesce(ce.observed_at, ce.occurred_at)::date <= p_date_to)
      and (p_entity_level is null or p_entity_level in ('trial', 'product', 'asset', 'company'))
      and (
        p_entity_id is null
        or ce.trial_id = p_entity_id
        or exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = p_entity_id)
        or co.id = p_entity_id
      )
      and (p_priority is null)
  ),
  filtered as (
    select uf.*
    from unified_feed uf
    where p_search is null
      or uf.title ilike '%' || p_search || '%'
      or uf.category_name ilike '%' || p_search || '%'
      or uf.entity_name ilike '%' || p_search || '%'
      or coalesce(uf.company_name, '') ilike '%' || p_search || '%'
      or coalesce(uf.asset_name, '') ilike '%' || p_search || '%'
      or coalesce(uf.change_event_type, '') ilike '%' || p_search || '%'
  ),
  ranked as (
    select
      f.*,
      count(*) over() as total_count,
      case p_sort_field
        when 'title'         then lower(f.title)
        when 'category_name' then lower(f.category_name)
        when 'entity_name'   then lower(f.entity_name)
        when 'priority'      then f.priority
        when 'source_type'   then f.source_type
        else null
      end as sort_text,
      case
        when p_sort_field in ('title', 'category_name', 'entity_name', 'priority', 'source_type')
          then null::timestamptz
        else f.feed_ts
      end as sort_ts
    from filtered f
  ),
  counted as (
    -- sort_text / sort_ts are real columns of `ranked` here, so they resolve
    -- inside the CASE order-by expressions (output aliases would not).
    select *
    from ranked
    order by
      case when p_sort_dir = 'asc'  then sort_ts end asc nulls last,
      case when p_sort_dir <> 'asc' then sort_ts end desc nulls last,
      case when p_sort_dir = 'asc'  then sort_text end asc nulls last,
      case when p_sort_dir <> 'asc' then sort_text end desc nulls last,
      feed_ts desc, id desc
    limit p_limit offset p_offset
  )
  select jsonb_build_object(
    'items', coalesce(
      jsonb_agg(
        jsonb_build_object(
          'source_type', r.source_type,
          'id', r.id,
          'title', r.title,
          'event_date', r.event_date,
          'feed_ts', r.feed_ts,
          'category_name', r.category_name,
          'category_id', r.category_id,
          'priority', r.priority,
          'entity_level', r.entity_level,
          'entity_name', r.entity_name,
          'entity_id', r.entity_id,
          'company_id', r.company_id,
          'company_name', r.company_name,
          'asset_id', r.asset_id,
          'asset_name', r.asset_name,
          'trial_id', r.trial_id,
          'trial_name', r.trial_name,
          'tags', to_jsonb(r.tags),
          'has_thread', r.has_thread,
          'thread_id', r.thread_id,
          'description', r.description,
          'source_url', r.source_url,
          'change_event_type', r.change_event_type,
          'change_payload', r.change_payload,
          'change_source', r.change_source,
          'has_annotation', r.has_annotation,
          'observed_at', r.observed_at,
          'company_logo_url', r.company_logo_url,
          'is_projected', r.is_projected,
          'marker_type_shape', r.marker_type_shape,
          'marker_type_color', r.marker_type_color,
          'marker_type_inner_mark', r.marker_type_inner_mark,
          'category_color', r.category_color
        )
        order by
          case when p_sort_dir = 'asc'  then r.sort_ts end asc nulls last,
          case when p_sort_dir <> 'asc' then r.sort_ts end desc nulls last,
          case when p_sort_dir = 'asc'  then r.sort_text end asc nulls last,
          case when p_sort_dir <> 'asc' then r.sort_text end desc nulls last,
          r.feed_ts desc, r.id desc
      ),
      '[]'::jsonb
    ),
    'total', coalesce(max(r.total_count), 0)
  )
  into v_result
  from counted r;

  return v_result;
end;
$$;

notify pgrst, 'reload schema';
```

- [ ] **Step 4: Apply the migration**

Run: `supabase db reset`
Expected: all migrations re-apply and seed loads with no error; the final `notify pgrst` is harmless.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd src/client && npx vitest run integration/tests/events-detected-date-moved-title.spec.ts`
Expected: PASS — including the updated "never assigns a priority to detected rows" test and the existing title/search tests (titles like "369 days" are unaffected; only priority changed).

- [ ] **Step 6: Run the Supabase advisor**

Run: `supabase db advisors --local --type all`
Expected: no new warnings introduced by this migration (function is `security invoker`, signature unchanged).

- [ ] **Step 7: Commit**

```bash
git add supabase/migrations/20260624120000_remove_detected_event_priority.sql src/client/integration/tests/events-detected-date-moved-title.spec.ts
git commit -m "feat(events): drop auto high-priority tier from detected feed rows"
```

---

### Task 2: Remove the detected "high" UI surfaces

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.html` (remove detected border at 147-151; remove detected pill branch at 313-315)
- Modify: `src/client/src/app/features/events/event-detail-panel.component.html` (remove detected "High signal" pill at 206-208)

**Interfaces:**
- Consumes: from Task 1, detected feed items always have `priority === null`, so the branches being removed are now dead code.
- Produces: no new interface. Detected rows render with no left border and no status-column "High" pill (the amber `detectedShift` chip stays); the detected detail view shows no "High signal" pill. Authored rendering (the `@default` "High" pill in the table, the authored "High priority" pill and red banner in the detail panel) is unchanged.

- [ ] **Step 1: Remove the detected highlight border**

In `src/client/src/app/features/events/events-page.component.html`, delete the entire `[style.border-left]` binding (lines 147-151):

```html
            [style.border-left]="
              item.source_type === 'detected' && item.priority === 'high'
                ? '3px solid rgb(217 119 6)'
                : ''
            "
```

The `<tr>` keeps its other bindings (`class`, `[class.selected-row]`, `(click)`, etc.); only the `[style.border-left]` attribute is removed.

- [ ] **Step 2: Remove the detected status-column "High" pill**

In the same file, in the `@case ('detected')` block, change:

```html
                @case ('detected') {
                  @if (detectedShift(item); as shift) {
                    <span
                      class="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800"
                      [attr.aria-label]="'Shifted ' + shift.text"
                    >
                      <i
                        class="fa-solid text-[8px]"
                        [class.fa-arrow-down]="shift.later"
                        [class.fa-arrow-up]="!shift.later"
                        aria-hidden="true"
                      ></i>
                      {{ shift.text }}
                    </span>
                  } @else if (item.priority === 'high') {
                    <app-detail-panel-pill tone="red">High</app-detail-panel-pill>
                  }
                }
```

to drop the `@else if` branch, leaving the shift chip alone:

```html
                @case ('detected') {
                  @if (detectedShift(item); as shift) {
                    <span
                      class="inline-flex items-center gap-1 border border-amber-200 bg-amber-50 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-800"
                      [attr.aria-label]="'Shifted ' + shift.text"
                    >
                      <i
                        class="fa-solid text-[8px]"
                        [class.fa-arrow-down]="shift.later"
                        [class.fa-arrow-up]="!shift.later"
                        aria-hidden="true"
                      ></i>
                      {{ shift.text }}
                    </span>
                  }
                }
```

- [ ] **Step 3: Remove the detected "High signal" detail pill**

In `src/client/src/app/features/events/event-detail-panel.component.html`, delete the detected pill block (lines 206-208), leaving the date span on line 205 in place:

```html
      @if (item.priority === 'high') {
        <app-detail-panel-pill tone="red">High signal</app-detail-panel-pill>
      }
```

Do NOT touch the authored blocks at lines 29 (`d.priority` "High priority" pill) or 63 (`d.priority` red banner) — those use the `d` (authored event) context and stay.

- [ ] **Step 4: Verify only authored/export/count high-priority sites remain**

Run: `cd src/client && grep -rn --include="*.html" --include="*.ts" "=== 'high'" src/app | grep -v ".spec.ts"`
Expected: exactly these 5 lines remain (no `events-page.component.html:148`, no detected `event-detail-panel.component.html:206`):
- `src/app/features/events/events-export.util.ts` (export column)
- `src/app/features/events/event-detail-panel.component.html` line 29 (`d.priority`)
- `src/app/features/events/event-detail-panel.component.html` line 63 (`d.priority`)
- `src/app/features/events/events-page.component.html` (the authored `@default` pill)
- `src/app/features/events/event-detail-panel.component.ts` (`highPriorityCount`)

- [ ] **Step 5: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: both succeed with no errors.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/events/events-page.component.html src/client/src/app/features/events/event-detail-panel.component.html
git commit -m "feat(events): remove detected high pill, border, and high-signal detail pill"
```

---

### Task 3: Full verification and manual smoke

**Files:** none (verification only)

**Interfaces:** none.

- [ ] **Step 1: Run the events integration suite**

Run: `cd src/client && npx vitest run integration/tests/events-detected-date-moved-title.spec.ts integration/tests/events-hierarchical-scope.spec.ts`
Expected: PASS. (The hierarchical-scope suite exercises the same RPC with priority/scope filters; confirm the `p_priority` filter change did not regress authored-event filtering.)

- [ ] **Step 2: Run the events unit specs**

Run: `cd src/client && npm run test:units -- events`
Expected: PASS for `server-query.spec.ts`, `events-export.util.spec.ts`, and any events component specs. If a spec asserts a detected row renders a "High" pill or a detected priority value of `'high'`, update it to expect `null`/no pill and re-run.

- [ ] **Step 3: Manual smoke in the browser**

Run the app (`cd src/client && ng serve` or the project's run skill) and open the events feed for a space with detected changes:
- Confirm detected rows show NO red "High" pill and NO left border; `date_moved` rows still show the amber shift chip ("369d ..."/"52d ...").
- Open a detected row's detail panel: confirm NO "High signal" pill; the WAS -> NOW diff hero still renders.
- Confirm an authored high-priority event still shows the red "High" pill in the table and the "High priority" pill + red banner in its detail panel.
- Apply the table's Priority = High filter: confirm detected rows drop out and only authored high-priority events remain.

- [ ] **Step 4: No commit** (verification only; any spec fixes in Step 2 are committed with their own message, e.g. `test(events): expect no priority on detected rows`).
