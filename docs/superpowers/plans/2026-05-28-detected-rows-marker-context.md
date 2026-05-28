# Detected Rows Full Marker Context Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Widen the marker change-event payload so every detected row in the events feed renders marker title/type/color and all simultaneously-changed fields (old → new, truncated to 40 chars), and unify the payload key as `changes`.

**Architecture:** One Postgres migration replaces `_emit_events_from_marker_change` to stash marker context (title, type name, color, plus reclassification from/to names) in payload for every marker event type, and to write a unified `changes: { field: { from, to } }` map for multi-field edits. The RPC `get_events_page_data` is untouched — all new context flows through the existing `change_payload` jsonb. The client formatter (`change-event-summary.ts`) gains two helpers (`truncate`, `renderFieldChanges`) and updates four cases to render the from/to pairs. The events-page stub reads marker context from the payload instead of hard-coding null.

**Tech Stack:** PostgreSQL (Supabase migrations with inline `DO $$` smoke tests), Angular 19 standalone, Vitest, PrimeNG 21.

**Spec:** `docs/superpowers/specs/2026-05-28-detected-rows-marker-context-design.md`

---

## File map

**Create:**
- `supabase/migrations/20260528130200_marker_change_payload_full_context.sql` — `create or replace function public._emit_events_from_marker_change`. Stashes marker context in payload for all six marker event types, replaces `secondary_changes` with `changes`, adds `changes` map to `marker_updated`. Inline `DO $$` smoke verifies all four assertions in the spec's "SQL smoke" section.

**Modify:**
- `src/client/src/app/shared/utils/change-event-summary.spec.ts` — add 8 Vitest cases (lines append at end of `describe` block).
- `src/client/src/app/shared/utils/change-event-summary.ts` — add `truncate()` and `renderFieldChanges()` helpers; update `marker_updated`, `date_moved`, `projection_finalized`, `marker_reclassified` cases.
- `src/client/src/app/features/events/events-page.component.ts:224-247` — `getDetectedSummary` reads marker context from `item.change_payload`.

**Do not touch:**
- `supabase/migrations/20260527120100_events_rpc_unified_feed.sql` — RPC unchanged.
- `supabase/migrations/20260528120000_marker_change_payload_event_date.sql` — keep history; new migration supersedes its function body via `create or replace`.
- `src/client/src/app/features/events/event-detail-panel.component.ts` — right rail unchanged.
- `src/client/src/app/core/services/event.service.ts` — RPC shape unchanged.
- `src/client/src/app/core/models/event.model.ts` — `FeedItem` already has `change_payload: Record<string, unknown> | null`.

---

## Task 1: Migration — widen marker change-event payload

Replaces `_emit_events_from_marker_change` in full. Resolves marker_type name+color via lookup at write time, stashes title, type name, color, and (for reclassified) from/to type names in payload. Builds a unified `changes` map keyed by field name; previous `secondary_changes` callsites become `changes`. Inline `DO $$` smoke asserts all four spec scenarios.

**Files:**
- Create: `supabase/migrations/20260528130200_marker_change_payload_full_context.sql`

- [ ] **Step 1: Confirm the migration filename slot is free**

Run: `ls supabase/migrations/ | grep 20260528130200`
Expected: no output (file does not exist yet). If it exists, bump to `20260528130300` and use that throughout the rest of the task. Parallel sessions may have taken the slot.

- [ ] **Step 2: Create the migration file with the function replace**

Create `supabase/migrations/20260528130200_marker_change_payload_full_context.sql` with this content:

