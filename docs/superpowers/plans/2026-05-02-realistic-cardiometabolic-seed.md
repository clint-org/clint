# Realistic Cardiometabolic Seed Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the synthetic demo seed (Zelvox / cortagliflozin / NCT05001001) with real cardiometabolic data covering Lilly, Novo, AZ, BI, BMS, Cytokinetics, Bayer, Novartis, Pfizer, Roche, Amgen, Viking, BridgeBio across HF / CKD / T2D / Obesity / ATTR-CM. Adds `material_type = 'conference_report'` end-to-end. Snapshot date: 2026-05-02.

**Architecture:** One new SQL migration rewrites 10 helper-function bodies (`_seed_demo_companies`, `_seed_demo_therapeutic_areas`, `_seed_demo_products`, `_seed_demo_moa_roa`, `_seed_demo_trials`, `_seed_demo_markers`, `_seed_demo_trial_notes`, `_seed_demo_events`, `_seed_demo_primary_intelligence`, `_seed_demo_materials`) inside the existing `seed_demo_data` orchestrator (preserved as-is). Same migration extends `materials.material_type` CHECK constraint with `conference_report` and updates the two material RPC whitelists. Six Angular files add UI handling for the new type. A verification report at `docs/specs/seed-data-verification.md` records the source URL for every NCT and date.

**Tech Stack:** PostgreSQL (Supabase), pl/pgSQL, Angular 19 + PrimeNG + Tailwind CSS v4, ClinicalTrials.gov REST API v2 (`https://clinicaltrials.gov/api/v2/studies`).

**Source of truth:** `docs/superpowers/specs/2026-05-02-realistic-cardiometabolic-seed-design.md`. Every entity list (companies, products, trials, markers, materials) lives there. Tasks below reference the spec by section.

---

## File map

**Created:**
- `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql` -- schema CHECK extension + 2 RPC whitelist updates + 10 helper-function rewrites.
- `docs/specs/seed-data-verification.md` -- source URL per NCT / date / approval.

**Modified (Angular):**
- `src/client/src/app/core/models/material.model.ts` -- add `'conference_report'` to `MaterialType` union.
- `src/client/src/app/core/services/material.service.ts` -- extend label/icon lookup map.
- `src/client/src/app/shared/components/material-row/material-row.component.ts` -- icon + label mapping for new type.
- `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts` -- dropdown option.
- `src/client/src/app/features/materials-browse/materials-browse-page.component.ts` -- filter chip.
- `src/client/src/app/shared/components/materials-section/materials-section.component.ts` -- grouped rendering.

**Reference (read-only, do not modify):**
- `supabase/migrations/20260501020000_seed_demo_data_gated.sql` -- existing 7 helper bodies. Source of helper signatures and the orchestrator gate logic.
- `supabase/migrations/20260501132002_seed_demo_intelligence_security_definer.sql` -- existing `_seed_demo_primary_intelligence` body (security definer pattern).
- `supabase/migrations/20260501130349_extend_seed_demo_intelligence_and_materials.sql` -- existing `_seed_demo_materials` body and the orchestrator wiring.
- `supabase/migrations/20260501115539_materials.sql` -- materials table definition (line 20-21: existing CHECK constraint).
- `supabase/migrations/20260501115541_material_rpcs.sql` -- `create_material` (line 84) and `update_material` (line 483) whitelists.

---

## Phase 1: Verification (Task 1)

Independent of all SQL/frontend work. Output is the verification report which Task 6 (trials helper) consumes.

### Task 1: Verify NCT IDs / dates / approvals via ClinicalTrials.gov + write verification report

**Files:**
- Create: `docs/specs/seed-data-verification.md`

For each `VERIFY` row in spec section "Trials" and each dated marker (approvals, readouts, NDA filings) in spec sections "Markers", "Events", and "Materials > Priority notices", look up the authoritative source.

**Sources, in priority order:**
1. ClinicalTrials.gov API: `https://clinicaltrials.gov/api/v2/studies?query.term=<TRIAL+NAME>&fields=NCTId,BriefTitle,EnrollmentCount,StartDate,PrimaryCompletionDate,OverallStatus`. Returns JSON. Use `WebFetch` with this URL.
2. FDA approval letters: `https://www.accessdata.fda.gov/drugsatfda_docs/...`
3. Company press releases (search company IR site).
4. NEJM/journal abstracts for publication dates.

**Trials to verify** (from spec section "Trials"):

| Trial | What to confirm |
|---|---|
| SURMOUNT-1 | NCT04184622, sample size, primary completion |
| SURPASS-2 | NCT03987919, sample size, primary completion |
| STEP 1 | NCT03548935, sample size, primary completion |
| SELECT | NCT03574597, sample size, primary completion |
| DAPA-HF | NCT03036124, sample size, primary completion |
| EMPEROR-Reduced | NCT03057977, sample size, primary completion |
| EXPLORER-HCM | NCT03470545, sample size, primary completion |
| PARADIGM-HF | NCT01035255, sample size, primary completion |
| ATTR-ACT | NCT01994889, sample size, primary completion |
| ATTRibute-CM | NCT03860935, sample size, primary completion |
| SURMOUNT-MMO | NCT05556512 |
| SUMMIT (tirzepatide HFpEF) | NCT04847557 |
| SURMOUNT-OSA | NCT05412004 |
| ATTAIN-1 | search "orforglipron obesity Phase 3" — Lilly trial |
| ACHIEVE-1 | search "orforglipron T2D Phase 3" — Lilly trial |
| TRIUMPH-1 | search "retatrutide obesity Phase 3" — Lilly trial |
| FLOW | NCT03819153 |
| REDEFINE-1 | search "CagriSema obesity Phase 3" — Novo trial |
| REDEFINE-2 | search "CagriSema obesity T2D Phase 3" |
| SOUL | search "oral semaglutide cardiovascular" |
| DELIVER | NCT03619213 |
| DAPA-CKD | NCT03036150 |
| EMPEROR-Preserved | NCT03057951 |
| EMPA-KIDNEY | NCT03594110 |
| EMPACT-MI | NCT04509674 |
| Survodutide P2 obesity | search "survodutide obesity Phase 2" — BI / Zealand |
| FINEARTS-HF | NCT04435626 |
| SEQUOIA-HCM | NCT05186818 |
| MAPLE-HCM | search "aficamten metoprolol" — Cytokinetics |
| ACACIA-HCM | search "aficamten non-obstructive" — Cytokinetics |
| ODYSSEY-HCM | search "mavacamten non-obstructive" — BMS |
| CT-388 P2 | search "CT-388 obesity Phase 2" — Roche / Carmot |
| VK2735 SC P2 | search "VK2735 subcutaneous obesity" — Viking |
| VK2735 oral P1/2 | search "VK2735 oral obesity" — Viking |
| MariTide P2 | search "maridebart cafraglutide obesity" — Amgen |
| Danuglipron P2 | search "danuglipron obesity" — Pfizer (terminated) |

**Approvals / regulatory dates to verify:**
- Mounjaro T2D approval: 2022-05-13 (FDA)
- Zepbound obesity approval: 2023-11-08 (FDA)
- Zepbound OSA approval: 2024-12-20 (FDA)
- Wegovy obesity approval: 2021-06-04 (FDA)
- Wegovy CV outcomes (SELECT) approval: 2024-03-08 (FDA)
- Ozempic CKD/T2D approval (FLOW): 2025-01 (FDA)
- Farxiga HFrEF approval: 2020-05-05 (FDA)
- Farxiga HFpEF approval: 2023-05 (FDA)
- Farxiga CKD approval: 2021-04-30 (FDA)
- Jardiance HFrEF approval: 2021-08-18 (FDA)
- Jardiance HFpEF approval: 2022-02-24 (FDA)
- Jardiance CKD approval: 2023-09-22 (FDA)
- Camzyos approval: 2022-04-28 (FDA)
- Entresto approval: 2015-07-07 (FDA)
- Vyndaqel/Vyndamax approval: 2019-05-03 (FDA)
- Attruby approval: 2024-11-22 (FDA)
- Verquvo approval: 2021-01-19 (FDA)
- Kerendia approval: 2021-07-09 (FDA)

