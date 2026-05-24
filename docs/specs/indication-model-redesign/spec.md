---
id: spec-2026-indication-model
title: Indication Model Redesign
slug: indication-model-redesign
status: completed
created: 2026-05-24
updated: 2026-05-24
---

# Indication Model Redesign

## Summary

Restructure the data model so that development status (PRECLIN through LAUNCHED) lives at the asset + indication level, not on individual trials. Rename the `products` table to `assets`. Replace the `therapeutic_areas` concept with a two-layer model: analyst-created **indications** (the business/regulatory unit) and CT.gov-sourced **conditions** (standardized medical terms with MeSH IDs). Trials link to conditions (many-to-many, matching CT.gov). Conditions map to indications (analyst-assigned). The timeline gains an indication grouping level and shows real trial phases on phase bars, with approval and launch as point-in-time markers.

Bullseye and positioning chart updates are deferred to a follow-up spec.

## Motivation

### Trial phase_type conflates two concepts

The current model stores `phase_type` on trials with values like APPROVED and LAUNCHED. But a trial doesn't get approved or launched. A *drug in an indication* does. DAPA-HF is a Phase 3 trial. Farxiga is LAUNCHED in Heart Failure. These are different facts about different entities.

### Development status is per-indication, not per-asset

Farxiga is LAUNCHED for HFrEF (May 2020), APPROVED for CKD (Apr 2021), and LAUNCHED for expanded HF (Apr 2023). Wegovy is LAUNCHED for adult obesity (Jun 2021), APPROVED for adolescent obesity (Mar 2023), and APPROVED for CV risk reduction (Mar 2024). A single status on the asset flattens this into one value.

### Therapeutic area is not indication

"Cardiovascular" is a therapeutic area. "Heart Failure" is an indication. "HFrEF" is a more specific indication. The current `therapeutic_areas` table is used at the indication level (entries like "Heart Failure", "CKD", "T2D") but the name is misleading and there's no hierarchy.

### Conditions come from CT.gov

CT.gov reports conditions per trial (e.g., "Heart Failure With Reduced Ejection Fraction"). These are medical terms, not business groupings. The analyst maps them to indications for competitive analysis. MeSH IDs provide stable deduplication across trials that describe the same condition with different wording.

## Goals

- Every trial's `phase_type` reflects its actual clinical phase, never a commercial milestone.
- Development status is explicit at the asset + indication level, with hybrid sourcing (auto-derived from trial phases, analyst-overridable, resettable).
- CT.gov conditions are first-class entities matched by MeSH ID.
- Indications are analyst-created business groupings with optional hierarchy (parent_id).
- Timeline groups by company > asset > indication > trial, with development status badges on indication rows.
- Phase bars show real trial phases. Approval/Launch appear as markers.
- `products` table renamed to `assets` throughout (DB, RPCs, frontend already uses Asset vocabulary).

## Non-Goals

- Automated condition-to-indication mapping (v1 is analyst-assigned; MeSH hierarchy can inform auto-suggestions later).
- Sub-indication hierarchy beyond one level of parent_id on indications.
- Multi-segment phase bars per trial row (each trial still gets one phase bar for its current phase).
- Molecule-level entity above assets (Ozempic, Wegovy, Rybelsus stay as separate assets).
- Bullseye/positioning frontend component changes (the chart components receive the same data shape; only RPC queries and scoping UI change).

## Design

### Entity Relationship Model

```
companies
  └── assets (renamed from products)
       ├── asset_mechanisms_of_action (renamed from product_mechanisms_of_action)
       ├── asset_routes_of_administration (renamed from product_routes_of_administration)
       └── asset_indications (NEW: the "program", carries development_status)
            └── indications (NEW: analyst-created, replaces therapeutic_areas)
                 └── condition_indication_map (NEW: analyst maps conditions to indications)
                      └── conditions (NEW: CT.gov-sourced, matched by MeSH ID)
                           └── trial_conditions (NEW: many-to-many, replaces trials.therapeutic_area_id)
                                └── trials (phase_type narrowed to clinical phases only)
```

### New Tables

**indications** (analyst-created, the business/regulatory grouping)

```sql
create table public.indications (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid references public.indications(id) on delete set null,
  space_id         uuid not null references public.spaces(id) on delete cascade,
  name             varchar(255) not null,
  abbreviation     varchar(50),
  display_order    int not null default 0,
  created_by       uuid not null references auth.users(id),
  updated_by       uuid references auth.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (space_id, name)
);
```

**conditions** (CT.gov-sourced medical terms)

```sql
create table public.conditions (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references public.spaces(id) on delete cascade,
  name             varchar(500) not null,
  mesh_id          varchar(20),
  source           text not null default 'analyst' check (source in ('ctgov', 'analyst')),
  created_at       timestamptz default now(),
  unique (space_id, mesh_id) where mesh_id is not null,
  unique (space_id, name)
);
```

The partial unique index on `(space_id, mesh_id) WHERE mesh_id IS NOT NULL` ensures MeSH-based dedup within a space while allowing multiple conditions without MeSH IDs.

