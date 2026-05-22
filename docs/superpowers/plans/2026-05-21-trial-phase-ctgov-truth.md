# Trial phase & timeline ct.gov as source of truth Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Flip the ownership of `trials.phase_type`, `trials.phase_start_date`, `trials.phase_end_date` so ct.gov is the source of truth on every sync, with per-field source tracking that lets analysts fill gaps and locks them out of fields ct.gov owns, and a change-feed event when materialize overwrites a previous value.

**Architecture:** Three sibling `*_source` text columns on `public.trials` keyed `'ctgov' | 'analyst'`. `_materialize_trial_from_snapshot` flips from analyst-wins reverse coalesce to ct.gov-wins forward coalesce and emits `phase_changed / phase_start_changed / phase_end_changed` events per field that actually changed. A BEFORE UPDATE trigger guards the columns server-side; an Angular dialog lock state guards them client-side. A backfill migration tags existing rows so the new write path doesn't surprise anyone.

**Tech Stack:** PostgreSQL via Supabase, Angular 21 (signals + standalone components), PrimeNG 21, Playwright e2e, Vitest unit tests, psql inline `do $$ ... $$` smoke tests.

**Spec:** `docs/superpowers/specs/2026-05-21-trial-phase-ctgov-truth-design.md`

**Important discovery noted during planning:** The codebase already has a `phase_transitioned` event type (from `_classify_change`, emitted by `ingest_ctgov_snapshot`'s diff pipeline at line 137 of `20260502120500_ctgov_ingest_rpc.sql`) and `date_moved` events for the start/primary completion/study completion ct.gov date fields. These fire when the raw ct.gov payload differs from the prior snapshot's payload. The new `phase_changed / phase_start_changed / phase_end_changed` events specified in this plan fire from `_materialize_trial_from_snapshot` when the analyst-facing column value changes, regardless of whether the underlying snapshot diff fired. The two pipelines coexist: on a normal ct.gov-side change both will fire (acceptable redundancy); on the post-backfill case where ct.gov has been stable but the materialize function newly overwrites a stored analyst value, only the new events fire (the gap this plan closes).

---

## File Structure

**New migrations:**
- `supabase/migrations/<ts1>_trial_phase_source_columns.sql`: add 3 source columns, backfill, inline psql smoke. Schema-only; no behavior change.
- `supabase/migrations/<ts2>_trial_phase_ctgov_truth.sql`: replace `_materialize_trial_from_snapshot`, add `_guard_ctgov_locked_phase_fields()` trigger function and trigger, inline psql smoke covering 11 cases.
- `supabase/migrations/<ts3>_seed_demo_data_phase_sources.sql`: `create or replace function public.seed_demo_data` to stamp source columns on seeded trials.

**Modified TypeScript:**
- `src/client/src/app/core/models/trial.model.ts`: add 3 `*_source` fields to `Trial` type.
- `src/client/src/app/core/services/trial.service.ts`: `update()` accepts the new fields, writes `*_source = 'analyst'` when caller supplies a value.
- `src/client/src/app/core/services/trial.service.spec.ts`: three new Vitest cases.

**Modified Angular UI:**
- `src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts`: add three signals, three lock computeds, save path writes editable subset.
- `src/client/src/app/features/manage/trials/trial-edit-dialog.component.html`: render three fields with disabled state + ct.gov badge + tooltip.
- `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts`: extend NCT autopopulate to read phase + dates from CT.gov v2 API; track per-field source; save with `*_source` siblings.
- `src/client/src/app/features/manage/trials/trial-create-dialog.component.html`: render three fields.
- `src/client/src/app/features/manage/trials/trial-detail.component.html`: remove `@if (t.phase_type)` gate on Phase card; add empty-state row; add `[ct.gov]` / `[analyst]` source tags per `<dd>`.
- `src/client/src/app/features/help/phases-help.component.ts`: add ct.gov-managed paragraph.
- `src/client/src/app/features/manage/trials/__/__ctgov-source-tag.ts` reused (the existing `<app-ctgov-source-tag>` component is what the Phase card source tags use).

**Modified e2e:**
- `src/client/e2e/tests/trial-management.spec.ts`: one new scenario covering edit-dialog lock state on a ct.gov-locked trial.

**Modified hook:**
- `.claude/hooks/runbook-review-guard.sh`: add `help/phases` to `helpRules` map keyed on materialize-function changes.

---

## Task 1: Add source columns + backfill (schema only)

This task adds the three source columns and backfills them from existing trial state. The materialize function is not touched. No behavior change for end users. This isolates the schema change from the write-path change so each commit produces working software.

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_trial_phase_source_columns.sql` (timestamp from `date +%Y%m%d%H%M%S`, must be after the latest existing migration)

- [ ] **Step 1: Pick a migration timestamp**

Run:
```bash
ls supabase/migrations/ | tail -1
date +%Y%m%d%H%M%S
```

Use a timestamp strictly greater than the last migration filename's prefix. If the date command output is not strictly greater, add 1 second.

- [ ] **Step 2: Write the migration**

Create the file with this content. Adjust the header timestamp comment to match the filename:

```sql
-- migration: <YYYYMMDDHHMMSS>_trial_phase_source_columns
-- purpose: add per-field source tracking columns on public.trials so the
--   write path (next migration) can flip phase_type / phase_start_date /
--   phase_end_date to ct.gov-wins coalesce while preserving analyst-set
--   values where ct.gov has no value. backfill tags every existing row
--   based on whether the latest ct.gov snapshot would derive the same
--   value the column currently holds.
-- affected tables: public.trials (3 new nullable columns + backfill)
-- notes: schema-only; behavior is unchanged until the next migration
--   replaces _materialize_trial_from_snapshot.

alter table public.trials
  add column phase_type_source       text check (phase_type_source       in ('ctgov','analyst')),
  add column phase_start_date_source text check (phase_start_date_source in ('ctgov','analyst')),
  add column phase_end_date_source   text check (phase_end_date_source   in ('ctgov','analyst'));

comment on column public.trials.phase_type_source is
  'Per-field ownership tag: ''ctgov'' means the latest ct.gov sync wrote the value; ''analyst'' means a user wrote it (or backfill found a divergence). NULL when the field itself is NULL.';
comment on column public.trials.phase_start_date_source is
  'See phase_type_source.';
comment on column public.trials.phase_end_date_source is
  'See phase_type_source.';

-- =============================================================================
-- backfill: for every trial with at least one snapshot, compute what ct.gov
-- would derive today and compare with the stored column. matching -> 'ctgov',
-- diverging or ct.gov-derived-null -> 'analyst'. trials with no snapshot but
-- a non-null stored field -> 'analyst'.
-- =============================================================================

with latest_snapshot as (
  select distinct on (trial_id) trial_id, payload
    from public.trial_ctgov_snapshots
   order by trial_id, fetched_at desc
),
derived as (
  select
    ls.trial_id,
    public._derive_phase_type(
      ls.payload #> '{protocolSection,designModule,phases}',
      ls.payload #>> '{protocolSection,designModule,studyType}'
    ) as d_phase_type,
    public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
    coalesce(
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
    ) as d_phase_end
    from latest_snapshot ls
)
update public.trials t
   set phase_type_source = case
         when t.phase_type is null then null
         when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
         else 'analyst'
       end,
       phase_start_date_source = case
         when t.phase_start_date is null then null
         when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
         else 'analyst'
       end,
       phase_end_date_source = case
         when t.phase_end_date is null then null
         when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
         else 'analyst'
       end
  from derived d
 where d.trial_id = t.id;

-- trials with no snapshot at all: any non-null analyst-facing field is 'analyst'
update public.trials t
   set phase_type_source       = case when t.phase_type       is not null and t.phase_type_source       is null then 'analyst' else t.phase_type_source       end,
       phase_start_date_source = case when t.phase_start_date is not null and t.phase_start_date_source is null then 'analyst' else t.phase_start_date_source end,
       phase_end_date_source   = case when t.phase_end_date   is not null and t.phase_end_date_source   is null then 'analyst' else t.phase_end_date_source   end
 where not exists (
   select 1 from public.trial_ctgov_snapshots s where s.trial_id = t.id
 );

-- =============================================================================
-- inline psql smoke: fabricate four trial fixtures covering each backfill
-- branch, run a second backfill pass and assert zero rows changed
-- (idempotency), then tear the fixtures down.
-- =============================================================================
do $$
declare
  v_agency_id   uuid := '99999881-9999-9999-9999-999999999881';
  v_tenant_id   uuid := '99999882-9999-9999-9999-999999999882';
  v_user_id     uuid := '99999883-9999-9999-9999-999999999883';
  v_space_id    uuid := '99999884-9999-9999-9999-999999999884';
  v_company_id  uuid := '99999885-9999-9999-9999-999999999885';
  v_product_id  uuid := '99999886-9999-9999-9999-999999999886';
  v_ta_id       uuid := '99999887-9999-9999-9999-999999999887';
  -- (a) snapshot derives values matching existing columns
  v_t_match     uuid := '99999891-9999-9999-9999-999999999891';
  -- (b) snapshot derives values diverging from existing columns
  v_t_divrg     uuid := '99999892-9999-9999-9999-999999999892';
  -- (c) snapshot has phases:["NA"] (derive returns null) but row has phase_type
  v_t_na        uuid := '99999893-9999-9999-9999-999999999893';
  -- (d) no snapshot at all
  v_t_nosnap    uuid := '99999894-9999-9999-9999-999999999894';
  v_payload_p2  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE2"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"}}}}'::jsonb;
  v_payload_na  jsonb := '{"protocolSection":{"designModule":{"phases":["NA"],"studyType":"INTERVENTIONAL"},"statusModule":{}}}'::jsonb;
  v_src_a       text;
  v_src_b       text;
  v_src_c       text;
  v_src_d       text;
  v_changed_rows int;
