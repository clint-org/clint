# Trial Change Feed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship the always-on trial change feed: background CT.gov polling via the existing Cloudflare Worker, snapshot history, analyst-marker audit log, a unified typed event stream, six in-app surfaces that consume it, per-space field visibility, and the schema cleanup that becomes possible once JSON snapshots are the source of truth.

**Architecture:** Four-stage pipeline (observe via Worker cron -> store JSONB snapshots + raw diffs -> classify into typed events -> surface across six UI places). Worker holds all CT.gov interaction; Postgres holds all classification logic; Angular reads through a small RPC family. Snapshots are append-only and become the source of truth, so adding a tracked field later is a code change plus a recompute, not a re-poll.

**Tech Stack:** Cloudflare Worker (TS, vitest under `@cloudflare/vitest-pool-workers`), Supabase Postgres (timestamped migrations under `supabase/migrations/`), Angular 19 standalone components with signals + new control flow, PrimeNG 19, Tailwind v4, RLS via `has_space_access()` helper.

**Spec:** `docs/superpowers/specs/2026-05-02-trial-change-feed-design.md` is authoritative. When this plan and the spec disagree, follow the spec and update the plan.

**Conventions:**
- Migrations named `YYYYMMDDHHmmss_<short_description>.sql`. Use `20260502120000` ... `20260502123000` as the base timestamps for this work; bump the suffix for each new migration.
- Standalone components, `inject()`, `signal()` / `computed()` / `effect()`, new control flow `@if` / `@for` / `@switch`. No NgModules, no constructor injection.
- PrimeNG components for interactive UI; Tailwind for layout. Brand colors: `bg-brand-*` / `text-brand-*`, never `bg-teal-*`. Slate / red / amber / green / cyan / violet stay literal.
- All new RLS policies use `has_space_access(space_id)` (or `has_space_access(space_id, array['owner'])` for write-restricted).
- No em dashes, no emojis, no Claude attribution in commits.
- Update `docs/runbook/*.md` in the same change set; run `cd src/client && npm run docs:arch` and commit the regen alongside schema changes.
- Verification gate at the end of every phase: `cd src/client && ng lint && ng build` AND `supabase db reset` AND `npm run test:worker` (where applicable). Phases must not be marked complete until all three pass.

---

## File Structure

### New SQL migrations (under `supabase/migrations/`)

| Filename | Responsibility |
|---|---|
| `20260502120000_trial_change_feed_tables.sql` | New tables: `trial_ctgov_snapshots`, `trial_field_changes`, `trial_change_events`, `marker_changes`, `ctgov_sync_runs`. RLS policies. Indexes. |
| `20260502120100_trials_polling_columns.sql` | Add `latest_ctgov_version`, `last_polled_at` to `trials`; partial index `idx_trials_polling_queue`. |
| `20260502120200_spaces_field_visibility.sql` | Add `ctgov_field_visibility jsonb` to `spaces` with default `'{}'`. Comment. |
| `20260502120300_ctgov_worker_secret.sql` | Vault entry placeholder + `_verify_ctgov_worker_secret(p_secret text)` SECURITY DEFINER function. |
| `20260502120400_ctgov_helper_functions.sql` | `_materialize_trial_from_snapshot`, `_compute_field_diffs`, `_classify_change`. Pure plpgsql, no I/O. |
| `20260502120500_ctgov_ingest_rpc.sql` | `ingest_ctgov_snapshot(p_secret, p_trial_id, p_payload, p_post_date, p_module_hints)` orchestration RPC. |
| `20260502120600_ctgov_polling_rpcs.sql` | `get_trials_for_polling(p_secret, p_limit)` + `record_sync_run(p_secret, ...)`. |
| `20260502120700_marker_changes_trigger.sql` | AFTER trigger on `markers` + `_emit_events_from_marker_change` classifier + `backfill_marker_history()` one-shot. |
| `20260502120800_change_feed_surface_rpcs.sql` | `get_activity_feed`, `get_trial_activity`, `get_marker_history`, `trigger_single_trial_sync`, `update_space_field_visibility`, `recompute_trial_change_events`. |
| `20260502120900_dashboard_data_change_counts.sql` | Drop + recreate `get_dashboard_data` adding `recent_changes_count` + `most_recent_change_type` per trial. Update `get_landscape_data` similarly. |
| `20260502122000_drop_orphaned_trial_columns.sql` | Drop the 36 CT.gov columns from `trials`. Also strip dropped keys from the `jsonb_build_object` projections in `get_dashboard_data`/`get_landscape_data`. |

### New Worker files (under `src/client/worker/`)

| File | Responsibility |
|---|---|
| `ctgov-sync/types.ts` | Shared TS types for the sync pipeline. Single source of truth for snapshot / diff / classification shapes the Worker hands to Postgres. |
| `ctgov-sync/ctgov-client.ts` | Adapter wrapping `/api/v2/studies/{nct}`, the batched `/api/v2/studies?query.term=...&fields=NCTId,LastUpdatePostDate`, and the opportunistic `/api/int/studies/{nct}/history` calls. The only file that knows CT.gov URL shapes. |
| `ctgov-sync/batch.ts` | Pure helpers: chunking trial rows by NCT, deduplication, building NCT->trial-assignment maps. |
| `ctgov-sync/watermark.ts` | Compares CT.gov `LastUpdatePostDate` against the per-trial watermark; returns the set of NCTs that need a full pull. |
| `ctgov-sync/poller.ts` | The `scheduled()` entry point. Orchestrates: get queue -> dedupe -> batched watermark -> fan-out full pulls -> per-trial ingest RPC -> record run row. Also exposes `runManualBackfill(nctIds)` for the admin POST. |
| `worker/index.ts` (modified) | Adds `scheduled` export. Adds `POST /admin/ctgov-backfill` route inside `fetch()`. |

### New Worker tests (under `src/client/worker/test/`)

| File | Responsibility |
|---|---|
| `ctgov-sync/batch.spec.ts` | Pure unit tests for chunking/dedupe. |
| `ctgov-sync/watermark.spec.ts` | Watermark comparison logic against fixture CT.gov responses. |
| `ctgov-sync/ctgov-client.spec.ts` | URL shape + error handling per CT.gov endpoint. Mocks `fetch`. |
| `ctgov-sync/poller.spec.ts` | End-to-end Worker `scheduled()` test with mocked CT.gov + mocked Supabase. Verifies idempotency, error continuation, sync-run summary row. |

### New Angular files

Under `src/client/src/app/core/models/`:

| File | Responsibility |
|---|---|
| `change-event.model.ts` | `ChangeEvent`, `ChangeEventSource`, `ChangeEventType`, payload-shape interfaces, `MarkerChange`. |
| `ctgov-field.model.ts` | `CtgovField` interface + `CTGOV_FIELD_CATALOGUE` constant (~60-80 entries). |

Under `src/client/src/app/core/services/`:

| File | Responsibility |
|---|---|
| `change-event.service.ts` | Wraps `get_activity_feed`, `get_trial_activity`, `get_marker_history`, `trigger_single_trial_sync`, `recompute_trial_change_events`. |
| `space-field-visibility.service.ts` | Wraps `update_space_field_visibility` + reads `spaces.ctgov_field_visibility`. |

Under `src/client/src/app/shared/components/`:

| File | Responsibility |
|---|---|
| `change-event-row/change-event-row.component.ts` | Stateless renderer: `@switch (event.event_type)` per-type formatting. Used by Activity page, widget, marker history, trial-detail Activity. |
| `change-event-row/change-event-row.component.html` | Per-event-type template branches with source badge, icon, summary, expand-to-payload. |
| `ctgov-field-renderer/ctgov-field-renderer.component.ts` | Walks JSON snapshot for a list of paths from `CTGOV_FIELD_CATALOGUE`, renders by `kind`. Used by trial-detail and the "Show all CT.gov data" modal. |
| `ctgov-field-picker/ctgov-field-picker.component.ts` | Two-column drag-to-reorder field chooser. Used by the per-space settings UI. |
| `what-changed-widget/what-changed-widget.component.ts` | Engagement-landing widget: top 5 high-signal events, last 7d. |

Under `src/client/src/app/features/engagement-landing/`:

| File | Modification |
|---|---|
| `engagement-landing.component.ts/.html` | Add `<app-what-changed-widget>` above `<app-intelligence-feed>`. Existing intelligence feed mixer adapts via service change. |

Under `src/client/src/app/features/`:

| File | Responsibility |
|---|---|
| `engagement-activity/engagement-activity-page.component.ts/.html` | New lazy-loaded page at `/t/:tenantId/s/:spaceId/activity`. Filter pills + cursor-paginated event list. |
| `space-settings/space-field-visibility-settings.component.ts/.html` | New tabbed per-surface field chooser. |
| `manage/trials/trial-create-dialog.component.ts/.html` | Small dialog launched from trial-list "New trial" action. |

Under `src/client/src/app/features/manage/trials/` (existing files modified):

| File | Modification |
|---|---|
| `trial-detail.component.ts/.html` | Add Activity section, CT.gov data block (renderer + "Show all" modal), "Sync from CT.gov" button. Replace `<app-trial-form>` modal with inline editing for analyst-owned fields. Drop import of `TrialFormComponent`. |
| `trial-list.component.ts/.html` | "New trial" button -> opens `app-trial-create-dialog` instead of routing to old form. Drop the inline form usage if any. |
| `trial-form.component.ts/.html` | DELETED in Phase 9. |

Under `src/client/src/app/core/services/`:

| File | Modification |
|---|---|
| `ctgov-sync.service.ts` | DELETED in Phase 9. Manual on-demand sync moves to `change-event.service.ts -> triggerSingleTrialSync()`. |

Under `src/client/src/app/core/models/trial.model.ts`:

Drop the 36 orphaned CT.gov field declarations; keep `phase`, `recruitment_status`, `study_type`, `last_update_posted_date`, plus the new `latest_ctgov_version`, `last_polled_at`, `ctgov_last_synced_at`. (Phase 10.)

Under `src/client/src/app/app.routes.ts`:

Add `/activity` route lazy-loaded under the `s/:spaceId` group. Add a redirect from any old `/manage/trials/:id/edit` URL if one exists. (No edit route exists today; the trial-form is rendered as a dialog inside trial-detail. Confirm during Phase 9 and add the redirect only if needed.)

Under `docs/runbook/`:

Update `03-features.md`, `06-backend-architecture.md`, `07-database-schema.md`, `08-authentication-security.md`, `12-deployment.md`. Re-run `npm run docs:arch` from `src/client/` after the migration set lands so AUTO-GEN blocks regenerate.

---

## Phase 1: Schema foundation (additive migrations)

Goal: All new tables, columns, helper functions, and RPCs land additively. Worker does not exist yet; ingest RPC works when called manually with a payload. No data flows to the UI.

### Task 1.1: Create the five new tables

**Files:**
- Create: `supabase/migrations/20260502120000_trial_change_feed_tables.sql`

- [ ] **Step 1: Write the migration**

Copy the exact `create table` blocks for `trial_ctgov_snapshots`, `trial_field_changes`, `trial_change_events`, `marker_changes`, `ctgov_sync_runs` from the spec's "New tables" section. Each table must include:
- The `unique` and `check` constraints from the spec
- All indexes from the spec
- `alter table ... enable row level security` after the create
- RLS policies: `select` and `insert`/`update`/`delete` (where applicable) gated by `public.has_space_access(space_id)` with `array['owner', 'editor']` for writes. `marker_changes` inserts come from a SECURITY DEFINER trigger so its RLS is select-only via `has_space_access`. `ctgov_sync_runs` is read-only to all members; writes only via the SECURITY DEFINER `record_sync_run` RPC.

End the file with `comment on table ...` for each table summarizing its role in one sentence.

- [ ] **Step 2: Run `supabase db reset` to verify migration applies cleanly**

Run: `supabase db reset` from repo root.
Expected: completes without error, all five tables visible via `psql "$DATABASE_URL" -c '\dt public.*'`.

- [ ] **Step 3: Smoke-test RLS isolation**

Add a `do $$ ... $$` block at the bottom of the migration in the same style as `supabase/migrations/20260428042300_whitelabel_isolation_smoke_tests.sql`. The block should: insert a snapshot under user A's space, set role to user B, attempt to select, assert zero rows. Wrap in `raise notice` per case as that file does.

