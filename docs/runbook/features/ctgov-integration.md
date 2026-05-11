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
    - /t/:tenantId/s/:spaceId/manage/trials/:id
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
  summary: 35-plus CT.gov dimensions mapped onto trial columns, including logistics, design, clinical context, eligibility, timeline, and regulatory fields.
  routes: []
  rpcs: []
  tables:
    - trials
  related:
    - manage-trials
  user_facing: false
  role: viewer
  status: active
```