```sql
-- migration: 20260528130200_marker_change_payload_full_context
-- purpose: enrich every marker-derived trial_change_events payload with
--   marker_title, marker_type_name, marker_color so the events feed can
--   render full context without RPC joins. Unify multi-field-change capture
--   under a single `changes` key (renaming `secondary_changes`). Add the
--   `changes` map to marker_updated payloads so old/new values render in
--   the feed for every edited field.
--
-- spec: docs/superpowers/specs/2026-05-28-detected-rows-marker-context-design.md
-- supersedes function body from 20260528120000_marker_change_payload_event_date.sql
--   (active signature: uuid, varchar). Trigger registration is unchanged.

create or replace function public._emit_events_from_marker_change(
  p_marker_change_id uuid,
  p_source           varchar(20) default 'analyst'
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_marker_id      uuid;
  v_space_id       uuid;
  v_change_type    varchar(20);
  v_old            jsonb;
  v_new            jsonb;
  v_changed_at     timestamptz;
  v_assignment     record;
  v_event_type     varchar(40);
  v_payload        jsonb;
  v_changes        jsonb;
  v_old_event_date date;
  v_new_event_date date;
  v_old_end_date   date;
  v_new_end_date   date;
  v_old_title      text;
  v_new_title      text;
  v_old_proj       text;
  v_new_proj       text;
  v_old_type       uuid;
  v_new_type       uuid;
  v_old_descr      text;
  v_new_descr      text;
  v_marker_title   text;
  v_marker_type_name text;
  v_marker_color   text;
  v_from_type_name text;
  v_to_type_name   text;
  v_days_diff      int;
  v_direction      text;
  v_marker_id_for_event uuid;
begin
  select marker_id, space_id, change_type, old_values, new_values, changed_at
    into v_marker_id, v_space_id, v_change_type, v_old, v_new, v_changed_at
    from public.marker_changes
   where id = p_marker_change_id;

  if v_marker_id is null then
    raise exception '_emit_events_from_marker_change: audit row % not found', p_marker_change_id;
  end if;

  v_old_event_date := nullif(v_old ->> 'event_date', '')::date;
  v_new_event_date := nullif(v_new ->> 'event_date', '')::date;
  v_old_end_date   := nullif(v_old ->> 'end_date', '')::date;
  v_new_end_date   := nullif(v_new ->> 'end_date', '')::date;
  v_old_title      := v_old ->> 'title';
  v_new_title      := v_new ->> 'title';
  v_old_proj       := v_old ->> 'projection';
  v_new_proj       := v_new ->> 'projection';
  v_old_type       := nullif(v_old ->> 'marker_type_id', '')::uuid;
  v_new_type       := nullif(v_new ->> 'marker_type_id', '')::uuid;
  v_old_descr      := v_old ->> 'description';
  v_new_descr      := v_new ->> 'description';

  -- resolve marker context for payload stashing. for 'deleted' we read the
  -- pre-delete title from v_old and look up the type by v_old_type.
  v_marker_title := case
    when v_change_type = 'deleted' then v_old_title
    else v_new_title
  end;

  select name, color into v_marker_type_name, v_marker_color
    from public.marker_types
   where id = case
     when v_change_type = 'deleted' then v_old_type
     else v_new_type
   end;

  v_changes := '{}'::jsonb;

  if v_change_type = 'created' then
    v_event_type := 'marker_added';
    v_payload := jsonb_build_object(
      'event_date',       v_new ->> 'event_date',
      'marker_type_id',   v_new ->> 'marker_type_id',
      'projection',       v_new ->> 'projection',
      'marker_title',     v_marker_title,
      'marker_type_name', v_marker_type_name,
      'marker_color',     v_marker_color
    );

  elsif v_change_type = 'deleted' then
    v_event_type := 'marker_removed';
    v_payload := jsonb_build_object(
      'event_date',       v_old ->> 'event_date',
      'marker_type_id',   v_old ->> 'marker_type_id',
      'projection',       v_old ->> 'projection',
      'marker_title',     v_marker_title,
      'marker_type_name', v_marker_type_name,
      'marker_color',     v_marker_color
    );

  elsif v_change_type = 'updated' then
    if v_old_event_date is distinct from v_new_event_date then
      v_event_type := 'date_moved';
      v_days_diff := abs((v_new_event_date - v_old_event_date));
      v_direction := case
        when v_new_event_date > v_old_event_date then 'slip'
        when v_new_event_date < v_old_event_date then 'accelerate'
        else 'none'
      end;
      v_payload := jsonb_build_object(
        'which_date',       'event_date',
        'from',             v_old_event_date,
        'to',               v_new_event_date,
        'days_diff',        v_days_diff,
        'direction',        v_direction,
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
      if v_old_proj is distinct from v_new_proj then
        v_changes := v_changes || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      if v_old_type is distinct from v_new_type then
        v_changes := v_changes || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_new_proj = 'actual' and v_old_proj is distinct from 'actual' then
      v_event_type := 'projection_finalized';
      v_payload := jsonb_build_object(
        'from',             v_old_proj,
        'to',               v_new_proj,
        'event_date',       v_new ->> 'event_date',
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
      if v_old_type is distinct from v_new_type then
        v_changes := v_changes || jsonb_build_object(
          'marker_type_id', jsonb_build_object('from', v_old_type, 'to', v_new_type));
      end if;
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_type is distinct from v_new_type then
      v_event_type := 'marker_reclassified';
      select name into v_from_type_name from public.marker_types where id = v_old_type;
      select name into v_to_type_name   from public.marker_types where id = v_new_type;
      v_payload := jsonb_build_object(
        'from_type_id',         v_old_type,
        'to_type_id',           v_new_type,
        'from_marker_type_name', v_from_type_name,
        'to_marker_type_name',   v_to_type_name,
        'event_date',           v_new ->> 'event_date',
        'marker_title',         v_marker_title,
        'marker_color',         v_marker_color
      );
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;

    elsif v_old_title is distinct from v_new_title
       or v_old_descr is distinct from v_new_descr
       or v_old_end_date is distinct from v_new_end_date
       or v_old_proj is distinct from v_new_proj then
      v_event_type := 'marker_updated';
      -- build the unified `changes` map for every changed field
      if v_old_title is distinct from v_new_title then
        v_changes := v_changes || jsonb_build_object(
          'title', jsonb_build_object('from', v_old_title, 'to', v_new_title));
      end if;
      if v_old_descr is distinct from v_new_descr then
        v_changes := v_changes || jsonb_build_object(
          'description', jsonb_build_object('from', v_old_descr, 'to', v_new_descr));
      end if;
      if v_old_end_date is distinct from v_new_end_date then
        v_changes := v_changes || jsonb_build_object(
          'end_date', jsonb_build_object('from', v_old_end_date, 'to', v_new_end_date));
      end if;
      if v_old_proj is distinct from v_new_proj then
        v_changes := v_changes || jsonb_build_object(
          'projection', jsonb_build_object('from', v_old_proj, 'to', v_new_proj));
      end if;
      -- also derive the back-compat changed_fields array from the same set
      v_payload := jsonb_build_object(
        'changed_fields',   coalesce(
          (select jsonb_agg(k) from jsonb_object_keys(v_changes) as k),
          '[]'::jsonb
        ),
        'event_date',       v_new ->> 'event_date',
        'marker_title',     v_marker_title,
        'marker_type_name', v_marker_type_name,
        'marker_color',     v_marker_color
      );
    else
      return;
    end if;
  else
    raise exception '_emit_events_from_marker_change: unknown change_type %', v_change_type;
  end if;

  if v_changes <> '{}'::jsonb then
    v_payload := v_payload || jsonb_build_object('changes', v_changes);
  end if;

  v_marker_id_for_event := case
    when v_change_type = 'deleted' then null
    else v_marker_id
  end;

  for v_assignment in
    select trial_id
      from public.marker_assignments
     where marker_id = v_marker_id
  loop
    insert into public.trial_change_events (
      trial_id,
      space_id,
      event_type,
      source,
      payload,
      occurred_at,
      observed_at,
      derived_from_marker_change_id,
      marker_id
    ) values (
      v_assignment.trial_id,
      v_space_id,
      v_event_type,
      p_source,
      v_payload,
      v_changed_at,
      now(),
      p_marker_change_id,
      v_marker_id_for_event
    );
  end loop;
end;
$$;

revoke execute on function public._emit_events_from_marker_change(uuid, varchar) from public;

comment on function public._emit_events_from_marker_change(uuid, varchar) is
  'Internal: classify a marker_changes row per spec rules and fan out one trial_change_events row per marker_assignments link. SECURITY DEFINER. Stashes marker_title / marker_type_name / marker_color in payload for every marker event type so the events-feed renderer needs no JOINs. Multi-field simultaneous edits ride in payload.changes (unified key; replaces secondary_changes).';
```

