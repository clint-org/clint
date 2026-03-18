---
id: spec-2026-005
title: Trial Universe Model + ClinicalTrials.gov Sync
slug: trial-universe-model
status: approved
created: 2026-03-15
updated: 2026-03-15
---

# Trial Universe Model + ClinicalTrials.gov Sync

## Summary

Expand the trial data model to capture the full ClinicalTrials.gov universe across 6 dimensions (logistics, scientific design, clinical context, eligibility, timeline, regulatory). Add on-demand sync from the ClinicalTrials.gov API -- users enter an NCT ID, click "Sync from CT.gov", and all structured fields are populated automatically. User-created data (markers, notes, competitive analysis) sits as a manual overlay on top of the synced data, never overwritten by sync.

## Goals

- Model every ClinicalTrials.gov dimension so the dashboard can represent any trial attribute
- On-demand sync: user enters NCT ID, clicks sync, structured fields populate from CT.gov API
- Manual overlay: user-added markers, notes, phases, and competitive intel are never touched by sync
- Filterable dashboard: all new dimensions available as filter facets
- Backward compatible: existing trials keep working, new fields are optional

## Non-Goals

- Background/scheduled sync (future enhancement)
- ClinicalTrials.gov search/discovery (users must know the NCT ID)
- Mapping MeSH terms to a local ontology
- Multi-registry support (EudraCT, ISRCTN) -- CT.gov only for now
- Eligibility criteria free-text parsing

---

## Architecture Overview

### CT.gov API Integration

The ClinicalTrials.gov v2 API (`https://clinicaltrials.gov/api/v2/studies`) returns study data in JSON format. The sync flow:

```
User enters NCT ID on trial form
  └── Clicks "Sync from CT.gov"
        └── Frontend calls CT.gov API directly (CORS-friendly, no auth needed)
              └── Maps JSON response to our trial model fields
                    └── Saves to Supabase (INSERT or UPDATE)
                          └── User adds manual overlay (markers, notes, etc.)
```

The CT.gov API is public and CORS-enabled, so we call it directly from the browser -- no backend proxy needed.

### Data Separation: Synced vs. Manual

- **Synced fields**: All the structured CT.gov dimensions (status, phase, design, eligibility, dates, regulatory). These get overwritten on re-sync.
- **Manual overlay**: Markers, notes, trial_phases (our visual timeline phases), trial_notes, display_order, competitive annotations. These are never touched by sync.
- **Tracking**: `ctgov_last_synced_at` timestamp on the trial record indicates when data was last pulled.

---

## Data Model Changes

### Modified Table: `trials`

Add columns for all 6 CT.gov dimensions. All new columns are nullable (backward compatible).

```sql
-- 1. Logistics (Where & Who)
recruitment_status varchar(50)        -- Not yet recruiting, Recruiting, etc.
sponsor_type varchar(50)              -- Industry, NIH, Academic, etc.
lead_sponsor varchar(255)             -- Organization name
collaborators text[]                  -- Array of collaborator names
study_countries text[]                -- Array of country names
study_regions text[]                  -- Array of regions (North America, EU, etc.)

-- 2. Scientific Design (What & How)
study_type varchar(50)                -- Interventional, Observational, Expanded Access
phase varchar(20)                     -- Early Phase 1, Phase 1, Phase 2, Phase 3, Phase 4, N/A
design_allocation varchar(50)         -- Randomized, Non-Randomized, N/A
design_intervention_model varchar(50) -- Parallel, Crossover, Factorial, Single Group, Sequential
design_masking varchar(50)            -- None (Open Label), Single, Double, Triple, Quadruple
design_primary_purpose varchar(50)    -- Treatment, Prevention, Diagnostic, etc.
enrollment_type varchar(20)           -- Actual, Estimated

-- 3. Clinical Context (Target)
conditions text[]                     -- Array of condition/disease names
intervention_type varchar(50)         -- Drug, Biologic, Device, Procedure, etc.
intervention_name varchar(500)        -- Drug/device name
primary_outcome_measures text[]       -- Array of primary endpoint descriptions
secondary_outcome_measures text[]     -- Array of secondary endpoint descriptions
is_rare_disease boolean               -- Orphan drug designation

-- 4. Eligibility (Patient Demographics)
eligibility_sex varchar(10)           -- All, Female, Male
eligibility_min_age varchar(20)       -- e.g., "18 Years"
eligibility_max_age varchar(20)       -- e.g., "65 Years"
accepts_healthy_volunteers boolean
eligibility_criteria text             -- Full inclusion/exclusion criteria text
sampling_method varchar(50)           -- Probability Sample, Non-Probability Sample

-- 5. Timeline (Operational Milestones)
start_date date                       -- Actual or estimated study start
start_date_type varchar(10)           -- Actual, Estimated
primary_completion_date date          -- Final data for primary endpoint
primary_completion_date_type varchar(10)
study_completion_date date            -- Last participant last visit
study_completion_date_type varchar(10)
first_posted_date date                -- CT.gov first posted
results_first_posted_date date        -- Results first posted
last_update_posted_date date          -- Last CT.gov update

-- 6. Regulatory/Labeling (Commercial Impact)
has_dmc boolean                       -- Data Monitoring Committee
is_fda_regulated_drug boolean
is_fda_regulated_device boolean
fda_designations text[]               -- Fast Track, Breakthrough, Priority Review, etc.
submission_type varchar(20)           -- IND, NDA, BLA, PMA

-- Sync tracking
ctgov_last_synced_at timestamptz      -- When last synced from CT.gov
ctgov_raw_json jsonb                  -- Raw CT.gov response for reference
```