**condition_indication_map** (analyst assigns conditions to indications)

```sql
create table public.condition_indication_map (
  condition_id     uuid not null references public.conditions(id) on delete cascade,
  indication_id    uuid not null references public.indications(id) on delete cascade,
  primary key (condition_id, indication_id)
);
```

**trial_conditions** (from CT.gov, many-to-many)

```sql
create table public.trial_conditions (
  trial_id         uuid not null references public.trials(id) on delete cascade,
  condition_id     uuid not null references public.conditions(id) on delete cascade,
  source           text not null default 'analyst' check (source in ('ctgov', 'analyst')),
  primary key (trial_id, condition_id)
);
```

**asset_indications** (the "program", carries development_status)

```sql
create table public.asset_indications (
  id                         uuid primary key default gen_random_uuid(),
  asset_id                   uuid not null references public.assets(id) on delete cascade,
  indication_id              uuid not null references public.indications(id) on delete cascade,
  space_id                   uuid not null references public.spaces(id) on delete cascade,
  development_status         varchar(20) check (development_status is null
                               or development_status in ('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED')),
  development_status_source  text not null default 'auto' check (development_status_source in ('auto', 'analyst')),
  created_by                 uuid not null references auth.users(id),
  updated_by                 uuid references auth.users(id),
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now(),
  unique (asset_id, indication_id)
);
```

### Table Rename: products -> assets

Rename `public.products` to `public.assets`. Rename all FK columns:
- `trials.product_id` -> `trials.asset_id`
- `product_mechanisms_of_action` -> `asset_mechanisms_of_action` (table + columns)
- `product_routes_of_administration` -> `asset_routes_of_administration` (table + columns)
- `events.product_id` -> `events.asset_id`
- All RPC functions that reference `products` or `product_id`
- All RLS policies on the renamed tables
- All indexes

### Trial Changes

**Remove APPROVED/LAUNCHED from phase_type constraint:**

```sql
-- Drop old constraint, add new
alter table public.trials drop constraint trials_phase_type_check;
alter table public.trials add constraint trials_phase_type_check
  check (phase_type is null or phase_type in
    ('PRECLIN', 'P1', 'P2', 'P3', 'P4', 'P1_2', 'P2_3', 'OBS'));
```

**Remove therapeutic_area_id column** (replaced by trial_conditions many-to-many):

After migrating data to trial_conditions, drop `trials.therapeutic_area_id`.

**Data migration for existing trials:**

1. For each trial with `phase_type IN ('APPROVED', 'LAUNCHED')`, set phase_type to 'P3' (the actual clinical phase for all currently seeded pivotal trials).
2. Backfill `asset_indications.development_status` from the old trial phase_type values.
3. Migrate `trials.therapeutic_area_id` to `trial_conditions` rows.

### Auto-Derive Trigger

A trigger on `trials` (AFTER INSERT/UPDATE of phase_type/DELETE) recomputes `asset_indications.development_status` for affected asset+indication pairs:

1. Identify affected asset_id from the trial.
2. Identify affected indication_ids by tracing: trial -> trial_conditions -> conditions -> condition_indication_map -> indications.
3. For each asset_indication where `development_status_source = 'auto'`:
   - Compute MAX(rank(phase_type)) across all trials for that asset that link to conditions under that indication.
   - Rank: PRECLIN=0, P1=1, P2=2, P3=3, P4=4. Auto-derive caps at P4.
   - APPROVED (rank 5) and LAUNCHED (rank 6) require analyst override.
4. Update asset_indications.development_status.

A `reset_asset_indication_status(p_asset_indication_id uuid)` RPC sets source back to 'auto' and re-derives.

### Timeline Visualization Changes

**New grouping level:** The `FlattenedTrial` interface gains indication fields:

```typescript
export interface FlattenedTrial {
  companyName: string;
  companyId: string;
  companyLogoUrl: string | null;
  assetName: string;
  assetId: string;
  assetLogoUrl: string | null;
  indicationName: string;          // NEW
  indicationId: string;            // NEW
  indicationStatus: string | null; // NEW: development_status from asset_indications
  isFirstInCompany: boolean;
  isFirstInAsset: boolean;
  isFirstInIndication: boolean;    // NEW
  isLastInCompany: boolean;
  trial: Trial;
}
```

**Flattening logic changes** from `companies > assets > trials` to `companies > assets > indications > trials`. Trials are grouped under their indication (derived via trial_conditions -> condition_indication_map -> indications).

**Grid column changes:**
- New "Indication" column between Asset and Trial.
- Indication name shows on first row of each indication group (same merge pattern as company/asset).
- Development status badge (compact chip: "P3", "APPROVED", "LAUNCHED") renders next to indication name in the appropriate phase color.
- MOA and ROA columns become hidden by default (toggleable via column settings). They're asset-level properties, less important for daily CI reading than indication.

