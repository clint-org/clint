---
surface: CT.gov Integration
spec: docs/superpowers/specs/2026-05-06-ctgov-history-backfill-design.md
---

# CT.gov Integration

The `CtgovSyncService` can fetch trial data from the ClinicalTrials.gov API v2 by NCT ID and map it to internal fields. Trials can store 35+ fields from the ClinicalTrials.gov data model, including:

- **Logistics**: recruitment_status, sponsor_type, lead_sponsor, collaborators[], study_countries[], study_regions[]
- **Scientific Design**: study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, enrollment_type
- **Clinical Context**: conditions[], intervention_type, intervention_name, primary/secondary_outcome_measures (jsonb), is_rare_disease
- **Eligibility**: eligibility_sex, eligibility_min_age, eligibility_max_age, accepts_healthy_volunteers, eligibility_criteria, sampling_method
- **Timeline**: start_date, primary_completion_date, study_completion_date (each with _type: Actual|Estimated), plus posting dates
- **Regulatory**: has_dmc, is_fda_regulated_drug, is_fda_regulated_device, fda_designations[], submission_type
- **Sync Tracking**: ctgov_last_synced_at, ctgov_raw_json

Helper methods in the sync service handle phase mapping, masking conversion, sponsor class normalization, country extraction, and region inference.

## Capabilities

```yaml
- id: ctgov-snapshot-ingest
  summary: Idempotent ingest RPC that stores a CT.gov payload snapshot, materializes the trial row, and writes raw field diffs.
  routes: []
  rpcs:
    - ingest_ctgov_snapshot
    - _materialize_trial_from_snapshot
    - _compute_field_diffs
    - _derive_phase_type
    - _derive_status
    - _map_phase_array
    - _safe_iso_date
  tables:
    - trial_ctgov_snapshots
    - trial_field_changes
    - trials
  related:
    - trial-change-feed-pipeline
  user_facing: false
  role: editor
  status: active
- id: ctgov-worker-cron
  summary: Daily Cloudflare Worker pulls fresh CT.gov payloads in batches, calling ingest per changed trial.
  routes: []
  rpcs:
    - bulk_update_last_polled
    - get_trials_for_polling
    - get_latest_sync_run
    - mark_trials_ctgov_withdrawn
    - record_sync_run
    - _verify_ctgov_worker_secret
  tables:
    - trials
    - ctgov_sync_runs
  related:
    - ctgov-snapshot-ingest
  user_facing: false
  role: owner
  status: active
- id: ctgov-manual-trial-sync
  summary: Single-trial sync trigger for ad-hoc refresh of a single NCT.
  routes:
    - /t/:tenantId/s/:spaceId/profiles/trials/:id
  rpcs:
    - trigger_single_trial_sync
  tables:
    - trials
    - ctgov_sync_runs
  related:
    - manage-trials
  user_facing: true
  role: editor
  status: active
- id: ctgov-snapshot-history
  summary: Append-only JSONB snapshot history for each trial, used for replay and audit.
  routes: []
  rpcs:
    - list_latest_snapshots_for_space
    - _seed_ctgov_markers
  tables:
    - trial_ctgov_snapshots
  related:
    - ctgov-snapshot-ingest
  user_facing: false
  role: viewer
  status: active
- id: ctgov-field-mapping
  summary: 35-plus CT.gov dimensions mapped onto trial columns, including logistics, design, clinical context, eligibility, timeline, and regulatory fields. A BEFORE trigger guards CT.gov-locked phase fields from analyst overwrites.
  routes: []
  rpcs:
    - _guard_ctgov_locked_phase_fields
  tables:
    - trials
  related:
    - manage-trials
  user_facing: false
  role: viewer
  status: active
- id: ctgov-trial-date-markers
  summary: Trial dates (start, end) live as Trial Start / Trial End markers. Partial dates are resolved to full dates with a precision label; seeding uses a source-aware UPSERT with an adoption step. A BEFORE UPDATE/DELETE trigger enforces ct.gov ownership on markers.
  routes: []
  rpcs:
    - _ctgov_resolve_partial_date
    - _seed_ctgov_marker_upsert
    - _create_trial_date_markers
    - _guard_ctgov_locked_markers
  tables:
    - events
  related:
    - ctgov-snapshot-history
    - ctgov-field-mapping
  user_facing: false
  role: viewer
  status: active
```

## Sync health: partial dates, withdrawn trials, and failure visibility

The daily pull runs in the prod `clint` Worker on a `0 7 * * *` cron (dev has `crons: []`, so the scheduled sync never fires in dev). Each run records one row in `ctgov_sync_runs` with counts and a `status` of `success` / `partial` / `failed`.

**Partial dates.** CT.gov emits month- or year-precision dates (e.g. `2026-04`, `2026`) for `startDateStruct` / `primaryCompletionDateStruct` / `completionDateStruct`, and month-precision for `statusVerifiedDate`. All date parsing in the ingest path goes through `_safe_iso_date()`, which returns null for anything that is not a full `YYYY-MM-DD`. A partial date never raises `22007` (which previously aborted `ingest_ctgov_snapshot` and dropped the run to `partial`). In `_classify_change`, a `date_moved` event for a partial still emits with `days_diff: null` and the raw `from`/`to` strings.

**Withdrawn trials (404).** When a full pull returns 404, the study has been removed from the registry. The worker collects the trial id and calls `mark_trials_ctgov_withdrawn`, which stamps `trials.ctgov_withdrawn_at`, emits a one-time `trial_withdrawn` event, and bumps `last_polled_at`. `get_trials_for_polling` excludes trials with a non-null `ctgov_withdrawn_at`, so a withdrawn NCT leaves the queue and is not re-fetched daily. A 404 is expected attrition, not a sync error: it does not add to `errors_count` and does not drag the run to `partial`.

**Failure visibility.** `runScheduledSync` always records a run row: if it throws before the normal `record_sync_run` (e.g. `get_trials_for_polling` 500s), it records a `status=failed` row with `error_summary.errors[0].kind = 'fatal'` and then rethrows so the `scheduled()` handler still logs. Previously a fatal throw left no row at all -- the run vanished into an unread Worker log, which is what produced the multi-day gaps in `ctgov_sync_runs`.

**Watchdog alert.** `.github/workflows/ctgov-sync-health.yml` is a scheduled GitHub Actions check (`0 9 * * *`, ~2h after the sync) that queries prod for the latest `ctgov_sync_runs` row. It fails -- opening or commenting on a deduped `ctgov-sync-failure` issue, the same pattern as `uptime-check.yml` -- when the latest run is stale (> 26h, i.e. a daily run was missed), is `failed`/`partial`, or no runs exist. Because it runs on GitHub's infra rather than the Worker, it is the only signal that catches the Worker cron silently not firing at all.