begin
  insert into auth.users (id, email) values (v_user_id, 'phase-source-backfill@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PhaseSourceBackfill', 'phase-src-bf', 'phasesrcbf', 'PSB', 'psb@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PSB', 'phase-src-bf-t', 'phasesrcbft', 'PSB');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'PSB Co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'PSB Drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'PSB TA');

  -- (a) matching
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_match, v_space_id, v_user_id, v_product_id, v_ta_id,
      'MATCH', 'NCT99999991', 'P2', '2024-01-01', '2025-12-31');
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_match, v_space_id, 'NCT99999991', 1, '2024-01-01', v_payload_p2, 'manual_sync', now());

  -- (b) diverging (existing P3 but ct.gov derives P2)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_divrg, v_space_id, v_user_id, v_product_id, v_ta_id,
      'DIVERGE', 'NCT99999992', 'P3', '2024-01-01', '2025-12-31');
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_divrg, v_space_id, 'NCT99999992', 1, '2024-01-01', v_payload_p2, 'manual_sync', now());

  -- (c) phases:["NA"] -> derive returns null; existing has phase_type
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_na, v_space_id, v_user_id, v_product_id, v_ta_id,
      'NA_DERIVE', 'NCT99999993', 'OBS', null, null);
  insert into public.trial_ctgov_snapshots (trial_id, space_id, nct_id, ctgov_version,
    last_update_post_date, payload, fetched_via, fetched_at)
    values (v_t_na, v_space_id, 'NCT99999993', 1, '2024-01-01', v_payload_na, 'manual_sync', now());

  -- (d) no snapshot, phase set
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, phase_type, phase_start_date, phase_end_date)
    values (v_t_nosnap, v_space_id, v_user_id, v_product_id, v_ta_id,
      'NOSNAP', null, 'P1', '2023-06-01', null);

  -- re-run the backfill against the new fixtures
  with latest_snapshot as (
    select distinct on (trial_id) trial_id, payload
      from public.trial_ctgov_snapshots
     order by trial_id, fetched_at desc
  ),
  derived as (
    select ls.trial_id,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as d_phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
      ) as d_phase_end
      from latest_snapshot ls
  )
  update public.trials t
     set phase_type_source = case
           when t.phase_type is null then null
           when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
           else 'analyst'
         end,
         phase_start_date_source = case
           when t.phase_start_date is null then null
           when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
           else 'analyst'
         end,
         phase_end_date_source = case
           when t.phase_end_date is null then null
           when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
           else 'analyst'
         end
    from derived d
   where d.trial_id = t.id;

  update public.trials t
     set phase_type_source = case when t.phase_type is not null and t.phase_type_source is null then 'analyst' else t.phase_type_source end,
         phase_start_date_source = case when t.phase_start_date is not null and t.phase_start_date_source is null then 'analyst' else t.phase_start_date_source end,
         phase_end_date_source = case when t.phase_end_date is not null and t.phase_end_date_source is null then 'analyst' else t.phase_end_date_source end
   where not exists (select 1 from public.trial_ctgov_snapshots s where s.trial_id = t.id);

  select phase_type_source into v_src_a from public.trials where id = v_t_match;
  select phase_type_source into v_src_b from public.trials where id = v_t_divrg;
  select phase_type_source into v_src_c from public.trials where id = v_t_na;
  select phase_type_source into v_src_d from public.trials where id = v_t_nosnap;

  if v_src_a is distinct from 'ctgov'   then raise exception 'backfill smoke FAIL (a) match: expected ctgov, got %', v_src_a; end if;
  if v_src_b is distinct from 'analyst' then raise exception 'backfill smoke FAIL (b) diverge: expected analyst, got %', v_src_b; end if;
  if v_src_c is distinct from 'analyst' then raise exception 'backfill smoke FAIL (c) NA derive: expected analyst, got %', v_src_c; end if;
  if v_src_d is distinct from 'analyst' then raise exception 'backfill smoke FAIL (d) no-snapshot: expected analyst, got %', v_src_d; end if;
  raise notice 'backfill smoke ok: match=ctgov diverge=analyst NA=analyst nosnap=analyst';

  -- idempotency: re-run, expect 0 row changes (every relevant row already tagged).
  -- the update statements use predicates that match only currently-null source
  -- columns OR derived-value-match comparisons. on re-run, no row's source flips.
  with latest_snapshot as (
    select distinct on (trial_id) trial_id, payload
      from public.trial_ctgov_snapshots
     order by trial_id, fetched_at desc
  ),
  derived as (
    select ls.trial_id,
      public._derive_phase_type(
        ls.payload #> '{protocolSection,designModule,phases}',
        ls.payload #>> '{protocolSection,designModule,studyType}'
      ) as d_phase_type,
      public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,startDateStruct,date}') as d_phase_start,
      coalesce(
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
        public._safe_iso_date(ls.payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
      ) as d_phase_end
      from latest_snapshot ls
  )
  update public.trials t
     set phase_type_source = case
           when t.phase_type is null then null
           when d.d_phase_type is not null and d.d_phase_type = t.phase_type then 'ctgov'
           else 'analyst'
         end,
         phase_start_date_source = case
           when t.phase_start_date is null then null
           when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov'
           else 'analyst'
         end,
         phase_end_date_source = case
           when t.phase_end_date is null then null
           when d.d_phase_end is not null and d.d_phase_end = t.phase_end_date then 'ctgov'
           else 'analyst'
         end
    from derived d
   where d.trial_id = t.id
     and (phase_type_source       is distinct from case when t.phase_type       is null then null when d.d_phase_type  is not null and d.d_phase_type  = t.phase_type       then 'ctgov' else 'analyst' end
       or phase_start_date_source is distinct from case when t.phase_start_date is null then null when d.d_phase_start is not null and d.d_phase_start = t.phase_start_date then 'ctgov' else 'analyst' end
       or phase_end_date_source   is distinct from case when t.phase_end_date   is null then null when d.d_phase_end   is not null and d.d_phase_end   = t.phase_end_date   then 'ctgov' else 'analyst' end);

  get diagnostics v_changed_rows = row_count;
  if v_changed_rows <> 0 then
    raise exception 'backfill smoke FAIL idempotency: expected 0 rows changed on re-run, got %', v_changed_rows;
  end if;
  raise notice 'backfill smoke ok: idempotent on re-run';

  -- cleanup
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'trial_phase_source_columns smoke test: PASS';
end$$;
```

- [ ] **Step 3: Run supabase db reset to apply the migration and run smoke**

Run:
```bash
supabase db reset
```

Expected: migration applies cleanly. Final `NOTICE` includes `trial_phase_source_columns smoke test: PASS`. If any smoke test raises, the migration aborts and `db reset` exits non-zero.

- [ ] **Step 4: Run advisors**

Run:
```bash
supabase db advisors --local --type all
```

Expected: no new warnings or errors compared to the pre-migration baseline. The check constraint on the source columns may surface as a NOTICE-level item but not WARN/ERROR.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<filename>.sql
git commit -m "$(cat <<'EOF'
feat(db): add per-field source columns on trials + backfill

phase_type_source / phase_start_date_source / phase_end_date_source
('ctgov' | 'analyst'). Backfilled from latest snapshot's derived values:
matching -> ctgov, diverging or derive-null -> analyst, no-snapshot ->
analyst. Schema-only; write paths unchanged until next migration.
EOF
)"
```

---

## Task 2: Replace materialize function + add change-feed events + guard trigger

Flips the coalesce direction so ct.gov wins, stamps source columns, emits one event per field that actually changed, and adds a BEFORE UPDATE trigger that blocks direct writes to `'ctgov'`-locked fields. Materialize sets a transaction-local GUC so its own UPDATEs are not blocked.

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_trial_phase_ctgov_truth.sql` (timestamp greater than Task 1's)

- [ ] **Step 1: Pick a migration timestamp**

Run:
```bash
ls supabase/migrations/ | tail -1
date +%Y%m%d%H%M%S
```

Use a timestamp strictly greater than Task 1's filename prefix.

- [ ] **Step 2: Write the migration**

```sql
-- migration: <YYYYMMDDHHMMSS>_trial_phase_ctgov_truth
-- purpose: flip _materialize_trial_from_snapshot from analyst-wins reverse
--   coalesce to ct.gov-wins forward coalesce on phase_type / phase_start_date
--   / phase_end_date. stamp the matching *_source columns whenever ct.gov
--   supplies a value. emit one trial_change_events row per field that
--   actually changed (prev non-null AND new differs). add a BEFORE UPDATE
--   trigger that blocks direct writes to 'ctgov'-locked fields; materialize
--   bypasses the trigger via a transaction-local GUC.
-- affected objects:
--   - function public._materialize_trial_from_snapshot(uuid, jsonb) (replace)
--   - function public._guard_ctgov_locked_phase_fields() (create)
--   - trigger trg_guard_ctgov_locked_phase_fields on public.trials (create)
-- depends on: previous migration <ts1>_trial_phase_source_columns
-- security: function bodies are SECURITY DEFINER with set search_path = public,
--   matching the prior _materialize_trial_from_snapshot. revoke from public.