Run `supabase db reset` again; expected output includes the smoke-test notices, none assertion-failed.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260502120000_trial_change_feed_tables.sql
git commit -m "feat(db): add trial change feed tables and RLS"
```

### Task 1.2: Add polling watermark columns to `trials`

**Files:**
- Create: `supabase/migrations/20260502120100_trials_polling_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table public.trials
  add column latest_ctgov_version int,
  add column last_polled_at       timestamptz;

create index idx_trials_polling_queue
  on public.trials (last_polled_at nulls first)
  where identifier is not null;

comment on column public.trials.latest_ctgov_version is
  'Highest CT.gov version we have ingested for this trial. Compared against snapshot rows.';
comment on column public.trials.last_polled_at is
  'Timestamp of the last successful Worker poll attempt for this trial. NULL means never polled; sorts first in the queue.';
```

- [ ] **Step 2: Verify**

Run `supabase db reset`; expected: clean.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/20260502120100_trials_polling_columns.sql
git commit -m "feat(db): add polling watermark columns to trials"
```

### Task 1.3: Add `ctgov_field_visibility` to `spaces`

**Files:**
- Create: `supabase/migrations/20260502120200_spaces_field_visibility.sql`

- [ ] **Step 1: Write the migration**

```sql
alter table public.spaces
  add column ctgov_field_visibility jsonb not null default '{}';

comment on column public.spaces.ctgov_field_visibility is
  'Per-surface CT.gov field display config. Shape: { surface_key: [field_path, ...] }';
```

- [ ] **Step 2: Verify and commit**

Run `supabase db reset`; expected: clean.

```bash
git add supabase/migrations/20260502120200_spaces_field_visibility.sql
git commit -m "feat(db): add per-space CT.gov field visibility config"
```

### Task 1.4: Worker secret verifier

**Files:**
- Create: `supabase/migrations/20260502120300_ctgov_worker_secret.sql`

- [ ] **Step 1: Write the migration**

Insert a placeholder vault entry only if running locally (gated by `current_setting('app.is_local', true)` checks are not stable; instead, use `if not exists`):

```sql
-- The Worker reads CTGOV_WORKER_SECRET from wrangler secrets and passes it as
-- the first argument to every cron-called RPC. The secret is verified
-- inside SECURITY DEFINER. Local devs get a fixed dev secret; prod sets it via
--   insert into vault.secrets (name, secret) values ('ctgov_worker_secret', '<random>')
-- per the deployment runbook.

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'ctgov_worker_secret') then
    perform vault.create_secret('local-dev-ctgov-secret', 'ctgov_worker_secret');
  end if;
end$$;

create or replace function public._verify_ctgov_worker_secret(p_secret text)
returns void
language plpgsql
security definer
set search_path = public, vault
as $$
declare
  v_expected text;
begin
  select decrypted_secret into v_expected
    from vault.decrypted_secrets
   where name = 'ctgov_worker_secret';
  if v_expected is null or p_secret <> v_expected then
    raise exception 'unauthorized' using errcode = '42501';
  end if;
end;
$$;

revoke execute on function public._verify_ctgov_worker_secret(text) from public;
```

- [ ] **Step 2: Smoke-test the verifier**

Add a `do $$ ... $$` block at the end:

```sql
do $$
begin
  perform public._verify_ctgov_worker_secret('local-dev-ctgov-secret');
  raise notice 'verify ok with correct secret';
  begin
    perform public._verify_ctgov_worker_secret('wrong');
    raise exception 'verify should have rejected wrong secret';
  exception when sqlstate '42501' then
    raise notice 'verify rejected wrong secret as expected';
  end;
end$$;
```

