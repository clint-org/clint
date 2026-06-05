---
surface: Data Management
spec: docs/specs/clinical-trial-dashboard/spec.md
---

# Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Assets | Drug/therapy assets linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults (each assigned to a category) |
| Indications | Disease indications with optional hierarchy (name, abbreviation, parent) |
| Conditions | Granular disease conditions mapped to indications |

## Capabilities

```yaml
- id: manage-companies
  summary: CRUD interface for pharma/biotech company records (name, logo_url, display_order, color).
  routes:
    - /t/:tenantId/s/:spaceId/manage/companies
    - /t/:tenantId/s/:spaceId/manage/companies/:id
  rpcs: []
  tables:
    - companies
  related: []
  user_facing: true
  role: editor
  status: active
- id: manage-assets
  summary: CRUD interface for drug/therapy assets (formerly products) linked to a company.
  routes:
    - /t/:tenantId/s/:spaceId/manage/assets
    - /t/:tenantId/s/:spaceId/manage/assets/:id
  rpcs:
    - link_asset_moa_roa
  tables:
    - assets
    - asset_mechanisms_of_action
    - asset_routes_of_administration
  related:
    - manage-companies
  user_facing: true
  role: editor
  status: active
- id: manage-trials
  summary: CRUD interface for clinical studies with full metadata plus CT.gov dimensions, including phase records and notes.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials
    - /t/:tenantId/s/:spaceId/manage/trials/:id
  rpcs: []
  tables:
    - trials
    - trial_notes
  related:
    - manage-assets
    - ctgov-snapshot-ingest
  user_facing: true
  role: editor
  status: active
- id: manage-markers
  summary: Edit event markers (event_date, end_date, tooltip_text, is_projected) attached to trials. Edited inline on the trial detail page; "View detail" links on catalyst rows deep-link via ?marker=<id> which opens the inline editor. Markers no longer have their own detail page. Trial-assignment changes go through update_marker_assignments, an atomic RPC that keeps the AFTER DELETE orphan-cleanup trigger from dropping a single-assignment marker mid-edit.
  routes:
    - /t/:tenantId/s/:spaceId/manage/trials/:id
  rpcs:
    - update_marker_assignments
    - _cleanup_orphan_marker
  tables:
    - markers
    - marker_assignments
  related:
    - manage-trials
  user_facing: true
  role: editor
  status: active
- id: manage-marker-types
  summary: Define custom marker types beyond the 10 system defaults, each assigned to a category.
  routes:
    - /t/:tenantId/s/:spaceId/manage/marker-types
    - /t/:tenantId/s/:spaceId/settings/marker-types
  rpcs: []
  tables:
    - marker_types
    - marker_categories
  related:
    - in-app-help-markers
  user_facing: true
  role: editor
  status: active
- id: manage-indications
  summary: Manage disease indications with optional hierarchy (name, abbreviation, parent).
  routes:
    - /t/:tenantId/s/:spaceId/settings/taxonomies
  rpcs: []
  tables:
    - indications
    - conditions
    - condition_indication_map
    - asset_indications
  related: []
  user_facing: true
  role: editor
  status: active
- id: manage-mechanisms-of-action
  summary: Manage mechanism-of-action taxonomy attached to assets.
  routes:
    - /t/:tenantId/s/:spaceId/manage/mechanisms-of-action
  rpcs:
    - update_asset_mechanisms
  tables:
    - mechanisms_of_action
    - asset_mechanisms_of_action
  related:
    - manage-assets
  user_facing: true
  role: editor
  status: active
- id: manage-routes-of-administration
  summary: Manage route-of-administration taxonomy attached to assets.
  routes:
    - /t/:tenantId/s/:spaceId/manage/routes-of-administration
  rpcs:
    - update_asset_routes
  tables:
    - routes_of_administration
    - asset_routes_of_administration
  related:
    - manage-assets
  user_facing: true
  role: editor
  status: active
- id: manage-engagement-overview
  summary: Engagement-level management dashboard linking to all data-management sections.
  routes:
    - /t/:tenantId/s/:spaceId/manage/engagement
  rpcs: []
  tables:
    - spaces
  related: []
  user_facing: true
  role: editor
  status: active
- id: manage-seed-demo
  summary: One-click seed-demo-data action for empty engagements (development/demo convenience).
  routes:
    - /t/:tenantId/s/:spaceId/seed-demo
  rpcs:
    - seed_demo_data
    - auto_join_demo_tenant_local
  tables:
    - companies
    - assets
    - trials
    - markers
    - marker_types
    - indications
  related:
    - manage-seed-demo-internals
  user_facing: true
  role: owner
  status: active
- id: manage-seed-demo-internals
  summary: Internal seed helpers invoked by seed_demo_data to populate companies, assets, trials, markers, materials, moa/roa, indications, conditions, and activity variety.
  routes: []
  rpcs:
    - _seed_demo_companies
    - _seed_demo_assets
    - _seed_demo_trials
    - _seed_demo_trial_notes
    - _seed_demo_markers
    - _seed_demo_events
    - _seed_demo_materials
    - _seed_demo_moa_roa
    - _seed_demo_indications
    - _seed_demo_therapeutic_areas
    - _seed_demo_asset_indications
    - _seed_demo_recent_activity
    - _seed_demo_activity_variety
    - _seed_demo_primary_intelligence
  tables:
    - companies
    - assets
    - trials
    - trial_notes
    - markers
    - events
    - materials
    - mechanisms_of_action
    - routes_of_administration
    - indications
    - conditions
    - condition_indication_map
    - asset_indications
    - trial_conditions
    - primary_intelligence
  related:
    - manage-seed-demo
  user_facing: false
  role: owner
  status: active
- id: observability-module-hint
  summary: Internal observability helper that classifies request paths into hinted module buckets for logging and audit-event attribution.
  routes: []
  rpcs:
    - _path_in_hinted_modules
  tables: []
  related: []
  user_facing: false
  role: super-admin
  status: active
- id: asset-indication-derivation
  summary: Trigger-driven derivation of each asset_indication's development_status from the trials linked to that asset and indication, kept in sync as trials and their conditions change. reset_asset_indication_status clears a manual override back to the auto-derived value.
  routes: []
  rpcs:
    - _auto_derive_asset_indication_status
    - _auto_derive_on_trial_condition_change
    - _recompute_asset_indication_status
    - _sync_asset_indications
    - reset_asset_indication_status
  tables:
    - asset_indications
    - trials
    - trial_conditions
    - condition_indication_map
  related:
    - manage-indications
  user_facing: false
  role: editor
  status: active
- id: trial-assets-sync
  summary: Triggers that keep the trial_assets many-to-many in sync with trials. Bootstrap seeds a trial_assets row from the scalar asset_id on trial insert; sync triggers mirror the is_primary member back into trials.asset_id and keep asset_indications aligned with the trial's full asset set.
  routes: []
  rpcs:
    - _trial_assets_bootstrap
    - _trial_assets_sync_indications
    - _trial_assets_sync_primary
  tables:
    - trial_assets
    - trials
    - asset_indications
  related:
    - manage-trials
    - source-import-commit
  user_facing: false
  role: editor
  status: active
```
