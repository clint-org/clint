# Trial Multi-Asset Phase 1A (Database Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the `trial_assets` join table, sync triggers, backfill, and the `set_trial_assets` RPC so a trial can belong to many assets, while `trials.asset_id` keeps working as a maintained primary-asset cache.

**Architecture:** `trial_assets(trial_id, asset_id, is_primary, source, created_at)` is the source of truth for the set of assets a trial tests. A bootstrap trigger creates the primary membership row whenever a trial is inserted; a sync trigger keeps `trials.asset_id` equal to the single `is_primary` member and promotes a replacement if the primary membership is removed. All multi-asset writes go through `set_trial_assets`, a SECURITY DEFINER RPC, never client DELETE+INSERT. This phase is purely additive: existing single-asset reads and `create_trial` are unchanged, so the app behaves identically until later phases consume the join table.

**Tech Stack:** Supabase Postgres migrations (PL/pgSQL), in-migration `do $$ ... $$` smoke assertions, Supabase CLI (`supabase db reset`, `supabase db advisors`).

**Spec:** `docs/superpowers/specs/2026-06-04-trial-multi-asset-design.md`

**Scope note:** This is the first of several plans for the spec. Phase 1B (worker extraction schema + import-review UI), Phase 2 (grouping/counting read RPCs + multi-asset delete semantics), and Phase 3 (trial-edit dialog + per-asset timelines) are separate plans written after 1A lands. Until Phase 2, deleting an asset still cascade-deletes a trial through `trials.asset_id`'s existing `ON DELETE CASCADE`; this is unchanged current behavior and is safe in 1A because no multi-asset trials exist yet (1B is what starts creating them).

**Conventions to follow (from the codebase):**
- Never edit an applied migration. Create a new timestamped file with `supabase migration new <name>`.
- Migrations carry their own `do $$ ... $$` smoke blocks that `raise exception` on failure, mirroring `20260526120100_shared_entity_create_rpcs.sql`. A failed assert aborts `supabase db reset`, so the smoke block IS the test.
- Local Supabase must be running (`supabase start`). Verify with `supabase db reset` after each migration.
- RLS for M2M tables is derived from the parent trial's `space_id` via an `exists` check, exactly like `trial_conditions` (`20260524120000_create_indication_condition_tables.sql:130-147`) and `marker_assignments` (`20260412130100_marker_system_redesign.sql:287-309`).

---

### Task 1: `trial_assets` table, indexes, partial unique, RLS

**Files:**
- Create: `supabase/migrations/<ts>_create_trial_assets.sql` (via `supabase migration new create_trial_assets`)

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new create_trial_assets`
This prints the path of a new empty file. Put all SQL below in it.

- [ ] **Step 2: Write the table, indexes, RLS, and a smoke block**

```sql
-- trial_assets: many-to-many between trials and assets.
-- Source of truth for the SET of assets a trial tests. trials.asset_id remains
-- a cached pointer to the single is_primary member (maintained by triggers added
-- in the next migration). Mirrors the trial_conditions / marker_assignments M2M
-- pattern: composite PK, both FKs ON DELETE CASCADE, RLS via the parent trial.