- [ ] **Step 3: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120300_ctgov_worker_secret.sql
git commit -m "feat(db): add worker secret verifier and vault entry"
```

### Task 1.5: Snapshot helper functions

**Files:**
- Create: `supabase/migrations/20260502120400_ctgov_helper_functions.sql`

These are pure plpgsql with no I/O; they are unit-tested via the smoke-test pattern at the end of the migration.

- [ ] **Step 1: Write `_materialize_trial_from_snapshot(p_trial_id, p_payload)`**

The body ports the relevant subset of `mapStudy()` from `src/client/src/app/core/services/ctgov-sync.service.ts`. After cleanup we only materialize 3 columns: `phase`, `recruitment_status`, `study_type`. Plus the watermark trio: `last_update_posted_date`, `latest_ctgov_version`, `ctgov_last_synced_at`. The function does ONE partial UPDATE and never touches analyst-owned columns (`name`, `notes`, `display_order`, `product_id`, `therapeutic_area_id`, `phase_type`, `phase_start_date`, `phase_end_date`).

`phase` mapping ports `mapPhase()` from `ctgov-sync.service.ts:108-117`: array of CT.gov phase enums to a single human-readable string (e.g. `['PHASE2','PHASE3']` -> `'Phase 2/Phase 3'`).

```sql
create or replace function public._materialize_trial_from_snapshot(
  p_trial_id uuid,
  p_payload jsonb
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_phase            text;
  v_recruitment      text;
  v_study_type       text;
  v_last_update_date date;
begin
  v_recruitment := p_payload #>> '{protocolSection,statusModule,overallStatus}';
  v_study_type  := p_payload #>> '{protocolSection,designModule,studyType}';
  v_phase       := public._map_phase_array(p_payload #> '{protocolSection,designModule,phases}');
  v_last_update_date := nullif(p_payload #>> '{protocolSection,statusModule,lastUpdatePostDateStruct,date}', '')::date;

  update public.trials
     set phase                    = coalesce(v_phase, phase),
         recruitment_status       = coalesce(v_recruitment, recruitment_status),
         study_type               = coalesce(v_study_type, study_type),
         last_update_posted_date  = coalesce(v_last_update_date, last_update_posted_date),
         ctgov_last_synced_at     = now()
   where id = p_trial_id;
end;
$$;
```

Plus a small private helper `_map_phase_array(jsonb) returns text` that handles the same enum-to-label mapping as the TS version.

- [ ] **Step 2: Write `_compute_field_diffs(p_old jsonb, p_new jsonb)`**

```sql
create or replace function public._compute_field_diffs(
  p_old jsonb,
  p_new jsonb,
  p_module_hints text[] default null
) returns table (
  field_path text,
  old_value  jsonb,
  new_value  jsonb
)
language plpgsql
immutable
as $$
declare
  v_paths text[] := array[
    'protocolSection.statusModule.overallStatus',
    'protocolSection.statusModule.startDateStruct.date',
    'protocolSection.statusModule.primaryCompletionDateStruct.date',
    'protocolSection.statusModule.completionDateStruct.date',
    'protocolSection.designModule.phases',
    'protocolSection.designModule.enrollmentInfo.count',
    'protocolSection.armsInterventionsModule.armGroups',
    'protocolSection.armsInterventionsModule.interventions',
    'protocolSection.outcomesModule.primaryOutcomes',
    'protocolSection.outcomesModule.secondaryOutcomes',
    'protocolSection.sponsorCollaboratorsModule.leadSponsor.name',
    'protocolSection.eligibilityModule.eligibilityCriteria',
    'protocolSection.eligibilityModule.sex',
    'protocolSection.eligibilityModule.minimumAge',
    'protocolSection.eligibilityModule.maximumAge'
  ];
  v_path text;
  v_keys text[];
  v_old  jsonb;
  v_new  jsonb;
begin
  foreach v_path in array v_paths loop
    -- if module hints supplied, skip paths whose containing module isn't in the hints
    if p_module_hints is not null then
      continue when not _path_in_hinted_modules(v_path, p_module_hints);
    end if;
    v_keys := string_to_array(v_path, '.');
    v_old  := p_old #> v_keys;
    v_new  := p_new #> v_keys;
    if v_old is distinct from v_new then
      field_path := v_path;
      old_value  := v_old;
      new_value  := v_new;
      return next;
    end if;
  end loop;
end;
$$;
```

Plus the helper `_path_in_hinted_modules(text, text[])` that returns true if any hint module name appears as a segment in the path.

- [ ] **Step 3: Write `_classify_change(p_field_path, p_old, p_new) returns setof event_classification`**

Returns a small composite type `(event_type text, payload jsonb, occurred_at timestamptz)`. Implements the path-to-event-type rules from the spec's "Helper functions" table. Multi-row returns where appropriate (e.g. `armGroups` differences emit one row per added/removed arm). The payload shapes match the spec's "Event taxonomy" tables exactly.

For `date_moved` events, compute `days_diff` from `(p_new::date - p_old::date)` and `direction := case when days_diff > 0 then 'slip' else 'accelerate' end`.

- [ ] **Step 4: Smoke-test all three helpers**

Add a `do $$ ... $$` block that:
1. Calls `_compute_field_diffs` with two fixture payloads where `overallStatus` changes from `RECRUITING` to `COMPLETED`. Asserts one row, correct field_path.
2. Calls `_classify_change` for `protocolSection.statusModule.primaryCompletionDateStruct.date` going from `'2027-01-01'` to `'2027-04-01'`. Asserts one event with `event_type = 'date_moved'`, `payload->>'days_diff' = '90'`, `direction = 'slip'`.
3. Inserts a fixture trial, calls `_materialize_trial_from_snapshot`, asserts the three materialized columns were set.

Use `raise exception` on any failure; otherwise `raise notice 'helper N ok'`.

- [ ] **Step 5: Verify and commit**

```bash
supabase db reset
# expected: notices for all helper smoke tests, no exceptions
git add supabase/migrations/20260502120400_ctgov_helper_functions.sql
git commit -m "feat(db): add ctgov diff/classify/materialize helpers"
```

### Task 1.6: `ingest_ctgov_snapshot` orchestration RPC

**Files:**
- Create: `supabase/migrations/20260502120500_ctgov_ingest_rpc.sql`

- [ ] **Step 1: Write the RPC**

Implements the flow in the spec's "Ingest pipeline" mermaid:
1. Verify worker secret.
2. INSERT into `trial_ctgov_snapshots` with `ON CONFLICT (trial_id, ctgov_version) DO NOTHING RETURNING id, xmax`.
3. If `xmax = 0` (new row), call `_materialize_trial_from_snapshot`.
4. Look up the previous snapshot for this trial (`order by ctgov_version desc offset 1 limit 1`).
5. If previous exists, call `_compute_field_diffs(prev.payload, p_payload, p_module_hints)`, INSERT each into `trial_field_changes`, then call `_classify_change` per row and INSERT each emitted event into `trial_change_events` with `derived_from_change_id` set.
6. Update `trials` row: `last_polled_at = now()`, `latest_ctgov_version = p_version`.
7. Wrap the whole body in a single transaction (the function is a transaction by default; no explicit `begin`).
8. Return `jsonb_build_object('snapshot_id', ..., 'inserted', boolean, 'events_emitted', int, 'changes_recorded', int)`.

Signature: `ingest_ctgov_snapshot(p_secret text, p_trial_id uuid, p_space_id uuid, p_nct_id text, p_version int, p_post_date date, p_payload jsonb, p_fetched_via text, p_module_hints text[] default null) returns jsonb`.

`SECURITY DEFINER`, `set search_path = public`. `revoke execute from public`. `grant execute to anon` (the Worker calls it as anon + secret).

- [ ] **Step 2: Smoke-test happy path**

Add `do $$ ... $$` block: insert a fixture trial + space, call the RPC twice with the same payload (first inserts, second returns `inserted=false`). Assert snapshot row count is 1.

Then call again with a payload that changes `overallStatus`. Assert one row in `trial_field_changes` and one row in `trial_change_events`.

- [ ] **Step 3: Smoke-test failure paths**

Wrong secret -> exception with sqlstate `42501`. Mismatched `space_id` for `trial_id` -> exception (validate inside the RPC).

- [ ] **Step 4: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120500_ctgov_ingest_rpc.sql
git commit -m "feat(db): add ingest_ctgov_snapshot RPC"
```

### Task 1.7: Polling queue and run-record RPCs

**Files:**
- Create: `supabase/migrations/20260502120600_ctgov_polling_rpcs.sql`

- [ ] **Step 1: `get_trials_for_polling(p_secret, p_limit)`**

Returns `(trial_id uuid, space_id uuid, nct_id text, last_update_posted_date date)`. Body: verify secret, then `select id, space_id, identifier, last_update_posted_date from public.trials where identifier is not null order by last_polled_at nulls first limit p_limit`. Marked `STABLE`, `SECURITY DEFINER`.

- [ ] **Step 2: `record_sync_run(p_secret, ...)`**

Single function that the Worker calls at the end of each scheduled invocation. Inserts one row into `ctgov_sync_runs`. Signature: `record_sync_run(p_secret text, p_started_at timestamptz, p_ended_at timestamptz, p_trials_checked int, p_ncts_with_changes int, p_snapshots_written int, p_events_emitted int, p_errors_count int, p_error_summary jsonb, p_status text) returns uuid`.

- [ ] **Step 3: Smoke-test**

Do block: call `get_trials_for_polling` with the dev secret; assert the queue ordering. Call `record_sync_run`; assert the new row exists.

- [ ] **Step 4: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120600_ctgov_polling_rpcs.sql
git commit -m "feat(db): add ctgov polling queue and run-record RPCs"
```

### Task 1.8: Markers audit trigger and classifier

**Files:**
- Create: `supabase/migrations/20260502120700_marker_changes_trigger.sql`

- [ ] **Step 1: Write `_emit_events_from_marker_change(p_marker_change_id uuid)`**

Pure plpgsql. Looks up the row in `marker_changes`, walks `marker_assignments` for the corresponding marker, applies the classifier rules from the spec's "Markers audit log and classifier" / "Classifier" table, INSERTs one row per `(marker_change, trial_assignment)` into `trial_change_events`. Tie-breaker rule (date_moved wins, secondary changes ride in `payload.secondary_changes`) lives here.

- [ ] **Step 2: Write the trigger function `_log_marker_change()`**

`AFTER INSERT OR UPDATE OR DELETE ON markers FOR EACH ROW`. SECURITY DEFINER. On UPDATE, compares OLD vs NEW for the material fields list (`event_date`, `end_date`, `title`, `projection`, `marker_type_id`, `description`); if none differ, returns NEW without writing. Otherwise inserts into `marker_changes` with `change_type`, `old_values`, `new_values` (only the material fields), `changed_by = auth.uid()`, then calls `_emit_events_from_marker_change(new_marker_change_id)`.

- [ ] **Step 3: Write `backfill_marker_history()`**

One-shot SECURITY DEFINER function. For every row in `markers`, synthesize a `created` row in `marker_changes` (with `changed_at = markers.created_at`, `new_values = row_to_json(markers)`, `old_values = null`), then run the classifier. Returns count of rows synthesized.

- [ ] **Step 4: Smoke-test all three**

Do block: insert a marker, assert one `marker_changes` row + one `trial_change_events` row of type `marker_added`. Update its `event_date`; assert one event of type `date_moved` with payload `which_date='event_date'`. Delete it; assert `marker_removed`.

Then run `backfill_marker_history()` against the seed data; assert non-zero rows synthesized.

- [ ] **Step 5: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120700_marker_changes_trigger.sql
git commit -m "feat(db): add markers audit trigger and event classifier"
```

### Task 1.9: Surface RPCs (UI read path)

**Files:**
- Create: `supabase/migrations/20260502120800_change_feed_surface_rpcs.sql`

All marked SECURITY INVOKER (RLS applies via `has_space_access`).

- [ ] **Step 1: `get_activity_feed(p_space_id, p_filters, p_cursor_observed_at, p_limit)`**

Returns `setof jsonb`. Each row is a flat record built via `jsonb_build_object`: event id, event_type, source, payload, occurred_at, observed_at, plus joined trial name + identifier (via `trials`) and joined marker title (via `markers` for `marker_id is not null`, falling back to `marker_changes.old_values->>'title'` for deleted markers).

Filters via `p_filters jsonb`:
- `'event_types': [...]` -> `event_type = any(...)`
- `'sources': [...]` -> `source = any(...)`
- `'trial_ids': [...]` -> `trial_id = any(...)`
- `'date_range': '7d' | '30d' | 'all'` -> `observed_at >= now() - interval`

Cursor pagination: `where observed_at < p_cursor_observed_at order by observed_at desc limit p_limit + 1`. Caller uses the (limit+1)th row's `observed_at` as the next cursor.

- [ ] **Step 2: `get_trial_activity(p_trial_id, p_limit)`**

Same shape, scoped to one trial; no cursor (small N).

- [ ] **Step 3: `get_marker_history(p_marker_id)`**

Returns rows from `marker_changes` where `marker_id = p_marker_id`, joined to author email. No pagination.

- [ ] **Step 4: `trigger_single_trial_sync(p_trial_id)`**

`SECURITY INVOKER`. Verifies the caller has `has_space_access(trial.space_id, array['owner', 'editor'])`. Returns `jsonb_build_object('ok', true, 'nct_id', identifier)`. The actual HTTP call to the Worker happens client-side; this RPC just validates auth + returns the NCT for the client to send. (The client, holding the user's JWT, posts to the Worker's `/admin/ctgov-backfill`. The Worker re-validates via the secret.)

Alternative if simpler: have the RPC use `pg_net` to POST to the Worker. Spec leaves this open; pick the JWT-from-client option since `pg_net` adds a moving part for one button.

- [ ] **Step 5: `update_space_field_visibility(p_space_id, p_visibility jsonb)`**

`SECURITY INVOKER`. Verifies `has_space_access(p_space_id, array['owner'])`. UPDATEs `spaces.ctgov_field_visibility = p_visibility`.

- [ ] **Step 6: `recompute_trial_change_events(p_trial_id uuid)`**

Admin-only utility. Verifies the caller is a space owner. Deletes existing `trial_field_changes` and `trial_change_events` (CT.gov-source only) for this trial, walks snapshots in version order, replays `_compute_field_diffs` and `_classify_change` between consecutive snapshots, re-inserts. Used when the watch list changes.

- [ ] **Step 7: Smoke-tests for each RPC**

Insert fixture data; call each RPC; assert reasonable shapes. For `get_activity_feed`, verify cursor pagination by setting a known `observed_at` and asserting the result count.

- [ ] **Step 8: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120800_change_feed_surface_rpcs.sql
git commit -m "feat(db): add change feed surface RPCs"
```

### Task 1.10: Extend `get_dashboard_data` with change counts

**Files:**
- Create: `supabase/migrations/20260502120900_dashboard_data_change_counts.sql`

- [ ] **Step 1: Drop and recreate `get_dashboard_data`**

Read the current definition from the most recent migration that touched it (`grep -l get_dashboard_data supabase/migrations/`). Copy the body, then per-trial add a `LEFT JOIN LATERAL` on `trial_change_events` filtered to `observed_at >= now() - interval '7 days'`:

```sql
left join lateral (
  select
    count(*)                                      as recent_changes_count,
    (array_agg(event_type order by observed_at desc))[1] as most_recent_change_type
  from public.trial_change_events e
  where e.trial_id = t.id
    and e.observed_at >= now() - interval '7 days'
) recent on true
```

Add `'recent_changes_count', coalesce(recent.recent_changes_count, 0)` and `'most_recent_change_type', recent.most_recent_change_type` to the per-trial `jsonb_build_object`.

- [ ] **Step 2: Same edits to `get_landscape_data`**

Mirror the lateral join + projection additions.

- [ ] **Step 3: Smoke-test**

Do block: insert fixture events, call `get_dashboard_data`, assert the projection contains the new keys with expected values.

- [ ] **Step 4: Verify and commit**

```bash
supabase db reset
git add supabase/migrations/20260502120900_dashboard_data_change_counts.sql
git commit -m "feat(db): extend dashboard/landscape RPCs with change counts"
```

### Phase 1 verification gate

- [ ] **Step 1: Full reset**

`supabase db reset` from repo root. Expected: all migrations apply cleanly, every smoke-test `do` block emits `notice` lines, no `exception`s.

- [ ] **Step 2: TS build still green**

`cd src/client && ng lint && ng build`. Expected: clean (no consumers of the new schema yet, so this should be a no-op).

- [ ] **Step 3: Worker tests still green**

`cd src/client && npm run test:worker`. Expected: existing tests pass.

- [ ] **Step 4: Phase commit (if any deferred files exist; otherwise skip)**

---

## Phase 2: Cloudflare Worker poller

Goal: The Worker can pull CT.gov on a schedule and call `ingest_ctgov_snapshot`. Manual backfill endpoint works. End-to-end: `wrangler dev` cron-triggered run produces snapshot rows + change events for a trial whose CT.gov payload differs from its last ingestion.

### Task 2.1: Worker shared types

**Files:**
- Create: `src/client/worker/ctgov-sync/types.ts`

- [ ] **Step 1: Write the types**

```ts
export interface PollingTrialRow {
  trial_id: string;
  space_id: string;
  nct_id: string;
  last_update_posted_date: string | null;
}

export interface CtgovStudySummary {
  nctId: string;
  lastUpdatePostDate: string;
}

export interface CtgovHistoryEntry {
  version: number;
  date: string;
  moduleLabels?: string[];
}

export interface IngestArgs {
  trial_id: string;
  space_id: string;
  nct_id: string;
  version: number;
  post_date: string;
  payload: unknown;
  fetched_via: 'v2_poll' | 'int_backfill' | 'manual_sync';
  module_hints: string[] | null;
}

export interface IngestResult {
  snapshot_id: string;
  inserted: boolean;
  events_emitted: number;
  changes_recorded: number;
}

export interface SyncRunSummary {
  started_at: string;
  ended_at: string;
  trials_checked: number;
  ncts_with_changes: number;
  snapshots_written: number;
  events_emitted: number;
  errors_count: number;
  error_summary: Record<string, unknown> | null;
  status: 'success' | 'partial' | 'failed';
}

export interface CtgovSyncEnv {
  SUPABASE_URL: string;
  SUPABASE_ANON_KEY: string;
  CTGOV_BASE_URL: string;
  CTGOV_BATCH_SIZE: string;
  CTGOV_PARALLEL_FETCHES: string;
  CTGOV_WORKER_SECRET: string;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/worker/ctgov-sync/types.ts
git commit -m "feat(worker): add ctgov-sync shared types"
```

### Task 2.2: CT.gov client adapter

**Files:**
- Create: `src/client/worker/ctgov-sync/ctgov-client.ts`
- Create: `src/client/worker/test/ctgov-sync/ctgov-client.spec.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createCtgovClient } from '../../ctgov-sync/ctgov-client';

beforeEach(() => vi.restoreAllMocks());

describe('CtgovClient.fetchStudy', () => {
  it('GETs /api/v2/studies/{nct} and returns JSON', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ protocolSection: {} }), { status: 200 })
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchStudy('NCT01234567');
    expect(fetchSpy).toHaveBeenCalledWith('https://x/api/v2/studies/NCT01234567', expect.any(Object));
    expect(result).toEqual({ protocolSection: {} });
  });

  it('returns null on 404', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 404 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchStudy('NCT99999999')).toBeNull();
  });

  it('throws on 5xx', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('', { status: 503 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    await expect(client.fetchStudy('NCT01234567')).rejects.toThrow();
  });
});

describe('CtgovClient.fetchSummariesBatch', () => {
  it('builds query.term=(NCT01 OR NCT02 ...) and parses page', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({
        studies: [
          { protocolSection: { identificationModule: { nctId: 'NCT01' }, statusModule: { lastUpdatePostDateStruct: { date: '2026-04-01' } } } },
          { protocolSection: { identificationModule: { nctId: 'NCT02' }, statusModule: { lastUpdatePostDateStruct: { date: '2026-03-15' } } } },
        ]
      }), { status: 200 })
    );
    const client = createCtgovClient({ baseUrl: 'https://x' });
    const result = await client.fetchSummariesBatch(['NCT01', 'NCT02']);
    const url = (fetchSpy.mock.calls[0][0] as string);
    expect(url).toContain('query.term=(NCT01+OR+NCT02)');
    expect(url).toContain('fields=NCTId%2CLastUpdatePostDate');
    expect(result).toEqual([
      { nctId: 'NCT01', lastUpdatePostDate: '2026-04-01' },
      { nctId: 'NCT02', lastUpdatePostDate: '2026-03-15' },
    ]);
  });
});