-- =============================================================================
-- 1. replace _materialize_trial_from_snapshot
-- =============================================================================
create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload  jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase                text;
  v_phase_type           text;
  v_phase_start_date     date;
  v_phase_end_date       date;
  v_recruitment          text;
  v_status               text;
  v_study_type           text;
  v_last_update_date     date;
  v_prev_phase_type      text;
  v_prev_phase_start     date;
  v_prev_phase_end       date;
  v_prev_phase_type_src  text;
  v_prev_phase_start_src text;
  v_prev_phase_end_src   text;
  v_space_id             uuid;
  v_now                  timestamptz := now();
  v_occurred             timestamptz;
begin
  -- derive from snapshot
  v_phase            := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_recruitment      := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type       := p_payload #>> '{protocolSection,designModule,studyType}';
  v_phase_type       := public._derive_phase_type(
                          p_payload #> '{protocolSection,designModule,phases}',
                          v_study_type
                        );
  v_phase_start_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,startDateStruct,date}');
  v_phase_end_date   := coalesce(
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,primaryCompletionDateStruct,date}'),
                          public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,completionDateStruct,date}')
                        );
  v_status           := public._derive_status(v_recruitment);
  v_last_update_date := public._safe_iso_date(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}');
  v_occurred         := coalesce(v_last_update_date::timestamptz, v_now);

  -- snapshot previous values (and space_id) for diff + event insert
  select phase_type, phase_start_date, phase_end_date,
         phase_type_source, phase_start_date_source, phase_end_date_source,
         space_id
    into v_prev_phase_type, v_prev_phase_start, v_prev_phase_end,
         v_prev_phase_type_src, v_prev_phase_start_src, v_prev_phase_end_src,
         v_space_id
    from public.trials where id = p_trial_id;

  -- allow this function's own UPDATE to bypass the guard trigger
  perform set_config('clint.materialize_in_progress', 'on', true);

  -- write (ct.gov-first coalesce; stamp source when ct.gov supplied a value)
  update public.trials
     set phase                   = coalesce(v_phase, phase),
         phase_type              = coalesce(v_phase_type,       phase_type),
         phase_start_date        = coalesce(v_phase_start_date, phase_start_date),
         phase_end_date          = coalesce(v_phase_end_date,   phase_end_date),
         phase_type_source       = case when v_phase_type       is not null then 'ctgov' else phase_type_source       end,
         phase_start_date_source = case when v_phase_start_date is not null then 'ctgov' else phase_start_date_source end,
         phase_end_date_source   = case when v_phase_end_date   is not null then 'ctgov' else phase_end_date_source   end,
         status                  = coalesce(status, v_status),
         recruitment_status      = coalesce(v_recruitment, recruitment_status),
         study_type              = coalesce(v_study_type, study_type),
         last_update_posted_date = coalesce(v_last_update_date, last_update_posted_date),
         ctgov_last_synced_at    = v_now
   where id = p_trial_id;

  -- reset the bypass flag so it does not bleed into other statements in the txn
  perform set_config('clint.materialize_in_progress', 'off', true);

  -- emit one event per field that actually changed (prev non-null and new differs).
  -- seeding (prev null) emits nothing. no-op syncs (new == prev) emit nothing.
  if v_prev_phase_type is not null and v_phase_type is not null and v_phase_type <> v_prev_phase_type then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_type',
        'old_value',  to_jsonb(v_prev_phase_type),
        'new_value',  to_jsonb(v_phase_type),
        'old_source', to_jsonb(v_prev_phase_type_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_start is not null and v_phase_start_date is not null and v_phase_start_date <> v_prev_phase_start then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_start_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_start_date',
        'old_value',  to_jsonb(v_prev_phase_start),
        'new_value',  to_jsonb(v_phase_start_date),
        'old_source', to_jsonb(v_prev_phase_start_src)
      ),
      v_occurred);
  end if;

  if v_prev_phase_end is not null and v_phase_end_date is not null and v_phase_end_date <> v_prev_phase_end then
    insert into public.trial_change_events (trial_id, space_id, event_type, source, payload, occurred_at)
    values (p_trial_id, v_space_id, 'phase_end_changed', 'ctgov',
      jsonb_build_object(
        'field',      'phase_end_date',
        'old_value',  to_jsonb(v_prev_phase_end),
        'new_value',  to_jsonb(v_phase_end_date),
        'old_source', to_jsonb(v_prev_phase_end_src)
      ),
      v_occurred);
  end if;
end;
$$;

revoke execute on function public._materialize_trial_from_snapshot(uuid, jsonb) from public;

comment on function public._materialize_trial_from_snapshot(uuid, jsonb) is
  'Applies a ct.gov snapshot to the trial row. phase / phase_type / phase_start_date / phase_end_date / status / recruitment_status / study_type / last_update_posted_date use ct.gov-first coalesce(derived, existing); when ct.gov supplies a non-null value the matching *_source flips to ''ctgov''. When the derived value is null (e.g. phases:["NA"]), the existing column and source survive. Emits one row into trial_change_events per phase field (phase_type, phase_start_date, phase_end_date) whose value actually changed (prev non-null AND new differs). Sets the transaction-local GUC clint.materialize_in_progress around its UPDATE so the guard trigger does not block it.';

-- =============================================================================
-- 2. guard trigger: block direct UPDATE to ctgov-locked fields
-- =============================================================================
create or replace function public._guard_ctgov_locked_phase_fields()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  -- bypass when materialize is the caller (set via transaction-local GUC)
  if current_setting('clint.materialize_in_progress', true) = 'on' then
    return new;
  end if;

  if new.phase_type is distinct from old.phase_type and old.phase_type_source = 'ctgov' then
    raise exception 'phase_type is managed by ct.gov for this trial; cannot update directly. Remove the NCT or wait for the next ct.gov sync.'
      using errcode = 'P0001';
  end if;
  if new.phase_start_date is distinct from old.phase_start_date and old.phase_start_date_source = 'ctgov' then
    raise exception 'phase_start_date is managed by ct.gov for this trial; cannot update directly.'
      using errcode = 'P0001';
  end if;
  if new.phase_end_date is distinct from old.phase_end_date and old.phase_end_date_source = 'ctgov' then
    raise exception 'phase_end_date is managed by ct.gov for this trial; cannot update directly.'
      using errcode = 'P0001';
  end if;

  return new;
end;
$$;

comment on function public._guard_ctgov_locked_phase_fields() is
  'BEFORE UPDATE trigger function on public.trials. Rejects writes that change phase_type / phase_start_date / phase_end_date when the matching *_source column is ''ctgov''. Bypasses when current_setting(''clint.materialize_in_progress'', true) = ''on'', which _materialize_trial_from_snapshot sets transaction-locally before its UPDATE.';

create trigger trg_guard_ctgov_locked_phase_fields
  before update on public.trials
  for each row
  execute function public._guard_ctgov_locked_phase_fields();

-- =============================================================================
-- inline psql smoke: 11 cases per spec
-- =============================================================================
do $$
declare
  v_agency_id   uuid := '99999771-9999-9999-9999-999999999771';
  v_tenant_id   uuid := '99999772-9999-9999-9999-999999999772';
  v_user_id     uuid := '99999773-9999-9999-9999-999999999773';
  v_space_id    uuid := '99999774-9999-9999-9999-999999999774';
  v_company_id  uuid := '99999775-9999-9999-9999-999999999775';
  v_product_id  uuid := '99999776-9999-9999-9999-999999999776';
  v_ta_id       uuid := '99999777-9999-9999-9999-999999999777';
  v_t           uuid := '99999778-9999-9999-9999-999999999778';
  v_threw       boolean;
  v_count       int;
  v_event_type  text;
  v_old_source  text;
  v_event_source text;
  v_phase_type  text;
  v_src         text;
  v_payload_p2  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE2"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"},"lastUpdatePostDateStruct":{"date":"2026-05-01"}}}}'::jsonb;
  v_payload_p3  jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE3"]},"statusModule":{"startDateStruct":{"date":"2024-01-01"},"primaryCompletionDateStruct":{"date":"2025-12-31"},"lastUpdatePostDateStruct":{"date":"2026-06-01"}}}}'::jsonb;
  v_payload_p3_start_moved jsonb := '{"protocolSection":{"designModule":{"phases":["PHASE3"]},"statusModule":{"startDateStruct":{"date":"2024-06-01"},"primaryCompletionDateStruct":{"date":"2026-06-30"},"lastUpdatePostDateStruct":{"date":"2026-07-01"}}}}'::jsonb;
  v_payload_na  jsonb := '{"protocolSection":{"designModule":{"phases":["NA"],"studyType":"INTERVENTIONAL"},"statusModule":{}}}'::jsonb;