**Output format** at `docs/specs/seed-data-verification.md`:

```markdown
# Seed data verification report

Snapshot date: 2026-05-02. Sources are public (ClinicalTrials.gov, FDA, company press releases, NEJM).

Last verified: 2026-05-02.

## Trials

### SURMOUNT-1 (Lilly tirzepatide obesity)
- NCT: NCT04184622
- Source: https://clinicaltrials.gov/study/NCT04184622
- Sample size: 2539
- Start date: 2019-12-12 (Actual)
- Primary completion: 2022-04-25 (Actual)
- Overall status: Completed
- Approval: 2023-11-08 (FDA: https://...)

### SURPASS-2 (Lilly tirzepatide T2D)
[... etc ...]

## Approvals (regulatory)

### Mounjaro (tirzepatide) T2D
- FDA approval date: 2022-05-13
- Source: https://www.fda.gov/...

[... one entry per approval ...]

## Unverified entries

| Entity | Reason | Best guess |
|---|---|---|
| ATTAIN-1 (orforglipron) | Trial registered after my knowledge cutoff (Jan 2026); ClinicalTrials.gov search returned multiple candidates | NCT pending; sample size ~3000 |
[... etc ...]
```

- [ ] **Step 1: For each trial in the table above, run a WebFetch to ClinicalTrials.gov.**

For known NCT IDs, fetch the study record directly:
```
WebFetch(url="https://clinicaltrials.gov/api/v2/studies/NCT04184622?fields=NCTId,BriefTitle,EnrollmentCount,StartDate,PrimaryCompletionDate,OverallStatus", prompt="Extract NCT ID, brief title, enrollment count, start date, primary completion date, overall status")
```

For trials marked "search ...", use the query endpoint:
```
WebFetch(url="https://clinicaltrials.gov/api/v2/studies?query.term=orforglipron+obesity+Phase+3&fields=NCTId,BriefTitle,EnrollmentCount,Phase,LeadSponsorName&pageSize=10", prompt="List the NCT IDs and brief titles of returned studies. Identify the Phase 3 study sponsored by Eli Lilly for orforglipron in obesity. Return the NCT, sample size, start date, primary completion date, overall status.")
```

If the search is ambiguous, record up to 3 candidates and pick the one with the highest enrollment count + sponsored by the expected company. If still ambiguous, mark as unverified.

- [ ] **Step 2: For each FDA approval in the list, verify the approval date via FDA approval letter or company press release.**

```
WebFetch(url="https://www.accessdata.fda.gov/scripts/cder/daf/index.cfm?event=overview.process&ApplNo=215866", prompt="What is the FDA approval date and indication for tirzepatide / Zepbound?")
```

If the FDA URL is uncertain, search via company IR site (e.g., `lilly.com investor news`) for the press release.

- [ ] **Step 3: Append each verified entry to `docs/specs/seed-data-verification.md` in the format above. Append unverifiable entries to the "Unverified entries" table at the end.**

- [ ] **Step 4: Commit.**

```bash
git add docs/specs/seed-data-verification.md
git commit -m "docs(seed): add verification report for cardiometabolic seed data"
```

---

## Phase 2: Frontend (Tasks 2-7)

Independent of Phase 1 and Phase 3. Adds `conference_report` to the existing material UI.

### Task 2: Extend `MaterialType` union

**Files:**
- Modify: `src/client/src/app/core/models/material.model.ts`

- [ ] **Step 1: Read the current file.**

```bash
cat src/client/src/app/core/models/material.model.ts
```

Locate the `MaterialType` type alias / union. Current value: `'briefing' | 'priority_notice' | 'ad_hoc'`.

- [ ] **Step 2: Extend the union to include `'conference_report'`.**

```typescript
export type MaterialType = 'briefing' | 'priority_notice' | 'ad_hoc' | 'conference_report';
```

- [ ] **Step 3: Verify the model compiles.**

```bash
cd src/client && npx tsc --noEmit
```

Expected: no TS errors related to MaterialType.

- [ ] **Step 4: Commit.**

```bash
git add src/client/src/app/core/models/material.model.ts
git commit -m "feat(materials): add conference_report to MaterialType union"
```

### Task 3: Extend label / icon lookup in material.service.ts

**Files:**
- Modify: `src/client/src/app/core/services/material.service.ts`

- [ ] **Step 1: Read the current file and find any `MaterialType -> { label, icon }` lookup map.**

```bash
grep -n "briefing\|priority_notice\|ad_hoc" src/client/src/app/core/services/material.service.ts
```

- [ ] **Step 2: Add a `conference_report` entry to the map.**

If the map is shaped like `Record<MaterialType, { label, icon, [other] }>`, add:
```typescript
conference_report: { label: 'Conference report', icon: 'presentation' /* or whichever icon naming the file uses */ }
```

Match the existing key/value shape exactly. If `icon` references lucide names, use `presentation` (a horizontal whiteboard icon, fits "deck/report" semantics). If the existing entries use a different naming scheme (e.g., a custom SVG icon path), follow that scheme and pick the closest match — fall back to the same icon as `briefing` if no good fit.

- [ ] **Step 3: Build to verify.**

```bash
cd src/client && ng build
```

Expected: build passes.

- [ ] **Step 4: Commit.**

```bash
git add src/client/src/app/core/services/material.service.ts
git commit -m "feat(materials): add conference_report to label/icon lookup"
```

### Task 4: Material row component icon/label mapping

**Files:**
- Modify: `src/client/src/app/shared/components/material-row/material-row.component.ts` (and its template if applicable)

- [ ] **Step 1: Read the component and find the place where `material_type` maps to a visible icon or label.**

```bash
grep -n "briefing\|priority_notice\|ad_hoc\|materialType" src/client/src/app/shared/components/material-row/material-row.component.ts src/client/src/app/shared/components/material-row/material-row.component.html 2>/dev/null
```

- [ ] **Step 2: Add a case / mapping for `conference_report`.**

Pattern depends on whether the component uses a switch, a method like `iconFor(type)`, or a `@for` over an inline map. If a method exists in the service (Task 3), prefer calling that. If not, add an inline branch alongside the existing three.

For label, use `'Conference report'`. For icon, match Task 3's choice (`presentation` if lucide).

- [ ] **Step 3: Build and visually inspect.**

```bash
cd src/client && ng build
```

Expected: build passes.

- [ ] **Step 4: Commit.**

```bash
git add src/client/src/app/shared/components/material-row/material-row.component.*
git commit -m "feat(materials): render conference_report icon and label in material row"
```

### Task 5: Material upload zone dropdown option

**Files:**
- Modify: `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts` (and template)

- [ ] **Step 1: Read the component and find the dropdown / `p-select` options for `material_type`.**

```bash
grep -n "briefing\|priority_notice\|ad_hoc\|materialType\|p-select\|MaterialType" src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.*
```

- [ ] **Step 2: Add `{ label: 'Conference report', value: 'conference_report' }` to the options array.**

Place it after the existing 3 options. Order: `briefing`, `conference_report`, `priority_notice`, `ad_hoc` (so meeting-cadence types group together).

- [ ] **Step 3: Build and verify.**

```bash
cd src/client && ng build
```

- [ ] **Step 4: Commit.**

```bash
git add src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.*
git commit -m "feat(materials): add Conference report option to upload zone dropdown"
```

### Task 6: Materials browse filter chip

**Files:**
- Modify: `src/client/src/app/features/materials-browse/materials-browse-page.component.ts` (and template)

- [ ] **Step 1: Read the component and find the filter chips / multi-select for `material_type`.**