### No New Tables Required

All new fields go on the existing `trials` table as nullable columns. The data model stays flat and simple -- no normalization of conditions, countries, etc. into separate tables. Arrays (`text[]`) handle multi-value fields cleanly in PostgreSQL.

### Dashboard Function Update

`get_dashboard_data()` already returns all trial columns via `*`. The new columns will be included automatically. Filter parameters can be added incrementally.

---

## Frontend Design

### CT.gov Sync Service

New service: `CtgovSyncService`
- `fetchStudy(nctId: string): Promise<CtgovStudy>` -- calls CT.gov API v2
- `mapToTrialFields(study: CtgovStudy): Partial<Trial>` -- maps CT.gov JSON to our model
- Used in the trial form when user clicks "Sync from CT.gov"

### Trial Form Updates

The trial form expands to show the new fields in collapsible sections:
1. **Basic Info** (existing: name, identifier, product, therapeutic area, status)
2. **CT.gov Sync** (new: NCT ID + Sync button, last synced timestamp)
3. **Study Design** (new: study type, phase, allocation, masking, purpose)
4. **Eligibility** (new: sex, age limits, healthy volunteers, criteria)
5. **Timeline** (new: start date, completion dates, posted dates)
6. **Regulatory** (new: FDA designations, DMC, submission type)
7. **Geography** (new: countries, regions, sponsor)

Each section is collapsible and shows a summary when collapsed.

### Dashboard Filters

Add new filter dropdowns to the filter panel:
- Recruitment Status (multiselect)
- Study Type (multiselect)
- Phase (multiselect -- supplements the visual phase bars)
- FDA Designations (multiselect)

### Updated Models

The `Trial` TypeScript interface gets all the new fields as optional properties.

---

## Tasks

