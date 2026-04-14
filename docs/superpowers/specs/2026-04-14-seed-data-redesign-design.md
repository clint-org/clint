# Seed Data Redesign

## Problem

The current seed data architecture has accumulated significant debt through 8 successive migrations that each replaced the entire `seed_demo_data()` function body. This has caused:

1. **Lost data.** The events system demo data (events, threads, sources, links) was added in migration `20260413120200` then overwritten by `20260414120200`, which replaced the function without carrying events forward. The current function seeds zero events.

2. **Marker type fragmentation.** Three sources define marker types (old migration `20260315163507`, redesign migration `20260412130100`, and `seed.sql`), resulting in ~23 marker types in the DB after `db reset` with overlapping/duplicate definitions. `seed_demo_data()` references old IDs that `seed.sql` doesn't define.

3. **Fragile monolith.** A single 670-line PL/pgSQL function that must be rewritten wholesale for any change. This is the root cause of the data loss.

4. **Coverage gaps.** No `no_longer_expected` markers, only 4 trial notes across 26 trials, no marker descriptions or source URLs, no CT.gov dimensions, landscape trials all in Heart Failure only, zero events/threads/sources/links.

5. **Dual seed paths.** `seed_pharma_demo()` exists alongside `seed_demo_data()` with different datasets. Only one is needed.

## Decision Record

- **Fictional companies and trials.** Keep the four therapeutic areas (HF, CKD, T2D, Obesity) but replace all real pharma companies, products, and trial names with realistic-feeling fictional equivalents. Avoids brand/accuracy concerns.
- **Single consolidated function.** Drop `seed_pharma_demo()`. One `seed_demo_data(p_space_id)` entry point.
- **`seed.sql` for system data, function for space data.** `seed.sql` is the single source of truth for system marker types, marker categories, and event categories. `seed_demo_data()` handles per-space demo data (companies, products, trials, markers, events, etc.).
- **Modular helper architecture.** Break the monolith into focused helper functions to prevent future data loss during migrations.
- **Marker type consolidation.** One cleanup migration removes old marker type IDs and makes `seed.sql` the canonical set.

## Architecture

### Two-Layer Seeding

```
supabase db reset
  1. Runs all migrations (schema only, no demo data)
  2. Runs seed.sql:
     - System marker categories (5)
     - System marker types (13)
     - System event categories (6: Clinical Data, Regulatory, Commercial, Corporate, Competitive Intelligence, Safety Signal)
  3. User calls seed_demo_data(space_id) via RPC to populate a space
```

### Orchestrator + Helpers

```
seed_demo_data(p_space_id uuid)
  |-- idempotency check (companies exist? return early)
  |-- create temp table _seed_ids (on commit drop)
  |-- _seed_demo_companies(p_space_id, uid)
  |-- _seed_demo_products(p_space_id, uid)
  |-- _seed_demo_therapeutic_areas(p_space_id, uid)
  |-- _seed_demo_moa_roa(p_space_id, uid)
  |-- _seed_demo_trials(p_space_id, uid)
  |-- _seed_demo_markers(p_space_id, uid)
  |-- _seed_demo_trial_notes(p_space_id, uid)
  |-- _seed_demo_events(p_space_id, uid)
  |-- _seed_demo_notifications(p_space_id, uid)
```

### ID Communication

Helpers share generated UUIDs via a session-scoped temp table:

```sql
create temp table _seed_ids (
  entity_type text not null,
  key         text not null,
  id          uuid not null,
  primary key (entity_type, key)
) on commit drop;
```

Each helper inserts its IDs (`entity_type='company', key='c_meridian', id=<uuid>`) and reads upstream IDs from the same table. No function signature changes needed when adding entities.

### Helper Convention