```bash
grep -n "briefing\|priority_notice\|ad_hoc\|materialType\|filter\|chip" src/client/src/app/features/materials-browse/materials-browse-page.component.*
```

- [ ] **Step 2: Add a `Conference reports` chip / option that filters to `material_type = 'conference_report'`.**

Match the shape of the existing filter chips exactly. If chips use a `{label, value, count}` object, follow that.

- [ ] **Step 3: Verify the filter applies correctly via `ng serve` if available; otherwise rely on build pass + visual check on next QA.**

```bash
cd src/client && ng build
```

- [ ] **Step 4: Commit.**

```bash
git add src/client/src/app/features/materials-browse/materials-browse-page.component.*
git commit -m "feat(materials): add Conference reports filter chip on browse page"
```

### Task 7: Materials section grouped rendering

**Files:**
- Modify: `src/client/src/app/shared/components/materials-section/materials-section.component.ts` (and template)

- [ ] **Step 1: Read the component and determine whether it groups materials by `material_type`.**

```bash
grep -n "briefing\|priority_notice\|ad_hoc\|group\|materialType" src/client/src/app/shared/components/materials-section/materials-section.component.*
```

- [ ] **Step 2A: If grouping exists, add a `Conference reports` group between briefing and priority_notice.** Match the shape of existing group definitions.

- [ ] **Step 2B: If no grouping logic exists, this task is a no-op except verifying the component still renders for the new type.** Move on.

- [ ] **Step 3: Build.**

```bash
cd src/client && ng build
```

Expected: build passes; no TS errors; no template type errors.

- [ ] **Step 4: Commit (only if changes were made).**

```bash
git add src/client/src/app/shared/components/materials-section/materials-section.component.*
git commit -m "feat(materials): render conference_report group in materials section"
```

---

## Phase 3: SQL migration (Tasks 8-18)

Depends on Task 1 (verification report). All tasks edit the same migration file.

### Task 8: Create migration file with header + schema change + RPC whitelist updates

**Files:**
- Create: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

- [ ] **Step 1: Create the migration file with the header comment and schema change.**

```sql
-- migration: 20260502130000_seed_demo_realistic_cardiometabolic
-- snapshot date: 2026-05-02. Refresh quarterly.
--
-- purpose: replace the synthetic seed_demo helper bodies with real
--          cardiometabolic landscape data (Lilly, Novo, AZ, BI, BMS,
--          Cytokinetics, Bayer, Novartis, Pfizer, Roche, Amgen, Viking,
--          BridgeBio across HF / CKD / T2D / Obesity / ATTR-CM). Adds
--          'conference_report' to the materials.material_type whitelist
--          end-to-end.
--
-- spec: docs/superpowers/specs/2026-05-02-realistic-cardiometabolic-seed-design.md
-- verification: docs/specs/seed-data-verification.md

-- =============================================================================
-- 1. extend materials.material_type CHECK constraint
-- =============================================================================

alter table public.materials
  drop constraint materials_material_type_check;

alter table public.materials
  add constraint materials_material_type_check
  check (material_type in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report'));
```

- [ ] **Step 2: Append the `create_material` RPC update with the extended whitelist.**

Read the existing function body from `supabase/migrations/20260501115541_material_rpcs.sql:60-145` and reproduce it verbatim with two changes: (a) the `if p_material_type not in (...)` whitelist on line 84 includes `'conference_report'`, (b) keep the `create or replace function` pattern.

```sql
-- =============================================================================
-- 2. update create_material RPC whitelist
-- =============================================================================

create or replace function public.create_material(
  -- [reproduce existing signature from 20260501115541_material_rpcs.sql lines 60-66]
)
-- [reproduce existing body, with the whitelist on the equivalent of line 84 changed to:]
  if p_material_type not in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report') then
    raise exception 'invalid material_type: %', p_material_type
      using errcode = 'P0001';
  end if;
-- [rest of body unchanged]
```

Read the actual file to copy the body. Do not paraphrase — preserve every line including comments, exception handlers, and grants.

- [ ] **Step 3: Append the `update_material` RPC update with the extended whitelist.**

Read existing body from `supabase/migrations/20260501115541_material_rpcs.sql:450-500` and reproduce verbatim with the whitelist on the equivalent of line 483 extended to include `'conference_report'`.

- [ ] **Step 4: Run a syntax check.**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" -f supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
```

Expected: no syntax errors. (Will partially run — that's fine; we only care about parse.)

- [ ] **Step 5: Reset the database to a known state before the next task.**

```bash
supabase db reset --no-seed
```

Wait — the migration we just ran is now part of `supabase/migrations/`. `db reset` will pick it up. The schema change applies cleanly. The RPCs are overwritten in place. After reset the DB is consistent.

- [ ] **Step 6: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(materials): add conference_report to material_type CHECK and RPC whitelists"
```

### Task 9: Rewrite `_seed_demo_companies` (13 real companies)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

The existing helper is in `supabase/migrations/20260501020000_seed_demo_data_gated.sql:794-830`. Helper signature: `(p_space_id uuid, p_uid uuid) returns void`. It declares 8 company UUIDs, inserts into `public.companies` with `(id, space_id, created_by, name, logo_url, display_order)`, and inserts an `_seed_ids` lookup row per company.

The new version uses 13 companies. Variable names must match the keys used in downstream helpers — keep the existing key names and add 5 new ones.

**Variable -> company name mapping** (preserve old keys, add 5 new):
- `c_meridian` -> Eli Lilly
- `c_helios` -> Bristol Myers Squibb
- `c_vantage` -> Novo Nordisk
- `c_apex` -> Pfizer
- `c_cardinal` -> Bayer
- `c_solara` -> Cytokinetics
- `c_cascade` -> Roche
- `c_zenith` -> Viking Therapeutics
- `c_aurora` -> AstraZeneca (NEW)
- `c_vortex` -> Boehringer Ingelheim (NEW)
- `c_polaris` -> Novartis (NEW)
- `c_orion` -> Amgen (NEW)
- `c_atlas` -> BridgeBio (NEW)

(Variable names are intentionally not the company names — keeps downstream helper variable references stable. Company NAME and logo are real.)

- [ ] **Step 1: Append `_seed_demo_companies` rewrite to the migration file.**

Append after the RPC updates from Task 8:

```sql
-- =============================================================================
-- 3. helper: _seed_demo_companies (13 real companies)
-- =============================================================================

create or replace function public._seed_demo_companies(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian uuid := gen_random_uuid();
  c_helios   uuid := gen_random_uuid();
  c_vantage  uuid := gen_random_uuid();
  c_apex     uuid := gen_random_uuid();
  c_cardinal uuid := gen_random_uuid();
  c_solara   uuid := gen_random_uuid();
  c_cascade  uuid := gen_random_uuid();
  c_zenith   uuid := gen_random_uuid();
  c_aurora   uuid := gen_random_uuid();
  c_vortex   uuid := gen_random_uuid();
  c_polaris  uuid := gen_random_uuid();
  c_orion    uuid := gen_random_uuid();
  c_atlas    uuid := gen_random_uuid();
begin
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_meridian, p_space_id, p_uid, 'Eli Lilly',            'https://cdn.brandfetch.io/domain/lilly.com',                1),
    (c_vantage,  p_space_id, p_uid, 'Novo Nordisk',         'https://cdn.brandfetch.io/domain/novonordisk.com',          2),
    (c_aurora,   p_space_id, p_uid, 'AstraZeneca',          'https://cdn.brandfetch.io/domain/astrazeneca.com',          3),
    (c_vortex,   p_space_id, p_uid, 'Boehringer Ingelheim', 'https://cdn.brandfetch.io/domain/boehringer-ingelheim.com', 4),
    (c_helios,   p_space_id, p_uid, 'Bristol Myers Squibb', 'https://cdn.brandfetch.io/domain/bms.com',                  5),
    (c_solara,   p_space_id, p_uid, 'Cytokinetics',         'https://cdn.brandfetch.io/domain/cytokinetics.com',         6),
    (c_cardinal, p_space_id, p_uid, 'Bayer',                'https://cdn.brandfetch.io/domain/bayer.com',                7),
    (c_polaris,  p_space_id, p_uid, 'Novartis',             'https://cdn.brandfetch.io/domain/novartis.com',             8),
    (c_apex,     p_space_id, p_uid, 'Pfizer',               'https://cdn.brandfetch.io/domain/pfizer.com',               9),
    (c_cascade,  p_space_id, p_uid, 'Roche',                'https://cdn.brandfetch.io/domain/roche.com',                10),
    (c_orion,    p_space_id, p_uid, 'Amgen',                'https://cdn.brandfetch.io/domain/amgen.com',                11),
    (c_zenith,   p_space_id, p_uid, 'Viking Therapeutics',  'https://cdn.brandfetch.io/domain/vikingtherapeutics.com',   12),
    (c_atlas,    p_space_id, p_uid, 'BridgeBio',            'https://cdn.brandfetch.io/domain/bridgebio.com',            13);

  insert into public._seed_ids (entity_type, key, id) values
    ('company', 'c_meridian',  c_meridian),
    ('company', 'c_helios',    c_helios),
    ('company', 'c_vantage',   c_vantage),
    ('company', 'c_apex',      c_apex),
    ('company', 'c_cardinal',  c_cardinal),
    ('company', 'c_solara',    c_solara),
    ('company', 'c_cascade',   c_cascade),
    ('company', 'c_zenith',    c_zenith),
    ('company', 'c_aurora',    c_aurora),
    ('company', 'c_vortex',    c_vortex),
    ('company', 'c_polaris',   c_polaris),
    ('company', 'c_orion',     c_orion),
    ('company', 'c_atlas',     c_atlas);
end;
$$;
```

- [ ] **Step 2: Run `supabase db reset` to confirm the helper compiles.**

```bash
supabase db reset
```

Expected: completes without error; the new helper definition is loaded.

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_companies with 13 real cardiometabolic companies"
```

### Task 10: Rewrite `_seed_demo_therapeutic_areas` (5 TAs incl ATTR-CM)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:29-53`. Adds `ta_attr_cm` as a 5th variable.

- [ ] **Step 1: Append helper rewrite.**

```sql
-- =============================================================================
-- 4. helper: _seed_demo_therapeutic_areas (5 TAs)
-- =============================================================================

create or replace function public._seed_demo_therapeutic_areas(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  ta_hf       uuid := gen_random_uuid();
  ta_ckd      uuid := gen_random_uuid();
  ta_t2d      uuid := gen_random_uuid();
  ta_obesity  uuid := gen_random_uuid();
  ta_attr_cm  uuid := gen_random_uuid();
begin
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf,      p_space_id, p_uid, 'Heart Failure',          'HF'),
    (ta_ckd,     p_space_id, p_uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d,     p_space_id, p_uid, 'Type 2 Diabetes',        'T2D'),
    (ta_obesity, p_space_id, p_uid, 'Obesity',                'OB'),
    (ta_attr_cm, p_space_id, p_uid, 'ATTR Cardiomyopathy',    'ATTR-CM');

  insert into public._seed_ids (entity_type, key, id) values
    ('ta', 'ta_hf',      ta_hf),
    ('ta', 'ta_ckd',     ta_ckd),
    ('ta', 'ta_t2d',     ta_t2d),
    ('ta', 'ta_obesity', ta_obesity),
    ('ta', 'ta_attr_cm', ta_attr_cm);
end;
$$;
```

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_therapeutic_areas with 5 TAs incl ATTR-CM"
```

### Task 11: Rewrite `_seed_demo_products` (28 real products)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:59-140`. Define 28 product variables with mnemonic names, look up the 13 company UUIDs from `_seed_ids`, insert with company assignments per spec section "Products", then register all 28 in `_seed_ids`.

**Product variable -> brand/generic mapping** (use these exact names):

| Variable | Brand name | Generic name | Company variable | display_order |
|---|---|---|---|---|
| p_mounjaro | Mounjaro | tirzepatide | c_meridian | 1 |
| p_zepbound | Zepbound | tirzepatide | c_meridian | 2 |
| p_retatrutide | -- | retatrutide | c_meridian | 3 |
| p_orforglipron | -- | orforglipron | c_meridian | 4 |
| p_trulicity | Trulicity | dulaglutide | c_meridian | 5 |
| p_ozempic | Ozempic | semaglutide | c_vantage | 1 |
| p_wegovy | Wegovy | semaglutide | c_vantage | 2 |
| p_rybelsus | Rybelsus | semaglutide (oral) | c_vantage | 3 |
| p_cagrisema | -- | CagriSema | c_vantage | 4 |
| p_farxiga | Farxiga | dapagliflozin | c_aurora | 1 |
| p_azd5004 | -- | AZD5004 | c_aurora | 2 |
| p_jardiance | Jardiance | empagliflozin | c_vortex | 1 |
| p_survodutide | -- | survodutide | c_vortex | 2 |
| p_camzyos | Camzyos | mavacamten | c_helios | 1 |
| p_aficamten | -- | aficamten | c_solara | 1 |
| p_omecamtiv | -- | omecamtiv mecarbil | c_solara | 2 |
| p_kerendia | Kerendia | finerenone | c_cardinal | 1 |
| p_verquvo | Verquvo | vericiguat | c_cardinal | 2 |
| p_entresto | Entresto | sacubitril-valsartan | c_polaris | 1 |
| p_leqvio | Leqvio | inclisiran | c_polaris | 2 |
| p_vyndaqel | Vyndaqel | tafamidis | c_apex | 1 |
| p_danuglipron | -- | danuglipron | c_apex | 2 |
| p_ct388 | -- | CT-388 | c_cascade | 1 |
| p_ct996 | -- | CT-996 | c_cascade | 2 |
| p_maritide | MariTide | maridebart cafraglutide | c_orion | 1 |
| p_vk2735_sc | -- | VK2735 (subcutaneous) | c_zenith | 1 |
| p_vk2735_oral | -- | VK2735 (oral) | c_zenith | 2 |
| p_attruby | Attruby | acoramidis | c_atlas | 1 |

- [ ] **Step 1: Append helper rewrite.**

Use the structure from `20260501020000_seed_demo_data_gated.sql:59-140`. Look up company UUIDs from `_seed_ids`. Generate 28 product UUIDs. Insert with `(id, space_id, created_by, company_id, name, generic_name, display_order)`. For products without a brand name (research-stage codes), use the generic / code as the `name` and set `generic_name = null`. For brand+generic products, `name` = brand, `generic_name` = generic.

For products where the brand cell is `--` in the table above:
- p_retatrutide: name='retatrutide', generic_name=null
- p_orforglipron: name='orforglipron', generic_name=null
- p_cagrisema: name='CagriSema', generic_name='cagrilintide + semaglutide'
- p_azd5004: name='AZD5004', generic_name=null
- p_survodutide: name='survodutide', generic_name=null
- p_aficamten: name='aficamten', generic_name=null
- p_omecamtiv: name='omecamtiv mecarbil', generic_name=null
- p_danuglipron: name='danuglipron', generic_name=null
- p_ct388: name='CT-388', generic_name=null
- p_ct996: name='CT-996', generic_name=null
- p_vk2735_sc: name='VK2735 (SC)', generic_name=null
- p_vk2735_oral: name='VK2735 (oral)', generic_name=null

Register all 28 in `_seed_ids` with `('product', '<varname>', <uuid>)` rows.