**Phase bar changes:**
- Phase bars render real trial phases (P1-P4, PRECLIN, OBS). Never APPROVED or LAUNCHED.
- Color palette narrows: no more APPROVED violet or LAUNCHED teal bars. P3 teal is the hero phase bar color.

**Marker changes:**
- Approval and Launch markers (already existing marker types) appear at their correct point in time on the timeline.
- No new marker types needed.

### Dashboard RPC Changes

`get_dashboard_data` needs to:
1. Return trials grouped by asset and indication (not just asset).
2. Include `development_status` from `asset_indications` in the response.
3. Join through `trial_conditions` -> `condition_indication_map` to determine which indication each trial belongs to.
4. Reference `public.assets` instead of `public.products`.

### Bullseye RPC Changes

All bullseye RPCs (`get_bullseye_data`, `get_bullseye_by_company`, `get_bullseye_by_moa`, `get_bullseye_by_roa`) currently:
- Take `p_therapeutic_area_id` as the scoping parameter
- Compute `MAX(CASE t.phase_type WHEN 'LAUNCHED' THEN 6 ...)` per product
- Reference `public.products`

After this spec:
- Scoping parameter becomes `p_indication_id` (references `indications.id`)
- Ring position reads `asset_indications.development_status` directly (no MAX rollup)
- For parent indications (with children), the RPC finds all child indication IDs and takes MAX(development_status) across matching `asset_indications` rows for each asset
- References `public.assets` instead of `public.products`
- Trial-level phase (returned in the trial list within each asset) stays as `trials.phase_type`
- Filters: `WHERE ai.development_status IS NOT NULL` (replaces the old `t.phase_type IS NOT NULL AND <> 'OBS'`)

The response shape (`BullseyeData` with spokes, products, ring_order) stays the same. The frontend chart components don't need changes.

### Positioning RPC Changes

`get_positioning_data` currently uses a `phase_rank_map` CTE and rolls up `MAX(trial.phase_type)` per product. After this spec:
- Reads `asset_indications.development_status` directly
- Scoping changes from therapeutic area to indication (same as bullseye)
- Bubble `highest_phase` and `highest_phase_rank` come from `asset_indications`
- Response shape (`PositioningData` with bubbles) stays the same

### Landscape Index RPC Changes

All four landscape index RPCs (`get_landscape_index`, `get_landscape_index_by_company`, `get_landscape_index_by_moa`, `get_landscape_index_by_roa`) switch from listing therapeutic areas to listing indications:
- Return indication id, name, abbreviation, parent_id instead of therapeutic area fields
- `highest_phase_present` reads from MAX(`asset_indications.development_status`) per indication
- `products_missing_phase` becomes `assets_missing_status`: count of assets with NULL development_status
- Support parent indications: a parent indication's stats aggregate across all child indications

### Frontend Model Changes

**Renamed/updated models:**
- `asset.model.ts`: Interface stays `Asset`. Add `indications?: AssetIndication[]` where `AssetIndication` includes indication name, id, development_status, and nested trials.
- `trial.model.ts`: Remove `therapeutic_area_id`. Add `conditions?: Condition[]`.
- New `indication.model.ts`: `Indication` interface (id, name, abbreviation, parent_id).
- New `condition.model.ts`: `Condition` interface (id, name, mesh_id, source).

**Updated services:**
- `asset.service.ts`: Rename internal references from product to asset. Add indication-related methods.
- `trial.service.ts`: Remove therapeutic_area_id handling. Add condition linking.
- New `indication.service.ts`: CRUD for indications.
- New `condition.service.ts`: CRUD for conditions, condition-indication mapping.
- `dashboard.service.ts`: Map new RPC response shape with indication grouping.

**Updated components:**
- `dashboard-grid.component`: New flattening logic, indication column, indication grouping.
- `phase-colors.ts`: Remove APPROVED and LAUNCHED from `PHASE_DESCRIPTORS`.
- `trial-create-dialog.component`: Remove APPROVED/LAUNCHED from phase options. Replace therapeutic area dropdown with condition selection.
- `trial-edit-dialog.component`: Same changes as create dialog.
- `asset-form.component`: Add indication management (list of asset_indications with development_status override).
- `phases-help.component`: Update to explain trial phases vs development status.

### Seed Data Changes

Rewrite `_seed_demo_trials` and related seed functions:
1. Create demo indications: Heart Failure, CKD, T2D, Obesity, ATTR-CM.
2. Create demo conditions with MeSH IDs where known.
3. Map conditions to indications.
4. Set all trial phase_types to real clinical phases (P3 for pivotal completed trials, P2 for phase 2 trials, etc.).
5. Create asset_indications with appropriate development_status values.
6. Link trials to conditions via trial_conditions.
7. Remove therapeutic_areas seed data.

### Migration Strategy

The rename and restructure happen in a sequence of migrations that maintain FK integrity:

1. Create new tables (indications, conditions, condition_indication_map, trial_conditions, asset_indications).
2. Migrate therapeutic_areas data to indications. Migrate trials.therapeutic_area_id to trial_conditions (creating conditions as needed).
3. Rename products to assets (ALTER TABLE RENAME). Rename FK columns. Rename junction tables.
4. Backfill asset_indications from trial data.
5. Update trial phase_type constraint (drop APPROVED/LAUNCHED).
6. Migrate trial phase_type data (APPROVED/LAUNCHED -> P3).
7. Drop trials.therapeutic_area_id column.
8. Drop therapeutic_areas table.
9. Update all RPCs to use new table/column names.
10. Update seed functions.

## Tasks

```yaml
tasks:

  # ============================================================
  # Database migrations (sequential)
  # ============================================================

  - id: T1
    title: "Create indications, conditions, and junction tables"
    description: |
      Create five new tables:
        1. public.indications (id, parent_id, space_id, name, abbreviation,
           display_order, created_by, updated_by, created_at, updated_at)
           with unique(space_id, name) and self-referencing parent_id FK.
        2. public.conditions (id, space_id, name, mesh_id, source, created_at)
           with partial unique on (space_id, mesh_id) WHERE mesh_id IS NOT NULL
           and unique(space_id, name).
        3. public.condition_indication_map (condition_id, indication_id) PK both.
        4. public.trial_conditions (trial_id, condition_id, source) PK both.
        5. public.asset_indications (id, asset_id, indication_id, space_id,
           development_status, development_status_source, created_by,
           updated_by, created_at, updated_at) with unique(asset_id, indication_id).

      Note: asset_id FK initially references public.products(id) since the
      rename hasn't happened yet. The rename migration (T3) will update it.

      Add RLS policies on all five tables matching the space-membership
      pattern (has_space_access for SELECT, has_space_access with
      owner/editor for INSERT/UPDATE/DELETE).

      Add indexes: idx_indications_space_id, idx_conditions_space_id,
      idx_trial_conditions_trial_id, idx_trial_conditions_condition_id,
      idx_asset_indications_space_id, idx_asset_indications_indication_id.

      Inline smoke test:
        - Insert indication with parent_id. Assert FK works.
        - Insert condition with mesh_id. Insert duplicate mesh_id in same
          space. Assert unique violation. Insert same mesh_id in different
          space. Assert success.
        - Insert condition without mesh_id. Insert another without mesh_id.
          Assert both succeed (partial unique allows multiple nulls).
        - Insert asset_indication with development_status = 'P3'. Assert success.
        - Insert asset_indication with development_status = 'INVALID'. Assert
          CHECK violation.
    files:
      - create: supabase/migrations/<ts>_create_indication_condition_tables.sql
    dependencies: []
    verification: "supabase db reset"

  - id: T2
    title: "Migrate therapeutic_areas to indications and trial_conditions"
    description: |
      1. Copy all therapeutic_areas rows into indications (preserving UUIDs
         so existing references work during transition).
      2. For each therapeutic_area, create a matching condition with the same
         name (since current TAs are really indication-level concepts, each
         gets one condition that maps 1:1).
      3. Insert condition_indication_map rows linking each condition to its
         corresponding indication.
      4. For each trial with therapeutic_area_id, insert a trial_conditions
         row linking the trial to the corresponding condition.
      5. For each distinct (product_id, therapeutic_area_id) pair in trials,
         insert an asset_indications row with development_status computed
         as MAX(phase_type rank) and development_status_source = 'analyst'
         for products that had APPROVED/LAUNCHED trials, 'auto' otherwise.

      Do NOT drop therapeutic_areas or trials.therapeutic_area_id yet (T7).

      Inline smoke test:
        - Assert indications count = therapeutic_areas count.
        - Assert every trial has at least one trial_conditions row.
        - Assert every distinct (product, TA) pair has an asset_indications row.
        - Assert asset_indications.development_status matches expected values
          for known products (e.g., Farxiga should have entries for HF, CKD).
    files:
      - create: supabase/migrations/<ts>_migrate_ta_to_indications.sql
    dependencies: [T1]
    verification: "supabase db reset"

  - id: T3
    title: "Rename products table to assets"
    description: |
      1. ALTER TABLE public.products RENAME TO assets.
      2. Rename FK columns across all referencing tables:
         - trials.product_id -> trials.asset_id
         - events.product_id -> events.asset_id (if exists)
         - asset_indications.asset_id already correct (created in T1 with
           the forward-looking name, but FK target needs updating)
      3. Rename junction tables:
         - product_mechanisms_of_action -> asset_mechanisms_of_action
         - product_routes_of_administration -> asset_routes_of_administration
         (rename their product_id columns to asset_id)
      4. Rename all indexes (idx_products_* -> idx_assets_*).
      5. Drop and recreate all RLS policies on renamed tables with updated
         names and column references.
      6. Update the audit-column triggers to reference new table/column names.

      Inline smoke test:
        - Assert public.assets exists with same row count as old products.
        - Assert public.products does not exist.
        - Assert trials.asset_id is populated (no nulls where product_id was not null).
        - Assert asset_mechanisms_of_action and asset_routes_of_administration exist.
        - Assert all RLS policies are in place (select from assets as
          authenticated user with space access).
    files:
      - create: supabase/migrations/<ts>_rename_products_to_assets.sql
    dependencies: [T2]
    verification: "supabase db reset"

  - id: T4
    title: "Update trial phase_type constraint and migrate data"
    description: |
      1. UPDATE trials SET phase_type = 'P3' WHERE phase_type IN ('APPROVED', 'LAUNCHED').
         All currently seeded APPROVED/LAUNCHED trials are pivotal P3 trials.
      2. DROP constraint trials_phase_type_check.
      3. ADD new constraint:
         CHECK (phase_type IS NULL OR phase_type IN
           ('PRECLIN','P1','P2','P3','P4','P1_2','P2_3','OBS'))
      4. Update the ctgov guard trigger (_guard_ctgov_locked_phase_fields)
         if it references APPROVED/LAUNCHED in any validation.

      Inline smoke test:
        - Assert zero trials with phase_type IN ('APPROVED', 'LAUNCHED').
        - Insert trial with phase_type = 'P3'. Assert success.
        - Insert trial with phase_type = 'APPROVED'. Assert CHECK violation.
        - Insert trial with phase_type = 'LAUNCHED'. Assert CHECK violation.
        - Assert existing P3 trials unchanged.
    files:
      - create: supabase/migrations/<ts>_narrow_trial_phase_constraint.sql
    dependencies: [T2]
    verification: "supabase db reset"

  - id: T5
    title: "Auto-derive trigger for asset_indications.development_status"
    description: |
      Create trigger function _auto_derive_asset_indication_status() that
      fires AFTER INSERT, UPDATE (of phase_type, asset_id), DELETE on
      public.trials.

      Logic:
        1. Identify affected asset_id (NEW.asset_id or OLD.asset_id).
        2. For each asset_indication row for that asset where
           development_status_source = 'auto':
           a. Find all trials for that asset.
           b. Trace trial -> trial_conditions -> conditions ->
              condition_indication_map -> to check if trial's conditions
              map to this indication.
           c. Compute MAX(rank(phase_type)) for matching trials.
              Rank: PRECLIN=0, P1=1, P2=2, P3=3, P4=4.
           d. Update development_status. NULL if no matching trials.
        3. If development_status_source = 'analyst', skip (respect override).

      Also create:
        - reset_asset_indication_status(p_id uuid) RPC: sets source to 'auto'
          and re-derives. Gated by has_space_access with editor role.
        - A trigger on trial_conditions (AFTER INSERT/DELETE) that also
          fires re-derivation, since linking a trial to a new condition
          can change which indication it maps to.

      Inline smoke test:
        - Create asset, indication, condition, condition_indication_map.
        - Create asset_indication with source='auto'. Assert status IS NULL.
        - Insert trial with phase_type='P2', link via trial_conditions.
          Assert asset_indication.development_status = 'P2'.
        - Insert trial with phase_type='P3'. Assert status bumps to 'P3'.
        - Delete P3 trial. Assert status falls to 'P2'.
        - Set source='analyst', status='LAUNCHED'. Insert P1 trial.
          Assert status stays 'LAUNCHED'.
        - Call reset_asset_indication_status. Assert source='auto', status='P2'.
    files:
      - create: supabase/migrations/<ts>_asset_indication_auto_derive.sql
    dependencies: [T3, T4]
    verification: "supabase db reset"

  - id: T6a
    title: "Update dashboard, entity, and CRUD RPCs for rename and new model"
    description: |
      Recreate every non-landscape RPC function that references `products`
      or `product_id` to use `assets` / `asset_id`. Also update references
      to `therapeutic_areas` / `therapeutic_area_id` to use the new
      indications/conditions model.

      Affected RPCs (non-exhaustive, grep for full list):
        - get_dashboard_data: reference assets, join through
          trial_conditions/condition_indication_map/indications to group
          trials by indication. Include asset_indications.development_status
          in the response per indication group.
        - get_entity_page_data / get_entity_detail: update table refs.
        - upsert_*, delete_*, list_* RPCs for assets (renamed from products).
        - Event RPCs that reference product_id.
        - Intelligence RPCs that reference product_id.
        - Palette/command-palette RPCs.
        - Change-feed RPCs.
        - Cascade preview/delete RPCs.

      Consider splitting into sub-migrations if the function count
      exceeds ~15 in a single file.
    files:
      - create: supabase/migrations/<ts>_rpcs_dashboard_entity_crud.sql
    dependencies: [T5]
    verification: "supabase db reset"

  - id: T6b
    title: "Update bullseye and landscape index RPCs"
    description: |
      Rewrite all bullseye and landscape index RPCs to use the new model:

      Bullseye RPCs (4 functions):
        - get_bullseye_data: scoping param changes from
          p_therapeutic_area_id to p_indication_id. Replace product_rollup
          CTE (MAX(CASE t.phase_type ...)) with direct read of
          asset_indications.development_status. For parent indications,
          collect child indication IDs and take MAX(development_status)
          across matching asset_indications rows per asset. Reference
          public.assets instead of public.products.
        - get_bullseye_by_company: same pattern.
        - get_bullseye_by_moa: same pattern.
        - get_bullseye_by_roa: same pattern.

      Landscape index RPCs (4 functions):
        - get_landscape_index: list indications instead of therapeutic
          areas. highest_phase_present from MAX(asset_indications.
          development_status). Support parent indications aggregating
          child stats.
        - get_landscape_index_by_company: same pattern.
        - get_landscape_index_by_moa: same pattern.
        - get_landscape_index_by_roa: same pattern.

      Response shapes stay the same (BullseyeData, LandscapeIndexEntry).
      Frontend chart components need no changes.

      Inline smoke test:
        - Call get_bullseye_data with a demo indication_id.
          Assert returned assets have correct highest_phase from
          asset_indications.development_status.
        - Assert an asset with development_status='LAUNCHED' appears
          at rank 6, not rank 3 (P3).
        - Call get_landscape_index. Assert it returns indications
          (not therapeutic areas) with correct highest_phase_present.
    files:
      - create: supabase/migrations/<ts>_rpcs_bullseye_landscape_index.sql
    dependencies: [T5]
    verification: "supabase db reset"

  - id: T6c
    title: "Update positioning RPC"
    description: |
      Rewrite get_positioning_data to use the new model:
        - Replace phase_rank_map CTE and trial-phase-based rollup with
          direct read of asset_indications.development_status.
        - Scoping changes from therapeutic area to indication.
        - Bubble highest_phase and highest_phase_rank come from
          asset_indications, not trial aggregation.
        - Reference public.assets instead of public.products.
        - Support parent indication scoping (aggregate child indications).

      Response shape (PositioningData with bubbles) stays the same.

      Inline smoke test:
        - Call get_positioning_data with a demo indication_id.
          Assert bubbles have correct highest_phase from
          asset_indications.development_status.
    files:
      - create: supabase/migrations/<ts>_rpcs_positioning.sql
    dependencies: [T5]
    verification: "supabase db reset"

  - id: T7
    title: "Drop therapeutic_areas table and trials.therapeutic_area_id"
    description: |
      Now that all data is migrated and all RPCs updated:
      1. DROP column trials.therapeutic_area_id.
      2. DROP TABLE public.therapeutic_areas.
      3. Drop any orphaned indexes or RLS policies on therapeutic_areas.

      Inline smoke test:
        - Assert therapeutic_areas does not exist.
        - Assert trials has no therapeutic_area_id column.
        - Assert all RPCs still execute without error (run seed_demo_data
          as a comprehensive integration test).
    files:
      - create: supabase/migrations/<ts>_drop_therapeutic_areas.sql
    dependencies: [T6a, T6b, T6c]
    verification: "supabase db reset"

  - id: T8
    title: "Rewrite seed_demo_data for new model"
    description: |
      Rewrite all _seed_demo_* helper functions for the new model:

      1. _seed_demo_indications: Create indications (Heart Failure, CKD,
         T2D, Obesity, ATTR-CM) with appropriate abbreviations.
      2. _seed_demo_conditions: Create conditions with MeSH IDs:
         - Heart Failure (D006333)
         - Heart Failure With Reduced Ejection Fraction
         - Heart Failure With Preserved Ejection Fraction
         - Chronic Kidney Disease (D051436)
         - Type 2 Diabetes Mellitus (D003924)
         - Obesity (D009765)
         - Transthyretin Amyloid Cardiomyopathy
         Map conditions to indications via condition_indication_map.
      3. _seed_demo_trials: Set all trial phase_types to real clinical
         phases. Link trials to conditions via trial_conditions.
         Key corrections:
         - DAPA-HF: P3 (was LAUNCHED), conditions: HF, HFrEF
         - DELIVER: P3 (was APPROVED), conditions: HF, HFpEF
         - DAPA-CKD: P3 (was APPROVED), conditions: CKD
         - SURMOUNT-1: P3 (was LAUNCHED), conditions: Obesity
         - STEP 1: P3 (was LAUNCHED), conditions: Obesity
         - SELECT: P3 (was APPROVED), conditions: Obesity, CV Diseases
         - All preclinical trials: PRECLIN (unchanged)
      4. _seed_demo_asset_indications: Create asset_indication rows with
         correct development_status:
         - Farxiga + HF → LAUNCHED (analyst)
         - Farxiga + CKD → APPROVED (analyst)
         - Jardiance + HF → LAUNCHED (analyst)
         - Zepbound + Obesity → LAUNCHED (analyst)
         - Wegovy + Obesity → LAUNCHED (analyst)
         - Aficamten + HF → P3 (auto)
         - etc.
      5. Update seed_demo_data orchestrator to call new helpers in order.
      6. Update the smoke test fixture to validate the new model.
    files:
      - create: supabase/migrations/<ts>_seed_demo_indication_model.sql
    dependencies: [T7]
    verification: "supabase db reset"

  # ============================================================
  # Frontend changes
  # ============================================================

  - id: T9
    title: "Update core models and phase constants"
    description: |
      1. phase-colors.ts: Remove APPROVED and LAUNCHED from PHASE_DESCRIPTORS.
         Add PRODUCT_STATUS_OPTIONS for the asset indication edit UI.
         Keep PHASE_COLORS for trial phases only (PRECLIN through OBS).
         Add DEVELOPMENT_STATUS_COLORS covering all 7 values (for badges).
      2. New indication.model.ts: Indication interface.
      3. New condition.model.ts: Condition interface.
      4. asset.model.ts: Add indications field (AssetIndication[] with
         indication details and development_status).
      5. trial.model.ts: Remove therapeutic_area_id and therapeutic_areas.
         Add conditions field. Rename product_id references to asset_id.
      6. company.model.ts: Rename products field to assets.
      7. landscape.model.ts: RingPhase unchanged (describes product lifecycle).
      8. change-event-summary.ts: Update phaseColorFor() to handle
         APPROVED/LAUNCHED from historical events via DEVELOPMENT_STATUS_COLORS.
    files:
      - modify: src/client/src/app/core/models/phase-colors.ts
      - modify: src/client/src/app/core/models/asset.model.ts
      - modify: src/client/src/app/core/models/trial.model.ts
      - modify: src/client/src/app/core/models/company.model.ts
      - create: src/client/src/app/core/models/indication.model.ts
      - create: src/client/src/app/core/models/condition.model.ts
      - modify: src/client/src/app/shared/utils/change-event-summary.ts
    dependencies: [T6a]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T10
    title: "Update services for renamed tables and new model"
    description: |
      1. asset.service.ts: Update Supabase table references from 'products'
         to 'assets'. Add methods for managing asset_indications
         (list, create, update development_status, reset to auto).
      2. trial.service.ts: Remove therapeutic_area_id from queries. Add
         condition linking (manage trial_conditions).
      3. dashboard.service.ts: Map new RPC response shape. Group trials
         by indication within each asset. Include development_status.
      4. New indication.service.ts: CRUD for indications within a space.
      5. New condition.service.ts: CRUD for conditions, manage
         condition_indication_map.
      6. Rename any internal 'product' references to 'asset' in service
         method names and variables.
    files:
      - modify: src/client/src/app/core/services/asset.service.ts
      - modify: src/client/src/app/core/services/trial.service.ts
      - modify: src/client/src/app/core/services/dashboard.service.ts
      - create: src/client/src/app/core/services/indication.service.ts
      - create: src/client/src/app/core/services/condition.service.ts
    dependencies: [T9]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T11
    title: "Redesign timeline grid with indication grouping"
    description: |
      Update dashboard-grid.component to add the indication grouping level:

      1. Update FlattenedTrial interface with indication fields
         (indicationName, indicationId, indicationStatus, isFirstInIndication).
      2. Rewrite flattenedTrials computed to iterate:
         companies > assets > indications > trials.
      3. Add Indication column in the grid between Asset and Trial:
         - Shows indication name on first row of each indication group.
         - Compact development_status badge (chip with phase color).
         - Column width ~w-28 to match asset column.
      4. MOA and ROA columns default to hidden (showMoaColumn/showRoaColumn
         initial value changes to false). Still toggleable via column settings.
      5. Update the grid header to include the Indication column label.
      6. Update row border/grouping logic to handle the new indication
         boundary (similar to isFirstInCompany/isFirstInAsset patterns).
      7. Phase bars continue rendering from trial.phase_type (now always
         a real clinical phase).
    files:
      - modify: src/client/src/app/features/dashboard/grid/dashboard-grid.component.ts
      - modify: src/client/src/app/features/dashboard/grid/dashboard-grid.component.html
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T12
    title: "Update trial create/edit dialogs"
    description: |
      1. trial-create-dialog.component.ts: Remove APPROVED and LAUNCHED
         from PHASE_OPTIONS. Replace therapeutic area dropdown with
         condition multi-select (trial_conditions is many-to-many).
      2. trial-edit-dialog.component.ts: Same changes. Respect ctgov
         locking on phase fields.
      3. Update both dialog templates for the new condition field.
    files:
      - modify: src/client/src/app/features/manage/trials/trial-create-dialog.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-create-dialog.component.html
      - modify: src/client/src/app/features/manage/trials/trial-edit-dialog.component.ts
      - modify: src/client/src/app/features/manage/trials/trial-edit-dialog.component.html
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T13
    title: "Update asset form with indication management"
    description: |
      Update asset-form.component to manage asset_indications:

      1. Add a section showing the asset's indications with their
         development_status.
      2. Allow adding/removing indication associations.
      3. For each asset_indication: dropdown to set development_status
         (Auto, PRECLIN, P1-P4, APPROVED, LAUNCHED).
         "Auto" sets source='auto'. Specific value sets source='analyst'.
      4. "Reset to auto" link when source is 'analyst'.
      5. Color swatch next to each status option.
    files:
      - modify: src/client/src/app/features/manage/assets/asset-form.component.ts
      - modify: src/client/src/app/features/manage/assets/asset-form.component.html
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T14
    title: "Add indication and condition management pages"
    description: |
      Create manage UI for indications and conditions within a space:

      1. Indication list page: CRUD for indications. Shows parent hierarchy.
         Replaces the current therapeutic area management (if any exists).
      2. Condition list page: Shows conditions in the space (auto-created
         from CT.gov or manually added). Manage condition-to-indication
         mapping.
      3. Add routes for these pages under the manage feature area.
      4. Update navigation to link to the new pages.
    files:
      - create: src/client/src/app/features/manage/indications/
      - create: src/client/src/app/features/manage/conditions/
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T15
    title: "Update remaining frontend references (products -> assets, TA -> indication)"
    description: |
      Grep for all remaining references to 'product_id', 'products',
      'product_mechanisms', 'product_routes', 'therapeutic_area' in
      src/client/src/app/ and update to the new names.

      Key areas:
        - Entity page components
        - Intelligence components
        - Event components
        - PPTX export service
        - Any route params or query params referencing productId
        - asset-list, asset-detail components
    files:
      - modify: (multiple files, grep-driven)
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T15b
    title: "Update landscape frontend for indication scoping"
    description: |
      Update landscape components to scope by indication instead of
      therapeutic area:

      1. landscape.model.ts: Update BullseyeData, LandscapeIndexEntry,
         LandscapeFilters to reference indication instead of
         therapeutic area. Rename therapeuticAreaIds to indicationIds
         in LandscapeFilters.
      2. landscape-state.service.ts: Update filter logic and RPC calls
         to pass p_indication_id instead of p_therapeutic_area_id.
      3. landscape-filter-bar.component.ts: Rename TA filter to
         Indication filter. Update label from "Therapy Area" to
         "Indication".
      4. landscape-shell.component.ts: Update route params and
         deep-link handling for indication-based scoping.
      5. bullseye-detail-panel.component.ts: Update openInTimeline
         output to emit indicationId instead of therapeuticAreaId.
      6. landscape.component.ts: Update any TA references.

      The chart components themselves (bullseye-chart, positioning-chart)
      don't need changes since they receive the same data shape from
      the updated RPCs.
    files:
      - modify: src/client/src/app/core/models/landscape.model.ts
      - modify: src/client/src/app/features/landscape/landscape-state.service.ts
      - modify: src/client/src/app/features/landscape/landscape-filter-bar.component.ts
      - modify: src/client/src/app/features/landscape/landscape-shell.component.ts
      - modify: src/client/src/app/features/landscape/bullseye-detail-panel.component.ts
      - modify: src/client/src/app/features/landscape/landscape.component.ts
    dependencies: [T10]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T16
    title: "Update phases help page"
    description: |
      Update phases-help.component.ts:
        - PHASE_DESCRIPTORS auto-updates (APPROVED/LAUNCHED removed in T9).
        - Add section explaining trial phases vs development status.
        - Add section explaining indications and conditions.
        - Update FAQ entries.
    files:
      - modify: src/client/src/app/features/help/phases-help.component.ts
    dependencies: [T9]
    verification: "cd src/client && npx ng lint && npx ng build"

  - id: T17
    title: "Regenerate runbook auto-gen blocks"
    description: |
      Run npm run docs:arch from src/client/ to regenerate:
        - ER diagram (new tables, renamed tables)
        - RPC-to-table matrix
        - Route tree
        - Drift detection

      Requires local Supabase running after all migrations applied.
    files:
      - modify: docs/runbook/07-database-schema.md
      - modify: docs/runbook/06-backend-architecture.md
      - modify: docs/runbook/05-frontend-architecture.md
    dependencies: [T8]
    verification: "cd src/client && npm run docs:arch"
```

## Open Questions

None. All scope and design decisions resolved during discussion.

## Risk Assessment

**High complexity, medium risk.** This is a significant restructure touching the core data model, 15+ RPC functions, the products-to-assets rename across ~500 migration references and ~45 frontend references, and multiple visualizations (timeline, bullseye, positioning). Mitigations:

1. **Sequential migrations with inline smoke tests.** Each migration validates its own invariants before the next one runs.
2. **Rename is mechanical.** The products-to-assets rename is high volume but low complexity. Every change is a deterministic find-and-replace.
3. **Frontend already uses Asset vocabulary.** The model interface is already called `Asset`, the service is `AssetService`, the component is `asset-form`. The rename is largely in Supabase table/column references.
4. **Bullseye/positioning RPCs simplify.** The new model replaces complex MAX(CASE) rollups with direct reads of asset_indications.development_status. The chart components themselves don't change (same data shape), only the RPC queries and the scoping UI.
5. **`supabase db reset` is the integration test.** Running all migrations from scratch + seed data exercises the full migration chain end to end.