- All helpers: `_seed_demo_<domain>(p_space_id uuid, p_uid uuid) returns void`
- Schema: `public`
- Security: `invoker` (inherits caller's RLS context)
- `set search_path = ''` on all functions
- Helpers are private implementation details, not part of the public API

## seed.sql: System Data

### Marker Categories (5, unchanged)

| ID | Name | display_order |
|----|------|--------------|
| c...0001 | Clinical Trial | 1 |
| c...0002 | Data | 2 |
| c...0003 | Regulatory | 3 |
| c...0004 | Approval | 4 |
| c...0005 | Loss of Exclusivity | 5 |

### Marker Types (13, canonical set)

These are the 13 types currently in `seed.sql`. After the cleanup migration, these are the only system marker types:

| ID | Name | Category | Shape | Fill | Color | Inner Mark |
|----|------|----------|-------|------|-------|------------|
| ...0013 | Topline Data | Data | circle | filled | #4ade80 | dot |
| ...0030 | Interim Data | Data | circle | filled | #22c55e | dash |
| ...0031 | Full Data | Data | circle | filled | #16a34a | none |
| ...0032 | Regulatory Filing | Regulatory | diamond | filled | #f97316 | dot |
| ...0033 | Submission | Regulatory | diamond | filled | #f97316 | none |
| ...0034 | Acceptance | Regulatory | diamond | filled | #f97316 | check |
| ...0008 | PCD | Clinical Trial | circle | filled | #475569 | none |
| ...0011 | Trial Start | Clinical Trial | dashed-line | filled | #94a3b8 | none |
| ...0012 | Trial End | Clinical Trial | dashed-line | filled | #94a3b8 | none |
| ...0035 | Approval | Approval | flag | filled | #3b82f6 | none |
| ...0036 | Launch | Approval | triangle | filled | #7c3aed | none |
| ...0020 | LOE Date | LOE | square | filled | #78350f | x |
| ...0021 | Generic Entry Date | LOE | square | filled | #d97706 | none |

### Event Categories (system, added to seed.sql)

| ID | Name | display_order |
|----|------|--------------|
| e...0001 | Clinical Data | 1 |
| e...0002 | Regulatory | 2 |
| e...0003 | Commercial | 3 |
| e...0004 | Corporate | 4 |
| e...0005 | Competitive Intelligence | 5 |
| e...0006 | Safety Signal | 6 |

## Demo Data: Fictional Entities

### Companies (8)

| Key | Name | Logo | display_order |
|-----|------|------|--------------|
| c_meridian | Meridian Therapeutics | null | 1 |
| c_helios | Helios Pharma | null | 2 |
| c_vantage | Vantage Biosciences | null | 3 |
| c_apex | Apex Biotech | null | 4 |
| c_cardinal | Cardinal Life Sciences | null | 5 |
| c_solara | Solara Pharmaceuticals | null | 6 |
| c_cascade | Cascade Medicine | null | 7 |
| c_zenith | Zenith Health | null | 8 |

### Therapeutic Areas (4)

| Key | Name | Abbreviation |
|-----|------|-------------|
| ta_hf | Heart Failure | HF |
| ta_ckd | Chronic Kidney Disease | CKD |
| ta_t2d | Type 2 Diabetes | T2D |
| ta_obesity | Obesity | OB |

### Products (20)

Distributed across companies with realistic generic names:

**Meridian Therapeutics (3):**
- Zelvox (cortagliflozin) -- SGLT2i, Oral -- HF/CKD focus
- Restivon (duralutide) -- GLP-1, SC -- Obesity focus
- MRD-4471 (undisclosed) -- Investigational, Oral -- Early pipeline

**Helios Pharma (3):**
- Cardivant (emparivat) -- Cardiac myosin modulator, Oral -- HF focus
- Renoquil (benafinerone) -- Non-steroidal MRA, Oral -- CKD/HF
- HLS-2289 (undisclosed) -- Investigational, IV -- Early pipeline

**Vantage Biosciences (3):**
- Glytara (vantizepatide) -- GIP/GLP-1 dual agonist, SC -- T2D/Obesity
- Oxavance (trebariguat) -- sGC stimulator, Oral -- HF
- VBX-7803 (undisclosed) -- Investigational, Inhaled -- Early pipeline

**Apex Biotech (2):**
- Thyravex (neratafidis) -- TTR stabilizer, Oral -- HF (LAUNCHED)
- APX-1150 (undisclosed) -- Investigational, Oral -- Early pipeline

**Cardinal Life Sciences (2):**
- Venatris (cariguat) -- sGC stimulator, Oral -- HF (APPROVED)
- CRD-3300 (undisclosed) -- Investigational, IV -- Early pipeline

**Solara Pharmaceuticals (3):**
- Ketavora (solafinerone) -- Non-steroidal MRA, Oral -- HF (APPROVED)
- Lumivex (solagliflozin) -- SGLT2i, Oral -- CKD
- SLR-8820 (undisclosed) -- Investigational, IM -- Early pipeline

**Cascade Medicine (2):**
- Pravicel (cascamyosin) -- Cardiac myosin modulator, Oral -- HF
- CSC-6610 (undisclosed) -- Investigational, Topical -- Early pipeline

**Zenith Health (2):**
- ZNH-1140 (undisclosed) -- Investigational, Inhaled -- Early pipeline
- ZNH-0092 (undisclosed) -- Investigational, Intrathecal -- Early pipeline

### MOAs (8)

| Key | Name | Abbreviation |
|-----|------|-------------|
| moa_sglt2 | SGLT2 inhibitor | SGLT2i |
| moa_glp1 | GLP-1 receptor agonist | GLP-1 RA |
| moa_glp1_gip | GIP/GLP-1 dual agonist | GIP/GLP-1 |
| moa_sgc | sGC stimulator | sGC |
| moa_ttr | TTR stabilizer | TTR |
| moa_nsmra | Non-steroidal MRA | nsMRA |
| moa_cardiac_myosin | Cardiac myosin modulator | CMM |
| moa_investigational | Investigational (undisclosed) | -- |

### ROAs (7)

| Key | Name | Abbreviation |
|-----|------|-------------|
| roa_oral | Oral | PO |
| roa_iv | Intravenous | IV |
| roa_sc | Subcutaneous | SC |
| roa_inhaled | Inhaled | INH |
| roa_im | Intramuscular | IM |
| roa_topical | Topical | TOP |
| roa_intrathecal | Intrathecal | IT |

### Trials (26)

**Phase distribution across all TAs:**

| Phase | Count | TAs represented |
|-------|-------|----------------|
| PRECLIN | 3 | HF (2), CKD (1) |
| P1 | 4 | HF (3), Obesity (1) |
| P2 | 4 | HF (2), CKD (1), T2D (1) |
| P3 | 6 | HF (3), CKD (1), T2D (1), Obesity (1) |
| P4 | 1 | CKD |
| APPROVED | 2 | HF (2) |
| LAUNCHED | 1 | HF |
| Completed (various phases) | 5 | HF (2), CKD (1), T2D (1), Obesity (1) |

**Timeline trials (8, completed, historical data):**
Distributed across all 4 TAs with dates spanning 2017-2023.

**Landscape trials (18, active + approved/launched):**
Distributed across HF primarily (competitive landscape) with some CKD/T2D/Obesity representation. Phases from PRECLIN through LAUNCHED.

Each trial has:
- Fictional name (e.g., ZENITH-HF, CARDIO-PRESERVE, RENAL-FORWARD)
- Fictional NCT-style identifier where appropriate (e.g., NCT0500xxxx)
- Realistic sample sizes
- Status (Active, Completed, Recruiting)
- Phase dates covering 2018-2027

### CT.gov Dimensions

10-12 trials get enriched CT.gov dimensions:
- recruitment_status, study_type, phase, design_allocation, design_masking
- conditions, intervention_type, intervention_name
- primary/secondary outcome measures
- eligibility criteria, start/completion dates
- DMC, FDA regulation flags

This exercises the dashboard filter dropdowns and trial detail views.

### Markers (~55-60 total)

**Coverage by marker type (all 13 system types used):**

| Marker Type | Count | Notes |
|-------------|-------|-------|
| Topline Data | 8 | Mix of actual and projected |
| Interim Data | 4 | Projected for active P3 trials |
| Full Data | 3 | Completed trials |
| Regulatory Filing | 4 | Mix of actual filings and projected |
| Submission | 4 | NDA/sNDA submissions |
| Acceptance | 3 | FDA acceptance letters |
| PCD | 6 | Primary completion dates |
| Trial Start | 3 | Trial initiation dates |
| Trial End | 2 | Completed trials |
| Approval | 3 | FDA approvals |
| Launch | 2 | Product launches |
| LOE Date | 2 | Patent expiries |
| Generic Entry Date | 2 | Generic competition dates |

**Feature coverage:**
- `projection`: mix of 'actual', 'company', 'primary' (exercises all non-stout values)
- `no_longer_expected`: 2-3 markers flagged NLE (exercises the feature)
- `end_date`: 3-4 range markers (e.g., estimated launch windows)
- `description`: 15-20 markers with descriptions (exercises tooltips and catalyst detail)
- `source_url`: 10-12 markers with placeholder URLs (exercises source links)
- Future-dated markers: 15-20 with `event_date >= 2026-04-14` (exercises Key Catalysts)
- Historical markers: 35-40 with past dates (exercises dashboard timeline)

**Per-trial distribution:**
- Completed trials: 3-5 markers each (data reported, regulatory filing, PCD, approval)
- Active P3 trials: 2-4 markers each (projected data, projected PCD, some regulatory)
- Active P1/P2 trials: 1-2 markers each (trial start, projected PCD)
- PRECLIN trials: 0-1 markers (trial start only)
- APPROVED/LAUNCHED: 3-4 markers (full lifecycle: data -> filing -> approval -> launch)

### Marker Assignments

Each marker assigned to 1 trial (the common case), with 2-3 markers assigned to multiple trials (exercises the many-to-many relationship -- e.g., a shared regulatory filing across related trials of the same product).

### Trial Notes (10-12)

Distributed across trials of varying phases. Short, factual annotations:
- Landmark results commentary for completed trials
- Enrollment status notes for active trials
- Design change notes (e.g., "Protocol amended to add biomarker endpoint")

### Events (18-22)

**Entity level coverage:**
- Space-level (industry): 3-4 events (e.g., "FDA publishes updated HF guidance")
- Company-level: 4-5 events (e.g., "Meridian Q4 earnings: pipeline update")
- Product-level: 4-5 events (e.g., "Zelvox added to ESC treatment algorithm")
- Trial-level: 4-5 events (e.g., "ZENITH-HF enrollment reaches 80%")

**Feature coverage:**
- All 6 event categories used
- Both priorities (high and low)
- Tags: 8-10 distinct tags across events (e.g., "earnings", "guidance", "safety", "enrollment", "conference", "patent")
- Event sources: 8-10 events with 1-2 source URLs each
- Date range: 2024-2027 (mix of past and future)

### Event Threads (2-3)

- "Meridian Therapeutics Leadership Transition" (3 events in sequence)
- "Zelvox Supply Chain Update" (2-3 events)
- Optional: "FDA HF Guidance Evolution" (2 events)

### Event Links (3-4)

Cross-linking related events (e.g., a safety signal event linked to a trial enrollment pause event).

### Event Sources (8-10)

Placeholder URLs with descriptive labels on events that warrant external references.

### Marker Notifications (3-5)

- 2 high-priority (competitor data readout, regulatory filing)
- 1-2 low-priority (projected date updates)

## View Coverage Matrix

| View | Data Exercised | Edge Cases Covered |
|------|---------------|-------------------|
| **Dashboard Grid** | All 8 companies with products, 26 trials with phase bars, markers on timeline, trial notes | Multi-product companies, multi-trial products, MOA/ROA columns, range markers, NLE markers, projected vs actual, zoom levels |
| **Dashboard Filters** | Company/product/TA multi-select, date range, recruitment status, study type, phase, MOA, ROA | CT.gov dimensions for filter dropdowns, empty filter results |
| **Key Catalysts** | 15-20 future markers grouped by quarter | Multiple categories, projected markers, detail panel with upcoming + related, client-side search |
| **Events Feed** | 18-22 events + markers in mixed feed | All entity levels, all categories, threads, links, sources, tags, pagination, priority filter |
| **Bullseye (by TA)** | HF landscape: 9 companies across all rings | Full ring distribution PRECLIN->LAUNCHED, spoke grouping, product detail |
| **Bullseye (by Company)** | Per-company view with TA spokes | Multi-TA products, MOA/ROA in detail |
| **Bullseye (by MOA)** | 8 MOAs as entry points | Varying product counts per MOA |
| **Bullseye (by ROA)** | 7 ROAs as entry points | Multi-ROA products (Glytara: SC+Oral) |
| **Positioning Chart** | All grouping dimensions (MOA, TA, MOA+TA, company, ROA) | Bubble sizing, phase coloring, product drill-down |
| **Manage Companies** | 8 companies, some with logos | CRUD, delete cascade |
| **Manage Products** | 20 products with MOA/ROA assignments | Multi-select MOA/ROA, company dropdown |
| **Manage Trials** | 26 trials with CT.gov dimensions | CT.gov fields populated on subset, identifier field, notes |
| **Manage Marker Types** | 13 system types (read-only) | System vs custom distinction |
| **Manage MOAs** | 8 MOAs | Delete protection (assigned to products) |
| **Manage ROAs** | 7 ROAs | Delete protection, abbreviations |

## Cleanup Migration

One migration handles all cleanup:

1. **Remap and delete old marker types.** First remap any markers that reference old types to their nearest new equivalent, then delete the old types:

   | Old ID | Old Name | New ID | New Name |
   |--------|----------|--------|----------|
   | ...0001 | Projected Data Reported | ...0013 | Topline Data |
   | ...0002 | Data Reported | ...0013 | Topline Data |
   | ...0003 | Projected Regulatory Filing | ...0032 | Regulatory Filing |
   | ...0004 | Submitted Regulatory Filing | ...0033 | Submission |
   | ...0005 | Label Projected Approval/Launch | ...0035 | Approval |
   | ...0006 | Label Update | ...0035 | Approval |
   | ...0007 | Est. Range of Potential Launch | ...0036 | Launch |
   | ...0009 | Change from Prior Update | ...0013 | Topline Data |
   | ...0010 | Event No Longer Expected | ...0008 | PCD |
   | ...0014 | Interim Data (migration) | ...0030 | Interim Data (seed.sql) |
   | ...0015 | Full Data (migration) | ...0031 | Full Data (seed.sql) |
   | ...0016 | FDA Submission (migration) | ...0033 | Submission (seed.sql) |
   | ...0017 | FDA Acceptance (migration) | ...0034 | Acceptance (seed.sql) |
   | ...0018 | PDUFA Date (migration) | ...0035 | Approval (seed.sql) |
   | ...0019 | Launch Date (migration) | ...0036 | Launch (seed.sql) |
2. **Drop `seed_pharma_demo()`** function.
3. **Drop old `seed_demo_data()`** function (both overloads if they exist).
4. **Create helper functions** (`_seed_demo_companies`, `_seed_demo_products`, etc.).
5. **Create new `seed_demo_data(p_space_id)`** orchestrator.

## File Changes

| File | Action |
|------|--------|
| `supabase/seed.sql` | Add event categories, ensure marker categories + types are canonical |
| `supabase/migrations/<timestamp>_seed_data_redesign.sql` | Cleanup migration with all helper functions + orchestrator |