create table public.trial_assets (
  trial_id   uuid not null references public.trials(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  is_primary boolean not null default false,
  source     text not null default 'analyst',
  created_at timestamptz not null default now(),
  primary key (trial_id, asset_id)
);

create index idx_trial_assets_trial_id on public.trial_assets(trial_id);
create index idx_trial_assets_asset_id on public.trial_assets(asset_id);

-- At most one primary member per trial.
create unique index uq_trial_assets_one_primary
  on public.trial_assets(trial_id) where is_primary;

alter table public.trial_assets enable row level security;

-- RLS derived from the parent trial's space (same shape as trial_conditions).
create policy "trial_assets_select" on public.trial_assets
  for select using (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

create policy "trial_assets_insert" on public.trial_assets
  for insert with check (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

create policy "trial_assets_delete" on public.trial_assets
  for delete using (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

-- Smoke: table exists, partial unique index rejects a second primary.
do $$
declare
  v_space   uuid;
  v_company uuid;
  v_asset_a uuid;
  v_asset_b uuid;
  v_trial   uuid;
  v_uid     uuid;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'trial_assets smoke skipped: no auth user in local db';
    return;
  end if;

  select id into v_space from public.spaces limit 1;
  select id into v_company from public.companies where space_id = v_space limit 1;
  select id into v_asset_a from public.assets where space_id = v_space limit 1;
  select id into v_asset_b from public.assets where space_id = v_space and id <> v_asset_a limit 1;
  select id into v_trial from public.trials where space_id = v_space limit 1;

  if v_trial is null or v_asset_a is null or v_asset_b is null then
    raise notice 'trial_assets smoke skipped: seed data insufficient';
    return;
  end if;

  -- one primary is fine
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_a, true, 'smoke')
    on conflict (trial_id, asset_id) do update set is_primary = true;

  -- a second primary on the same trial must violate the partial unique index
  begin
    insert into public.trial_assets (trial_id, asset_id, is_primary, source)
      values (v_trial, v_asset_b, true, 'smoke');
    raise exception 'trial_assets smoke FAIL: second primary was allowed';
  exception when unique_violation then
    null; -- expected
  end;

  -- cleanup smoke rows
  delete from public.trial_assets where source = 'smoke';
  raise notice 'trial_assets smoke ok: table + partial unique';
end $$;
```

- [ ] **Step 3: Apply and verify**

Run: `supabase db reset`
Expected: completes without error; log shows `NOTICE: trial_assets smoke ok: table + partial unique` (or the "skipped" notice if local seed lacks two assets, which is acceptable).

- [ ] **Step 4: Advisor check**

Run: `supabase db advisors --local --type all`
Expected: no new ERROR or WARN attributable to `trial_assets` (RLS is enabled with policies, so no `rls_disabled` finding).

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "Add trial_assets join table (trials many-to-many assets)"
```

---

### Task 2: Bootstrap + sync triggers

**Files:**
- Create: `supabase/migrations/<ts>_trial_assets_triggers.sql` (via `supabase migration new trial_assets_triggers`)

These two triggers maintain the invariants: every trial has a primary membership, and `trials.asset_id` always equals it.

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new trial_assets_triggers`

- [ ] **Step 2: Write the bootstrap trigger (trial insert -> primary membership)**

```sql
-- When a trial is inserted, create its primary trial_assets row from asset_id.
-- This covers every trial-creation path (create_trial, seeds, direct inserts)
-- without changing their signatures. AFTER INSERT only, so the sync trigger's
-- UPDATE of trials.asset_id never re-fires this.
create or replace function public._trial_assets_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  values (new.id, new.asset_id, true, 'bootstrap')
  on conflict (trial_id, asset_id) do nothing;
  return new;
end;
$$;

create trigger trg_trial_assets_bootstrap
  after insert on public.trials
  for each row execute function public._trial_assets_bootstrap();
```

- [ ] **Step 3: Write the sync trigger (primary membership -> trials.asset_id, with promotion)**

```sql
-- Keep trials.asset_id equal to the single is_primary member. One direction only:
-- trial_assets.is_primary drives trials.asset_id, never the reverse.
-- If the primary membership is removed but others remain, promote the earliest
-- remaining member so the invariant (exactly one primary) is restored.
-- If zero members remain (e.g. mid-cascade when the trial is being deleted),
-- do nothing.
create or replace function public._trial_assets_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial     uuid := coalesce(new.trial_id, old.trial_id);
  v_remaining int;
  v_primary   uuid;
begin
  select count(*) into v_remaining
    from public.trial_assets where trial_id = v_trial;

  if v_remaining = 0 then
    return null;
  end if;

  -- No primary flagged (e.g. the primary row was just deleted): promote the
  -- earliest-created remaining member. The UPDATE re-fires this trigger, which
  -- then syncs trials.asset_id on the next pass.
  if not exists (
    select 1 from public.trial_assets where trial_id = v_trial and is_primary
  ) then
    update public.trial_assets ta
       set is_primary = true
     where ta.trial_id = v_trial
       and ta.asset_id = (
         select t2.asset_id from public.trial_assets t2
          where t2.trial_id = v_trial
          order by t2.created_at, t2.asset_id
          limit 1
       );
    return null;
  end if;

  select asset_id into v_primary
    from public.trial_assets
   where trial_id = v_trial and is_primary;

  update public.trials
     set asset_id = v_primary
   where id = v_trial
     and asset_id is distinct from v_primary;

  return null;
end;
$$;

create trigger trg_trial_assets_sync_primary
  after insert or update of is_primary or delete on public.trial_assets
  for each row execute function public._trial_assets_sync_primary();
```

- [ ] **Step 4: Write a smoke block covering bootstrap, sync, and promotion**

```sql
do $$
declare
  v_space   uuid;
  v_company uuid;
  v_asset_a uuid;
  v_asset_b uuid;
  v_uid     uuid;
  v_trial   uuid;
  v_aid     uuid;
  v_count   int;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'trial_assets triggers smoke skipped: no auth user';
    return;
  end if;

  select id into v_space from public.spaces limit 1;
  select id into v_company from public.companies where space_id = v_space limit 1;
  select id into v_asset_a from public.assets where space_id = v_space limit 1;
  select id into v_asset_b from public.assets where space_id = v_space and id <> v_asset_a limit 1;
  if v_asset_b is null then
    raise notice 'trial_assets triggers smoke skipped: need two assets';
    return;
  end if;

  -- Bootstrap: inserting a trial must create exactly one primary membership.
  insert into public.trials (name, asset_id, space_id, created_by, phase_type, status)
    values ('SMOKE-TA-TRIAL', v_asset_a, v_space, v_uid, 'P3', 'Active')
    returning id into v_trial;

  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 1 then
    raise exception 'bootstrap FAIL: expected 1 membership, got %', v_count;
  end if;
  if not exists (select 1 from public.trial_assets
                 where trial_id = v_trial and asset_id = v_asset_a and is_primary) then
    raise exception 'bootstrap FAIL: primary membership not on asset_a';
  end if;

  -- Add a second (non-primary) member, then flip primary to it: asset_id syncs.
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_b, false, 'smoke');
  update public.trial_assets set is_primary = false where trial_id = v_trial;
  update public.trial_assets set is_primary = true
    where trial_id = v_trial and asset_id = v_asset_b;

  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_b then
    raise exception 'sync FAIL: trials.asset_id did not follow primary (got %)', v_aid;
  end if;

  -- Delete the primary membership: the other member is promoted, asset_id resyncs.
  delete from public.trial_assets where trial_id = v_trial and asset_id = v_asset_b;
  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_a then
    raise exception 'promotion FAIL: expected asset_a after primary delete (got %)', v_aid;
  end if;
  if not exists (select 1 from public.trial_assets
                 where trial_id = v_trial and asset_id = v_asset_a and is_primary) then
    raise exception 'promotion FAIL: asset_a not flagged primary';
  end if;

  -- Cleanup.
  delete from public.trials where id = v_trial;
  raise notice 'trial_assets triggers smoke ok: bootstrap + sync + promotion';
end $$;
```

- [ ] **Step 5: Apply and verify**

Run: `supabase db reset`
Expected: completes without error; log shows `NOTICE: trial_assets triggers smoke ok: bootstrap + sync + promotion` (or a documented "skipped" notice).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "Maintain trials.asset_id from trial_assets via bootstrap + sync triggers"
```

---

### Task 3: Backfill existing trials

**Files:**
- Create: `supabase/migrations/<ts>_backfill_trial_assets.sql` (via `supabase migration new backfill_trial_assets`)

Existing trials predate the bootstrap trigger, so they have no `trial_assets` row yet. Backfill one primary row each.

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new backfill_trial_assets`

- [ ] **Step 2: Write the backfill and a 1:1 assertion**

```sql
-- One primary membership per existing trial, mirroring its current asset_id.
insert into public.trial_assets (trial_id, asset_id, is_primary, source)
select t.id, t.asset_id, true, 'backfill'
  from public.trials t
on conflict (trial_id, asset_id) do nothing;

-- Assert a clean 1:1 mapping: every trial has exactly one primary equal to asset_id.
do $$
declare
  v_bad int;
begin
  select count(*) into v_bad
    from public.trials t
    left join public.trial_assets ta
      on ta.trial_id = t.id and ta.is_primary
   where ta.asset_id is null or ta.asset_id <> t.asset_id;

  if v_bad > 0 then
    raise exception 'backfill FAIL: % trials lack a matching primary membership', v_bad;
  end if;
  raise notice 'backfill ok: every trial has a primary membership equal to asset_id';
end $$;
```

- [ ] **Step 3: Apply and verify**

Run: `supabase db reset`
Expected: completes; log shows `NOTICE: backfill ok: every trial has a primary membership equal to asset_id`.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations
git commit -m "Backfill trial_assets primary rows for existing trials"
```

---

### Task 4: `set_trial_assets` RPC

**Files:**
- Create: `supabase/migrations/<ts>_set_trial_assets_rpc.sql` (via `supabase migration new set_trial_assets_rpc`)

Atomic membership reconciliation. The client and `commit_source_import` call this instead of issuing DELETE+INSERT across PostgREST (which would be two transactions and could leave a trial with no primary in between).

- [ ] **Step 1: Create the migration file**

Run: `supabase migration new set_trial_assets_rpc`

- [ ] **Step 2: Write the RPC**

```sql
-- Reconcile a trial's asset membership to exactly p_asset_ids, with
-- p_primary_asset_id (default: first element) marked primary. One transaction;
-- the sync trigger updates trials.asset_id afterward. Rejects an empty set
-- (a trial must always keep at least one asset).
create or replace function public.set_trial_assets(
  p_trial_id         uuid,
  p_asset_ids        uuid[],
  p_primary_asset_id uuid default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space   uuid;
  v_primary uuid;
begin
  select space_id into v_space from public.trials where id = p_trial_id;
  if v_space is null then
    raise exception 'trial not found' using errcode = 'P0002';
  end if;
  if not public.has_space_access(v_space) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_asset_ids is null or array_length(p_asset_ids, 1) is null then
    raise exception 'a trial must have at least one asset' using errcode = '23514';
  end if;

  v_primary := coalesce(p_primary_asset_id, p_asset_ids[1]);
  if not (v_primary = any(p_asset_ids)) then
    raise exception 'primary asset must be one of the asset ids' using errcode = '22023';
  end if;

  -- Remove members no longer present.
  delete from public.trial_assets
   where trial_id = p_trial_id and not (asset_id = any(p_asset_ids));

  -- Add new members (non-primary; primary set below).
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  select p_trial_id, a, false, 'analyst'
    from unnest(p_asset_ids) a
  on conflict (trial_id, asset_id) do nothing;

  -- Set primary: demote all, then promote the chosen one. Doing it in this order
  -- keeps the partial unique index (at most one primary) satisfied at each step.
  update public.trial_assets set is_primary = false
   where trial_id = p_trial_id and is_primary;
  update public.trial_assets set is_primary = true
   where trial_id = p_trial_id and asset_id = v_primary;
end;
$$;

revoke execute on function public.set_trial_assets(uuid, uuid[], uuid) from public;
grant execute on function public.set_trial_assets(uuid, uuid[], uuid) to authenticated;

comment on function public.set_trial_assets(uuid, uuid[], uuid) is
  'Atomically reconcile a trial''s asset membership to p_asset_ids with p_primary_asset_id marked primary. Used by commit_source_import and the trial-edit UI. The sync trigger updates trials.asset_id.';
```

- [ ] **Step 3: Write a smoke block (add, repoint primary, shrink, reject empty)**

```sql
do $$
declare
  v_space   uuid;
  v_asset_a uuid;
  v_asset_b uuid;
  v_uid     uuid;
  v_trial   uuid;
  v_count   int;
  v_aid     uuid;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'set_trial_assets smoke skipped: no auth user';
    return;
  end if;
  select id into v_space from public.spaces limit 1;
  select id into v_asset_a from public.assets where space_id = v_space limit 1;
  select id into v_asset_b from public.assets where space_id = v_space and id <> v_asset_a limit 1;
  if v_asset_b is null then
    raise notice 'set_trial_assets smoke skipped: need two assets';
    return;
  end if;

  insert into public.trials (name, asset_id, space_id, created_by, phase_type, status)
    values ('SMOKE-STA-TRIAL', v_asset_a, v_space, v_uid, 'P3', 'Active')
    returning id into v_trial;

  -- Grow to two assets, primary = asset_b.
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_b);
  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 2 then raise exception 'set_trial_assets FAIL: expected 2 members, got %', v_count; end if;
  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_b then raise exception 'set_trial_assets FAIL: primary not synced to asset_b'; end if;

  -- Shrink back to one asset (asset_a). Primary must follow.
  perform public.set_trial_assets(v_trial, array[v_asset_a], v_asset_a);
  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 1 then raise exception 'set_trial_assets FAIL: expected 1 member after shrink, got %', v_count; end if;
  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_a then raise exception 'set_trial_assets FAIL: primary not asset_a after shrink'; end if;

  -- Empty set is rejected.
  begin
    perform public.set_trial_assets(v_trial, array[]::uuid[], null);
    raise exception 'set_trial_assets FAIL: empty set was accepted';
  exception when check_violation then
    null; -- expected (errcode 23514)
  end;

  delete from public.trials where id = v_trial;
  raise notice 'set_trial_assets smoke ok: grow + repoint + shrink + reject-empty';
end $$;
```

- [ ] **Step 4: Apply and verify**

Run: `supabase db reset`
Expected: completes; log shows `NOTICE: set_trial_assets smoke ok: grow + repoint + shrink + reject-empty`.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations
git commit -m "Add set_trial_assets RPC for atomic trial-asset membership"
```

---

### Task 5: `commit_source_import` multi-asset handling (back-compatible)

**Files:**
- Create: `supabase/migrations/<ts>_commit_source_import_multi_asset.sql` (via `supabase migration new commit_source_import_multi_asset`)
- Reference (current definition to copy verbatim, then edit): `supabase/migrations/20260528060000_commit_source_import_redelegate_and_backfill.sql` (the `create or replace function public.commit_source_import(...)` body)

`commit_source_import` is a large function redefined across several migrations; the latest definition is in `20260528060000`. Do NOT hand-rewrite it from scratch. Copy that function body verbatim into the new migration as a `create or replace`, then make the single change below to the trials loop. The change is back-compatible: today's proposals carry a scalar `asset_ref`, so it reads `[asset_ref]` and behavior is identical; once Phase 1B emits `asset_refs[]` + `primary_asset_ref`, the same code records the full set.

- [ ] **Step 1: Create the migration file and paste the current function**

Run: `supabase migration new commit_source_import_multi_asset`
Open `supabase/migrations/20260528060000_commit_source_import_redelegate_and_backfill.sql`, copy the entire `create or replace function public.commit_source_import(...) ... $$;` statement (including its grants/comment if present in that file), and paste it into the new migration file unchanged. Build and verify the rest later; first get the verbatim copy in place.

- [ ] **Step 2: Edit only the trials loop to record the full asset set**

In the pasted function, the trials loop currently looks like this (from `20260528060000` lines 332-364):

```sql
  -- trials -----------------------------------------------------------------
  v_i := 0;
  if p_proposal->'trials' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'trials')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        v_ref_idx := (v_item->>'asset_ref')::int;
        v_resolved_id := (v_asset_map->>v_ref_idx::text)::uuid;

        v_new_id := public.create_trial(
          p_space_id,
          v_resolved_id,
          coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
          v_item->>'nct_id',
          v_item->>'status',
          v_item->>'phase',
          (v_item->>'phase_start_date')::date,
          (v_item->>'phase_end_date')::date,
          v_item->>'indication',
          v_source_doc_id
        );
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_new_id::text);
        v_created_trials := v_created_trials || v_new_id;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;