- [ ] **Step 2: Reset and verify the function compiles + can run successfully when called from the orchestrator.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_products with 28 real cardiometabolic products"
```

### Task 12: Rewrite `_seed_demo_moa_roa` (12 MoA + 3 RoA + 28 product mappings)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:146-255`. Define 12 MoA + 3 RoA variables, look up all 28 product UUIDs, insert MoA/RoA rows, then product->MoA and product->RoA mappings.

**MoA list (12 entries with abbreviation, description, display_order):**

| # | Name | Abbrev | Display order |
|---|---|---|---|
| 1 | SGLT2 inhibitor | SGLT2i | 1 |
| 2 | GLP-1 receptor agonist | GLP-1 RA | 2 |
| 3 | GIP/GLP-1 dual agonist | GIP/GLP-1 | 3 |
| 4 | GIP/GLP-1/glucagon triple agonist | Triple | 4 |
| 5 | GLP-1/glucagon dual agonist | GLP-1/Glucagon | 5 |
| 6 | GIPR antagonist + GLP-1 agonist | GIPR-A/GLP-1 | 6 |
| 7 | Non-steroidal MRA | nsMRA | 7 |
| 8 | sGC stimulator | sGC | 8 |
| 9 | Cardiac myosin inhibitor | CMI | 9 |
| 10 | TTR stabilizer | TTR | 10 |
| 11 | ARNI | ARNI | 11 |
| 12 | PCSK9 siRNA | PCSK9 siRNA | 12 |

Provide a one-sentence description for each (e.g., SGLT2i: "Blocks sodium-glucose co-transporter 2 in the kidney."). Use precise mechanism wording — review existing seed for tone reference.

**RoA list (3):** Oral (PO), Subcutaneous (SC), Intravenous (IV).

**Product -> MoA mapping (one row per product, except where dual MoA noted):**

| Product var | MoA |
|---|---|
| p_mounjaro | GIP/GLP-1 dual agonist |
| p_zepbound | GIP/GLP-1 dual agonist |
| p_retatrutide | GIP/GLP-1/glucagon triple agonist |
| p_orforglipron | GLP-1 receptor agonist |
| p_trulicity | GLP-1 receptor agonist |
| p_ozempic | GLP-1 receptor agonist |
| p_wegovy | GLP-1 receptor agonist |
| p_rybelsus | GLP-1 receptor agonist |
| p_cagrisema | GLP-1 receptor agonist (also amylin -- but only seed GLP-1 since CagriSema is the dual product, drop the amylin row) |
| p_farxiga | SGLT2 inhibitor |
| p_azd5004 | GLP-1 receptor agonist |
| p_jardiance | SGLT2 inhibitor |
| p_survodutide | GLP-1/glucagon dual agonist |
| p_camzyos | Cardiac myosin inhibitor |
| p_aficamten | Cardiac myosin inhibitor |
| p_omecamtiv | Cardiac myosin inhibitor |
| p_kerendia | Non-steroidal MRA |
| p_verquvo | sGC stimulator |
| p_entresto | ARNI |
| p_leqvio | PCSK9 siRNA |
| p_vyndaqel | TTR stabilizer |
| p_danuglipron | GLP-1 receptor agonist |
| p_ct388 | GIP/GLP-1 dual agonist |
| p_ct996 | GLP-1 receptor agonist |
| p_maritide | GIPR antagonist + GLP-1 agonist |
| p_vk2735_sc | GIP/GLP-1 dual agonist |
| p_vk2735_oral | GIP/GLP-1 dual agonist |
| p_attruby | TTR stabilizer |

**Product -> RoA mapping:**

| Product var | RoA |
|---|---|
| p_mounjaro | SC |
| p_zepbound | SC |
| p_retatrutide | SC |
| p_orforglipron | Oral |
| p_trulicity | SC |
| p_ozempic | SC |
| p_wegovy | SC |
| p_rybelsus | Oral |
| p_cagrisema | SC |
| p_farxiga | Oral |
| p_azd5004 | Oral |
| p_jardiance | Oral |
| p_survodutide | SC |
| p_camzyos | Oral |
| p_aficamten | Oral |
| p_omecamtiv | Oral |
| p_kerendia | Oral |
| p_verquvo | Oral |
| p_entresto | Oral |
| p_leqvio | SC |
| p_vyndaqel | Oral |
| p_danuglipron | Oral |
| p_ct388 | SC |
| p_ct996 | Oral |
| p_maritide | SC |
| p_vk2735_sc | SC |
| p_vk2735_oral | Oral |
| p_attruby | Oral |

- [ ] **Step 1: Append helper rewrite. Insert MoA + RoA rows, then `product_mechanisms_of_action` rows, then `product_routes_of_administration` rows.**

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_moa_roa with 12 MoA + 3 RoA + 28 product mappings"
```

### Task 13: Rewrite `_seed_demo_trials` (~35 real trials)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:261-485`. The new version inserts ~35 trials matching spec section "Trials". Use **verified** values from `docs/specs/seed-data-verification.md` for: identifier (NCT), sample_size, phase_start_date, phase_end_date, recruitment_status, primary_completion_date, study_type, design_*, conditions, intervention_type, intervention_name, primary_outcome_measures, has_dmc, is_fda_regulated_drug. For unverified entries, leave NCT null and note in a SQL comment.

**Trial variable naming convention:** `t_<short_name>` matching the trial's well-known acronym, e.g. `t_surmount_1`, `t_step_1`, `t_dapa_hf`, `t_explorer_hcm`. For trials without a clean acronym, use the drug + indication, e.g. `t_vk2735_sc_p2`, `t_maritide_p2`, `t_ct388_p2`, `t_danuglipron_p2`.

**phase_type values from the existing schema:** `'PRECLIN' | 'P1' | 'P2' | 'P3' | 'P4' | 'APPROVED' | 'LAUNCHED'`.

**Mapping trial -> product / TA / phase / status:** All 35 trials defined in spec section "Trials > Timeline trials (10)" and "Landscape trials (25)". Use the verified report for dates and sample sizes. For each row, include a SQL comment with the source URL: `-- src: https://clinicaltrials.gov/study/<NCT>` or `-- src: <FDA / press release URL>` or `-- src: VERIFY -- <reason>` for unverified.

For each `update public.trials set ...` clause adding CT.gov dimensions (recruitment_status, study_type, phase, design_allocation, design_intervention_model, design_masking, design_primary_purpose, conditions, intervention_type, intervention_name, primary_outcome_measures, secondary_outcome_measures, eligibility_sex, eligibility_min_age, eligibility_max_age, start_date, start_date_type, primary_completion_date, primary_completion_date_type, has_dmc, is_fda_regulated_drug, is_fda_regulated_device): only add for trials with verified CT.gov data. ~15 of the 35 trials will have CT.gov enrichment; the rest leave the dimension columns null.

Register all trial UUIDs in `_seed_ids`.

- [ ] **Step 1: Append helper rewrite.**

- [ ] **Step 2: Reset and verify the seed runs end-to-end.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_trials with ~35 real cardiometabolic trials"
```

### Task 14: Rewrite `_seed_demo_markers` (~75 real markers)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:491-739`. Insert markers per spec section "Markers" (~75 total across 11 categories: topline data past, topline data projected, regulatory filings past, regulatory filings projected, approvals + launches, primary completion dates, trial starts, LOE / generic entry, no longer expected, range markers, many-to-many shared markers).

**Marker_type_id constants (from `seed.sql`):**
- Topline Data: `a0000000-0000-0000-0000-000000000013`
- Interim Data: `a0000000-0000-0000-0000-000000000030`
- Full Data: `a0000000-0000-0000-0000-000000000031`
- Regulatory Filing: `a0000000-0000-0000-0000-000000000032`
- Submission: `a0000000-0000-0000-0000-000000000033`
- Acceptance: `a0000000-0000-0000-0000-000000000034`
- Primary Completion Date (PCD): `a0000000-0000-0000-0000-000000000008`
- Trial Start: `a0000000-0000-0000-0000-000000000011`
- Trial End: `a0000000-0000-0000-0000-000000000012`
- Approval: `a0000000-0000-0000-0000-000000000035`
- Launch: `a0000000-0000-0000-0000-000000000036`
- LOE Date: `a0000000-0000-0000-0000-000000000020`
- Generic Entry Date: `a0000000-0000-0000-0000-000000000021`