describe('CtgovClient.fetchHistory (opportunistic)', () => {
  it('returns null + logs on /api/int parse failure rather than throwing', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('not json', { status: 200 }));
    const client = createCtgovClient({ baseUrl: 'https://x' });
    expect(await client.fetchHistory('NCT01234567')).toBeNull();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/ctgov-sync/ctgov-client.spec.ts`
Expected: FAIL with "Cannot find module".

- [ ] **Step 3: Write the implementation**

```ts
import type { CtgovStudySummary, CtgovHistoryEntry } from './types';

export interface CtgovClientOptions {
  baseUrl: string;
}

export interface CtgovClient {
  fetchStudy(nctId: string): Promise<unknown | null>;
  fetchSummariesBatch(nctIds: string[]): Promise<CtgovStudySummary[]>;
  fetchHistory(nctId: string): Promise<CtgovHistoryEntry[] | null>;
}

export function createCtgovClient(opts: CtgovClientOptions): CtgovClient {
  const ua = { 'User-Agent': 'clint-worker/1.0' };
  return {
    async fetchStudy(nctId: string): Promise<unknown | null> {
      const res = await fetch(`${opts.baseUrl}/api/v2/studies/${nctId}`, { headers: ua });
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`ctgov fetchStudy ${nctId} ${res.status}`);
      return await res.json();
    },
    async fetchSummariesBatch(nctIds: string[]): Promise<CtgovStudySummary[]> {
      const term = encodeURIComponent(`(${nctIds.join(' OR ')})`).replace(/%20/g, '+');
      const fields = encodeURIComponent('NCTId,LastUpdatePostDate');
      const url = `${opts.baseUrl}/api/v2/studies?query.term=${term}&fields=${fields}&pageSize=${nctIds.length}`;
      const res = await fetch(url, { headers: ua });
      if (!res.ok) throw new Error(`ctgov batch ${res.status}`);
      const json = (await res.json()) as { studies?: Array<{ protocolSection?: { identificationModule?: { nctId?: string }; statusModule?: { lastUpdatePostDateStruct?: { date?: string } } } }> };
      return (json.studies ?? []).map((s) => ({
        nctId: s.protocolSection?.identificationModule?.nctId ?? '',
        lastUpdatePostDate: s.protocolSection?.statusModule?.lastUpdatePostDateStruct?.date ?? '',
      })).filter((s) => s.nctId && s.lastUpdatePostDate);
    },
    async fetchHistory(nctId: string): Promise<CtgovHistoryEntry[] | null> {
      try {
        const res = await fetch(`${opts.baseUrl}/api/int/studies/${nctId}/history`, { headers: ua });
        if (!res.ok) return null;
        const text = await res.text();
        try {
          const json = JSON.parse(text) as { changes?: CtgovHistoryEntry[] };
          return json.changes ?? null;
        } catch {
          return null;
        }
      } catch {
        return null;
      }
    },
  };
}
```

- [ ] **Step 4: Run tests to verify they pass**

`cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/ctgov-sync/ctgov-client.spec.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/client/worker/ctgov-sync/ctgov-client.ts src/client/worker/test/ctgov-sync/ctgov-client.spec.ts
git commit -m "feat(worker): add ctgov client adapter with v2 + int endpoints"
```

### Task 2.3: Batch + watermark helpers

**Files:**
- Create: `src/client/worker/ctgov-sync/batch.ts`
- Create: `src/client/worker/ctgov-sync/watermark.ts`
- Create: `src/client/worker/test/ctgov-sync/batch.spec.ts`
- Create: `src/client/worker/test/ctgov-sync/watermark.spec.ts`

- [ ] **Step 1: Write batch tests**

```ts
import { describe, it, expect } from 'vitest';
import { chunkBy, groupByNct } from '../../ctgov-sync/batch';
import type { PollingTrialRow } from '../../ctgov-sync/types';

describe('chunkBy', () => {
  it('splits a flat array into N-sized chunks', () => {
    expect(chunkBy([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
  });
  it('returns [] for empty input', () => {
    expect(chunkBy([], 10)).toEqual([]);
  });
});

describe('groupByNct', () => {
  it('groups multiple trial rows that share an NCT', () => {
    const rows: PollingTrialRow[] = [
      { trial_id: 't1', space_id: 's1', nct_id: 'NCT01', last_update_posted_date: null },
      { trial_id: 't2', space_id: 's2', nct_id: 'NCT01', last_update_posted_date: '2026-04-01' },
      { trial_id: 't3', space_id: 's1', nct_id: 'NCT02', last_update_posted_date: null },
    ];
    const groups = groupByNct(rows);
    expect(groups.size).toBe(2);
    expect(groups.get('NCT01')?.length).toBe(2);
    expect(groups.get('NCT02')?.length).toBe(1);
  });
});
```

- [ ] **Step 2: Write watermark tests**

```ts
import { describe, it, expect } from 'vitest';
import { needsFullPull } from '../../ctgov-sync/watermark';

describe('needsFullPull', () => {
  it('returns true when CT.gov post date is newer than ours', () => {
    expect(needsFullPull('2026-04-01', '2026-03-15')).toBe(true);
  });
  it('returns false when equal', () => {
    expect(needsFullPull('2026-04-01', '2026-04-01')).toBe(false);
  });
  it('returns true when we have null', () => {
    expect(needsFullPull('2026-04-01', null)).toBe(true);
  });
});
```

- [ ] **Step 3: Run both, expect FAIL**

`cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/ctgov-sync/batch.spec.ts worker/test/ctgov-sync/watermark.spec.ts`
Expected: FAIL with module-not-found.

- [ ] **Step 4: Implement `batch.ts`**

```ts
import type { PollingTrialRow } from './types';

export function chunkBy<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [];
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

export function groupByNct(rows: PollingTrialRow[]): Map<string, PollingTrialRow[]> {
  const out = new Map<string, PollingTrialRow[]>();
  for (const row of rows) {
    const arr = out.get(row.nct_id) ?? [];
    arr.push(row);
    out.set(row.nct_id, arr);
  }
  return out;
}
```

- [ ] **Step 5: Implement `watermark.ts`**

```ts
export function needsFullPull(ctgovPostDate: string, ourLastPostDate: string | null): boolean {
  if (!ourLastPostDate) return true;
  return ctgovPostDate > ourLastPostDate;
}
```

- [ ] **Step 6: Run, expect PASS, commit**

```bash
cd src/client && npx vitest run --config worker/vitest.config.mts worker/test/ctgov-sync/batch.spec.ts worker/test/ctgov-sync/watermark.spec.ts
git add src/client/worker/ctgov-sync/batch.ts src/client/worker/ctgov-sync/watermark.ts src/client/worker/test/ctgov-sync/batch.spec.ts src/client/worker/test/ctgov-sync/watermark.spec.ts
git commit -m "feat(worker): add batch and watermark helpers"
```

### Task 2.4: Poller orchestration

**Files:**
- Create: `src/client/worker/ctgov-sync/poller.ts`
- Create: `src/client/worker/test/ctgov-sync/poller.spec.ts`

- [ ] **Step 1: Write the failing tests**

The test file mocks both `globalThis.fetch` (CT.gov) and the Supabase RPC layer. It exercises four scenarios:
1. **Happy path with no changes:** queue returns 3 trials, batched watermark says all unchanged. Assert no `ingest_ctgov_snapshot` calls but `last_polled_at` updated for all 3 (via a small `bulk_update_last_polled` RPC) and one `record_sync_run` row with `status='success'`.
2. **Happy path with one change:** queue returns 1 trial, watermark says newer. CT.gov full pull returns the new payload. Assert one `ingest_ctgov_snapshot` call with the right shape, `record_sync_run` with `snapshots_written=1`.
3. **One trial fails ingestion:** queue returns 2 trials, both have changes; the first ingest RPC throws. Assert second still runs, `record_sync_run` has `status='partial'`, `errors_count=1`.
4. **CT.gov 5xx during batch:** entire batch fails. Assert `last_polled_at` NOT updated for those trials, `status='failed'`, `errors_count > 0`.

Each test uses small fixture inputs (~3 trials) and asserts exact RPC argument shape via spy.

- [ ] **Step 2: Run, expect FAIL**

- [ ] **Step 3: Implement `poller.ts`**

Public exports:
- `runScheduledSync(env: CtgovSyncEnv): Promise<SyncRunSummary>` -- the cron entry point
- `runManualBackfill(env: CtgovSyncEnv, nctIds: string[]): Promise<SyncRunSummary>` -- admin POST entry point

Internal flow per `runScheduledSync`:
1. Call `get_trials_for_polling` RPC (limit = `CTGOV_BATCH_SIZE` * `CTGOV_PARALLEL_FETCHES`, e.g. 1000).
2. `groupByNct(rows)`.
3. `chunkBy([...nctIds], CTGOV_BATCH_SIZE)`.
4. For each chunk, call `client.fetchSummariesBatch(chunk)`. On error, push to error log; do not update last_polled_at for those NCTs.
5. For each summary, `needsFullPull(summary.lastUpdatePostDate, ourLastPostDate)`. The `ourLastPostDate` is the min across the trial-rows for that NCT.
6. For NCTs without changes, accumulate their `(trial_id, space_id)` into a "skip but mark polled" list.
7. For NCTs with changes, fetch full payload + history, run a parallel pool of `CTGOV_PARALLEL_FETCHES` (use a simple `Promise.all` over `chunkBy(changedNcts, parallel)` semaphore-style with `await`).
8. For each fetched study, fan out to every `(trial_id, space_id)` assignment via `ingest_ctgov_snapshot` RPC. Errors per trial logged and counted; do not abort.
9. Call `bulk_update_last_polled` RPC (add to `20260502120600_ctgov_polling_rpcs.sql` if missing) with the union of polled trial ids.
10. Build `SyncRunSummary`. Status: `success` if no errors, `partial` if some, `failed` if all summary fetches failed.
11. Call `record_sync_run`.
12. Return the summary.

Use `callRpc` from `src/client/worker/supabase.ts` (already exists); pass `null` for the auth header so it goes anon-only, and pass `p_secret = env.CTGOV_WORKER_SECRET` as the first argument.

- [ ] **Step 4: Add the missing `bulk_update_last_polled` RPC**

If not already in Task 1.7, add to a new migration `20260502121100_bulk_update_last_polled.sql` with signature `bulk_update_last_polled(p_secret text, p_trial_ids uuid[]) returns int`. Verifies secret, runs `update public.trials set last_polled_at = now() where id = any(p_trial_ids)`. Smoke-test included.

- [ ] **Step 5: Run, expect PASS**

- [ ] **Step 6: Commit**

```bash
git add src/client/worker/ctgov-sync/poller.ts src/client/worker/test/ctgov-sync/poller.spec.ts supabase/migrations/20260502121100_bulk_update_last_polled.sql
git commit -m "feat(worker): add ctgov-sync scheduled poller"
```

### Task 2.5: Wire `scheduled()` and admin POST into `worker/index.ts`

**Files:**
- Modify: `src/client/worker/index.ts`
- Modify: `src/client/wrangler.jsonc`
- Modify: `src/client/worker/test/index.spec.ts`

- [ ] **Step 1: Update `Env` to include the new vars**

Extend the existing `Env` interface in `src/client/worker/index.ts` with:
```ts
CTGOV_BASE_URL: string;
CTGOV_BATCH_SIZE: string;
CTGOV_PARALLEL_FETCHES: string;
CTGOV_WORKER_SECRET: string;
```

- [ ] **Step 2: Add `scheduled` export and admin POST route**

```ts
import { runScheduledSync, runManualBackfill } from './ctgov-sync/poller';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    // ... existing routes ...
    if (url.pathname === '/admin/ctgov-backfill' && request.method === 'POST') {
      return handleManualBackfill(request, env, cors);
    }
    // ... existing fallthrough ...
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil(runScheduledSync(env));
  },
};

async function handleManualBackfill(request: Request, env: Env, cors: Record<string, string>) {
  // platform-admin gate: require Authorization with super-admin JWT
  const auth = request.headers.get('Authorization');
  // call a small `is_super_admin()` RPC over Supabase to gate; return 401 on failure
  // if ok, parse body { nct_ids: string[] } and run runManualBackfill
}
```

Use the existing `jwtSubject` + `callRpc` plumbing. Add a `is_super_admin()` Postgres function in a new migration (or reuse the existing super-admin guard predicate if one exists). Search: `grep -rn "is_super_admin\|super_admin_member" supabase/migrations/`.

- [ ] **Step 3: Update `wrangler.jsonc`**

Add:
```jsonc
"triggers": { "crons": ["0 7 * * *"] },
"vars": {
  "ALLOWED_APEXES": "clintapp.com",
  "R2_BUCKET": "clint-materials",
  "CTGOV_BASE_URL": "https://clinicaltrials.gov",
  "CTGOV_BATCH_SIZE": "100",
  "CTGOV_PARALLEL_FETCHES": "10"
},
```

(`CTGOV_WORKER_SECRET` is set via `wrangler secret put` and is NOT in vars.)

- [ ] **Step 4: Add admin POST test**

In `worker/test/index.spec.ts`, add a `describe('POST /admin/ctgov-backfill')` block with:
- Returns 401 without super-admin JWT
- Returns 200 + run summary with valid super-admin JWT and `{nct_ids: ['NCT01']}`

- [ ] **Step 5: Run all worker tests**

`cd src/client && npm run test:worker`
Expected: PASS for all worker test files including the new ones.

- [ ] **Step 6: Local cron smoke test**

```bash
cd src/client
wrangler dev --test-scheduled
# in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Expected: log lines from `runScheduledSync`, `record_sync_run` row visible in local Supabase.

- [ ] **Step 7: Commit**

```bash
git add src/client/worker/index.ts src/client/wrangler.jsonc src/client/worker/test/index.spec.ts
git commit -m "feat(worker): add scheduled cron and admin backfill endpoint"
```

### Phase 2 verification gate

- [ ] **Step 1: All worker tests green**

`cd src/client && npm run test:worker`. Expected: PASS.

- [ ] **Step 2: SQL still applies cleanly**

`supabase db reset`. Expected: clean.

- [ ] **Step 3: TS build green**

`cd src/client && ng lint && ng build`. Expected: clean.

- [ ] **Step 4: End-to-end manual run**

With `wrangler dev --test-scheduled` running and a known NCT in the seed: trigger the cron, verify a `trial_ctgov_snapshots` row appears, verify a `ctgov_sync_runs` row with `status='success'`. Document results in commit message of the gate commit.

---

## Phase 3: Activity page and the unified surfaces

Goal: Six UI surfaces all read from the typed event feed. Activity page is fully filterable and paginated. Engagement landing has the "What changed" widget. Trial rows show change badges. Marker history panel and intel feed mixing both work.

### Task 3.1: Models + service layer

**Files:**
- Create: `src/client/src/app/core/models/change-event.model.ts`
- Create: `src/client/src/app/core/services/change-event.service.ts`

- [ ] **Step 1: Write `change-event.model.ts`**

```ts
export type ChangeEventSource = 'ctgov' | 'analyst';

export type ChangeEventType =
  | 'status_changed'
  | 'date_moved'
  | 'phase_transitioned'
  | 'enrollment_target_changed'
  | 'arm_added'
  | 'arm_removed'
  | 'intervention_changed'
  | 'outcome_measure_changed'
  | 'sponsor_changed'
  | 'eligibility_criteria_changed'
  | 'eligibility_changed'
  | 'trial_withdrawn'
  | 'marker_added'
  | 'projection_finalized'
  | 'marker_reclassified'
  | 'marker_updated'
  | 'marker_removed';

export interface ChangeEvent {
  id: string;
  trial_id: string;
  space_id: string;
  event_type: ChangeEventType;
  source: ChangeEventSource;
  payload: Record<string, unknown>;
  occurred_at: string;
  observed_at: string;
  marker_id: string | null;
  // joined for display
  trial_name: string;
  trial_identifier: string | null;
  marker_title: string | null;
}

export interface ActivityFeedFilters {
  event_types?: ChangeEventType[];
  sources?: ChangeEventSource[];
  trial_ids?: string[];
  date_range?: '7d' | '30d' | 'all';
}

export interface ActivityFeedPage {
  events: ChangeEvent[];
  next_cursor: string | null;
}

export interface MarkerChangeRow {
  id: string;
  marker_id: string;
  change_type: 'created' | 'updated' | 'deleted';
  old_values: Record<string, unknown> | null;
  new_values: Record<string, unknown> | null;
  changed_at: string;
  changed_by_email: string | null;
}
```

- [ ] **Step 2: Write `change-event.service.ts`**

```ts
import { inject, Injectable } from '@angular/core';
import { SupabaseService } from './supabase.service';
import type { ChangeEvent, ActivityFeedFilters, ActivityFeedPage, MarkerChangeRow } from '../models/change-event.model';

@Injectable({ providedIn: 'root' })
export class ChangeEventService {
  private supabase = inject(SupabaseService);

  async getActivityFeed(spaceId: string, filters: ActivityFeedFilters, cursor: string | null, limit = 50): Promise<ActivityFeedPage> {
    const { data, error } = await this.supabase.client.rpc('get_activity_feed', {
      p_space_id: spaceId,
      p_filters: filters,
      p_cursor_observed_at: cursor,
      p_limit: limit,
    });
    if (error) throw error;
    const rows = (data as ChangeEvent[]) ?? [];
    const events = rows.slice(0, limit);
    const next_cursor = rows.length > limit ? rows[limit - 1].observed_at : null;
    return { events, next_cursor };
  }

  async getTrialActivity(trialId: string, limit = 25): Promise<ChangeEvent[]> {
    const { data, error } = await this.supabase.client.rpc('get_trial_activity', { p_trial_id: trialId, p_limit: limit });
    if (error) throw error;
    return (data as ChangeEvent[]) ?? [];
  }

  async getMarkerHistory(markerId: string): Promise<MarkerChangeRow[]> {
    const { data, error } = await this.supabase.client.rpc('get_marker_history', { p_marker_id: markerId });
    if (error) throw error;
    return (data as MarkerChangeRow[]) ?? [];
  }

  async triggerSingleTrialSync(trialId: string): Promise<{ ok: boolean; nct_id: string }> {
    const { data, error } = await this.supabase.client.rpc('trigger_single_trial_sync', { p_trial_id: trialId });
    if (error) throw error;
    const result = data as { ok: boolean; nct_id: string };
    if (!result.ok || !result.nct_id) return result;
    const session = (await this.supabase.client.auth.getSession()).data.session;
    const apiBase = (window as Window & { __WORKER_API_BASE?: string }).__WORKER_API_BASE ?? '';
    await fetch(`${apiBase}/admin/ctgov-backfill`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${session?.access_token ?? ''}`,
      },
      body: JSON.stringify({ nct_ids: [result.nct_id] }),
    });
    return result;
  }
}
```

- [ ] **Step 3: Verify TS compile**

`cd src/client && ng build`. Expected: PASS (no consumers yet, so this is a sanity build).

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/change-event.model.ts src/client/src/app/core/services/change-event.service.ts
git commit -m "feat(client): add change-event model and service"
```