- [ ] **Step 3: Append the inline smoke test**

Append this `DO $$` block to the same migration file (after the `comment on function`):

```sql
-- =============================================================================
-- smoke: payload stashing + unified `changes` map + reclassification names
-- =============================================================================
do $$
declare
  v_agency_id    uuid := 'fffffff1-ffff-ffff-ffff-fffffffff001';
  v_tenant_id    uuid := 'fffffff2-ffff-ffff-ffff-fffffffff002';
  v_user_id      uuid := 'fffffff3-ffff-ffff-ffff-fffffffff003';
  v_space_id     uuid := 'fffffff4-ffff-ffff-ffff-fffffffff004';
  v_company_id   uuid := 'fffffff5-ffff-ffff-ffff-fffffffff005';
  v_asset_id     uuid := 'fffffff6-ffff-ffff-ffff-fffffffff006';
  v_trial_id     uuid := 'fffffff7-ffff-ffff-ffff-fffffffff007';
  v_marker_id    uuid;
  -- system marker types seeded by 20260414024141_marker_visual_redesign:
  v_type_a       uuid := 'a0000000-0000-0000-0000-000000000030';  -- Interim Data
  v_type_b       uuid := 'a0000000-0000-0000-0000-000000000031';  -- Full Data
  v_added        jsonb;
  v_removed      jsonb;
  v_updated      jsonb;
  v_date_moved   jsonb;
  v_reclassified jsonb;
begin
  -- bootstrap hermetic fixture (pattern matches 20260528120000)
  insert into auth.users (id, email)
    values (v_user_id, 'detected-context-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'DRC Smoke', 'drc-smoke', 'drcsmoke', 'DRC', 'drc@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'DRC', 'drc-smoke-t', 'drcsmoket', 'DRC');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'DRC Smoke Co');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_user_id, v_company_id, 'DRC Smoke Drug');

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_asset_id, 'DRC_TRIAL', 'NCT-DRC-SMOKE');

  -- (1) marker_added smoke
  insert into public.markers (space_id, marker_type_id, title, projection, event_date, created_by)
    values (v_space_id, v_type_a, 'Smoke title 1', 'stout', '2030-01-01', v_user_id)
    returning id into v_marker_id;
  insert into public.marker_assignments (marker_id, trial_id)
    values (v_marker_id, v_trial_id);

  select payload into v_added
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_added'
   order by occurred_at desc limit 1;

  if v_added->>'marker_title' is null then
    raise exception 'marker_added FAIL: marker_title missing (got: %)', v_added;
  end if;
  if v_added->>'marker_type_name' is null then
    raise exception 'marker_added FAIL: marker_type_name missing (got: %)', v_added;
  end if;
  if v_added->>'marker_color' is null then
    raise exception 'marker_added FAIL: marker_color missing (got: %)', v_added;
  end if;

  -- (2) marker_updated smoke: multi-field edit (title + description + end_date + projection)
  update public.markers
     set title = 'Smoke title 2',
         description = 'New description',
         end_date = '2030-02-01',
         projection = 'company'
   where id = v_marker_id;

  select payload into v_updated
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_updated'
   order by occurred_at desc limit 1;

  if not (v_updated -> 'changes' ? 'title') then
    raise exception 'marker_updated FAIL: changes.title missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'description') then
    raise exception 'marker_updated FAIL: changes.description missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'end_date') then
    raise exception 'marker_updated FAIL: changes.end_date missing (got: %)', v_updated;
  end if;
  if not (v_updated -> 'changes' ? 'projection') then
    raise exception 'marker_updated FAIL: changes.projection missing (got: %)', v_updated;
  end if;
  if (v_updated -> 'changes' -> 'title' ->> 'from') is null then
    raise exception 'marker_updated FAIL: changes.title.from missing (got: %)', v_updated;
  end if;
  if (v_updated -> 'changes' -> 'title' ->> 'to') is null then
    raise exception 'marker_updated FAIL: changes.title.to missing (got: %)', v_updated;
  end if;
  if v_updated->>'marker_title' is null then
    raise exception 'marker_updated FAIL: marker_title missing (got: %)', v_updated;
  end if;

  -- (3) date_moved + simultaneous description edit
  update public.markers
     set event_date = '2030-03-01',
         description = 'Another description'
   where id = v_marker_id;

  select payload into v_date_moved
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'date_moved'
   order by occurred_at desc limit 1;

  if not (v_date_moved -> 'changes' ? 'description') then
    raise exception 'date_moved FAIL: changes.description missing (got: %)', v_date_moved;
  end if;
  if v_date_moved->>'marker_title' is null then
    raise exception 'date_moved FAIL: marker_title missing (got: %)', v_date_moved;
  end if;

  -- (4) marker_reclassified + simultaneous end_date edit
  update public.markers
     set marker_type_id = v_type_b,
         end_date = '2030-04-01'
   where id = v_marker_id;

  select payload into v_reclassified
    from public.trial_change_events
   where marker_id = v_marker_id and event_type = 'marker_reclassified'
   order by occurred_at desc limit 1;

  if v_reclassified->>'from_marker_type_name' is null then
    raise exception 'marker_reclassified FAIL: from_marker_type_name missing (got: %)', v_reclassified;
  end if;
  if v_reclassified->>'to_marker_type_name' is null then
    raise exception 'marker_reclassified FAIL: to_marker_type_name missing (got: %)', v_reclassified;
  end if;
  if not (v_reclassified -> 'changes' ? 'end_date') then
    raise exception 'marker_reclassified FAIL: changes.end_date missing (got: %)', v_reclassified;
  end if;

  -- (5) marker_removed smoke
  delete from public.markers where id = v_marker_id;

  select payload into v_removed
    from public.trial_change_events
   where derived_from_marker_change_id in (
     select id from public.marker_changes where marker_id = v_marker_id and change_type = 'deleted'
   )
   order by occurred_at desc limit 1;

  if v_removed->>'marker_title' is null then
    raise exception 'marker_removed FAIL: marker_title missing (got: %)', v_removed;
  end if;
  if v_removed->>'marker_type_name' is null then
    raise exception 'marker_removed FAIL: marker_type_name missing (got: %)', v_removed;
  end if;

  -- cleanup (reverse dependency order, same pattern as 20260528120000)
  delete from public.trial_change_events where space_id = v_space_id;
  delete from public.marker_changes where space_id = v_space_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'detected rows context smoke: PASS';
end $$;
```