begin
  insert into auth.users (id, email) values (v_user_id, 'phase-truth-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PhaseTruth', 'phase-truth', 'phasetruth', 'PT', 'pt@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PT', 'phase-truth-t', 'phasetrutht', 'PT');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);
  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'PT Co');
  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'PT Drug');
  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'PT TA');

  -- ===== test 1: materialize over null row -> ctgov source, no events (seeding)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_t, v_space_id, v_user_id, v_product_id, v_ta_id, 'TEST_1_SEED', 'NCT99999998');
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P2' or v_src <> 'ctgov' then
    raise exception 'test 1 FAIL: expected phase_type=P2 source=ctgov, got %, %', v_phase_type, v_src;
  end if;

  select count(*) into v_count
    from public.trial_change_events
   where trial_id = v_t and event_type in ('phase_changed', 'phase_start_changed', 'phase_end_changed');
  if v_count <> 0 then
    raise exception 'test 1 FAIL: seeding should emit 0 events, got %', v_count;
  end if;
  raise notice 'test 1 ok: seeding writes ctgov source, no events';

  -- ===== test 2: materialize over ctgov-source P2 with new P3 -> phase_changed event
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3);

  select count(*) into v_count
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';
  if v_count <> 1 then raise exception 'test 2 FAIL: expected 1 phase_changed event, got %', v_count; end if;

  select event_type, source, payload ->> 'old_source'
    into v_event_type, v_event_source, v_old_source
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';

  if v_event_source <> 'ctgov' then raise exception 'test 2 FAIL: expected source=ctgov, got %', v_event_source; end if;
  if v_old_source <> 'ctgov' then raise exception 'test 2 FAIL: expected old_source=ctgov, got %', v_old_source; end if;
  raise notice 'test 2 ok: P2->P3 emits phase_changed with source=ctgov, old_source=ctgov';

  -- clear events for the next test
  delete from public.trial_change_events where trial_id = v_t;

  -- ===== test 3: start_date only changes -> only phase_start_changed
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3_start_moved);

  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_start_changed';
  if v_count <> 1 then raise exception 'test 3 FAIL: expected 1 phase_start_changed, got %', v_count; end if;
  -- end date moved too in this payload (2025-12-31 -> 2026-06-30), so phase_end_changed should also fire
  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_end_changed';
  if v_count <> 1 then raise exception 'test 3 FAIL: expected 1 phase_end_changed, got %', v_count; end if;
  select count(*) into v_count from public.trial_change_events where trial_id = v_t and event_type = 'phase_changed';
  if v_count <> 0 then raise exception 'test 3 FAIL: phase unchanged, expected 0 phase_changed events, got %', v_count; end if;
  raise notice 'test 3 ok: dates changed -> phase_start_changed + phase_end_changed, no phase_changed';

  delete from public.trial_change_events where trial_id = v_t;

  -- ===== test 4: no-op sync (same payload) -> 0 events
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3_start_moved);
  select count(*) into v_count from public.trial_change_events where trial_id = v_t;
  if v_count <> 0 then raise exception 'test 4 FAIL: no-op sync, expected 0 events, got %', v_count; end if;
  raise notice 'test 4 ok: no-op sync emits 0 events';

  -- ===== test 5: derive returns null (phases:["NA"]) against existing ctgov P3 -> unchanged, no events
  perform public._materialize_trial_from_snapshot(v_t, v_payload_na);
  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P3' or v_src <> 'ctgov' then
    raise exception 'test 5 FAIL: NA derive should leave existing untouched, got %, %', v_phase_type, v_src;
  end if;
  select count(*) into v_count from public.trial_change_events where trial_id = v_t;
  if v_count <> 0 then raise exception 'test 5 FAIL: NA derive should emit 0 events, got %', v_count; end if;
  raise notice 'test 5 ok: NA derive leaves row untouched, no events';

  -- ===== test 6: analyst-source override gets overwritten by ctgov
  -- bypass the guard trigger to set up the analyst-source state
  perform set_config('clint.materialize_in_progress', 'on', true);
  update public.trials
     set phase_type = 'P3', phase_type_source = 'analyst'
   where id = v_t;
  perform set_config('clint.materialize_in_progress', 'off', true);

  delete from public.trial_change_events where trial_id = v_t;
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select phase_type, phase_type_source into v_phase_type, v_src from public.trials where id = v_t;
  if v_phase_type <> 'P2' or v_src <> 'ctgov' then
    raise exception 'test 6 FAIL: expected P2/ctgov after override overwrite, got %, %', v_phase_type, v_src;
  end if;
  select payload ->> 'old_source' into v_old_source
    from public.trial_change_events
   where trial_id = v_t and event_type = 'phase_changed';
  if v_old_source <> 'analyst' then
    raise exception 'test 6 FAIL: expected old_source=analyst in event payload, got %', v_old_source;
  end if;
  raise notice 'test 6 ok: analyst override overwritten, event payload old_source=analyst';

  -- ===== test 7: guard trigger blocks direct UPDATE on ctgov-locked phase_type
  v_threw := false;
  begin
    update public.trials set phase_type = 'P1' where id = v_t;
  exception when sqlstate 'P0001' then
    v_threw := true;
  end;
  if not v_threw then raise exception 'test 7 FAIL: direct update on ctgov-locked phase_type did not raise'; end if;
  raise notice 'test 7 ok: guard trigger blocks update on ctgov-locked phase_type';

  -- ===== test 8: guard trigger allows no-op update (same value) on ctgov-locked field
  v_threw := false;
  begin
    update public.trials set phase_type = 'P2' where id = v_t;
  exception when sqlstate 'P0001' then v_threw := true;
  end;
  if v_threw then raise exception 'test 8 FAIL: no-op update on ctgov-locked field was rejected'; end if;
  raise notice 'test 8 ok: guard trigger allows no-op update';

  -- ===== test 9: guard trigger does not block updates to other columns on ctgov-locked trial
  v_threw := false;
  begin
    update public.trials set notes = 'guard test' where id = v_t;
  exception when others then v_threw := true;
  end;
  if v_threw then raise exception 'test 9 FAIL: guard trigger blocked unrelated column update'; end if;
  raise notice 'test 9 ok: guard trigger does not block unrelated columns';

  -- ===== test 10: analyst-source field is editable via direct UPDATE
  perform set_config('clint.materialize_in_progress', 'on', true);
  update public.trials
     set phase_type = 'OBS', phase_type_source = 'analyst'
   where id = v_t;
  perform set_config('clint.materialize_in_progress', 'off', true);

  v_threw := false;
  begin
    update public.trials set phase_type = 'P4', phase_type_source = 'analyst' where id = v_t;
  exception when others then v_threw := true;
  end;
  if v_threw then raise exception 'test 10 FAIL: update on analyst-source field was rejected'; end if;
  raise notice 'test 10 ok: analyst-source field is editable';

  -- ===== test 11: payload structure includes field/old_value/new_value/old_source
  delete from public.trial_change_events where trial_id = v_t;
  -- restore to ctgov P3 first, then change
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p3);
  delete from public.trial_change_events where trial_id = v_t;
  perform public._materialize_trial_from_snapshot(v_t, v_payload_p2);

  select payload into v_phase_type from public.trial_change_events where trial_id = v_t and event_type = 'phase_changed';
  -- check all four keys are present
  if v_phase_type::jsonb ->> 'field'      <> 'phase_type' then raise exception 'test 11 FAIL: payload.field'; end if;
  if v_phase_type::jsonb ->> 'old_value'  is null         then raise exception 'test 11 FAIL: payload.old_value missing'; end if;
  if v_phase_type::jsonb ->> 'new_value'  is null         then raise exception 'test 11 FAIL: payload.new_value missing'; end if;
  if v_phase_type::jsonb ? 'old_source'  is not true     then raise exception 'test 11 FAIL: payload.old_source key missing'; end if;
  raise notice 'test 11 ok: event payload has field / old_value / new_value / old_source';

  -- cleanup
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'trial_phase_ctgov_truth smoke test: PASS';
end$$;
```

Note: variable `v_phase_type` is reused for the payload jsonb in test 11. That is intentional; it avoids extending the declare block. The cast back to `jsonb` is explicit.

- [ ] **Step 3: Run supabase db reset and verify smoke passes**

Run:
```bash
supabase db reset
```

Expected: final `NOTICE` includes `trial_phase_ctgov_truth smoke test: PASS`.

- [ ] **Step 4: Run advisors**

Run:
```bash
supabase db advisors --local --type all
```

Expected: no new warnings or errors compared to the post-Task-1 baseline.

- [ ] **Step 5: Commit**

```bash
git add supabase/migrations/<filename>.sql
git commit -m "$(cat <<'EOF'
feat(db): ct.gov is source of truth for trial phase + dates