**Projection values:** `'actual'` (event has happened), `'company'` (company-stated projection), `'primary'` (primary-source projection), `'secondary'` (secondary-source).

**For each marker:** insert into `public.markers (id, space_id, created_by, marker_type_id, title, projection, event_date, end_date?, no_longer_expected?, description?, source_url?)` then `marker_assignments (marker_id, trial_id)` linking to the trial.

For many-to-many markers (e.g. Zepbound HFpEF sNDA covering both SUMMIT and SURMOUNT-1), insert one marker row and two `marker_assignments` rows.

For LOE markers (Entresto LOE Jul 2025, Vyndaqel LOE 2024-2028, Trulicity LOE 2027, Jardiance LOE 2028): assign to the relevant trial OR leave un-assigned if no clean trial fit. (Schema allows markers without assignments — they appear product-wide via product_id JOIN if applicable. Confirm by re-reading the markers table schema.)

Register named marker UUIDs in `_seed_ids` for any marker referenced by `_seed_demo_primary_intelligence` (specifically: SUMMIT topline, REDEFINE-1 disappointment, orforglipron readout, MariTide P2 readout — see Task 15 for the exact list).

- [ ] **Step 1: Append helper rewrite.**

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_markers with ~75 real cardiometabolic markers"
```

### Task 15: Rewrite `_seed_demo_trial_notes` (~15 real analyst notes)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:745-779`. Insert ~15 analyst-style notes from spec section "Trial notes". Each row: `(id, space_id, created_by, trial_id, content)`.

Notes (write all 15, expanding the 7 examples in the spec):
1. SUMMIT: "First HFpEF outcomes trial in obese patients to show improvement on KCCQ-CSS. Sets a new standard for cardiometabolic trial design that combines body weight + clinical outcomes."
2. REDEFINE-1: "Weight loss of ~22.7% missed Street's ~25% bar. CagriSema differentiation thesis (additive amylin effect) weakened. Read-through to amycretin and other Novo combo bets."
3. SURMOUNT-1: "Tirzepatide ~22% weight loss at 72 weeks redefined the obesity efficacy bar. Fastest US obesity launch ramp on record post-approval."
4. SELECT: "First obesity drug to demonstrate CV outcomes benefit independent of glycemic effect. Reframes payer ROI calculation -- now defensible on cardiology budget, not just metabolic."
5. FLOW: "Broadens semaglutide label to non-diabetic CKD an open question for next FDA cycle. Substantially expands TAM."
6. ATTRibute-CM: "Acoramidis vs tafamidis: head-to-head data lacking; payer pressure expected. Real-world switching dynamics will define 2026."
7. SEQUOIA-HCM: "Aficamten data closely tracks EXPLORER-HCM. NDA filed Q3 2024; PDUFA 2025. Differentiation will come on dosing convenience and onset of effect."
8. MAPLE-HCM: "Head-to-head vs metoprolol the first true active-control HCM trial. Result will set the bar for displacement of beta-blockers as first-line."
9. Pfizer danuglipron: "Discontinuation a clean signal that oral GLP-1 small molecule is harder than the SC peptide. Reads through to Lilly orforglipron and other oral programs."
10. EMPACT-MI: "Failed primary in post-MI -- limits SGLT2 expansion narrative. Doesn't reverse HFrEF / HFpEF / CKD wins but caps the indication ladder."
11. ODYSSEY-HCM: "BMS Camzyos failed primary in nHCM -- limits indication expansion vs. obstructive form. Aficamten ACACIA-HCM still in play for nHCM."
12. FINEARTS-HF: "First nsMRA HFpEF win opens a non-SGLT2 / non-ARNI lane. Combined with EMPEROR-Preserved, suggests HFpEF treatment cocktail forming."
13. Viking VK2735 SC: "P2 ~13-15% weight loss at 13 weeks competitive with tirzepatide+semaglutide ramp. M&A speculation justified given Viking pipeline depth."
14. CT-388: "Roche entry via Carmot acquisition late but well-resourced. P2 obesity readout 2026 the make-or-break catalyst."
15. MariTide: "GIPR antagonism (vs agonism) a differentiated bet. Mechanism distinct from Lilly/Novo entries; if validated, Amgen has a defensible second-mover position."

- [ ] **Step 1: Append helper rewrite.**

```sql
create or replace function public._seed_demo_trial_notes(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- look up all 15 trial UUIDs from _seed_ids
  t_summit       uuid := (select id from public._seed_ids where entity_type='trial' and key='t_summit');
  -- ... etc for the 14 others
begin
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values
    (gen_random_uuid(), p_space_id, p_uid, t_summit, 'First HFpEF outcomes trial in obese patients...'),
    -- ... 14 more rows ...
end;
$$;
```

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_trial_notes with 15 real analyst notes"
```

### Task 16: Rewrite `_seed_demo_events` (~10 real company-level events)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501020000_seed_demo_data_gated.sql:836+` (continues past the read window — check the file for the full body). Insert ~10 events from spec section "Events" (~10 reads).

**Event_category_id constants (from `seed.sql`):**
- Leadership: `e0000000-0000-0000-0000-000000000001`
- Regulatory: `e0000000-0000-0000-0000-000000000002`
- Financial: `e0000000-0000-0000-0000-000000000003`
- Strategic: `e0000000-0000-0000-0000-000000000004`
- Clinical: `e0000000-0000-0000-0000-000000000005`
- Commercial: `e0000000-0000-0000-0000-000000000006`

**Events to seed:**
1. Strategic, Roche acquires Carmot ($2.7B), 2023-12-04, c_cascade
2. Strategic, Lilly $4.5B manufacturing capacity expansion, 2024-02-23, c_meridian
3. Strategic, Novo Holdings acquires Catalent ($16.5B), 2024-02-05, c_vantage
4. Clinical, Pfizer discontinues danuglipron program, 2023-12-01, c_apex
5. Financial, Viking VK2735 P2 readout drives stock +120%, 2024-02-27, c_zenith
6. Financial, Novo CagriSema misses bar, stock -20%, 2024-12-20, c_vantage
7. Commercial, BridgeBio Attruby launch, 2024-12-09, c_atlas
8. Commercial, Lilly Mounjaro/Zepbound combined annual revenue >$15B, 2024-02-06 (FY2024 earnings), c_meridian
9. Regulatory, Wegovy SELECT label update for CV outcomes, 2024-03-08, c_vantage
10. Strategic, Pfizer pivots cardiometabolic R&D away from oral GLP-1, 2024-01-15 (post-danuglipron), c_apex

- [ ] **Step 1: Append helper rewrite.**

Read the existing helper from `20260501020000_seed_demo_data_gated.sql` to find the events table column list. The events table has columns including event_category_id, company_id, name/title, event_date, description. Use the existing helper's column list verbatim — do not invent columns.

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_events with 10 real cardiometabolic company events"
```

### Task 17: Rewrite `_seed_demo_primary_intelligence` (~10 real reads + cross-entity links)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501132002_seed_demo_intelligence_security_definer.sql` (full file is the helper). The new version is a `create or replace function` overwriting it. **Must use `security definer`** (matches existing pattern; see comment at top of `20260501132002`).

**Reads to seed (8 published + 2 drafts) per spec section "Primary intelligence":**

For each, insert one `public.primary_intelligence` row (id, space_id, entity_type, entity_id, state, headline, thesis_md, watch_md, implications_md, last_edited_by, created_at, updated_at) plus 3-5 `public.primary_intelligence_links` rows (primary_intelligence_id, entity_type, entity_id, relationship_type, gloss?, display_order).