```

Replace that entire block with the version below. It resolves a full set of asset refs (`asset_refs` array if present, else the legacy scalar `asset_ref`), creates the trial with the primary asset (so the bootstrap trigger makes the primary membership), then calls `set_trial_assets` to record the complete set when there is more than one:

```sql
  -- trials -----------------------------------------------------------------
  -- Back-compatible multi-asset: read asset_refs[] (Phase 1B) when present,
  -- else fall back to the legacy scalar asset_ref. The primary is
  -- primary_asset_ref when given, else the first ref. create_trial sets the
  -- primary membership via the bootstrap trigger; set_trial_assets records any
  -- additional members.
  v_i := 0;
  if p_proposal->'trials' is not null then
    for v_item in select * from jsonb_array_elements(p_proposal->'trials')
    loop
      v_match := v_item->'match';
      if v_match->>'kind' = 'existing' then
        v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_match->>'id');
      else
        declare
          v_refs        int[];
          v_primary_ref int;
          v_asset_ids   uuid[] := '{}';
          v_primary_id  uuid;
          r             int;
        begin
          -- Collect the proposal's asset refs into v_refs (array or scalar).
          if jsonb_typeof(v_item->'asset_refs') = 'array' then
            select array_agg((e#>>'{}')::int)
              into v_refs
              from jsonb_array_elements(v_item->'asset_refs') e;
          elsif (v_item->>'asset_ref') is not null then
            v_refs := array[(v_item->>'asset_ref')::int];
          else
            v_refs := '{}';
          end if;

          -- Resolve each ref to a created/matched asset id (skip unresolved).
          if v_refs is not null then
            foreach r in array v_refs loop
              if (v_asset_map->>r::text) is not null then
                v_asset_ids := v_asset_ids || (v_asset_map->>r::text)::uuid;
              end if;
            end loop;
          end if;

          -- Determine the primary asset id.
          v_primary_ref := nullif(v_item->>'primary_asset_ref', '')::int;
          if v_primary_ref is not null and (v_asset_map->>v_primary_ref::text) is not null then
            v_primary_id := (v_asset_map->>v_primary_ref::text)::uuid;
          elsif array_length(v_asset_ids, 1) is not null then
            v_primary_id := v_asset_ids[1];
          else
            v_primary_id := null;
          end if;

          -- Create the trial with the primary asset (bootstrap trigger makes the
          -- primary membership). If no asset resolved, this trial is unlinked and
          -- the UI commit gate should have blocked it; guard regardless.
          if v_primary_id is null then
            raise exception 'commit_source_import: trial "%" has no resolvable asset',
              coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name');
          end if;

          v_new_id := public.create_trial(
            p_space_id,
            v_primary_id,
            coalesce(nullif(trim(v_item->>'name'), ''), v_match->>'name'),
            v_item->>'nct_id',
            v_item->>'status',
            v_item->>'phase',
            (v_item->>'phase_start_date')::date,
            (v_item->>'phase_end_date')::date,
            v_item->>'indication',
            v_source_doc_id
          );

          -- Record the full asset set when there is more than one member.
          if array_length(v_asset_ids, 1) > 1 then
            perform public.set_trial_assets(v_new_id, v_asset_ids, v_primary_id);
          end if;

          v_trial_map := v_trial_map || jsonb_build_object(v_i::text, v_new_id::text);
          v_created_trials := v_created_trials || v_new_id;
        end;
      end if;
      v_i := v_i + 1;
    end loop;
  end if;
```

Note: the `declare ... begin ... end;` inner block is required because we introduce new locals (`v_refs`, etc.) scoped to the loop body. Keep `v_ref_idx` / `v_resolved_id` in the function's top-level `declare` if they are still referenced elsewhere; if the trials loop was their only use, leaving them declared is harmless.

- [ ] **Step 3: Add a smoke block that imports a 2-asset trial**

Append this after the function definition in the same migration. It calls `commit_source_import` is heavy to fully stub, so instead assert the lower-level path the loop relies on: a proposal-shaped `asset_refs` produces two memberships via `set_trial_assets`. (Full end-to-end commit is covered by the integration test suite, see Verification.)

```sql
do $$
declare
  v_space   uuid;
  v_asset_a uuid;
  v_asset_b uuid;
  v_uid     uuid;
  v_trial   uuid;
  v_count   int;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'commit multi-asset smoke skipped: no auth user';
    return;
  end if;
  select id into v_space from public.spaces limit 1;
  select id into v_asset_a from public.assets where space_id = v_space limit 1;
  select id into v_asset_b from public.assets where space_id = v_space and id <> v_asset_a limit 1;
  if v_asset_b is null then
    raise notice 'commit multi-asset smoke skipped: need two assets';
    return;
  end if;

  -- Simulate what the edited loop does: create_trial (primary) then set the set.
  v_trial := public.create_trial(v_space, v_asset_a, 'SMOKE-COMMIT-MA', 'NCT-SMOKE-MA',
                                 'Active', 'P3', null, null, null, null);
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_a);

  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 2 then
    raise exception 'commit multi-asset smoke FAIL: expected 2 memberships, got %', v_count;
  end if;

  delete from public.trials where id = v_trial;
  raise notice 'commit multi-asset smoke ok: create_trial + set_trial_assets records 2 members';
end $$;
```

- [ ] **Step 4: Apply and verify**

Run: `supabase db reset`
Expected: completes; log shows `NOTICE: commit multi-asset smoke ok: create_trial + set_trial_assets records 2 members`. No errors from the `create or replace` of `commit_source_import` (confirms the pasted body still compiles).

- [ ] **Step 5: Run the existing integration suite to confirm single-asset import is unchanged**

Per `reference_integration_tests_local`: export `SUPABASE_SERVICE_ROLE_KEY` from `supabase status`, then run the source-import integration tests.

Run: `cd src/client && npm run test:integration -- source-import` (use the actual integration script name in `package.json`; if unsure run `npm run` to list scripts)
Expected: existing single-asset commit tests pass (scalar `asset_ref` proposals still produce exactly one membership).

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations
git commit -m "commit_source_import records full asset set (back-compatible with scalar asset_ref)"
```

---

### Task 6: Runbook + auto-gen docs

**Files:**
- Modify: `docs/runbook/features/source-import.md` (the "New tables" table and the `source-import-commit` capability's `tables` list and `rpcs` list)
- Regenerate: `docs/runbook/07-database-schema.md`, `06-backend-architecture.md` (auto-gen blocks)

- [ ] **Step 1: Add `trial_assets` and `set_trial_assets` to the source-import feature doc**

In `docs/runbook/features/source-import.md`, under "## New tables", add a row:

```markdown
| `trial_assets` | Many-to-many between trials and assets; source of truth for the set of assets a trial tests. `is_primary` marks the headline member, mirrored into `trials.asset_id` by a sync trigger. | Agency members of space via parent trial; RPC-only write |
```

In the `source-import-commit` capability YAML block, add `set_trial_assets` to its `rpcs:` list and `trial_assets` to its `tables:` list.

- [ ] **Step 2: Regenerate auto-gen blocks**

Run: `cd src/client && npm run docs:arch`
Expected: `07-database-schema.md` ER diagram now includes `trial_assets`; `06-backend-architecture.md` RPC matrix includes `set_trial_assets`. Only auto-gen blocks change.

- [ ] **Step 3: Commit**

```bash
git add docs/runbook
git commit -m "Runbook: document trial_assets table and set_trial_assets RPC"
```

---

### Verification (run before handing off Phase 1A)

- [ ] **Full reset applies cleanly with all smoke blocks green**

Run: `supabase db reset`
Expected: no errors; all five `NOTICE: ... ok` lines present (or documented skips on a thin local seed).

- [ ] **Advisors clean**

Run: `supabase db advisors --local --type all`
Expected: no new ERROR/WARN for `trial_assets` or the new functions.

- [ ] **Lint/build unaffected (no frontend change in 1A, sanity only)**

Run: `cd src/client && ng lint && ng build`
Expected: passes (1A touches no TypeScript).

- [ ] **Confirm phasing assumption holds**

Manually confirm in the spec that Phase 2 (delete semantics + read RPCs) is scheduled before Phase 1B's multi-asset extraction is enabled for real imports, so deleting the primary asset of a future multi-asset trial does not cascade-delete a trial that still has other members. This is a sequencing note for the next plan, not a code change here.

---

## Self-Review

**Spec coverage (Phase 1 DB portion):**
- Data model: `trial_assets` table + partial unique + RLS (Task 1); `trials.asset_id` kept as primary cache via sync trigger (Task 2). Covered.
- Invariants: bootstrap trigger guarantees >=1 membership; partial unique + promotion guarantee exactly one primary (Tasks 1-2). Covered.
- Backfill 1:1 (Task 3). Covered.
- Atomic RPC-only writes: `set_trial_assets` (Task 4); `commit_source_import` uses it (Task 5). Covered.
- Import capture (DB side): `commit_source_import` reads `asset_refs[]`/`primary_asset_ref` with scalar fallback (Task 5). Covered.
- Deferred to later plans (explicitly, not gaps): worker extraction schema + import UI (Phase 1B); read-RPC attribution + multi-asset delete semantics (Phase 2); trial-edit dialog + per-asset timelines (Phase 3). `create_trial` signature is intentionally NOT changed in 1A (the bootstrap trigger covers the primary membership), reducing churn; the spec's `p_asset_ids` array signature can land in Phase 1B/Phase 3 alongside the Angular CRUD callers.

**Placeholder scan:** No TBD/TODO. The one "copy the current function" instruction (Task 5) names the exact source migration and shows the exact block to replace, with the full replacement code; that is concrete, not a placeholder.

**Type/name consistency:** Trigger function names (`_trial_assets_bootstrap`, `_trial_assets_sync_primary`) and trigger names are used consistently. `set_trial_assets(uuid, uuid[], uuid)` signature is identical in Tasks 4, 5, and 6. Column names (`trial_id`, `asset_id`, `is_primary`, `source`, `created_at`) match across all tasks.