### Task 3.2: Reusable change-event-row component

**Files:**
- Create: `src/client/src/app/shared/components/change-event-row/change-event-row.component.ts`
- Create: `src/client/src/app/shared/components/change-event-row/change-event-row.component.html`

- [ ] **Step 1: Write the component**

```ts
import { Component, computed, input, signal } from '@angular/core';
import { DatePipe, JsonPipe } from '@angular/common';
import { ButtonModule } from 'primeng/button';
import type { ChangeEvent } from '../../../core/models/change-event.model';

@Component({
  selector: 'app-change-event-row',
  standalone: true,
  imports: [DatePipe, JsonPipe, ButtonModule],
  templateUrl: './change-event-row.component.html',
})
export class ChangeEventRowComponent {
  event = input.required<ChangeEvent>();
  expanded = signal(false);

  iconClass = computed(() => iconFor(this.event().event_type));
  summary   = computed(() => summaryFor(this.event()));
  sourceLabel = computed(() => this.event().source === 'ctgov' ? 'CT.GOV' : 'ANALYST');

  toggle() { this.expanded.update((v) => !v); }
}

function iconFor(t: ChangeEvent['event_type']): string {
  // pf icons, slate by default
  switch (t) {
    case 'date_moved': return 'fa-solid fa-calendar-days';
    case 'phase_transitioned': return 'fa-solid fa-arrow-right-arrow-left';
    case 'status_changed': return 'fa-solid fa-flag';
    case 'sponsor_changed': return 'fa-solid fa-building';
    case 'arm_added': case 'arm_removed': return 'fa-solid fa-vial';
    case 'trial_withdrawn': return 'fa-solid fa-ban';
    case 'marker_added': return 'fa-solid fa-circle-plus';
    case 'marker_removed': return 'fa-solid fa-circle-minus';
    case 'projection_finalized': return 'fa-solid fa-circle-check';
    default: return 'fa-solid fa-circle';
  }
}

function summaryFor(e: ChangeEvent): string {
  const p = e.payload;
  switch (e.event_type) {
    case 'status_changed': return `Status: ${p['from']} -> ${p['to']}`;
    case 'date_moved': return `${p['which_date']} ${p['direction']} ${p['days_diff']}d (${p['from']} -> ${p['to']})`;
    case 'phase_transitioned': return `Phase: ${(p['from'] as string[])?.join('/') ?? ''} -> ${(p['to'] as string[])?.join('/') ?? ''}`;
    case 'enrollment_target_changed': return `Enrollment: ${p['from']} -> ${p['to']} (${p['percent_change']}%)`;
    case 'arm_added': return `Arm added: ${p['arm_label']}`;
    case 'arm_removed': return `Arm removed: ${p['arm_label']}`;
    case 'sponsor_changed': return `Sponsor: ${p['from']} -> ${p['to']}`;
    case 'trial_withdrawn': return `Trial withdrawn from CT.gov (last seen ${p['last_seen_post_date']})`;
    case 'marker_added': return `Marker added`;
    case 'marker_removed': return `Marker removed`;
    case 'projection_finalized': return `Projected -> Actual`;
    case 'marker_reclassified': return `Reclassified`;
    case 'marker_updated': return `Updated: ${(p['changed_fields'] as string[])?.join(', ') ?? ''}`;
    default: return e.event_type;
  }
}
```

- [ ] **Step 2: Write the template**

```html
<div class="flex items-start gap-3 py-3 border-b border-slate-200">
  <i [class]="iconClass()" class="text-slate-500 mt-1 w-5"></i>
  <div class="flex-1 min-w-0">
    <div class="flex items-center gap-2 text-xs text-slate-500 mb-1">
      <span class="font-mono uppercase tracking-wide">{{ sourceLabel() }}</span>
      <span>&bull;</span>
      <span>{{ event().observed_at | date: 'medium' }}</span>
      <span>&bull;</span>
      <span>{{ event().trial_identifier ?? event().trial_name }}</span>
    </div>
    <div class="text-sm text-slate-900">{{ summary() }}</div>
    @if (expanded()) {
      <pre class="mt-2 p-2 bg-slate-50 rounded text-xs overflow-x-auto">{{ event().payload | json }}</pre>
    }
    <p-button
      [label]="expanded() ? 'Hide details' : 'Show details'"
      [text]="true"
      size="small"
      (click)="toggle()"
    ></p-button>
  </div>
</div>
```

- [ ] **Step 3: Verify TS compile**

`cd src/client && ng build`.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/change-event-row/
git commit -m "feat(client): add reusable change-event-row component"
```

### Task 3.3: Activity page

**Files:**
- Create: `src/client/src/app/features/engagement-activity/engagement-activity-page.component.ts`
- Create: `src/client/src/app/features/engagement-activity/engagement-activity-page.component.html`
- Modify: `src/client/src/app/app.routes.ts`

- [ ] **Step 1: Write the component**

The component owns:
- `events = signal<ChangeEvent[]>([])`
- `cursor = signal<string | null>(null)`
- `loading = signal(false)`
- `filters = signal<ActivityFeedFilters>({date_range: '30d'})`
- `dateRange`, `eventTypes`, `sources`, `trialIds` UI signals bound to `[(ngModel)]`
- `lastSyncRun = signal<{ended_at: string; trials_checked: number; ncts_with_changes: number} | null>(null)` for the footer

`computed()` flattens filters into a single jsonb. `effect()` calls `loadPage(reset=true)` when the filter signal changes. `loadMore()` appends the next page.

Use PrimeNG `p-multiselect` for event types + trials, `p-button` for the date-range pill group, and the new `ChangeEventRowComponent` for rendering.

Footer is read by calling a new lightweight RPC `get_latest_sync_run()` (add to a small migration `20260502121200_get_latest_sync_run.sql`, returns the most recent row from `ctgov_sync_runs`).

- [ ] **Step 2: Wire the route**

In `src/client/src/app/app.routes.ts`, inside the `s/:spaceId` children block (around line 286 -- the level above the `landscape` redirects), add:

```ts
{
  path: 'activity',
  loadComponent: () =>
    import('./features/engagement-activity/engagement-activity-page.component').then(
      (m) => m.EngagementActivityPageComponent
    ),
},
```

- [ ] **Step 3: Verify**

```bash
cd src/client && ng lint && ng build
```

Manual: navigate to `/t/<tenant>/s/<space>/activity`, confirm the page loads, filter pills work, "Show details" expand works.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/engagement-activity/ src/client/src/app/app.routes.ts supabase/migrations/20260502121200_get_latest_sync_run.sql
git commit -m "feat(client): add engagement activity page"
```