```yaml
tasks:
  - id: T1
    title: "Database migration - add CT.gov dimension columns to trials"
    description: |
      Create migration that adds all new columns to the trials table:
      - 6 dimension groups: logistics, scientific design, clinical context,
        eligibility, timeline, regulatory
      - All columns nullable (backward compatible)
      - ctgov_last_synced_at and ctgov_raw_json for sync tracking
      - Add indexes on frequently filtered columns: recruitment_status,
        study_type, phase, intervention_type
      - No changes to RLS policies (existing space-based policies cover new columns)
    files:
      - create: supabase/migrations/20260315200000_add_ctgov_dimensions.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T2
    title: "Update Trial TypeScript model and seed data"
    description: |
      1. Update Trial interface in trial.model.ts with all new optional fields
      2. Update seed_demo_data function to populate some of the new fields
         for existing demo trials (realistic CT.gov-like data)
      3. Update the get_dashboard_data function to include new filter params:
         p_recruitment_statuses text[], p_study_types text[], p_phases text[]
    files:
      - modify: src/client/src/app/core/models/trial.model.ts
      - create: supabase/migrations/20260315200100_update_dashboard_function_filters.sql
    dependencies: [T1]
    verification: "supabase db reset && cd src/client && npx ng build"

  - id: T3
    title: "Create CT.gov sync service"
    description: |
      Create CtgovSyncService that:
      1. Calls ClinicalTrials.gov API v2:
         GET https://clinicaltrials.gov/api/v2/studies/{nctId}
         with fields parameter to request specific modules
      2. Maps the JSON response to our Trial model fields:
         - protocolSection.identificationModule -> name, identifier
         - protocolSection.statusModule -> recruitment_status, start dates, completion dates
         - protocolSection.designModule -> study_type, phase, allocation, masking, purpose
         - protocolSection.eligibilityModule -> sex, age limits, criteria, healthy volunteers
         - protocolSection.armsInterventionsModule -> intervention_type, intervention_name
         - protocolSection.conditionsModule -> conditions
         - protocolSection.outcomesModule -> primary/secondary outcome measures
         - protocolSection.oversightModule -> has_dmc, fda_regulated_drug/device
         - protocolSection.sponsorCollaboratorsModule -> lead_sponsor, collaborators, sponsor_type
         - protocolSection.contactsLocationsModule -> countries, regions
      3. Returns mapped fields as Partial<Trial> ready for upsert
      4. Handles errors gracefully (invalid NCT ID, network errors, API changes)
    files:
      - create: src/client/src/app/core/services/ctgov-sync.service.ts
    dependencies: [T2]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T4
    title: "Update trial form with CT.gov sync + expanded fields"
    description: |
      1. Add "Sync from CT.gov" button to trial form:
         - Appears when identifier field has an NCT ID pattern (NCT\d{8})
         - Clicking it calls CtgovSyncService, populates all mapped fields
         - Shows success/error message and last sync timestamp
      2. Expand trial-form.component with collapsible sections:
         - Study Design: study_type (p-select), phase (p-select),
           design_allocation (p-select), design_masking (p-select),
           design_primary_purpose (p-select), enrollment_type
         - Eligibility: eligibility_sex (p-select), min/max age (pInputText),
           accepts_healthy_volunteers (p-checkbox), eligibility_criteria (pTextarea)
         - Timeline: start_date, primary_completion_date, study_completion_date
           (all with date type + Actual/Estimated select)
         - Regulatory: fda_designations (p-multiselect), has_dmc (p-checkbox),
           is_fda_regulated_drug/device (p-checkbox), submission_type (p-select)
         - Geography: study_countries (chips/text input), lead_sponsor (pInputText)
      3. Update trial-detail.component to display new fields in the Basic Info section
      4. All new fields optional -- form works without them
    files:
      - modify: src/client/src/app/features/manage/trials/trial-form.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-form.component.html
      - modify: src/client/src/app/features/manage/trials/trial-detail.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-detail.component.html
    dependencies: [T3]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T5
    title: "Update dashboard filters for new dimensions"
    description: |
      1. Add new filter dropdowns to filter-panel.component:
         - Recruitment Status (p-multiselect with predefined options)
         - Phase (p-multiselect: Early Phase 1, Phase 1-4, N/A)
         - Study Type (p-multiselect: Interventional, Observational, Expanded Access)
      2. Update DashboardFilters interface with new filter fields
      3. Update DashboardService to pass new filters to get_dashboard_data
      4. Filters should be collapsible or in a secondary row to avoid
         overcrowding the top bar
    files:
      - modify: src/client/src/app/core/models/dashboard.model.ts
      - modify: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.ts
      - modify: src/client/src/app/features/dashboard/filter-panel/filter-panel.component.html
      - modify: src/client/src/app/core/services/dashboard.service.ts
    dependencies: [T2]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T6
    title: "Update seed data with CT.gov-realistic fields"
    description: |
      Create migration that updates existing demo trials with realistic
      CT.gov dimension data:
      - VALOR-CKD: Interventional, Phase 3, Randomized, Double-Blind,
        Treatment, Drug, countries: [US, Germany, Japan], etc.
      - FIDELIO-DKD: Completed, Interventional, Phase 3, FDA Fast Track
      - SURMOUNT-1: Completed, Phase 3, Breakthrough Therapy
      - etc. for all seeded trials
      This makes the dashboard immediately useful with rich filter data.
    files:
      - create: supabase/migrations/20260315200200_enrich_demo_trials.sql
    dependencies: [T1]
    verification: "supabase db reset"

  - id: T7
    title: "Deploy and verify"
    description: |
      1. Push migrations to production: supabase db push
      2. Deploy to Netlify: netlify deploy --prod
      3. Verify:
         - Trial form shows new sections
         - Sync from CT.gov works with a real NCT ID
         - New filters appear on dashboard
         - Existing trials still render correctly
    files: []
    dependencies: [T4, T5, T6]
    verification: "supabase db push && netlify deploy --prod"
```

---

## Risks and Mitigations

| Risk | Mitigation |
|------|------------|
| CT.gov API rate limits | Client-side calls are per-user; unlikely to hit limits. Add retry with backoff. |
| CT.gov API response format changes | Store raw JSON in ctgov_raw_json; mapping can be updated without data loss |
| Large number of new columns overwhelms trial form | Collapsible sections, all fields optional, auto-populated via sync |
| Array columns (text[]) not supported by Supabase PostgREST filters | Use `@>` (contains) operator via `.contains()` in Supabase JS client |
| Too many dashboard filters clutter the UI | Secondary filter row that collapses; show count of active filters |

---

## Open Questions

None -- scope is clear: full CT.gov model + on-demand sync + manual overlay.