Headlines (write the full thesis/watch/implications inline with realistic 3-5 sentence pharma CI prose):

1. Anchor: SUMMIT trial. Headline: "Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time". Links: Farxiga (Same class HF), Jardiance (Competitor HF), Kerendia (Same class HFpEF), Entresto (Predecessor HFrEF).
2. Anchor: REDEFINE-1 trial. Headline: "CagriSema misses 25% bar -- Novo's combo defense thesis under structural pressure". Links: Wegovy (Predecessor), Zepbound (Competitor), retatrutide (Future window competitor), VK2735 SC (Future window challenger).
3. Anchor: SEQUOIA-HCM trial. Headline: "Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race". Links: Camzyos product (Competitor), Cytokinetics company (Same class), Bristol Myers Squibb company (Competitor), MAPLE-HCM trial (Future window).
4. Anchor: FINEARTS-HF trial. Headline: "Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF". Links: Farxiga DELIVER (Same class HFpEF), Jardiance EMPEROR-Preserved (Same class HFpEF), Entresto PARAGON-HF (Predecessor non-win).
5. Anchor: VK2735 SC P2 trial. Headline: "Viking VK2735 P2: takeout target or independent path -- both scenarios under-priced". Links: Zepbound (Competitor), Wegovy (Competitor), MariTide (Same class), Roche company (Future window acquirer).
6. Anchor: ATTRibute-CM trial. Headline: "Acoramidis launches into a Vyndaqel-saturated market -- switching dynamics will define 2026". Links: Vyndaqel product (Competitor), Pfizer company (Competitor), ATTR-ACT trial (Predecessor).
7. Anchor: Pfizer (company). Headline: "Pfizer's cardiometabolic exit: danuglipron's discontinuation reframes the GLP-1 oral race". Links: orforglipron product (Future window), Rybelsus (Same class), AZD5004 (Competitor).
8. Anchor: Space (engagement-thematic). Headline: "Cardiometabolic catalyst cluster H2 2026: TRIUMPH-1, ATTAIN-1, ACHIEVE-1, MAPLE-HCM in one window". Links: Lilly company (Future window), Novo Nordisk company (Future window), Cytokinetics company (Future window).
9. Draft. Anchor: orforglipron readout marker. Headline: "Pre-read framework for the orforglipron Phase 3 cluster". Links: ATTAIN-1 (Future window), ACHIEVE-1 (Future window), danuglipron (Predecessor failure).
10. Draft. Anchor: MariTide P2 trial. Headline: "MariTide differentiation thesis: GIPR antagonism vs agonism". Links: Mounjaro (Same class), Zepbound (Competitor), VK2735 SC (Same class).

For each marker / company / trial / product / space anchor: look up the entity UUID from `_seed_ids` (or use `p_space_id` directly for the space-anchor read).

- [ ] **Step 1: Append helper rewrite.**