### Task 3.4: "What changed" widget on engagement landing

**Files:**
- Create: `src/client/src/app/shared/components/what-changed-widget/what-changed-widget.component.ts`
- Create: `src/client/src/app/shared/components/what-changed-widget/what-changed-widget.component.html`
- Modify: `src/client/src/app/features/engagement-landing/engagement-landing.component.ts`
- Modify: `src/client/src/app/features/engagement-landing/engagement-landing.component.html`

- [ ] **Step 1: Write the widget**

It uses `ChangeEventService.getActivityFeed` with a curated whitelist filter:

```ts
// In get_activity_feed, the whitelist becomes a filter argument
// Whitelist: date_moved with days_diff > 90, phase_transitioned, status_changed
// to terminal states, sponsor_changed, trial_withdrawn.
// Implementation: pass `{event_types: [...], date_range: '7d', whitelist: 'high_signal'}`
// and have `get_activity_feed` interpret `whitelist: 'high_signal'` server-side.
```

Update `get_activity_feed` (in the original migration or a small follow-up `20260502121300_activity_feed_whitelist.sql`) to support a `p_filters->>'whitelist' = 'high_signal'` shortcut that compiles to the curated WHERE clause.

Component shows top 5 results, links to `/activity` "View all".

- [ ] **Step 2: Mount inside engagement-landing**

Add `<app-what-changed-widget [spaceId]="spaceId()" />` above `<app-intelligence-feed>` in `engagement-landing.component.html`. Import the component into the `imports` array.

- [ ] **Step 3: Verify**

`cd src/client && ng lint && ng build`. Manual: load engagement landing, confirm widget renders or shows the empty state.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/what-changed-widget/ src/client/src/app/features/engagement-landing/ supabase/migrations/20260502121300_activity_feed_whitelist.sql
git commit -m "feat(client): add what-changed widget on engagement landing"
```

### Task 3.5: Trial row badges

**Files:**
- Modify: `src/client/src/app/core/models/dashboard.model.ts` (or wherever `TrialNode` lives)
- Modify: existing trial-row templates: `landscape` company-product trees, `bullseye-detail-panel`, `key-catalysts` list

- [ ] **Step 1: Add fields to the trial node interface**

Locate the interface used for trial rows in dashboard/landscape data. Add:

```ts
recent_changes_count: number;
most_recent_change_type: string | null;
```

- [ ] **Step 2: Add a small `ChangeBadgeComponent`**

`src/client/src/app/shared/components/change-badge/change-badge.component.ts` -- takes `count: number` and `type: string | null` inputs. Renders:
- `count === 0` -> nothing
- non-priority -> small slate dot
- priority types (`date_moved`, `phase_transitioned`, `trial_withdrawn`) -> red dot

Tailwind: `inline-block w-2 h-2 rounded-full` with conditional `bg-slate-400` or `bg-red-500`. ARIA label.

- [ ] **Step 3: Insert the badge in trial-row templates**

`grep -rn "trial.name\|trial?.name" src/client/src/app/features/landscape/ src/client/src/app/features/catalysts/` to find every trial-name render site. Add `<app-change-badge [count]="trial.recent_changes_count" [type]="trial.most_recent_change_type" />` next to each.

- [ ] **Step 4: Verify**

`cd src/client && ng lint && ng build`. Manual: load a space with seeded change events; confirm dots appear on the right trial rows.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/shared/components/change-badge/ src/client/src/app/features/landscape/ src/client/src/app/features/catalysts/ src/client/src/app/core/models/
git commit -m "feat(client): add change-count badges to trial rows"
```

### Task 3.6: Marker history panel

**Files:**
- Modify: existing marker detail surface (find via `grep -rn "marker-detail\|MarkerDetail" src/client/src/app/`)

- [ ] **Step 1: Identify the marker detail component**

Likely `src/client/src/app/shared/components/marker-detail-content.component.ts` or `marker-detail-panel.component.ts`.

- [ ] **Step 2: Add a History section**

Add a collapsible "History" section that calls `ChangeEventService.getMarkerHistory(marker.id)` on first expand, renders rows via a small adapter that converts `MarkerChangeRow` to the same `ChangeEventRowComponent` shape (or a similar component).

Keep the section visually consistent with the rest of the panel (spacing, dividers, heading style).

- [ ] **Step 3: Verify**

`cd src/client && ng lint && ng build`. Manual: open a marker detail, expand History, confirm rows render with old/new values shown on expand.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/marker-detail-*
git commit -m "feat(client): add history section to marker detail"
```

### Task 3.7: Intel feed mixing

**Files:**
- Modify: `src/client/src/app/core/services/primary-intelligence.service.ts` and the RPC behind `intelligence-feed`
- Modify: `src/client/src/app/shared/components/intelligence-feed/intelligence-feed.component.ts`

- [ ] **Step 1: Find and modify the intelligence feed RPC**

`grep -rn "primary_intelligence\|get_intelligence_feed" supabase/migrations/`. Locate the RPC that powers `intelligence-feed`. Add a new migration `20260502121400_intelligence_feed_mixing.sql` that drops + recreates it with merged output: existing primary_intelligence rows UNIONed with high-signal `trial_change_events` (CT.gov-source only, same whitelist as Task 3.4), sorted by published_at/observed_at desc.

Each row gets a discriminator field `kind: 'intelligence' | 'system_update'`.

- [ ] **Step 2: Update the component template**

Render `kind: 'system_update'` rows with smaller font, a slate accent bar, and a "System update" label. Keep the existing intelligence row visual intact.

- [ ] **Step 3: Verify**

`cd src/client && ng lint && ng build`. Manual: load engagement landing, confirm system updates appear interleaved with intelligence rows.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/shared/components/intelligence-feed/ src/client/src/app/core/services/primary-intelligence.service.ts supabase/migrations/20260502121400_intelligence_feed_mixing.sql
git commit -m "feat(client): mix change events into intelligence feed"
```

### Phase 3 verification gate

- [ ] **Step 1: Lint + build**

`cd src/client && ng lint && ng build`. Expected: clean.

- [ ] **Step 2: SQL still applies**

`supabase db reset`. Expected: clean.

- [ ] **Step 3: Worker tests**

`cd src/client && npm run test:worker`. Expected: PASS.

- [ ] **Step 4: Manual smoke**

Walk through Activity page, widget, badges, marker history, intel feed. Each should render with seed data without console errors.

---

## Phase 4: Trial-detail rework (CT.gov data block, Activity section, manual sync)

Goal: trial-detail page renders CT.gov data via the snapshot-driven renderer with a "Show all CT.gov data" modal, an Activity section, and a "Sync from CT.gov" button. Inline editing replaces the modal `TrialFormComponent` for analyst-owned fields.

### Task 4.1: CT.gov field catalogue

**Files:**
- Create: `src/client/src/app/core/models/ctgov-field.model.ts`

- [ ] **Step 1: Write the catalogue**

Use the spec's "Field catalogue" section as the starter. Aim for ~60-80 entries covering: identification, status (all dates), design (phases, study type, allocation, masking, etc.), eligibility, sponsorship, conditions, interventions, outcomes (primary + secondary), regulatory (DMC, FDA, etc.), locations.

```ts
export interface CtgovField {
  path: string;
  label: string;
  kind: 'string' | 'longtext' | 'date' | 'number' | 'array' | 'boolean';
  itemPath?: string;
  summary?: 'count';
}

export const CTGOV_FIELD_CATALOGUE: CtgovField[] = [
  { path: 'protocolSection.identificationModule.officialTitle', label: 'Official title', kind: 'longtext' },
  { path: 'protocolSection.identificationModule.briefTitle', label: 'Brief title', kind: 'string' },
  { path: 'protocolSection.identificationModule.nctId', label: 'NCT identifier', kind: 'string' },
  // ... 60-80 total entries; group by section with comment headers
];
```

- [ ] **Step 2: Verify TS compile**

`cd src/client && ng build`.

- [ ] **Step 3: Commit**

```bash
git add src/client/src/app/core/models/ctgov-field.model.ts
git commit -m "feat(client): add ctgov field catalogue"
```

### Task 4.2: CT.gov field renderer

**Files:**
- Create: `src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.ts`
- Create: `src/client/src/app/shared/components/ctgov-field-renderer/ctgov-field-renderer.component.html`

- [ ] **Step 1: Write the renderer**

Inputs:
- `snapshot: input.required<unknown>()` -- the latest snapshot payload jsonb
- `paths: input.required<string[]>()` -- ordered list of paths to render
- `dense = input(false)` -- compact mode for trial-detail vs spacious for the modal

The component resolves each path via `CTGOV_FIELD_CATALOGUE`, walks the snapshot via `path.split('.').reduce((acc, k) => acc?.[k], snapshot)`, then renders by `kind`:
- `string` / `longtext` -> plain text (longtext truncates with see-more)
- `date` -> `{{ value | date:'mediumDate' }}` (use Angular `DatePipe`)
- `number` -> formatted with locale
- `array` with `summary: 'count'` -> "N items" with click to expand
- `array` without summary -> bulleted list of `itemPath` extractions
- `boolean` -> "Yes" / "No"

Definition list layout: `<dl><dt>label</dt><dd>value</dd></dl>` with Tailwind grid `grid-cols-[max-content_1fr] gap-x-4 gap-y-2`.

- [ ] **Step 2: Verify and commit**

```bash
cd src/client && ng lint && ng build
git add src/client/src/app/shared/components/ctgov-field-renderer/
git commit -m "feat(client): add ctgov field renderer"
```

### Task 4.3: Trial snapshot service helper

**Files:**
- Modify: `src/client/src/app/core/services/trial.service.ts`

- [ ] **Step 1: Add `getLatestSnapshot(trialId)` method**

```ts
async getLatestSnapshot(trialId: string): Promise<{ payload: unknown; fetched_at: string } | null> {
  const { data, error } = await this.supabase.client
    .from('trial_ctgov_snapshots')
    .select('payload, fetched_at')
    .eq('trial_id', trialId)
    .order('ctgov_version', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/core/services/trial.service.ts
git commit -m "feat(client): add getLatestSnapshot helper"
```

### Task 4.4: Trial-detail rework

**Files:**
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-detail.component.html`

- [ ] **Step 1: Add new state to the component**

```ts
snapshot = signal<{ payload: unknown; fetched_at: string } | null>(null);
spaceFieldVisibility = signal<Record<string, string[]>>({});
trialActivity = signal<ChangeEvent[]>([]);
showAllCtgovModal = signal(false);
syncing = signal(false);

ngOnInit changes: also call loadSnapshot, loadFieldVisibility, loadTrialActivity.

protected configuredPaths = computed(() => this.spaceFieldVisibility()['trial_detail'] ?? defaultPathsForTrialDetail);
```

`defaultPathsForTrialDetail` is a small const exported from `ctgov-field.model.ts` listing the spec's default extras (Lead sponsor, Primary completion date).

Add a service injection for `ChangeEventService`. Call `getTrialActivity(trialId, 25)` in `ngOnInit`.

- [ ] **Step 2: Add new sections to the template**

Insert above the existing "MARKERS" section:

```html
<!-- CT.gov data block -->
<app-section-card heading="CT.gov data" id="ctgov">
  <div slot="actions">
    <p-button label="Sync from CT.gov" icon="fa-solid fa-rotate" [text]="true" [loading]="syncing()" (click)="syncCtgov()" />
    <p-button label="Show all CT.gov data" [text]="true" (click)="showAllCtgovModal.set(true)" />
  </div>
  <div class="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-2 text-sm">
    <dt class="text-slate-500">Phase</dt><dd>{{ trial()?.phase }}</dd>
    <dt class="text-slate-500">Recruitment status</dt><dd>{{ trial()?.recruitment_status }}</dd>
    <dt class="text-slate-500">Study type</dt><dd>{{ trial()?.study_type }}</dd>
    @if (snapshot()?.payload && configuredPaths().length) {
      <app-ctgov-field-renderer [snapshot]="snapshot()!.payload" [paths]="configuredPaths()" [dense]="true" />
    }
  </div>
  <p class="text-xs text-slate-500 mt-2">
    Last synced: {{ trial()?.ctgov_last_synced_at | date:'short' }}
  </p>