- [ ] **Step 4: Apply the migration locally**

Run: `supabase db reset`
Expected: at the end of reset output, `NOTICE: detected rows context smoke: PASS`. Any `FAIL:` raise stops the reset with the offending payload printed — fix the trigger body to match the expectation, re-run reset.

- [ ] **Step 5: Run the advisor**

Run: `supabase db advisors --local --type all`
Expected: no new warnings or errors introduced by this migration.

- [ ] **Step 6: Commit**

Run:
```bash
git add supabase/migrations/20260528130200_marker_change_payload_full_context.sql
git commit -m "Widen marker change-event payload with context and unified changes map"
```

---

## Task 2: Client formatter — render multi-field changes with truncation

Adds `truncate()` and `renderFieldChanges()` helpers, updates four formatter cases to read from `payload.changes` (with `secondary_changes` fallback for in-flight rows). Vitest specs first per TDD.

**Files:**
- Modify: `src/client/src/app/shared/utils/change-event-summary.spec.ts` — append 8 cases.
- Modify: `src/client/src/app/shared/utils/change-event-summary.ts` — add helpers, update 4 cases.

- [ ] **Step 1: Append the failing Vitest specs**

Open `src/client/src/app/shared/utils/change-event-summary.spec.ts`. Inside the existing `describe('summarySegmentsFor marker-related events', () => { ... })` block, append these 8 `it` blocks just before the closing `});`:

```ts
  it('marker_updated renders each changed field as old → new', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: {
          changed_fields: ['title', 'description'],
          changes: {
            title: { from: 'Old title', to: 'New title' },
            description: { from: 'Old text', to: 'New text' },
          },
          event_date: '2026-06-20',
          marker_title: 'PDUFA decision',
          marker_type_name: 'Topline readout',
          marker_color: '#0ea5e9',
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Old title');
    expect(text).toContain('New title');
    expect(text).toContain('Old text');
    expect(text).toContain('New text');
  });

  it('marker_updated truncates values longer than 40 chars with ellipsis', () => {
    const longOld = 'A'.repeat(60);
    const longNew = 'B'.repeat(60);
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: {
          changed_fields: ['description'],
          changes: { description: { from: longOld, to: longNew } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('…');
    expect(text).not.toContain(longOld);
    expect(text).not.toContain(longNew);
  });

  it('marker_updated legacy slim payload (changed_fields only) still renders field names', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_updated',
        payload: { changed_fields: ['title', 'description'] },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('title');
    expect(text).toContain('description');
    // no `changes` map present, so no strikethrough/bold value pairs
    expect(text).not.toContain('→');
  });

  it('marker_added picks up marker_title from payload when ChangeEvent.marker_title is null', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_added',
        marker_title: null,
        payload: {
          event_date: '2026-06-20',
          marker_title: 'PDUFA decision (from payload)',
          marker_type_name: 'Topline readout',
        },
      })
    );
    // formatter still keys off e.marker_title, so this case asserts the
    // legacy contract — the stub remap happens in events-page.component.ts.
    // here we just confirm e.marker_title=null collapses gracefully and
    // does NOT crash on the payload-stashed value.
    expect(result.segments.length).toBeGreaterThan(0);
  });

  it('date_moved with simultaneous description edit renders BOTH primary and secondary', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'date_moved',
        marker_title: 'TRIUMPH-1 readout',
        payload: {
          which_date: 'event_date',
          from: '2026-10-19',
          to: '2026-10-21',
          days_diff: 2,
          direction: 'slip',
          changes: { description: { from: 'Old desc', to: 'New desc' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('event date');
    expect(text).toContain('Old desc');
    expect(text).toContain('New desc');
  });

  it('date_moved still reads legacy secondary_changes key (in-flight rows)', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'date_moved',
        marker_title: 'TRIUMPH-1 readout',
        payload: {
          which_date: 'event_date',
          from: '2026-10-19',
          to: '2026-10-21',
          days_diff: 2,
          direction: 'slip',
          secondary_changes: { description: { from: 'Old desc', to: 'New desc' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Old desc');
    expect(text).toContain('New desc');
  });

  it('projection_finalized with simultaneous title edit renders both', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'projection_finalized',
        payload: {
          from: 'projected',
          to: 'actual',
          event_date: '2026-06-20',
          changes: { title: { from: 'Old', to: 'New' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('projected');
    expect(text).toContain('actual');
    expect(text).toContain('Old');
    expect(text).toContain('New');
  });

  it('marker_reclassified with simultaneous end_date edit renders both', () => {
    const result = summarySegmentsFor(
      baseEvent({
        event_type: 'marker_reclassified',
        from_marker_type_name: 'Interim readout',
        to_marker_type_name: 'Topline readout',
        payload: {
          from_type_id: 'a',
          to_type_id: 'b',
          event_date: '2026-06-20',
          changes: { end_date: { from: '2026-06-01', to: '2026-07-15' } },
        },
      })
    );
    const text = joinText(result.segments);
    expect(text).toContain('Interim readout');
    expect(text).toContain('Topline readout');
    expect(text).toContain('2026-06-01');
    expect(text).toContain('2026-07-15');
  });
```

- [ ] **Step 2: Run the new specs and confirm they fail**