Replace _materialize_trial_from_snapshot with ct.gov-first coalesce on
phase_type / phase_start_date / phase_end_date plus per-field source
stamping. Emit phase_changed / phase_start_changed / phase_end_changed
events when prev non-null and new differs. Add BEFORE UPDATE trigger
that blocks direct writes to ctgov-locked fields; materialize bypasses
via transaction-local GUC clint.materialize_in_progress.
EOF
)"
```

---

## Task 3: Update seed function to stamp source columns

The latest `create or replace function public.seed_demo_data` lives in `20260510120200_seed_demo_activity_variety.sql`. It does NOT touch the trial inserts directly (it appends activity rows), so the seed trials still come from an earlier `create or replace` chain. We add one more `create or replace function public.seed_demo_data` that wraps the existing behavior and stamps source columns after the trials are inserted.

**Files:**
- Create: `supabase/migrations/<YYYYMMDDHHMMSS>_seed_demo_data_phase_sources.sql`

- [ ] **Step 1: Pick a migration timestamp greater than Task 2's**

Run:
```bash
date +%Y%m%d%H%M%S
```

- [ ] **Step 2: Find the canonical seed_demo_data body to copy**

Run:
```bash
grep -l "create or replace function public.seed_demo_data" supabase/migrations/ | xargs ls -1 | sort | tail -1
```

Expected: the latest migration that defines the function. Read it fully; we will copy its body verbatim and add the source-stamping at the end.

- [ ] **Step 3: Write the migration**

Approach: re-declare `seed_demo_data` with the same body as the latest version, then add a final UPDATE that stamps source columns on the newly-seeded trials. The simplest place to add this is right after the trials are inserted; if the existing body has multiple trial INSERTs, add one UPDATE per insert OR a single UPDATE at the very end that targets all trials in the seeded space.

Because the existing seed function is long (multi-hundred lines), the agent executing this plan should:

1. Open the latest `seed_demo_data` migration found in Step 2.
2. Copy the entire function body into the new migration file, prefixed by the standard `create or replace function public.seed_demo_data(p_space_id uuid) returns void language plpgsql security definer set search_path = public as $$ ... $$;` wrapper.
3. Insert this UPDATE statement immediately before the function's final `end;`:

```sql
-- stamp source columns on seeded trials: NCT-bearing trials with phase data
-- get 'ctgov' (they were seeded to match what ct.gov would say); non-NCT or
-- analyst-managed trials get 'analyst'.
update public.trials
   set phase_type_source       = case
         when phase_type is null then null
         when identifier is null then 'analyst'
         else 'ctgov'
       end,
       phase_start_date_source = case
         when phase_start_date is null then null
         when identifier is null then 'analyst'
         else 'ctgov'
       end,
       phase_end_date_source   = case
         when phase_end_date is null then null
         when identifier is null then 'analyst'
         else 'ctgov'
       end
 where space_id = p_space_id;
```

4. Update the function `comment on function` line to add: `'… also stamps phase_type_source / phase_start_date_source / phase_end_date_source on seeded trials: ''ctgov'' for NCT-bearing trials, ''analyst'' for trials without an NCT.'`.

- [ ] **Step 4: Run supabase db reset and verify the seed runs without error**

Run:
```bash
supabase db reset
```

Expected: full reset succeeds. Source columns are populated on seeded trials.

- [ ] **Step 5: Verify with a query**

Run (from a separate shell or psql):
```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -c "
  select identifier, phase_type, phase_type_source
    from public.trials
   where phase_type is not null
   limit 10;"
```

Expected: NCT-bearing trials show `phase_type_source = 'ctgov'`; the few non-NCT preclin trials show `'analyst'`.

- [ ] **Step 6: Commit**

```bash
git add supabase/migrations/<filename>.sql
git commit -m "chore(db): stamp source columns on seeded trials"
```

---

## Task 4: Add source fields to the Trial model

**Files:**
- Modify: `src/client/src/app/core/models/trial.model.ts`

- [ ] **Step 1: Open the file and locate the Trial interface**

Run:
```bash
sed -n '1,60p' src/client/src/app/core/models/trial.model.ts
```

- [ ] **Step 2: Add three optional fields**

After the existing `phase_end_date` field (or near `phase_type`, depending on file order), add:

```typescript
  phase_type_source?: 'ctgov' | 'analyst' | null;
  phase_start_date_source?: 'ctgov' | 'analyst' | null;
  phase_end_date_source?: 'ctgov' | 'analyst' | null;
```

If the file uses a different shape (e.g. discriminated unions), preserve that style. Don't make these required; they are nullable per the migration.

- [ ] **Step 3: Verify build**

Run:
```bash
cd src/client && ng build
```

Expected: build passes.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/trial.model.ts
git commit -m "feat(model): add phase_*_source fields to Trial"
```

---

## Task 5: Update TrialService.update + Vitest cases

`TrialService.update(id, changes)` currently accepts `Partial<Trial>`. Per the spec, when the caller supplies `phase_type` / `phase_start_date` / `phase_end_date` directly, the service also writes the matching `*_source = 'analyst'`. If the caller already passes the source explicitly, the caller wins.

**Files:**
- Modify: `src/client/src/app/core/services/trial.service.ts`
- Modify: `src/client/src/app/core/services/trial.service.spec.ts`

- [ ] **Step 1: Write the failing tests**

Open `src/client/src/app/core/services/trial.service.spec.ts` and add (preserving existing test structure):

```typescript
describe('update with phase fields', () => {
  it('writes phase_type_source=analyst when caller supplies phase_type without a source', async () => {
    // Arrange: mock Supabase update + select chain to capture the payload
    const captured: Record<string, unknown> = {};
    mockSupabase.from = vi.fn().mockReturnValue({
      update: vi.fn((payload: Record<string, unknown>) => {
        Object.assign(captured, payload);
        return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 't1', ...payload }, error: null }) }) }) };
      }),
    });

    // Act
    await service.update('t1', { phase_type: 'P2' });

    // Assert
    expect(captured['phase_type']).toBe('P2');
    expect(captured['phase_type_source']).toBe('analyst');
  });

  it('writes all three sources when caller supplies all three fields', async () => {
    const captured: Record<string, unknown> = {};
    mockSupabase.from = vi.fn().mockReturnValue({
      update: vi.fn((payload: Record<string, unknown>) => {
        Object.assign(captured, payload);
        return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 't1', ...payload }, error: null }) }) }) };
      }),
    });
    await service.update('t1', { phase_type: 'P3', phase_start_date: '2024-01-01', phase_end_date: '2025-06-30' });
    expect(captured['phase_type_source']).toBe('analyst');
    expect(captured['phase_start_date_source']).toBe('analyst');
    expect(captured['phase_end_date_source']).toBe('analyst');
  });

  it('does not touch source columns when caller omits phase fields', async () => {
    const captured: Record<string, unknown> = {};
    mockSupabase.from = vi.fn().mockReturnValue({
      update: vi.fn((payload: Record<string, unknown>) => {
        Object.assign(captured, payload);
        return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 't1', ...payload }, error: null }) }) }) };
      }),
    });
    await service.update('t1', { name: 'renamed' });
    expect(captured).not.toHaveProperty('phase_type_source');
    expect(captured).not.toHaveProperty('phase_start_date_source');
    expect(captured).not.toHaveProperty('phase_end_date_source');
  });

  it('respects caller-provided source over default analyst', async () => {
    const captured: Record<string, unknown> = {};
    mockSupabase.from = vi.fn().mockReturnValue({
      update: vi.fn((payload: Record<string, unknown>) => {
        Object.assign(captured, payload);
        return { eq: vi.fn().mockReturnValue({ select: vi.fn().mockReturnValue({ single: vi.fn().mockResolvedValue({ data: { id: 't1', ...payload }, error: null }) }) }) };
      }),
    });
    await service.update('t1', { phase_type: 'P2', phase_type_source: 'ctgov' });
    expect(captured['phase_type_source']).toBe('ctgov');
  });
});
```

If the existing spec uses a different mocking pattern (the service is small and might mock differently), adapt the test shape but keep the four cases.

- [ ] **Step 2: Run the new tests to verify they fail**

Run:
```bash
cd src/client && vitest run trial.service.spec.ts -t "update with phase fields"
```

Expected: 4 tests FAIL with the current service implementation.

- [ ] **Step 3: Implement the service change**

Open `src/client/src/app/core/services/trial.service.ts`. Locate the `update` method:

```typescript
async update(id: string, changes: Partial<Trial>): Promise<Trial> {
  const { data, error } = await this.supabase
    .from('trials')
    .update(changes)
    .eq('id', id)
    .select(...)
    .single();
  if (error) throw error;
  return data as Trial;
}
```

Change to:

```typescript
async update(id: string, changes: Partial<Trial>): Promise<Trial> {
  const payload: Partial<Trial> = { ...changes };
  // When the caller supplies a phase field without an explicit source,
  // tag it as analyst-written. The migration's BEFORE UPDATE trigger
  // also enforces this server-side.
  if ('phase_type' in changes && !('phase_type_source' in changes)) {
    payload.phase_type_source = 'analyst';
  }
  if ('phase_start_date' in changes && !('phase_start_date_source' in changes)) {
    payload.phase_start_date_source = 'analyst';
  }
  if ('phase_end_date' in changes && !('phase_end_date_source' in changes)) {
    payload.phase_end_date_source = 'analyst';
  }
  const { data, error } = await this.supabase
    .from('trials')
    .update(payload)
    .eq('id', id)
    .select(...)
    .single();
  if (error) throw error;
  return data as Trial;
}
```