</app-section-card>
```

Insert below "MARKERS":

```html
<app-section-card heading="Activity" id="activity">
  @for (event of trialActivity(); track event.id) {
    <app-change-event-row [event]="event" />
  }
  @empty {
    <p class="text-slate-500 text-sm py-4">No activity yet.</p>
  }
</app-section-card>
```

Modal:

```html
<p-dialog [(visible)]="showAllCtgovModal" header="All CT.gov data" [modal]="true" [style]="{width: '60rem'}">
  @if (snapshot()) {
    <app-ctgov-field-renderer [snapshot]="snapshot()!.payload" [paths]="allCatalogPaths" />
  }
</p-dialog>
```

- [ ] **Step 3: Implement `syncCtgov()`**

```ts
async syncCtgov(): Promise<void> {
  this.syncing.set(true);
  try {
    await this.changeEventService.triggerSingleTrialSync(this.trialId());
    await Promise.all([this.loadTrial(), this.loadSnapshot(), this.loadTrialActivity()]);
    this.messageService.add({ severity: 'success', summary: 'Sync queued', life: 3000 });
  } catch (e) {
    this.messageService.add({ severity: 'error', summary: 'Sync failed', detail: String(e), life: 4000 });
  } finally {
    this.syncing.set(false);
  }
}
```

- [ ] **Step 4: Inline editing for analyst-owned fields**

Replace the existing `<app-trial-form>` modal usage with inline edit controls inside an "Identity" section. For each editable field, use either PrimeNG `p-inplace` or a small click-to-edit pattern that swaps `<span>{{ trial()?.name }}</span>` for `<input pInputText [(ngModel)]="draftName" (blur)="saveName()" />`.

Editable fields per spec: `name`, `notes`, `display_order`, `product`, `therapeutic_area`, `phase_type`, `phase_start_date`, `phase_end_date`. Keep existing per-field validation (e.g. required name). Save calls `trialService.update(id, {name: ...})`.

- [ ] **Step 5: Drop `TrialFormComponent` from imports**

In `trial-detail.component.ts`, remove `TrialFormComponent` from `imports`. Remove `<app-trial-form>` usages from the template. Remove `editingTrial` signal + `onTrialSaved` handler.

- [ ] **Step 6: Verify**

`cd src/client && ng lint && ng build`. Manual: open a trial-detail page, confirm:
- CT.gov data block renders with phase/status/study type
- Snapshot extras render
- "Show all" modal shows the full catalogue
- "Sync from CT.gov" calls the worker and refreshes
- Activity section shows recent events
- Inline editing works for `name` and `notes`

- [ ] **Step 7: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-detail.component.ts src/client/src/app/features/manage/trials/trial-detail.component.html
git commit -m "feat(client): rework trial-detail with ctgov block and activity"
```

### Phase 4 verification gate

- [ ] **Step 1: Lint + build**

`cd src/client && ng lint && ng build`.

- [ ] **Step 2: Functional walkthrough**

Open trial-detail for two seeded trials (one with NCT, one without). Confirm:
- With-NCT: snapshot fields render, "Sync from CT.gov" works, Activity section populates after a sync
- Without-NCT: CT.gov section degrades gracefully (empty state), no broken UI

---

## Phase 5: Trial-create dialog and trial-form retirement

Goal: New small dialog for trial creation. Old trial-form component, route reference, and client-side ctgov-sync service deleted. No analyst-facing edit form remains.

### Task 5.1: Trial-create dialog

**Files:**
- Create: `src/client/src/app/features/manage/trials/trial-create-dialog.component.ts`
- Create: `src/client/src/app/features/manage/trials/trial-create-dialog.component.html`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.ts`
- Modify: `src/client/src/app/features/manage/trials/trial-list.component.html`

- [ ] **Step 1: Write the dialog**

Standalone component, signal-based state, PrimeNG `p-dialog`. Inputs: `visible`, `spaceId`, plus `(saved)` output emitting the new trial id.

Form fields: `name` (required, `pInputText`), `identifier` (NCT, `pInputText`, optional, validate `/^NCT\d{8}$/i` if provided), `product_id` (`p-select` over products in space), `therapeutic_area_id` (`p-select` over therapeutic areas in space).

Submit: insert via `trialService.create`, then if NCT provided call `changeEventService.triggerSingleTrialSync(newId)` (best-effort, non-blocking). Emit saved + redirect to `/manage/trials/:id`.

- [ ] **Step 2: Wire it into trial-list**

In `trial-list.component.ts`, replace the existing "New trial" CTA's behavior. If today it routes to a form, change it to set a `creating = signal(false)` to true. Render `<app-trial-create-dialog [(visible)]="creating" [spaceId]="spaceId()" (saved)="onTrialCreated($event)" />`.

- [ ] **Step 3: Verify**

`cd src/client && ng lint && ng build`. Manual: click "New trial", create one with NCT, confirm redirect, confirm sync kicks off.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/features/manage/trials/trial-create-dialog.* src/client/src/app/features/manage/trials/trial-list.*
git commit -m "feat(client): add trial-create dialog"
```

### Task 5.2: Delete trial-form, ctgov-sync.service, trial-form.html

**Files:**
- Delete: `src/client/src/app/features/manage/trials/trial-form.component.ts`
- Delete: `src/client/src/app/features/manage/trials/trial-form.component.html`
- Delete: `src/client/src/app/core/services/ctgov-sync.service.ts`

- [ ] **Step 1: Confirm zero remaining references**

```bash
grep -rn "TrialFormComponent\|CtgovSyncService\|ctgov-sync.service" src/client/src/
```