Use the structure from `20260501132002_seed_demo_intelligence_security_definer.sql` verbatim as the template. Replace the body's content with the 10 reads above. Keep `security definer`.

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_primary_intelligence with 10 real analyst reads"
```

### Task 18: Rewrite `_seed_demo_materials` (~76 materials over 36 months)

**Files:**
- Modify: `supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql`

Existing helper at `20260501130349_extend_seed_demo_intelligence_and_materials.sql:191-273`. Insert ~76 materials matching spec section "Materials": 36 monthly briefings (programmatic), 15 conference reports (bespoke), ~13 priority notices (bespoke), ~12 ad hoc memos (bespoke).

**Engagement window:** 2023-05-01 to 2026-05-02 = 36 months.

**Monthly briefings (36):** Generated via `generate_series`. Each row:
- `material_type = 'briefing'`
- title = `'Competitive landscape briefing -- ' || to_char(month_date, 'Mon YYYY')`
- file_name = `'competitive-landscape-briefing-' || to_char(month_date, 'YYYY-MM') || '.pptx'`
- mime_type = `'application/vnd.openxmlformats-officedocument.presentationml.presentation'`
- file_size_bytes = pseudorandom in 1.5MB-3MB range (`1500000 + (random()*1500000)::bigint`)
- file_path = `'materials/' || p_space_id || '/' || mat_id || '/' || file_name`
- uploaded_at = month start + interval '1 day'

For each monthly briefing, insert 1-3 material_links pointing at the space + a representative trial active that month. For simplicity, link every monthly briefing to the space (`entity_type = 'space'`, `entity_id = p_space_id`). Skip entity-specific links for the monthly briefings — they're space-thematic.

```sql
-- Monthly briefings: 36 rows generated programmatically
with months as (
  select generate_series(
    date '2023-05-01',
    date '2026-04-01',
    interval '1 month'
  ) as month_start
),
new_materials as (
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at
  )
  select
    gen_random_uuid(),
    p_space_id,
    p_uid,
    'materials/' || p_space_id::text || '/' || gen_random_uuid()::text || '/competitive-landscape-briefing-' || to_char(m.month_start, 'YYYY-MM') || '.pptx',
    'competitive-landscape-briefing-' || to_char(m.month_start, 'YYYY-MM') || '.pptx',
    1500000 + (random()*1500000)::bigint,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'briefing',
    'Competitive landscape briefing -- ' || to_char(m.month_start, 'Mon YYYY'),
    m.month_start + interval '1 day'
  from months m
  returning id
)
insert into public.material_links (material_id, entity_type, entity_id, display_order)
select id, 'space', p_space_id, 0 from new_materials;
```

**Wait — file_path uses gen_random_uuid() in two places (id and the path).** That's a problem because the path UUID won't match the material's id. Fix by using a CTE that generates the UUID once:

```sql
with months as (
  select generate_series(
    date '2023-05-01',
    date '2026-04-01',
    interval '1 month'
  ) as month_start
),
materials_to_insert as (
  select
    gen_random_uuid() as mat_id,
    m.month_start,
    'competitive-landscape-briefing-' || to_char(m.month_start, 'YYYY-MM') || '.pptx' as file_name
  from months m
),
inserted as (
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at
  )
  select
    mat_id,
    p_space_id,
    p_uid,
    'materials/' || p_space_id::text || '/' || mat_id::text || '/' || file_name,
    file_name,
    1500000 + (random()*1500000)::bigint,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'briefing',
    'Competitive landscape briefing -- ' || to_char(month_start, 'Mon YYYY'),
    month_start + interval '1 day'
  from materials_to_insert
  returning id
)
insert into public.material_links (material_id, entity_type, entity_id, display_order)
select id, 'space', p_space_id, 0 from inserted;
```

**Conference reports (15):** Bespoke rows. material_type = 'conference_report'. Each links to 2-4 trials presented at that conference.

| Conference | Year | Date (week after end) | Themes (in title) | Linked trials |
|---|---|---|---|---|
| ADA | 2023 | 2023-06-30 | SURPASS series + STEP 2 / oral sema | t_surpass_2, t_step_1 |
| ESC | 2023 | 2023-09-04 | DELIVER subgroups + EMPEROR analyses | t_deliver, t_emperor_preserved |
| EASD | 2023 | 2023-09-29 | SURMOUNT readouts | t_surmount_1 |
| AHA | 2023 | 2023-11-20 | SELECT NEJM + EMPACT-MI design | t_select |
| ObesityWeek | 2023 | 2023-10-22 | Tirzepatide vs semaglutide head-to-head | t_surmount_1, t_step_1 |
| ADA | 2024 | 2024-06-28 | FLOW + tirzepatide HFpEF SUMMIT preview | t_flow, t_summit |
| ESC | 2024 | 2024-09-04 | FINEARTS-HF + EMPACT-MI failure | t_fineart_hf, t_empact_mi |
| EASD | 2024 | 2024-09-23 | CagriSema preview + REDEFINE | t_redefine_1 |
| AHA | 2024 | 2024-11-20 | SUMMIT NEJM + SEQUOIA-HCM full results | t_summit, t_sequoia_hcm |
| ObesityWeek | 2024 | 2024-11-08 | Zepbound real-world + retatrutide P2 | t_zepbound (no trial), t_summit |
| ADA | 2025 | 2025-06-26 | Orforglipron Phase 3 preview + Mounjaro long-term | t_attain_1 |
| ESC | 2025 | 2025-09-03 | Aficamten launch outlook + finerenone HFpEF | t_sequoia_hcm, t_fineart_hf |
| EASD | 2025 | 2025-09-22 | Survodutide P3 + GLP-1 oral race | t_survodutide_p2 |
| AHA | 2025 | 2025-11-19 | MAPLE-HCM preview + GLP-1 in cardiology | t_sequoia_hcm |
| ObesityWeek | 2025 | 2025-11-05 | Tirzepatide vs CagriSema field data | t_redefine_1 |

For each, insert one material row + one material_link per linked trial.

**Priority notices (~13):** Bespoke. material_type = 'priority_notice'. Each links to 1-3 entities (trial / company / product).

| Date | Title | Links |
|---|---|---|
| 2023-11-13 | Priority notice: SELECT NEJM publication and CV-outcomes label implications | t_select, p_wegovy |
| 2023-12-01 | Priority notice: Pfizer discontinues danuglipron program | c_apex, p_danuglipron |
| 2023-12-04 | Priority notice: Roche acquires Carmot for $2.7B | c_cascade, p_ct388, p_ct996 |
| 2024-02-27 | Priority notice: Viking VK2735 P2 readout -- stock +120% | c_zenith, p_vk2735_sc |
| 2024-03-12 | Priority notice: FLOW positive readout in CKD/T2D | t_flow, p_ozempic |
| 2024-04-08 | Priority notice: EMPACT-MI fails primary in post-MI population | t_empact_mi, p_jardiance |
| 2024-08-23 | Priority notice: SUMMIT positive in HFpEF + obesity | t_summit, p_zepbound |
| 2024-09-03 | Priority notice: SEQUOIA-HCM Full results + NDA filing planned | t_sequoia_hcm, p_aficamten |
| 2024-10-15 | Priority notice: ODYSSEY-HCM fails primary in non-obstructive HCM | t_odyssey_hcm, p_camzyos |
| 2024-11-22 | Priority notice: Attruby (acoramidis) FDA approval | p_attruby, c_atlas |
| 2024-12-20 | Priority notice: Zepbound approved for OSA | t_surmount_osa, p_zepbound |
| 2024-12-21 | Priority notice: REDEFINE-1 misses 25% bar -- CagriSema thesis impaired | t_redefine_1, p_cagrisema |
| 2025-01-30 | Priority notice: Ozempic FDA-approved for CKD in T2D (FLOW) | t_flow, p_ozempic |

**Ad hoc memos (~12):** Bespoke. material_type = 'ad_hoc'. Each links to relevant entities.

| Date | Title | Links |
|---|---|---|
| 2024-01-22 | Tirzepatide salesforce sizing -- US specialty endo channel | p_mounjaro, p_zepbound, c_meridian |
| 2024-02-15 | Viking takeout scenarios -- pre-and-post P2 readout | c_zenith, p_vk2735_sc |
| 2024-04-30 | Wegovy formulary access deep dive -- top 10 PBM coverage | p_wegovy, c_vantage |
| 2024-06-10 | HCM diagnostic / undiagnosed pool sizing | t_explorer_hcm, p_camzyos, p_aficamten |
| 2024-09-30 | HFpEF white space -- post-FINEARTS positioning | t_fineart_hf, p_kerendia |
| 2024-10-22 | Cardiometabolic lipid franchise add-on -- Leqvio scenario | p_leqvio, c_polaris |
| 2024-12-04 | ATTR-CM market expansion -- post-Attruby launch dynamics | p_attruby, p_vyndaqel |
| 2025-03-15 | Aficamten launch readiness assessment | p_aficamten, c_solara |
| 2025-04-22 | Salesforce reorg memo for HFpEF launches (BMS / BI) | c_helios, c_vortex |
| 2025-08-12 | Long-acting incretin landscape memo | p_orforglipron, p_retatrutide, p_maritide |
| 2025-10-20 | Generic-entry timing memo for Entresto | p_entresto, c_polaris |
| 2026-01-08 | Orforglipron pricing scenarios | p_orforglipron, c_meridian |

- [ ] **Step 1: Append helper rewrite combining the programmatic monthly briefings + bespoke conference reports + priority notices + ad hoc memos.**

- [ ] **Step 2: Reset and verify.**

```bash
supabase db reset
```

- [ ] **Step 3: Commit.**

```bash
git add supabase/migrations/20260502130000_seed_demo_realistic_cardiometabolic.sql
git commit -m "feat(seed): rewrite _seed_demo_materials with 76 materials over 36-month engagement"
```

---

## Phase 4: Verification (Task 19)

### Task 19: End-to-end verification

**Files:**
- None (verification only)

- [ ] **Step 1: Run `supabase db reset` cleanly.**

```bash
supabase db reset
```

Expected: completes without error.

- [ ] **Step 2: Manually invoke the `seed_demo_data` orchestrator for a test space and verify counts.**

```bash
psql "postgresql://postgres:postgres@127.0.0.1:54322/postgres" <<'SQL'
-- Create a test space + space owner if not exists, then call seed_demo_data.
-- (Exact commands depend on the existing test fixture pattern -- read seed.sql
-- and any existing demo-space fixture for the canonical setup.)
SQL
```

After seeding, run:

```sql
select count(*) from public.companies where space_id = '<test-space-id>';        -- expect 13
select count(*) from public.products where space_id = '<test-space-id>';         -- expect 28
select count(*) from public.therapeutic_areas where space_id = '<test-space-id>'; -- expect 5
select count(*) from public.trials where space_id = '<test-space-id>';            -- expect ~35
select count(*) from public.markers where space_id = '<test-space-id>';           -- expect ~75
select count(*) from public.trial_notes where space_id = '<test-space-id>';       -- expect ~15
select count(*) from public.events where space_id = '<test-space-id>';            -- expect ~10
select count(*) from public.primary_intelligence where space_id = '<test-space-id>'; -- expect 10
select count(*) from public.materials where space_id = '<test-space-id>';         -- expect ~76
select count(*) from public.materials where space_id = '<test-space-id>' and material_type = 'conference_report'; -- expect 15
```

- [ ] **Step 3: Run frontend lint + build.**

```bash
cd src/client && ng lint && ng build
```

Expected: both pass.

- [ ] **Step 4: Run the docs:arch regenerator (any RPC additions go in the runbook).**

```bash
cd src/client && npm run docs:arch
```

Expected: regenerates the auto-gen blocks in `docs/runbook/06-backend-architecture.md` and similar. Commit the regen.

- [ ] **Step 5: Final commit (only if docs:arch produced changes).**

```bash
git add docs/runbook/
git commit -m "docs(runbook): regen auto-gen blocks after realistic seed migration"
```

- [ ] **Step 6: Push branch.**

```bash
git push -u origin worktree-realistic-cardiometabolic-seed
```

---

## Acceptance criteria

(From spec):

1. `supabase db reset` runs cleanly through all migrations including the new one.
2. Calling `seed_demo_data(<space_id>)` for a space-owner test user populates 13 companies, 28 products, 5 TAs, ~35 trials, ~75 markers, ~15 notes, ~10 events, ~10 primary intelligence reads, and ~76 materials.
3. The materials browse page renders the `Conference reports` filter chip and applies it correctly when clicked.
4. `cd src/client && ng lint && ng build` passes.
5. `docs/specs/seed-data-verification.md` exists and documents every NCT / date with its source URL.