Preserve the existing `.select(...)` shape exactly.

- [ ] **Step 4: Run the tests to verify they pass**

Run:
```bash
cd src/client && vitest run trial.service.spec.ts -t "update with phase fields"
```

Expected: 4 tests PASS.

- [ ] **Step 5: Run the full service spec**

Run:
```bash
cd src/client && vitest run trial.service.spec.ts
```

Expected: all tests pass (including pre-existing ones).

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/core/services/trial.service.ts src/client/src/app/core/services/trial.service.spec.ts
git commit -m "feat(service): TrialService.update stamps analyst source on phase fields"
```

---

## Task 6: Trial edit dialog with per-field lock state

The edit dialog gains three fields, each enabled or disabled based on the trial's matching `*_source` column.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-edit-dialog.component.html`

- [ ] **Step 1: Add signals + computeds in the TS component**

Open `src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts`. Add these signals near the existing form signals (`name`, `identifier`, `assetId`, `therapeuticAreaId`):

```typescript
  readonly phaseType = signal<string | null>(null);
  readonly phaseStart = signal<string | null>(null);
  readonly phaseEnd = signal<string | null>(null);
```

Add computed lock state. These read the source columns from the input trial, which is the always-fresh reference loaded from the parent:

```typescript
  readonly phaseTypeLocked = computed(() => this.trial().phase_type_source === 'ctgov');
  readonly phaseStartLocked = computed(() => this.trial().phase_start_date_source === 'ctgov');
  readonly phaseEndLocked = computed(() => this.trial().phase_end_date_source === 'ctgov');
```

Add the phase enum option list as a class field:

```typescript
  protected readonly PHASE_OPTIONS: Array<{ id: string; name: string }> = [
    { id: 'PRECLIN',  name: 'Preclinical' },
    { id: 'P1',       name: 'Phase 1' },
    { id: 'P2',       name: 'Phase 2' },
    { id: 'P3',       name: 'Phase 3' },
    { id: 'P4',       name: 'Phase 4' },
    { id: 'APPROVED', name: 'Approved' },
    { id: 'LAUNCHED', name: 'Launched' },
    { id: 'OBS',      name: 'Observational' },
  ];
```

- [ ] **Step 2: Seed the new signals from the input trial when the dialog opens**

In the existing constructor `effect()` block that seeds from `this.trial()`, add:

```typescript
        this.phaseType.set(t.phase_type ?? null);
        this.phaseStart.set(t.phase_start_date ?? null);
        this.phaseEnd.set(t.phase_end_date ?? null);
```

- [ ] **Step 3: Extend save() to write the editable subset**

Change the existing `update()` call to:

```typescript
      const updates: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.assetId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
      };
      // Only send phase fields the user is allowed to edit. The server-side
      // trigger also enforces this; the UI lock is the user-facing constraint.
      if (!this.phaseTypeLocked()) {
        updates.phase_type = this.phaseType();
      }
      if (!this.phaseStartLocked()) {
        updates.phase_start_date = this.phaseStart();
      }
      if (!this.phaseEndLocked()) {
        updates.phase_end_date = this.phaseEnd();
      }
      const updated = await this.trialService.update(this.trial().id, updates);
```

- [ ] **Step 4: Add the three fields in the HTML**

Open `trial-edit-dialog.component.html`. Add a section after the existing form fields. Use the same `<label>` + `<p-select>` / date input shape the rest of the dialog uses. Each field is disabled when its lock computed is true and shows a small `[ct.gov]` badge plus a tooltip.

```html
<div class="mb-3">
  <label for="phase-type" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
    Phase
    @if (phaseTypeLocked()) {
      <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">
        ct.gov
      </span>
    }
  </label>
  <p-select
    inputId="phase-type"
    [options]="PHASE_OPTIONS"
    optionLabel="name"
    optionValue="id"
    [ngModel]="phaseType()"
    (ngModelChange)="phaseType.set($event)"
    [disabled]="phaseTypeLocked()"
    placeholder="Select a phase"
    [showClear]="true"
    appendTo="body"
    [pTooltip]="phaseTypeLocked() ? 'Managed by ct.gov. Edit at clinicaltrials.gov or remove the NCT to override.' : null"
    tooltipPosition="top"
  />
</div>

<div class="mb-3 grid grid-cols-2 gap-3">
  <div>
    <label for="phase-start" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
      Phase start
      @if (phaseStartLocked()) {
        <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">ct.gov</span>
      }
    </label>
    <input
      id="phase-start"
      type="date"
      class="block w-full border border-slate-200 px-2 py-1 text-sm tabular-nums"
      [value]="phaseStart() ?? ''"
      (input)="phaseStart.set(($event.target as HTMLInputElement).value || null)"
      [disabled]="phaseStartLocked()"
      [pTooltip]="phaseStartLocked() ? 'Managed by ct.gov.' : null"
      tooltipPosition="top"
    />
  </div>
  <div>
    <label for="phase-end" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
      Phase end
      @if (phaseEndLocked()) {
        <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">ct.gov</span>
      }
    </label>
    <input
      id="phase-end"
      type="date"
      class="block w-full border border-slate-200 px-2 py-1 text-sm tabular-nums"
      [value]="phaseEnd() ?? ''"
      (input)="phaseEnd.set(($event.target as HTMLInputElement).value || null)"
      [disabled]="phaseEndLocked()"
      [pTooltip]="phaseEndLocked() ? 'Managed by ct.gov.' : null"
      tooltipPosition="top"
    />
  </div>
</div>
```

If `Tooltip` is not yet imported in this component, add `import { Tooltip } from 'primeng/tooltip';` and include `Tooltip` in the component's `imports` array.

- [ ] **Step 5: Build + lint**

Run:
```bash
cd src/client && ng lint && ng build
```

Expected: both pass with no new warnings on the modified files.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts \
        src/client/src/app/features/manage/trials/trial-edit-dialog.component.html
git commit -m "feat(ui): trial edit dialog with per-field phase lock state"
```

---

## Task 7: Trial create dialog with NCT autopopulate extension

Extend the existing NCT lookup to also pre-fill phase + start + end from the CT.gov v2 response. Pre-filled fields render disabled with the same `[ct.gov]` badge. If the analyst clears the NCT, the fields become editable.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-create-dialog.component.html`

- [ ] **Step 1: Add signals + helpers in the TS**

Open `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts`. Add:

```typescript
  // form fields for the three new phase columns
  readonly phaseType = signal<string | null>(null);
  readonly phaseStart = signal<string | null>(null);
  readonly phaseEnd = signal<string | null>(null);

  // tracks whether each value was pre-filled by the ct.gov lookup. when true,
  // the field renders disabled and saves with source='ctgov'. when false, the
  // analyst typed it and the save uses source='analyst'.
  protected readonly phaseTypeFromCtgov = signal(false);
  protected readonly phaseStartFromCtgov = signal(false);
  protected readonly phaseEndFromCtgov = signal(false);

  protected readonly PHASE_OPTIONS: Array<{ id: string; name: string }> = [
    { id: 'PRECLIN',  name: 'Preclinical' },
    { id: 'P1',       name: 'Phase 1' },
    { id: 'P2',       name: 'Phase 2' },
    { id: 'P3',       name: 'Phase 3' },
    { id: 'P4',       name: 'Phase 4' },
    { id: 'APPROVED', name: 'Approved' },
    { id: 'LAUNCHED', name: 'Launched' },
    { id: 'OBS',      name: 'Observational' },
  ];

  // map of ct.gov phase enum value to our analyst-facing enum. matches
  // _derive_phase_type() in supabase/migrations/20260503050000_derive_phase_type_from_ctgov.sql.
  private mapCtgovPhase(phases: string[] | undefined, studyType: string | undefined): string | null {
    if (!phases || phases.length === 0) return studyType === 'OBSERVATIONAL' ? 'OBS' : null;
    if (phases.length > 1) {
      // multi-phase trials collapse to max (e.g. PHASE2/PHASE3 -> P3) per the
      // sql function's documented behavior.
      const ranked = ['EARLY_PHASE1', 'PHASE1', 'PHASE2', 'PHASE3', 'PHASE4'];
      const max = phases
        .map((p) => ranked.indexOf(p))
        .filter((i) => i >= 0)
        .sort((a, b) => b - a)[0];
      if (max === undefined) return null;
      return { 0: 'P1', 1: 'P1', 2: 'P2', 3: 'P3', 4: 'P4' }[max] ?? null;
    }
    const single = phases[0];
    if (single === 'EARLY_PHASE1' || single === 'PHASE1') return 'P1';
    if (single === 'PHASE2') return 'P2';
    if (single === 'PHASE3') return 'P3';
    if (single === 'PHASE4') return 'P4';
    if (single === 'NA' && studyType === 'OBSERVATIONAL') return 'OBS';
    return null;
  }
```

- [ ] **Step 2: Extend the NCT lookup to capture phase + dates**

Find the existing `onIdentifierChanged` method and the `fetch` block. After `const study = (await res.json()) as { ... }` is parsed, extend the parsed type and assign the new signals. Replace the existing parse + acronym block with:

```typescript
        const study = (await res.json()) as {
          protocolSection?: {
            identificationModule?: { acronym?: string; briefTitle?: string };
            designModule?: { phases?: string[]; studyType?: string };
            statusModule?: {
              startDateStruct?: { date?: string };
              primaryCompletionDateStruct?: { date?: string };
              completionDateStruct?: { date?: string };
            };
          };
        };
        const acronym = study.protocolSection?.identificationModule?.acronym?.trim() ?? null;
        const briefTitle = study.protocolSection?.identificationModule?.briefTitle?.trim() ?? null;
        const display = acronym || briefTitle;
        this.nctLookupAcronym.set(acronym);
        this.nctLookupState.set('ok');
        if (display && !this.nameWasManuallyEdited()) {
          this.name.set(display);
        }

        // pre-fill phase + dates
        const derivedPhase = this.mapCtgovPhase(
          study.protocolSection?.designModule?.phases,
          study.protocolSection?.designModule?.studyType
        );
        if (derivedPhase) {
          this.phaseType.set(derivedPhase);
          this.phaseTypeFromCtgov.set(true);
        }
        const startDate = study.protocolSection?.statusModule?.startDateStruct?.date;
        if (startDate) {
          // ct.gov returns YYYY-MM or YYYY-MM-DD; normalize to YYYY-MM-DD
          const normalized = /^\d{4}-\d{2}$/.test(startDate) ? `${startDate}-01` : startDate;
          this.phaseStart.set(normalized);
          this.phaseStartFromCtgov.set(true);
        }
        const endDate =
          study.protocolSection?.statusModule?.primaryCompletionDateStruct?.date ??
          study.protocolSection?.statusModule?.completionDateStruct?.date;
        if (endDate) {
          const normalized = /^\d{4}-\d{2}$/.test(endDate) ? `${endDate}-01` : endDate;
          this.phaseEnd.set(normalized);
          this.phaseEndFromCtgov.set(true);
        }
```

- [ ] **Step 3: Reset the pre-fill flags when NCT is cleared**

In the `onIdentifierChanged` method, when `value` becomes falsy OR the format is invalid, reset:

```typescript
    if (!value) {
      this.phaseTypeFromCtgov.set(false);
      this.phaseStartFromCtgov.set(false);
      this.phaseEndFromCtgov.set(false);
      return;
    }
```

(Add this in addition to the existing reset of `nctLookupState`.)

- [ ] **Step 4: Reset the new signals when dialog closes**

In the existing `effect()` that resets form on close, add:

```typescript
        this.phaseType.set(null);
        this.phaseStart.set(null);
        this.phaseEnd.set(null);
        this.phaseTypeFromCtgov.set(false);
        this.phaseStartFromCtgov.set(false);
        this.phaseEndFromCtgov.set(false);
```

- [ ] **Step 5: Save with per-field source**

In the existing `save()` method, replace the `trialService.create` call with:

```typescript
      const payload: Partial<Trial> = {
        name: this.name().trim(),
        identifier: this.identifier()?.trim() || null,
        product_id: this.assetId()!,
        therapeutic_area_id: this.therapeuticAreaId()!,
      };
      if (this.phaseType()) {
        payload.phase_type = this.phaseType();
        payload.phase_type_source = this.phaseTypeFromCtgov() ? 'ctgov' : 'analyst';
      }
      if (this.phaseStart()) {
        payload.phase_start_date = this.phaseStart();
        payload.phase_start_date_source = this.phaseStartFromCtgov() ? 'ctgov' : 'analyst';
      }
      if (this.phaseEnd()) {
        payload.phase_end_date = this.phaseEnd();
        payload.phase_end_date_source = this.phaseEndFromCtgov() ? 'ctgov' : 'analyst';
      }
      const trial = await this.trialService.create(this.spaceId(), payload);
```

You may need to verify `TrialService.create` accepts source columns. The existing `create(spaceId, trial: Partial<Trial>)` spreads the object into the insert, so as long as `Trial` has the source fields (Task 4), this works.

- [ ] **Step 6: Add the three fields in the HTML**

Open `trial-create-dialog.component.html`. Add the same HTML block as Task 6's edit dialog, but the `[disabled]` binding uses `phaseTypeFromCtgov()` (not `phaseTypeLocked()`) and there is no "remove the NCT to override" tooltip. Instead use "Pre-filled from ct.gov." Mirror the structure:

```html
<div class="mb-3">
  <label for="create-phase-type" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
    Phase
    @if (phaseTypeFromCtgov()) {
      <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">ct.gov</span>
    }
  </label>
  <p-select
    inputId="create-phase-type"
    [options]="PHASE_OPTIONS"
    optionLabel="name"
    optionValue="id"
    [ngModel]="phaseType()"
    (ngModelChange)="phaseType.set($event)"
    [disabled]="phaseTypeFromCtgov()"
    placeholder="Select a phase"
    [showClear]="true"
    appendTo="body"
    [pTooltip]="phaseTypeFromCtgov() ? 'Pre-filled from ct.gov. Clear the NCT to override.' : null"
    tooltipPosition="top"
  />
</div>

<div class="mb-3 grid grid-cols-2 gap-3">
  <div>
    <label for="create-phase-start" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
      Phase start
      @if (phaseStartFromCtgov()) {
        <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">ct.gov</span>
      }
    </label>
    <input id="create-phase-start" type="date"
      class="block w-full border border-slate-200 px-2 py-1 text-sm tabular-nums"
      [value]="phaseStart() ?? ''"
      (input)="phaseStart.set(($event.target as HTMLInputElement).value || null)"
      [disabled]="phaseStartFromCtgov()" />
  </div>
  <div>
    <label for="create-phase-end" class="block text-[10px] font-medium uppercase tracking-wider text-slate-500">
      Phase end
      @if (phaseEndFromCtgov()) {
        <span class="ml-1 rounded-sm border border-slate-200 bg-slate-50 px-1 py-px font-mono text-[9px] uppercase tracking-wider text-slate-500">ct.gov</span>
      }
    </label>
    <input id="create-phase-end" type="date"
      class="block w-full border border-slate-200 px-2 py-1 text-sm tabular-nums"
      [value]="phaseEnd() ?? ''"
      (input)="phaseEnd.set(($event.target as HTMLInputElement).value || null)"
      [disabled]="phaseEndFromCtgov()" />
  </div>
</div>
```

- [ ] **Step 7: Build + lint**

Run:
```bash
cd src/client && ng lint && ng build
```

Expected: both pass.

- [ ] **Step 8: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-create-dialog.component.ts \
        src/client/src/app/features/manage/trials/trial-create-dialog.component.html
git commit -m "feat(ui): trial create dialog pre-fills phase + dates from ct.gov"
```

---

## Task 8: Trial detail Phase card always-render + source tags

The current Phase card is guarded by `@if (t.phase_type)`, which hides the empty state. Remove the gate, add an empty-state row, and append a source tag to each populated `<dd>`.

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Read the existing Phase card block**

Run:
```bash
sed -n '397,430p' src/client/src/app/features/manage/trials/trial-detail.component.html
```

Confirm the block matches what's in the spec (lines 400-427). If not, adapt.

- [ ] **Step 2: Replace the block**

Replace lines ~400-427 with:

```html
      <!-- Phase card: always renders. Empty state cues the analyst to fill it. -->
      <app-section-card title="Phase">
        @if (t.phase_type || t.phase_start_date || t.phase_end_date) {
          <dl class="grid grid-cols-2 gap-x-8 gap-y-4 sm:grid-cols-3">
            <div>
              <dt class="text-[10px] font-medium uppercase tracking-wider text-slate-400">Phase type</dt>
              <dd class="mt-1 flex items-baseline gap-1.5 font-mono text-sm text-slate-900">
                <span>{{ t.phase_type ? phaseLabel(t.phase_type) : '--' }}</span>
                @if (t.phase_type_source) {
                  <span class="rounded-sm border border-slate-200 bg-slate-50 px-1 py-px text-[9px] uppercase tracking-wider text-slate-500">
                    {{ t.phase_type_source }}
                  </span>
                }
              </dd>
            </div>
            <div>
              <dt class="text-[10px] font-medium uppercase tracking-wider text-slate-400">Start date</dt>
              <dd class="mt-1 flex items-baseline gap-1.5 font-mono text-sm text-slate-900 tabular-nums">
                <span>{{ (t.phase_start_date | date: 'mediumDate') || '--' }}</span>
                @if (t.phase_start_date_source) {
                  <span class="rounded-sm border border-slate-200 bg-slate-50 px-1 py-px text-[9px] uppercase tracking-wider text-slate-500">
                    {{ t.phase_start_date_source }}
                  </span>
                }
              </dd>
            </div>
            <div>
              <dt class="text-[10px] font-medium uppercase tracking-wider text-slate-400">End date</dt>
              <dd class="mt-1 flex items-baseline gap-1.5 font-mono text-sm text-slate-900 tabular-nums">
                <span>{{ (t.phase_end_date | date: 'mediumDate') || '--' }}</span>
                @if (t.phase_end_date_source) {
                  <span class="rounded-sm border border-slate-200 bg-slate-50 px-1 py-px text-[9px] uppercase tracking-wider text-slate-500">
                    {{ t.phase_end_date_source }}
                  </span>
                }
              </dd>
            </div>
          </dl>
        } @else {
          <p class="text-sm text-slate-500">
            No phase set.
            @if (spaceRole.canEdit()) {
              <a
                href="#"
                class="text-brand-700 hover:underline"
                (click)="$event.preventDefault(); editingTrial.set(true)"
              >Edit this trial</a> to add phase, start, and end dates.
            } @else {
              The trial owner can add phase, start, and end dates from the edit dialog.
            }
          </p>
        }
      </app-section-card>