If anything still references them, fix the references first (this is a sign Task 4 didn't fully drop the import).

- [ ] **Step 2: Delete the files**

```bash
git rm src/client/src/app/features/manage/trials/trial-form.component.ts src/client/src/app/features/manage/trials/trial-form.component.html src/client/src/app/core/services/ctgov-sync.service.ts
```

- [ ] **Step 3: Check `app.routes.ts` for old edit-route entries**

`grep -n "trial-form\|trials/.*edit" src/client/src/app/app.routes.ts`. If a route exists, replace it with a redirect to `/manage/trials/:id`. If no route exists, no action.

- [ ] **Step 4: Verify**

`cd src/client && ng lint && ng build`. Expected: clean.

- [ ] **Step 5: Commit**

```bash
git add -A src/client/src/app/features/manage/trials/ src/client/src/app/core/services/ src/client/src/app/app.routes.ts
git commit -m "refactor(client): retire trial-form and ctgov-sync.service"
```

### Phase 5 verification gate

- [ ] `cd src/client && ng lint && ng build` clean
- [ ] No grep hits for `TrialFormComponent` or `CtgovSyncService`
- [ ] Manual: trial-list "New trial" -> dialog; trial-detail edit -> inline; "Sync from CT.gov" still works

---

## Phase 6: Per-space field visibility settings

Goal: A space owner can choose which CT.gov fields appear on which surface. Changes take effect immediately for all space members.

### Task 6.1: Field visibility service

**Files:**
- Create: `src/client/src/app/core/services/space-field-visibility.service.ts`

- [ ] **Step 1: Write the service**

```ts
@Injectable({providedIn: 'root'})
export class SpaceFieldVisibilityService {
  private supabase = inject(SupabaseService);

  async get(spaceId: string): Promise<Record<string, string[]>> {
    const { data, error } = await this.supabase.client
      .from('spaces').select('ctgov_field_visibility').eq('id', spaceId).single();
    if (error) throw error;
    return (data?.ctgov_field_visibility as Record<string, string[]>) ?? {};
  }

  async update(spaceId: string, visibility: Record<string, string[]>): Promise<void> {
    const { error } = await this.supabase.client.rpc('update_space_field_visibility', {
      p_space_id: spaceId,
      p_visibility: visibility,
    });
    if (error) throw error;
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add src/client/src/app/core/services/space-field-visibility.service.ts
git commit -m "feat(client): add space field visibility service"
```

### Task 6.2: Field-picker presenter

**Files:**
- Create: `src/client/src/app/shared/components/ctgov-field-picker/ctgov-field-picker.component.ts`
- Create: `src/client/src/app/shared/components/ctgov-field-picker/ctgov-field-picker.component.html`

- [ ] **Step 1: Write the picker**

Inputs:
- `available: input.required<CtgovField[]>()`
- `selected: input.required<string[]>()` (paths)
Outputs:
- `(selectedChange) = output<string[]>()`

Two columns. PrimeNG `cdkDragDrop` (Angular CDK already in deps) enables drag from "Available" to "Visible" and reordering within "Visible". Visible column shows them in the order the user dragged them.

- [ ] **Step 2: Verify and commit**

`cd src/client && ng lint && ng build`.

```bash
git add src/client/src/app/shared/components/ctgov-field-picker/
git commit -m "feat(client): add ctgov field picker component"
```

### Task 6.3: Field visibility settings page

**Files:**
- Create: `src/client/src/app/features/space-settings/space-field-visibility-settings.component.ts`
- Create: `src/client/src/app/features/space-settings/space-field-visibility-settings.component.html`
- Modify: `src/client/src/app/app.routes.ts`
- Modify: settings nav (search `grep -rn "settings/general\|settings/members\|setting-nav" src/client/src/app/`)

- [ ] **Step 1: Write the page**

Tabs by `surface_key`: `trial_detail`, `bullseye_detail_panel`, `timeline_detail`, `key_catalysts_panel`, `trial_list_columns`. Each tab renders `<app-ctgov-field-picker>` bound to that surface's slice of the visibility object.

"Save" button at bottom: calls `service.update(spaceId, visibility)`.

Permission gate: only owners get the editable view; other members see read-only labels (defer to a `disabled` state). Use `SpaceRoleService.isOwner()`.

- [ ] **Step 2: Add the route**

In `s/:spaceId` children:
```ts
{
  path: 'settings/fields',
  loadComponent: () =>
    import('./features/space-settings/space-field-visibility-settings.component').then(
      (m) => m.SpaceFieldVisibilitySettingsComponent
    ),
},
```

- [ ] **Step 3: Add to settings nav**

Find the settings nav definition (likely in `app-shell.component` or a sidebar service). Add a "Fields" entry pointing to `settings/fields`. Visible only to owners.

- [ ] **Step 4: Verify**

`cd src/client && ng lint && ng build`. Manual: as a space owner, change `trial_detail` visibility, navigate to a trial-detail, confirm new fields render.

- [ ] **Step 5: Commit**

```bash
git add src/client/src/app/features/space-settings/space-field-visibility-settings.* src/client/src/app/app.routes.ts
git commit -m "feat(client): add per-space field visibility settings"
```

### Phase 6 verification gate

- [ ] Lint + build clean
- [ ] Owner can edit, non-owner sees read-only
- [ ] Trial-detail / bullseye-detail / timeline-detail / key-catalysts all read the per-space config

---

## Phase 7: Schema cleanup (drop the orphaned columns)

Goal: 36 dead CT.gov columns gone from `trials`. RPC projections, model interface, and any UI referencing them all cleaned up. `sample_size` displays removed.

This phase is destructive: do it after Phases 4-6 land so we know nothing else reads the dropped columns.

### Task 7.1: Audit remaining consumers

- [ ] **Step 1: Grep for each dropped column name**

For each column in the spec's "Columns dropped" table, run:

```bash
grep -rn "<column_name>" src/client/src/ supabase/migrations/
```

Build a punch list of files that still read or write each. Most should be `trial.model.ts`, `ctgov-sync.service.ts` (already deleted), `trial-form.component.*` (already deleted), the existing `get_dashboard_data` / `get_landscape_data` projections.

- [ ] **Step 2: Document the audit**

Save findings to a scratch file (do not commit). For each remaining reference, decide: rewrite to use snapshot path, or accept the deletion. Resolve all references before moving to Task 7.2.

### Task 7.2: Drop columns migration

**Files:**
- Create: `supabase/migrations/20260502122000_drop_orphaned_trial_columns.sql`

- [ ] **Step 1: Write the migration**

```sql
-- Drop the 36 orphaned CT.gov columns from public.trials.
-- These had no live consumer after the trial change feed cleanup.
-- Data remains accessible via trial_ctgov_snapshots.payload and the
-- per-space field visibility renderer.

alter table public.trials
  drop column if exists lead_sponsor,
  drop column if exists sponsor_type,
  drop column if exists collaborators,
  drop column if exists study_countries,
  drop column if exists study_regions,
  drop column if exists design_allocation,
  drop column if exists design_intervention_model,
  drop column if exists design_masking,
  drop column if exists design_primary_purpose,
  drop column if exists enrollment_type,
  drop column if exists conditions,
  drop column if exists intervention_type,
  drop column if exists intervention_name,
  drop column if exists primary_outcome_measures,
  drop column if exists secondary_outcome_measures,
  drop column if exists is_rare_disease,
  drop column if exists eligibility_sex,
  drop column if exists eligibility_min_age,
  drop column if exists eligibility_max_age,
  drop column if exists accepts_healthy_volunteers,
  drop column if exists eligibility_criteria,
  drop column if exists sampling_method,
  drop column if exists start_date,
  drop column if exists start_date_type,
  drop column if exists primary_completion_date,
  drop column if exists primary_completion_date_type,
  drop column if exists study_completion_date,
  drop column if exists study_completion_date_type,
  drop column if exists first_posted_date,
  drop column if exists results_first_posted_date,
  drop column if exists has_dmc,
  drop column if exists is_fda_regulated_drug,
  drop column if exists is_fda_regulated_device,
  drop column if exists fda_designations,
  drop column if exists submission_type,
  drop column if exists sample_size;
```

- [ ] **Step 2: Update RPC projections in the same migration**

Drop and recreate `get_dashboard_data` (copying the most recent definition) without the dropped keys in `jsonb_build_object`. Same for `get_landscape_data`.

- [ ] **Step 3: Verify**

`supabase db reset`. Expected: clean.

- [ ] **Step 4: Commit**

```bash
git add supabase/migrations/20260502122000_drop_orphaned_trial_columns.sql
git commit -m "refactor(db): drop orphaned ctgov trial columns"
```

### Task 7.3: Update Trial model

**Files:**
- Modify: `src/client/src/app/core/models/trial.model.ts`

- [ ] **Step 1: Trim the interface**

Keep:
- `id`, `space_id`, `created_by`, `product_id`, `therapeutic_area_id`, `name`, `identifier`, `status`, `notes`, `display_order`, `created_at`, `updated_at`, `phase_type`, `phase_start_date`, `phase_end_date`, `therapeutic_areas?`, `markers?`, `trial_notes?`
- CT.gov-materialized: `phase`, `recruitment_status`, `study_type`, `last_update_posted_date`
- Sync: `latest_ctgov_version`, `last_polled_at`, `ctgov_last_synced_at`

Delete every other CT.gov field from the interface.

- [ ] **Step 2: Drop `sample_size` displays**

`grep -rn "sample_size" src/client/src/app/`. Remove the column from any p-table displays in trial-detail, bullseye-detail-panel.

- [ ] **Step 3: Verify**

`cd src/client && ng lint && ng build`. Expected: any breakage from Task 7.1's audit should already be resolved; if anything still fails, fix it before committing.

- [ ] **Step 4: Commit**

```bash
git add src/client/src/app/core/models/trial.model.ts src/client/src/app/features/
git commit -m "refactor(client): trim Trial model and drop sample_size displays"
```

### Phase 7 verification gate

- [ ] `supabase db reset` clean
- [ ] `cd src/client && ng lint && ng build` clean
- [ ] `cd src/client && npm run test:worker` clean
- [ ] Manual: full app walkthrough -- trial-list, trial-detail, bullseye, landscape, catalysts, activity, engagement landing

---

## Phase 8: Runbook + docs:arch regeneration

Goal: Runbook reflects the new schema, RPCs, routes, deployment. AUTO-GEN blocks regenerate cleanly. Mermaid diagrams added where the spec has them.

### Task 8.1: Hand-written runbook updates

**Files:**
- Modify: `docs/runbook/03-features.md`
- Modify: `docs/runbook/06-backend-architecture.md`
- Modify: `docs/runbook/07-database-schema.md`
- Modify: `docs/runbook/08-authentication-security.md`
- Modify: `docs/runbook/12-deployment.md`

- [ ] **Step 1: `03-features.md`**

Add a "Trial change feed" section describing the four-stage pipeline + six surfaces. Reuse the spec's mermaid `flowchart LR` for the pipeline. Reference the activity route, the widget, the badges, the marker history panel.

- [ ] **Step 2: `06-backend-architecture.md`**

Document the new RPC family. Add the worker-secret -> `_verify_ctgov_worker_secret` -> ingest RPC chain. Reuse the spec's "Ingest pipeline" mermaid.

- [ ] **Step 3: `07-database-schema.md`**

Add the five new tables to the prose. The mermaid ER block is regenerated by `docs:arch` so don't hand-edit there; just update the surrounding context.

- [ ] **Step 4: `08-authentication-security.md`**

Document the worker-secret model: blast radius limited to three RPCs, rotation playbook (vault row update + `wrangler secret put`).

- [ ] **Step 5: `12-deployment.md`**

Add a "CT.gov sync" subsection covering: cron schedule (`0 7 * * *`), the secret rotation playbook, manual backfill via `POST /admin/ctgov-backfill`, monitoring via `ctgov_sync_runs`.

- [ ] **Step 6: Commit hand-written changes**

```bash
git add docs/runbook/
git commit -m "docs(runbook): document trial change feed"
```

### Task 8.2: Regenerate AUTO-GEN blocks

- [ ] **Step 1: Ensure local Supabase running with all migrations applied**

`supabase status` should show running. If not, `supabase start` then `supabase db reset`.

- [ ] **Step 2: Run docs:arch**

```bash
cd src/client && npm run docs:arch
```

Expected: regenerates blocks in `02-tech-stack.md`, `03-features.md`, `05-frontend-architecture.md` (route tree), `06-backend-architecture.md` (RPC->table matrix), `07-database-schema.md` (Mermaid ER), `08-authentication-security.md` (RLS coverage), `09-multi-tenant-model.md` (helpers).

- [ ] **Step 3: Inspect the diff**

`git diff docs/runbook/`. Expected: AUTO-GEN blocks reflect the new tables, RPCs, route. Surrounding prose unchanged.

- [ ] **Step 4: Commit the regen**

```bash
git add docs/runbook/
git commit -m "docs(runbook): regenerate auto-gen blocks"
```

### Phase 8 verification gate

- [ ] All five hand-edited runbook files mention the change feed
- [ ] `npm run docs:arch` is a no-op on a second run (deterministic output)
- [ ] No ASCII tree art added; all relationship diagrams use Mermaid

---

## Phase 9: Final integration verification

Goal: Every gate from every previous phase is green simultaneously, and the full feature works end-to-end against a fresh local stack.

### Task 9.1: Clean reset + full verification

- [ ] **Step 1: Stop everything**

```bash
supabase stop
```

- [ ] **Step 2: Fresh start**

```bash
supabase start
supabase db reset
```

Expected: every migration applies cleanly, every smoke-test `do` block emits success notices.

- [ ] **Step 3: TS verification**

```bash
cd src/client && ng lint && ng build
```

Expected: no warnings, no errors.

- [ ] **Step 4: Worker tests**

```bash
cd src/client && npm run test:worker
```

Expected: PASS for all spec files including the new ctgov-sync tests.

- [ ] **Step 5: Local cron run**

```bash
cd src/client && wrangler dev --test-scheduled
# in another terminal:
curl "http://localhost:8787/__scheduled?cron=0+7+*+*+*"
```

Expected: log lines from `runScheduledSync`. Query the local DB:
```bash
psql "postgresql://postgres:postgres@localhost:54322/postgres" -c \
  "select status, trials_checked, ncts_with_changes, snapshots_written, events_emitted from public.ctgov_sync_runs order by started_at desc limit 1;"
```
Expected: one row with `status='success'` (or `partial` if the seed has a bad NCT).

- [ ] **Step 6: Manual UI walkthrough**

Sign in, open a seed engagement, walk:
1. Engagement landing -> "What changed" widget renders, intel feed mixes system updates
2. `/activity` -> filter by date / event type / source, expand a row, paginate
3. Bullseye / landscape / key-catalysts -> trial badges visible
4. Trial detail -> CT.gov data block, "Show all" modal, "Sync from CT.gov" works, Activity section, inline editing
5. Marker detail -> History panel
6. Settings -> Fields -> change visibility, confirm trial-detail picks it up
7. Trial list -> "New trial" dialog, NCT-bearing trial gets synced

Document each step's pass/fail in the gate commit message.

- [ ] **Step 7: Phase 9 gate commit**

```bash
git commit --allow-empty -m "verify: trial change feed end-to-end gate"
```

---

## Phase 10: Cleanup checks

- [ ] **Step 1: Re-grep for stragglers**

```bash
grep -rn "trial-form\|TrialFormComponent\|CtgovSyncService\|ctgov-sync.service" src/client/
grep -rn "lead_sponsor\|sponsor_type\|study_countries\|design_allocation" src/client/src/ supabase/migrations/
```

Expected: zero hits in `src/client/src/`. Migration file hits are fine (they're history).

- [ ] **Step 2: Re-run docs:arch one more time**

`cd src/client && npm run docs:arch`. Expected: clean diff (no changes -- it's deterministic).

- [ ] **Step 3: Final commit if anything changed**

If git status is dirty after these checks, fix and commit. Otherwise skip.

---

## Risks and how this plan addresses them

| Risk from spec | Plan mitigation |
|---|---|
| `/api/int/` undocumented and may shape-shift | Adapter isolated to `ctgov-client.ts` (Task 2.2). Errors swallowed with log; v2 keeps working. Tests assert null-on-parse-failure behavior. |
| Initial backfill volume hits CT.gov hard | Manual backfill endpoint chunks NCTs; deployment runbook (Task 8.1 step 5) documents running it in batches. |
| Bulk marker imports trigger thousands of events | Accepted in v1 per spec; migration `20260502120700` adds the row-level trigger only. STATEMENT-level mitigation deferred. |
| Bookmarks pointing at old `/edit` URL | Task 5.2 step 3 audits and adds a redirect if a route exists. |
| Worker secret rotation | Documented in Task 8.1 step 4. `_verify_ctgov_worker_secret` reads from vault each call so rotation is one INSERT + one `wrangler secret put`. |

---

## Self-Review Notes

**Spec coverage check:**
- [x] Background CT.gov polling -- Phase 2
- [x] Snapshot history capture -- Phase 1, Task 1.1 + 1.6
- [x] Markers audit log -- Phase 1, Task 1.8
- [x] Unified change feed -- Phase 1, Task 1.1 + 1.8
- [x] Activity page -- Phase 3, Task 3.3
- [x] What-changed widget -- Phase 3, Task 3.4
- [x] Trial row badges -- Phase 3, Task 3.5
- [x] Marker history panel -- Phase 3, Task 3.6
- [x] Intel feed mixing -- Phase 3, Task 3.7
- [x] Trial-detail Activity section + CT.gov block + Sync button -- Phase 4
- [x] Per-space field visibility config -- Phase 1, Task 1.3 + Phase 6
- [x] Trial form retirement (form, route, ctgov-sync.service) -- Phase 5
- [x] Drop 36 orphaned columns -- Phase 7
- [x] Drop sample_size displays -- Phase 7, Task 7.3 step 2
- [x] Update Trial model -- Phase 7, Task 7.3
- [x] Worker scheduled handler tests -- Phase 2, Task 2.4
- [x] Wrangler config additions -- Phase 2, Task 2.5
- [x] Manual backfill path -- Phase 2, Task 2.5
- [x] Worker secret model -- Phase 1, Task 1.4
- [x] Six surface RPCs -- Phase 1, Task 1.9
- [x] Dashboard/landscape change-count extension -- Phase 1, Task 1.10
- [x] Recompute path for snapshot replay -- Phase 1, Task 1.9 step 6
- [x] Runbook updates + docs:arch regen -- Phase 8
- [x] No em dashes in any new content -- enforced via final grep in Phase 10

**Type consistency check:**
- `IngestArgs` in `types.ts` (Task 2.1) matches `ingest_ctgov_snapshot` parameter shape from migration `20260502120500` (Task 1.6). Both use `nct_id`, `version`, `post_date`, `payload`, `fetched_via`, `module_hints`.
- `ChangeEvent` model (Task 3.1) matches the row shape returned by `get_activity_feed` (Task 1.9 step 1) including the joined `trial_name`, `trial_identifier`, `marker_title`.
- `triggerSingleTrialSync` returns `{ok: bool, nct_id: string}` consistently between RPC (Task 1.9 step 4) and service (Task 3.1 step 2).
- `surface_key` literal set is consistent across spec, settings UI (Phase 6), and the field renderer (Phase 4).