Run: `cd src/client && npm run test:units -- src/app/shared/utils/change-event-summary.spec.ts`
Expected: at least 6 of the 8 new cases FAIL (the legacy slim-payload case and the marker_added-graceful-null case should already pass). Specifically:
- "marker_updated renders each changed field as old → new" — FAIL (no changes-map parsing yet)
- "marker_updated truncates values longer than 40 chars" — FAIL
- "date_moved with simultaneous description edit" — FAIL (formatter ignores changes)
- "date_moved still reads legacy secondary_changes" — FAIL
- "projection_finalized with simultaneous title edit" — FAIL
- "marker_reclassified with simultaneous end_date edit" — FAIL

- [ ] **Step 3: Add the `truncate` and `renderFieldChanges` helpers**

In `src/client/src/app/shared/utils/change-event-summary.ts`, just below the `markerContextSegments` function (around line 234), append these two helpers:

```ts
const TRUNCATE_AT = 40;

function truncate(s: string): string {
  return s.length > TRUNCATE_AT ? s.slice(0, TRUNCATE_AT - 1) + '…' : s;
}

interface FieldChange {
  from: unknown;
  to: unknown;
}

function isFieldChange(v: unknown): v is FieldChange {
  return typeof v === 'object' && v !== null && ('from' in v || 'to' in v);
}

/**
 * Render a `changes` map ({ field: { from, to } }) as a leading-comma list of
 * `, {label} (~~old~~ → **new**)` segments. Reads `payload.changes` (preferred)
 * and falls back to `payload.secondary_changes` for in-flight rows written
 * before migration 20260528130200. Returns [] when neither key is present.
 */
function renderFieldChanges(payload: Record<string, unknown>): SummarySegment[] {
  const raw = payload['changes'] ?? payload['secondary_changes'];
  if (typeof raw !== 'object' || raw === null) return [];
  const entries = Object.entries(raw as Record<string, unknown>).filter(([, v]) =>
    isFieldChange(v)
  );
  if (entries.length === 0) return [];
  const segs: SummarySegment[] = [];
  for (const [field, change] of entries) {
    const { from, to } = change as FieldChange;
    const label = (MARKER_FIELD_LABELS[field] ?? field.replace(/_/g, ' ')).toLowerCase();
    const fromStr = truncate(formatMarkerFieldValue(field, from) ?? '');
    const toStr = truncate(formatMarkerFieldValue(field, to) ?? '');
    segs.push({ kind: 'plain', text: `, ${label} (` });
    segs.push({ kind: 'old', text: fromStr });
    segs.push({ kind: 'arrow' });
    segs.push({ kind: 'new', text: toStr });
    segs.push({ kind: 'plain', text: ')' });
  }
  return segs;
}
```

You also need to import `formatMarkerFieldValue` from `./marker-fields`. Update the import line at the top of the file (currently `import { MARKER_FIELD_LABELS, formatDateRange, formatShortDate } from './marker-fields';`) to:

```ts
import {
  MARKER_FIELD_LABELS,
  formatDateRange,
  formatMarkerFieldValue,
  formatShortDate,
} from './marker-fields';
```

- [ ] **Step 4: Update the `marker_updated` case to use `renderFieldChanges`**

Locate the `case 'marker_updated':` block in `summarySegmentsFor` (around lines 450-464). Replace the entire case with:

```ts
    case 'marker_updated': {
      const changesSegs = renderFieldChanges(p);
      let segments: SummarySegment[];
      if (changesSegs.length > 0) {
        // rich payload: lead with "Marker edited" then , field (old → new), ...
        segments = [{ kind: 'plain', text: 'Marker edited' }, ...changesSegs];
      } else {
        // legacy slim payload: field names only
        const raw = (p['changed_fields'] as string[] | undefined) ?? [];
        const fields = raw
          .map((f) => MARKER_FIELD_LABELS[f] ?? f.replace(/_/g, ' '))
          .map((label) => label.charAt(0).toLowerCase() + label.slice(1))
          .join(', ');
        segments = fields
          ? [
              { kind: 'plain', text: 'Marker edited: ' },
              { kind: 'plain', text: fields },
            ]
          : [{ kind: 'plain', text: 'Marker edited' }];
      }
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

- [ ] **Step 5: Update the `date_moved` case to append `changes`**

Locate the `case 'date_moved':` block. Find the two `return` statements (one in the `which === 'event_date' && e.marker_title` branch, one in the else branch). In both, after building the existing `segments` array, append `renderFieldChanges(p)` BEFORE the return. Concretely, change:

```ts
      if (which === 'event_date' && e.marker_title) {
        return {
          color,
          segments: [
            { kind: 'plain', text: `${e.marker_title}: event date ${direction}${magnitude} (` },
            { kind: 'old', text: fromStr },
            { kind: 'arrow' },
            { kind: 'new', text: toStr },
            { kind: 'plain', text: ')' },
          ],
        };
      }
      const label = TRIAL_DATE_LABEL[which] ?? MARKER_FIELD_LABELS[which] ?? 'Date';
      return {
        color,
        segments: [
          { kind: 'plain', text: `${label} ${direction}${magnitude} (` },
          { kind: 'old', text: fromStr },
          { kind: 'arrow' },
          { kind: 'new', text: toStr },
          { kind: 'plain', text: ')' },
        ],
      };
```

into:

```ts
      if (which === 'event_date' && e.marker_title) {
        const segments: SummarySegment[] = [
          { kind: 'plain', text: `${e.marker_title}: event date ${direction}${magnitude} (` },
          { kind: 'old', text: fromStr },
          { kind: 'arrow' },
          { kind: 'new', text: toStr },
          { kind: 'plain', text: ')' },
        ];
        segments.push(...renderFieldChanges(p));
        return { color, segments };
      }
      const label = TRIAL_DATE_LABEL[which] ?? MARKER_FIELD_LABELS[which] ?? 'Date';
      const segments: SummarySegment[] = [
        { kind: 'plain', text: `${label} ${direction}${magnitude} (` },
        { kind: 'old', text: fromStr },
        { kind: 'arrow' },
        { kind: 'new', text: toStr },
        { kind: 'plain', text: ')' },
      ];
      segments.push(...renderFieldChanges(p));
      return { color, segments };
```

- [ ] **Step 6: Update the `projection_finalized` case to append `changes`**

Locate `case 'projection_finalized':`. Change:

```ts
    case 'projection_finalized': {
      const segments: SummarySegment[] = [
        { kind: 'plain', text: 'Projection: ' },
        { kind: 'old', text: 'projected' },
        { kind: 'arrow' },
        { kind: 'new', text: 'actual' },
      ];
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

into:

```ts
    case 'projection_finalized': {
      const segments: SummarySegment[] = [
        { kind: 'plain', text: 'Projection: ' },
        { kind: 'old', text: 'projected' },
        { kind: 'arrow' },
        { kind: 'new', text: 'actual' },
      ];
      segments.push(...renderFieldChanges(p));
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

- [ ] **Step 7: Update the `marker_reclassified` case to append `changes`**

Locate `case 'marker_reclassified':`. Change:

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

into:

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
      segments.push(...renderFieldChanges(p));
      segments.push(...markerContextSegments(e, p));
      return { color, segments };
    }
```

- [ ] **Step 8: Run the spec — all should pass**

Run: `cd src/client && npm run test:units -- src/app/shared/utils/change-event-summary.spec.ts`
Expected: all cases PASS (the original 6 from prior sessions + the 8 new ones). If "marker_reclassified with simultaneous end_date edit" still fails on the date strings ('2026-06-01' / '2026-07-15'), the issue is that `formatMarkerFieldValue` formats dates as `Jun 1, 2026`, not as the ISO string. Update the test to assert on the formatted string instead:

```ts
    expect(text).toContain('Jun 1, 2026');
    expect(text).toContain('Jul 15, 2026');
```

Run the spec again to confirm green.

- [ ] **Step 9: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors. No new warnings beyond the existing baseline.

- [ ] **Step 10: Commit**

Run:
```bash
git add src/client/src/app/shared/utils/change-event-summary.ts src/client/src/app/shared/utils/change-event-summary.spec.ts
git commit -m "Render marker_updated and multi-field edits in detected feed rows"
```

---

## Task 3: Events-page stub — read marker context from payload

`getDetectedSummary` currently hard-codes `marker_title`, `marker_color`, `marker_type_name`, `from_marker_type_name`, `to_marker_type_name` to `null`. Read them from `item.change_payload` so the formatter has data to render.

**Files:**
- Modify: `src/client/src/app/features/events/events-page.component.ts:224-247`

- [ ] **Step 1: Update `getDetectedSummary` to source marker context from payload**

In `src/client/src/app/features/events/events-page.component.ts`, locate `protected getDetectedSummary(item: FeedItem): RichSummary` (around lines 224-247). Replace the body with:

```ts
  protected getDetectedSummary(item: FeedItem): RichSummary {
    const p = (item.change_payload ?? {}) as Record<string, unknown>;
    const stub: ChangeEvent = {
      id: item.id,
      trial_id: item.entity_id ?? '',
      space_id: this.spaceId,
      event_type: item.change_event_type!,
      source: item.change_source ?? 'ctgov',
      payload: item.change_payload ?? {},
      occurred_at: item.event_date,
      observed_at: item.feed_ts ?? item.observed_at ?? item.event_date,
      marker_id: null,
      trial_name: item.entity_name,
      trial_identifier: null,
      asset_name: null,
      company_name: item.company_name,
      company_logo_url: item.company_logo_url,
      marker_title: (p['marker_title'] as string | undefined) ?? null,
      marker_color: (p['marker_color'] as string | undefined) ?? null,
      marker_type_name: (p['marker_type_name'] as string | undefined) ?? null,
      from_marker_type_name: (p['from_marker_type_name'] as string | undefined) ?? null,
      to_marker_type_name: (p['to_marker_type_name'] as string | undefined) ?? null,
    };
    return summarySegmentsFor(stub);
  }
```

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors. No new warnings.

- [ ] **Step 3: Commit**

Run:
```bash
git add src/client/src/app/features/events/events-page.component.ts
git commit -m "Events feed: read detected marker context from change_payload"
```

---

## Task 4: Verification pass

End-to-end check before push. Runs the full test suite, advisor, and a manual browser scenario.

- [ ] **Step 1: Run all client unit tests**

Run: `cd src/client && npm run test:units`
Expected: all pass.

- [ ] **Step 2: Lint and build**

Run: `cd src/client && ng lint && ng build`
Expected: 0 errors.

- [ ] **Step 3: Reset DB and run advisor**

Run: `supabase db reset && supabase db advisors --local --type all`
Expected: smoke `detected rows context smoke: PASS` notice fires; advisor reports no new findings.

- [ ] **Step 4: Manual — multi-field marker edit**

Run: `cd src/client && npm run start`. Open the events page. Add a marker, then edit its title AND description in a single save. Confirm the new detected row shows:
1. `Marker edited` lead
2. `title (~~old title~~ → **new title**), description (~~old desc~~ → **new desc**)`
3. Trailing ` · {type} · {event date}` context

- [ ] **Step 5: Manual — date move with simultaneous edit**

In the same UI, edit the marker's event_date AND its description in a single save. Confirm the new row shows:
1. `{title}: event date delayed N days (~~from~~ → **to**)`
2. Followed by `, description (~~old~~ → **new**)`

- [ ] **Step 6: Manual — reclassification**

Change the marker's type. Confirm the row reads `Reclassified: ~~{old type}~~ → **{new type}** · {event date}`.

- [ ] **Step 7: Regenerate runbook**

Run: `cd src/client && npm run docs:arch`
Expected: AUTO-GEN blocks in `06-backend-architecture.md` and `07-database-schema.md` regenerate to pick up the new function definition. Commit any regen as part of the same change set.

- [ ] **Step 8: Commit runbook regen (if any) and push**

Run:
```bash
git add docs/runbook
git diff --cached --quiet || git commit -m "Regen runbook for marker payload context"
git push
```

---

## Self-review

**Spec coverage:**
- Trigger payload widening for all six marker event types → Task 1.
- Unified `changes` key rename across date_moved/projection_finalized/marker_reclassified, plus addition to marker_updated → Task 1.
- Reclassification from/to type names in payload → Task 1.
- 40-char truncation helper and renderFieldChanges → Task 2.
- Formatter updates for marker_updated, date_moved, projection_finalized, marker_reclassified → Task 2.
- Backward-compat fallback for legacy slim payload and `secondary_changes` key → Task 2 (Step 3 helper, Step 4 case).
- Events-page stub reads marker context from payload → Task 3.
- Vitest spec additions (8 cases) → Task 2.
- SQL smoke (5 scenarios: marker_added, marker_updated multi-field, date_moved + secondary, marker_reclassified + names + secondary, marker_removed) → Task 1.
- Manual browser walkthroughs → Task 4.

**Placeholder scan:** No "TBD", "TODO", or "fill in details" in any task. Every step has a code block or exact command. The migration body in Task 1 Step 2 is the complete `create or replace function` definition — not a sketch.

**Type consistency:**
- `renderFieldChanges(payload: Record<string, unknown>): SummarySegment[]` — same signature in Task 2 Step 3 (definition) and Steps 4-7 (callers).
- `FieldChange { from: unknown; to: unknown }` — defined in Step 3, narrowed in Step 3 via `isFieldChange`.
- `formatMarkerFieldValue(field, value)` — exists in `marker-fields.ts` (already imported pattern), used in Step 3.
- `MARKER_FIELD_LABELS` — already imported in `change-event-summary.ts`; lookup in Step 3.
- The `p` shadow inside `marker_updated` case (Step 4) — `p` is the existing parameter from `summarySegmentsFor(e: ChangeEvent)` body (`const p = e.payload;`), declared once at the top of the function.

**Scope check:** Three concrete file targets (migration, formatter+spec, events-page stub), each with a clear boundary. Each task produces an independently testable artifact. Verification is gated to its own task. Reasonable for a single implementation pass.

**Edge cases handled:**
- Empty `changes` map → no `changes` key written to payload (Task 1 conditional at the end).
- Marker deleted before payload built → `marker_title` resolved from `v_old`, `marker_type_name`/`marker_color` from a marker_types lookup keyed by `v_old_type`.
- Marker_updated with no `changes` (legacy slim payload) → falls back to `changed_fields` rendering (Task 2 Step 4).
- date_moved/projection_finalized/marker_reclassified with no `changes` and no `secondary_changes` → `renderFieldChanges` returns `[]`, no trailing segments (Task 2 Step 3 guard).
- Long descriptions → truncated at 40 chars with `…` (Task 2 Step 3).