```

Note: this removes the `@if (t.phase_type)` outer guard. The empty-state branch is now self-contained.

- [ ] **Step 3: Build + lint**

Run:
```bash
cd src/client && ng lint && ng build
```

Expected: both pass.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "feat(ui): trial detail Phase card always renders with source tags"
```

---

## Task 9: Help page paragraph + runbook-review-guard map

**Files:**
- Modify: `src/client/src/app/features/help/phases-help.component.ts`
- Modify: `.claude/hooks/runbook-review-guard.sh`

- [ ] **Step 1: Read the existing phases-help component**

Run:
```bash
cat src/client/src/app/features/help/phases-help.component.ts
```

- [ ] **Step 2: Add the ct.gov-managed paragraph**

Locate the prose section near the existing description of the phase enum. Insert a new paragraph at a sensible spot (likely after the phase-color or phase-enum explanation, before the FAQ):

```html
<p class="mt-4 text-sm text-slate-700">
  Phase values for trials with a registered NCT are managed by ct.gov: the
  product mirrors what ct.gov reports on every sync. For trials without an
  NCT, or for fields ct.gov leaves blank, analysts can set them on the trial
  edit dialog. On sync, ct.gov values overwrite previous analyst values and
  the change appears in the activity feed.
</p>
```

If the component is purely template-string-based (template inline in the `.ts`), insert into the template string. If a separate `.html` file exists, edit that.

- [ ] **Step 3: Update `runbook-review-guard.sh`**

Open `.claude/hooks/runbook-review-guard.sh`. Find the `helpRules` map (a bash-associative-array or pattern-list pairing changed paths to help pages). Add an entry that maps the materialize-function migration path to `help/phases`. The exact syntax depends on the hook's existing format; mirror what's there.

```bash
# Example (depends on existing format):
helpRules["supabase/migrations/.*_(derive_phase_type|trial_phase_ctgov_truth|trial_phase_source_columns)"]="help/phases"
```

If the file uses a different structure (e.g. a list of pattern-page pairs in a case statement), follow that pattern.

- [ ] **Step 4: Smoke-test the hook**

Run (from the repo root):
```bash
bash -n .claude/hooks/runbook-review-guard.sh
```

Expected: zero output (syntax check passes).

- [ ] **Step 5: Build + lint**

Run:
```bash
cd src/client && ng lint && ng build
```

Expected: both pass.

- [ ] **Step 6: Commit**

```bash
git add src/client/src/app/features/help/phases-help.component.ts \
        .claude/hooks/runbook-review-guard.sh
git commit -m "docs(help): phases page documents ct.gov-managed fields"
```

---

## Task 10: E2E scenario for locked edit dialog

Extend the existing `trial-management.spec.ts` with one scenario that covers the lock state. The test should: open the edit dialog on a seed trial known to be ct.gov-managed (any seed trial with an NCT), assert the Phase select is disabled and the `[ct.gov]` badge is present; then open the edit dialog on a non-NCT trial (a `MRD-PRECLIN`-style preclin), assert the Phase select is enabled and save round-trips.

**Files:**
- Modify: `src/client/e2e/tests/trial-management.spec.ts`

- [ ] **Step 1: Read the existing test file to learn the helpers it uses**

Run:
```bash
sed -n '1,60p' src/client/e2e/tests/trial-management.spec.ts
```

- [ ] **Step 2: Add a new test scenario**

Append a new `test(...)` block. Use the existing test's auth + navigation helpers. The seed has `MYOCARD-1` (NCT, P3) as a ct.gov-managed trial and `MRD-PRECLIN` (no NCT, PRECLIN) as an analyst-managed one.

```typescript
test('Phase fields lock when ct.gov manages them', async ({ page, signInAsOwner }) => {
  await signInAsOwner();
  await page.goto('/...'); // navigate to trial-list (use the existing helper)

  // Open edit dialog on the ct.gov-managed trial MYOCARD-1
  await page.getByRole('link', { name: 'MYOCARD-1' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();

  const phaseSelect = page.getByLabel('Phase');
  await expect(phaseSelect).toBeDisabled();
  await expect(page.getByText('ct.gov').first()).toBeVisible();
  await page.getByRole('button', { name: 'Cancel' }).click();

  // Open edit dialog on the analyst-managed trial MRD-PRECLIN
  await page.goto('/...'); // back to trial list
  await page.getByRole('link', { name: 'MRD-PRECLIN' }).click();
  await page.getByRole('button', { name: 'Edit details' }).click();

  const preclinPhaseSelect = page.getByLabel('Phase');
  await expect(preclinPhaseSelect).toBeEnabled();
});
```

Adapt the navigation helpers and selectors to match what the rest of the file uses. The exact route and signIn helper names are visible in Step 1's read.

- [ ] **Step 3: Run e2e**

Run:
```bash
cd src/client && npm run test:e2e:fast -- -g "Phase fields lock"
```

Expected: the new test passes. Other tests should not have regressed.

- [ ] **Step 4: Commit**

```bash
git add src/client/e2e/tests/trial-management.spec.ts
git commit -m "test(e2e): trial-edit dialog phase lock state"
```

---

## Task 11: Final verification

- [ ] **Step 1: Full lint + build**

Run:
```bash
cd src/client && ng lint && ng build
```

Expected: clean.

- [ ] **Step 2: Run supabase advisors with strict gate**

Run:
```bash
supabase db advisors --local --type all
```

Expected: no new warnings/errors compared to the pre-feature baseline. Per `CLAUDE.md`, the local check ratchets to ERROR; CI honors `--fail-on warn`.

- [ ] **Step 3: Regen architecture docs**

Run:
```bash
cd src/client && npm run docs:arch
```

Expected: docs regenerate. The script may update `docs/runbook/06-backend-architecture.md` (RPC matrix) and `docs/runbook/07-database-schema.md` (ER diagram) with the new source columns + the modified materialize function. Commit any drift the regen produces.

- [ ] **Step 4: Manual browser verification per spec §Testing → manual**

Boot the dev server and exercise each surface:

```bash
cd src/client && npm start
```

Verify:
- **Trial create dialog with valid NCT.** Pre-fills phase + dates in disabled state with `[ct.gov]` badges.
- **Trial create dialog with no NCT.** Phase + dates are editable; save writes them; trial detail shows `[analyst]` tags.
- **Trial edit dialog on ct.gov-managed trial (e.g. MYOCARD-1).** Phase locked, dates locked.
- **Trial edit dialog on analyst-managed trial (e.g. MRD-PRECLIN).** Phase editable, dates editable, save round-trips.
- **Trial detail Phase card on a trial with `phase_type = null`.** Empty-state copy renders; "Edit this trial" link visible to editors.
- **Trial detail Phase card source tags.** `[ct.gov]` / `[analyst]` shows next to populated values.
- **Trigger a manual ct.gov resync that changes a phase value on a ctgov-locked trial.** The trial's activity feed shows a `phase_changed` row.

- [ ] **Step 5: Commit any docs:arch drift, push**

```bash
git add -A
git status
# review the diff
git commit -m "docs(runbook): regenerate after ct.gov truth migration"  # only if drift exists
```

Hand back to the user to push the branch.

---

## Self-review checklist

- [x] **Spec coverage.** Every section of the spec has a corresponding task:
  - §Schema → Task 1
  - §Sync materialization → Task 2
  - §Edit UI (edit dialog) → Task 6
  - §Edit UI (create dialog) → Task 7
  - §Trial detail display → Task 8
  - §Help page + runbook-review-guard → Task 9
  - §Backfill → Task 1 + Task 3 (seed)
  - §Testing → migration smokes (Tasks 1, 2), service Vitest (Task 5), e2e + manual (Tasks 10, 11)
- [x] **Placeholders.** None: every code/test step contains the actual content.
- [x] **Type consistency.** Field names (`phase_type_source`, `phase_start_date_source`, `phase_end_date_source`) and event names (`phase_changed`, `phase_start_changed`, `phase_end_changed`) match between SQL, TypeScript model, service, dialog signals, e2e selectors, and migration smoke.
- [x] **Failure modes (spec §Failure modes).** Covered:
  - Ct.gov returns same value → Task 2 test 4 (no-op).
  - Ct.gov returns structurally novel value → Task 2 test 5 (NA-derive).
  - Misbehaving client posts to ct.gov-locked field → Task 2 test 7 (trigger rejection).
  - Two simultaneous syncs → trusted to Postgres serialization; no test needed beyond what materialize already covers.
  - Trial loses its NCT → source columns stay, lock stays on (current model already handles this; no extra task).
