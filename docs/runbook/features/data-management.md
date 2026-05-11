---
surface: Data Management
spec: docs/specs/clinical-trial-dashboard/spec.md
---

# Data Management

A full CRUD interface for managing all data within a space:

| Section | What You Manage |
|---|---|
| Companies | Pharma/biotech company records (name, logo_url, display_order, color) |
| Products | Drug/therapy products linked to a company (name, generic_name, logo_url) |
| Trials | Clinical studies with all metadata + CT.gov dimensions |
| Trial Phases | Phase records with phase_type, start_date, end_date, color, label |
| Trial Markers | Event markers with event_date, end_date, tooltip_text, is_projected |
| Trial Notes | Free-text annotations on trials |
| Marker Types | Custom marker types beyond the 10 system defaults (each assigned to a category) |
| Therapeutic Areas | Medical indication categories (name, abbreviation) |

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
  rpcs: []
  tables:
    - products
    - product_mechanisms_of_action
    - product_routes_of_administration
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
  summary: Edit event markers (event_date, end_date, tooltip_text, is_projected) attached to trials.
  routes:
    - /t/:tenantId/s/:spaceId/manage/markers/:id
  rpcs: []
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
- id: manage-therapeutic-areas
  summary: Manage medical indication categories (name, abbreviation).
  routes:
    - /t/:tenantId/s/:spaceId/manage/therapeutic-areas
  rpcs: []
  tables:
    - therapeutic_areas
  related: []
  user_facing: true
  role: editor
  status: active
- id: manage-mechanisms-of-action
  summary: Manage mechanism-of-action taxonomy attached to assets.
  routes:
    - /t/:tenantId/s/:spaceId/manage/mechanisms-of-action
  rpcs: []
  tables:
    - mechanisms_of_action
    - product_mechanisms_of_action
  related:
    - manage-assets
  user_facing: true
  role: editor
  status: active
- id: manage-routes-of-administration
  summary: Manage route-of-administration taxonomy attached to assets.
  routes:
    - /t/:tenantId/s/:spaceId/manage/routes-of-administration
  rpcs: []
  tables:
    - routes_of_administration
    - product_routes_of_administration
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
  tables:
    - companies
    - products
    - trials
    - markers
    - marker_types
    - therapeutic_areas
  related:
    - manage-seed-demo-internals
  user_facing: true
  role: owner
  status: active
- id: manage-seed-demo-internals
  summary: Internal seed helpers invoked by seed_demo_data to populate companies, products, trials, markers, materials, moa/roa, therapeutic areas, and activity variety.
  routes: []
  rpcs:
    - _seed_demo_companies
    - _seed_demo_products
    - _seed_demo_trials
    - _seed_demo_trial_notes
    - _seed_demo_markers
    - _seed_demo_events
    - _seed_demo_materials
    - _seed_demo_moa_roa
    - _seed_demo_therapeutic_areas
    - _seed_demo_recent_activity
    - _seed_demo_activity_variety
    - _seed_demo_primary_intelligence
  tables:
    - companies
    - products
    - trials
    - trial_notes
    - markers
    - events
    - materials
    - mechanisms_of_action
    - routes_of_administration
    - therapeutic_areas
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
```
