# Realistic cardiometabolic seed data

## Goal

Replace the synthetic demo seed (made-up companies / products / NCTs) with real cardiometabolic data so the demo dashboard reflects the actual competitive landscape pharma CI professionals work in: Lilly vs. Novo on GLP-1s, BMS vs. Cytokinetics on cardiac myosin, the SGLT2 incumbents (AZ, BI), the late entrants (Roche, Amgen, Viking), and the ATTR-CM duopoly (Pfizer, BridgeBio). Built around a 3-year engagement (started May 1, 2023) so the materials timeline shows the kind of accumulated work product a real Stout client relationship produces.

## Background

The current demo seed uses real big-pharma company names but synthetic products, generic names, trial names, and NCT IDs (`Zelvox`, `cortagliflozin`, `CARDIO-SHIELD`, `NCT05001001`). It's structurally complete (companies, products, MoA/RoA, trials, markers, primary intelligence, materials) but the made-up entity names break the demo for anyone who knows the real space. A pharma CI prospect looks at it, sees `MRD-4471` and `Cardivant`, and immediately disengages.

This spec replaces the entity content while keeping the schema and helper architecture intact. No table structure changes except the small `material_type` extension described below.

## Snapshot date

The seed is anchored to **2026-05-02**. Every "approved / pending / projected" state is relative to this moment. The migration header carries an explicit `-- snapshot date: 2026-05-02. Refresh quarterly.` comment.

My knowledge cutoff is January 2026; today's system date is May 2, 2026. For events between Feb-May 2026 I'll use my best estimate from public-trajectory information and flag each one with `VERIFY:` so the verification pass can confirm or correct it.

## Scope

### In scope

- Rewrite of 10 helper-function bodies in one new migration: `_seed_demo_companies`, `_seed_demo_therapeutic_areas`, `_seed_demo_products`, `_seed_demo_moa_roa`, `_seed_demo_trials`, `_seed_demo_markers`, `_seed_demo_trial_notes`, `_seed_demo_events`, `_seed_demo_primary_intelligence`, `_seed_demo_materials`. The outer `seed_demo_data` orchestrator and its space-owner permission gate are unchanged.
- New `material_type = 'conference_report'` end-to-end (schema CHECK constraint + 2 RPC whitelists + 6 frontend files).
- Verification report at `docs/specs/seed-data-verification.md` listing every NCT, sample size, completion date, and approval date with its source URL.

### Out of scope

- No changes to `system marker_types` or `system event_categories` (those live in `seed.sql` and stay generic).
- No schema changes other than the `material_type` CHECK extension.
- No changes to RLS policies, RPCs unrelated to materials, or any dashboard / landscape / bullseye logic.
- No changes to the `/seed-demo` route or `dashboardService.seedDemoData()`.
- No real file uploads -- material rows reference plausible storage paths but don't upload bytes (download flows 404 cleanly, by design, matching current behavior).

## Architecture

One new migration file: `supabase/migrations/<timestamp>_seed_demo_realistic_cardiometabolic.sql`

Contents in order:
1. Schema change: drop and recreate the `materials.material_type` CHECK constraint to add `conference_report`.
2. RPC updates: extend the whitelist in `create_material` and `update_material` to include `conference_report`. Use `create or replace function` to overwrite the existing definitions cleanly.
3. Helper rewrites: 10 `create or replace function` blocks for the seed helpers, in dependency order (companies -> TAs -> products -> MoA/RoA -> trials -> markers -> notes -> events -> primary_intelligence -> materials).

Frontend changes touch 6 files (no architectural changes -- additive only):
- `src/client/src/app/core/models/material.model.ts` -- add `'conference_report'` to the type union.
- `src/client/src/app/core/services/material.service.ts` -- extend any label/icon lookup map.
- `src/client/src/app/shared/components/material-row/material-row.component.ts` -- icon + label for the new type. Proposed: lucide `presentation` icon, slate-600.
- `src/client/src/app/shared/components/material-upload-zone/material-upload-zone.component.ts` -- dropdown option.
- `src/client/src/app/features/materials-browse/materials-browse-page.component.ts` -- filter chip.
- `src/client/src/app/shared/components/materials-section/materials-section.component.ts` -- grouped rendering if grouping by type.

## Companies (13)

| # | Name | Why included |
|---|---|---|
| 1 | Eli Lilly | GLP-1 incumbent (Mounjaro, Zepbound) + late-stage triple agonist + oral GLP-1 |
| 2 | Novo Nordisk | Defending GLP-1 champion (Ozempic, Wegovy, Rybelsus) losing share to Lilly |
| 3 | AstraZeneca | SGLT2 anchor (Farxiga) + GLP-1 catch-up (AZD5004 ex-Eccogene) |
| 4 | Boehringer Ingelheim | SGLT2 anchor (Jardiance, with Lilly) + GLP-1/glucagon (survodutide, with Zealand) |
| 5 | Bristol Myers Squibb | HCM anchor (Camzyos) |
| 6 | Cytokinetics | Camzyos challenger (aficamten) |
| 7 | Bayer | Renal MRA (Kerendia) + sGC stimulator (Verquvo, with Merck) |
| 8 | Novartis | HF incumbent (Entresto LOE imminent) + lipid bet (Leqvio) |
| 9 | Pfizer | TTR-CM anchor (Vyndaqel/Vyndamax) + cautionary tale (danuglipron discontinued Dec 2023) |
| 10 | Roche | Late entrant via Carmot acquisition (CT-388, CT-996) |
| 11 | Amgen | Differentiated mechanism (MariTide: GIPR antagonist + GLP-1 agonist) |
| 12 | Viking Therapeutics | Pure-play obesity biotech (VK2735 SC + oral) |
| 13 | BridgeBio | ATTR-CM challenger (Attruby/acoramidis approved Nov 2024) |

Each company gets a real `logo_url` via the existing `https://cdn.brandfetch.io/domain/<domain>` pattern.

## Therapeutic areas (5)

`Heart Failure (HF)`, `Chronic Kidney Disease (CKD)`, `Type 2 Diabetes (T2D)`, `Obesity (OB)`, `ATTR Cardiomyopathy (ATTR-CM)`.

ATTR-CM is added as a 5th TA (vs. the current 4) so Vyndaqel and Attruby get a clean home; folding under HF would muddy the GLP-1/SGLT2 HF analysis.

## Products (28)

Full list with company assignment (entries marked `VERIFY` get fact-checked during the verification pass):

| Company | Products |
|---|---|
| Eli Lilly | Mounjaro (tirzepatide T2D), Zepbound (tirzepatide obesity/OSA/HFpEF), retatrutide (Phase 3 GIP/GLP-1/glucagon), orforglipron (Phase 3 oral GLP-1), Trulicity (dulaglutide) |
| Novo Nordisk | Ozempic (semaglutide T2D/CV/CKD), Wegovy (semaglutide obesity/CV), Rybelsus (oral semaglutide), CagriSema (cagrilintide + semaglutide) |
| AstraZeneca | Farxiga (dapagliflozin SGLT2), AZD5004 (oral GLP-1 ex-Eccogene) |
| Boehringer Ingelheim | Jardiance (empagliflozin SGLT2, with Lilly), survodutide (GLP-1/glucagon, with Zealand) |
| Bristol Myers Squibb | Camzyos (mavacamten cardiac myosin) |
| Cytokinetics | aficamten (CK-274), omecamtiv mecarbil (historical) |
| Bayer | Kerendia (finerenone nsMRA), Verquvo (vericiguat sGC, with Merck) |
| Novartis | Entresto (sacubitril-valsartan ARNI), Leqvio (inclisiran PCSK9 siRNA) |
| Pfizer | Vyndaqel/Vyndamax (tafamidis TTR), danuglipron (oral GLP-1, **discontinued Dec 2023**) |
| Roche | CT-388 (dual GLP-1/GIP, ex-Carmot), CT-996 (oral GLP-1, ex-Carmot) |
| Amgen | MariTide (maridebart cafraglutide GIPR-antagonist + GLP-1) |
| Viking | VK2735 SC, VK2735 oral |
| BridgeBio | Attruby (acoramidis TTR stabilizer) |

Total: 28 products. Brand vs. molecule split (Mounjaro / Zepbound for tirzepatide) is preserved because pharma CI professionals track them as distinct commercial products.

## Mechanisms of action (12) and routes (3)

**MoA:** SGLT2 inhibitor, GLP-1 receptor agonist, GIP/GLP-1 dual agonist, GIP/GLP-1/glucagon triple agonist, GLP-1/glucagon dual agonist, GIPR antagonist + GLP-1 agonist (MariTide-unique), Non-steroidal MRA, sGC stimulator, Cardiac myosin inhibitor, TTR stabilizer, ARNI, PCSK9 siRNA.

**RoA:** Oral, Subcutaneous, IV. (Drop inhaled / IM / topical / intrathecal -- none apply.)

Drop the `Investigational (undisclosed)` MoA -- every product in this dataset has a known mechanism.

## Trials (~35)

### Timeline trials (10) -- pivotal, completed, drove an approval

| Trial | NCT | Sponsor | Drug | Indication | Approval |
|---|---|---|---|---|---|
| SURMOUNT-1 | NCT04184622 | Lilly | tirzepatide | Obesity | Nov 2023 |
| SURPASS-2 | NCT03987919 | Lilly | tirzepatide | T2D | May 2022 |
| STEP 1 | NCT03548935 | Novo | semaglutide 2.4mg | Obesity | Jun 2021 |
| SELECT | NCT03574597 | Novo | semaglutide | Obesity CV outcomes | Mar 2024 |
| DAPA-HF | NCT03036124 | AZ | dapagliflozin | HFrEF | May 2020 |
| EMPEROR-Reduced | NCT03057977 | BI | empagliflozin | HFrEF | Aug 2021 |
| EXPLORER-HCM | NCT03470545 | BMS | mavacamten | oHCM | Apr 2022 |
| PARADIGM-HF | NCT01035255 | Novartis | sacubitril-valsartan | HFrEF | Jul 2015 |
| ATTR-ACT | NCT01994889 | Pfizer | tafamidis | ATTR-CM | May 2019 |
| ATTRibute-CM | NCT03860935 | BridgeBio | acoramidis | ATTR-CM | Nov 2024 |

### Landscape trials (25) -- active / recently read out / future catalyst

| Trial | NCT | Sponsor | Drug | Indication | Phase / Status |
|---|---|---|---|---|---|
| SURMOUNT-MMO | NCT05556512 | Lilly | tirzepatide | Obesity CV outcomes | P3, readout 2027 |
| SUMMIT | NCT04847557 | Lilly | tirzepatide | HFpEF + obesity | P3, positive Aug 2024 |
| SURMOUNT-OSA | NCT05412004 | Lilly | tirzepatide | OSA | P3, approval Dec 2024 |
| ATTAIN-1 | `VERIFY` | Lilly | orforglipron | Obesity | P3, readout 2026 |
| ACHIEVE-1 | `VERIFY` | Lilly | orforglipron | T2D | P3, readout 2026 |
| TRIUMPH-1 | `VERIFY` | Lilly | retatrutide | Obesity | P3, readout 2026 |
| FLOW | NCT03819153 | Novo | semaglutide | CKD/T2D | P3, approval Jan 2025 |
| REDEFINE-1 | `VERIFY` | Novo | CagriSema | Obesity | P3, missed bar Dec 2024 |
| REDEFINE-2 | `VERIFY` | Novo | CagriSema | Obesity + T2D | P3, readout 2026 |
| SOUL | `VERIFY` | Novo | oral semaglutide | T2D CV outcomes | P3, positive 2024 |
| DELIVER | NCT03619213 | AZ | dapagliflozin | HFpEF | P3, approval May 2023 |
| DAPA-CKD | NCT03036150 | AZ | dapagliflozin | CKD | P3, approval Apr 2021 |
| EMPEROR-Preserved | NCT03057951 | BI | empagliflozin | HFpEF | P3, approval Feb 2022 |
| EMPA-KIDNEY | NCT03594110 | BI | empagliflozin | CKD | P3, approval Sep 2023 |
| EMPACT-MI | NCT04509674 | BI | empagliflozin | Post-MI | P3, **failed primary 2024** |
| Survodutide P2 obesity | `VERIFY` | BI/Zealand | survodutide | Obesity | P2, positive 2024 |
| FINEARTS-HF | NCT04435626 | Bayer | finerenone | HFpEF | P3, positive Aug 2024 |
| SEQUOIA-HCM | NCT05186818 | Cytokinetics | aficamten | oHCM | P3, NDA filed 2024 |
| MAPLE-HCM | `VERIFY` | Cytokinetics | aficamten | oHCM (vs metoprolol) | P3, readout 2026 |
| ACACIA-HCM | `VERIFY` | Cytokinetics | aficamten | nHCM | P3, readout 2027 |
| ODYSSEY-HCM | `VERIFY` | BMS | mavacamten | nHCM | P3, **failed primary 2024** |
| CT-388 P2 | `VERIFY` | Roche | CT-388 | Obesity | P2 ongoing |
| VK2735 SC P2 | `VERIFY` | Viking | VK2735 SC | Obesity | P2, positive 2024 |
| VK2735 oral P1/2 | `VERIFY` | Viking | VK2735 oral | Obesity | P1/2 ongoing |
| MariTide P2 | `VERIFY` | Amgen | maridebart cafraglutide | Obesity | P2 readout late 2024/early 2025 |
| Danuglipron P2 | `VERIFY` | Pfizer | danuglipron | Obesity | **Discontinued Dec 2023** |

`VERIFY` rows: NCT IDs that are either uncertain in my training data or registered after my Jan 2026 cutoff. The verification pass either fills them in from ClinicalTrials.gov or leaves the `identifier` column null with a SQL comment listing my best guess.

The set deliberately includes:
- Two **failed primary** trials (EMPACT-MI, ODYSSEY-HCM) for the "negative outcome" demo path.
- One **discontinued asset** (danuglipron) for the "no longer expected" marker path.
- A mix of completed-with-approval, recently read out, actively recruiting, and future-readout phases for filter and timeline coverage.

## Markers (~75)

Distribution by category:

| Category | Count | Examples |
|---|---|---|
| Topline data readouts (past) | ~15 | SURMOUNT-1 NEJM Jul 2022; STEP 1 NEJM Mar 2021; SELECT NEJM Nov 2023; FLOW NEJM May 2024; SUMMIT NEJM Nov 2024; SEQUOIA-HCM AHA 2024; FINEARTS-HF ESC 2024; REDEFINE-1 Dec 2024 |
| Topline data readouts (projected) | ~10 | TRIUMPH-1 H2 2026; ATTAIN-1 mid-2026; ACHIEVE-1 mid-2026; MAPLE-HCM 2026; ACACIA-HCM 2027; SURMOUNT-MMO 2027; CT-388 P2 final 2026 |
| Regulatory filings (past) | ~10 | Wegovy sNDA SELECT (early 2024); aficamten NDA Sep 2024; finerenone sNDA HFpEF; Zepbound sNDA OSA |
| Regulatory filings (projected) | ~5 | tirzepatide HFpEF sNDA; orforglipron NDA; retatrutide NDA; CagriSema NDA |
| Approvals + launches | ~14 | One approval marker + one launch marker per launched product (10 timeline products + recent FLOW, SURMOUNT-OSA, ATTRibute-CM, FINEARTS-HF approvals) |
| Primary completion dates | ~6 | Active P3s, real PCDs from CT.gov |
| Trial starts | ~5 | Early-phase trials, real start dates from CT.gov |
| Loss of exclusivity / generic entry | ~5 | Entresto US LOE Jul 2025; Trulicity LOE 2027; Vyndaqel/Vyndamax LOE 2024-2028; Jardiance LOE 2028 |
| No longer expected (failures / DCs) | ~3 | Pfizer danuglipron DC Dec 2023; ODYSSEY-HCM failed primary 2024; EMPACT-MI failed primary 2024 |
| Range markers (launch windows) | ~3 | aficamten US launch window Q4 2025-Q1 2026; finerenone HFpEF launch window 2025-2026 |
| Many-to-many shared markers | ~2 | Semaglutide CKD label expansion (FLOW + SUSTAIN); Zepbound HFpEF sNDA (SUMMIT + SURMOUNT-1) |

Future-dated markers (~24 total: projected readouts + projected filings + range markers + LOEs) ensure the Future Catalysts feed has populated content.

## Events (~10)

Company-level events not tied to a specific trial. Real recent events:

- **Strategic:** Roche acquires Carmot ($2.7B, Dec 2023); Lilly $4.5B in additional manufacturing capacity (2024); Novo Holdings acquires Catalent ($16.5B, 2024).
- **Clinical:** Pfizer discontinues danuglipron program (Dec 2023).
- **Financial:** Viking VK2735 P2 readout sends stock +120% (Feb 2024); Novo CagriSema misses bar, stock -20% (Dec 2024).
- **Commercial:** BridgeBio Attruby launch (Dec 2024); Lilly Mounjaro/Zepbound combined annual revenue >$15B (2024).
- **Regulatory:** FDA-related events for the cardiometabolic space (sparingly -- these go stale fast).

## Trial notes (~15)

Short analyst-style commentary, one per major trial. Real angles:
- "First HFpEF trial in obese patients to show improvement on KCCQ-CSS" (SUMMIT)
- "REDEFINE-1 weight loss of ~22.7% missed Street's ~25% bar; CagriSema differentiation thesis weakened"
- "Fastest US obesity launch ramp on record" (Zepbound / SURMOUNT-1)
- "FLOW broadens semaglutide label to non-diabetic CKD an open question for next cycle"
- "Acoramidis vs tafamidis: head-to-head data lacking; payer pressure expected" (ATTRibute-CM)
- "Aficamten head-to-head vs metoprolol the first true active-control HCM trial" (MAPLE-HCM)
- "Danuglipron discontinuation a clean signal that oral GLP-1 small molecule is harder than the SC peptide" (Pfizer)

## Primary intelligence (~10 reads)

Eight published, two drafts. Each anchored to one entity (trial / marker / company / product / space) and linked to others via `primary_intelligence_links`.

| # | Anchor | State | Headline |
|---|---|---|---|
| 1 | SUMMIT trial | Published | Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time |
| 2 | REDEFINE-1 trial | Published | CagriSema misses 25% bar -- Novo's combo defense thesis under structural pressure |
| 3 | SEQUOIA-HCM trial | Published | Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race |
| 4 | FINEARTS-HF trial | Published | Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF |
| 5 | VK2735 P2 trial | Published | Viking VK2735 P2: takeout target or independent path -- both scenarios under-priced |
| 6 | ATTRibute-CM trial | Published | Acoramidis launches into a Vyndaqel-saturated market -- switching dynamics will define 2026 |
| 7 | Pfizer (company) | Published | Pfizer's cardiometabolic exit: danuglipron's discontinuation reframes the GLP-1 oral race |
| 8 | Space (engagement-thematic) | Published | Cardiometabolic catalyst cluster H2 2026: TRIUMPH-1, ATTAIN-1, ACHIEVE-1, MAPLE-HCM in one window |
| 9 | Orforglipron readout marker | Draft | Pre-read framework for the orforglipron Phase 3 cluster |
| 10 | MariTide P2 trial | Draft | MariTide differentiation thesis: GIPR antagonism vs agonism |

Each published read gets 3-5 `primary_intelligence_links` rows (relationship types: Competitor, Same class, Predecessor, Combination, Future window, Partner). The helper runs as `security definer` (existing pattern from migration `20260501132002`) so space owners can seed without the agency-membership write check.

## Materials (~76 over 36 months)

Engagement start: **May 1, 2023**. Today: **May 2, 2026**. Span: 36 months.

| Material kind | `material_type` | Cadence | Count |
|---|---|---|---|
| Monthly competitive landscape briefing | `briefing` | 1st of each month | 36 |
| Conference reports | `conference_report` | Within 7 days of conference end | 15 |
| Priority notices | `priority_notice` | Event-driven | ~13 |
| Ad hoc memos | `ad_hoc` | Client-triggered | ~12 |

### Monthly briefings (36)

Generated programmatically using `generate_series` over months. Title pattern: `"Competitive landscape briefing -- {Mon YYYY}"`. Each links to the space + 2-3 representative entities active that month (e.g., the Aug 2024 briefing links to SUMMIT and the Lilly company because the SUMMIT readout was the headline event that month).

### Conference reports (15)

Five major cardiometabolic conferences per year, real dates:
- **ADA Scientific Sessions** -- June each year (2023, 2024, 2025)
- **ESC Congress** -- Aug/Sep each year (2023, 2024, 2025)
- **EASD Annual Meeting** -- September each year (2023, 2024, 2025)
- **AHA Scientific Sessions** -- November each year (2023, 2024, 2025)
- **ObesityWeek** -- November each year (2023, 2024, 2025)

Title pattern: `"{Conference} {Year} conference report -- {top 2-3 themes}"`. Each links to the trials whose results were presented at that conference. Conferences happening after May 2, 2026 (e.g., ADA 2026) are not included since the report wouldn't yet exist.

### Priority notices (~13)

Event-driven, tied to real surprising events:
- SELECT NEJM publication (Nov 2023)
- Pfizer danuglipron discontinuation (Dec 2023)
- Roche acquires Carmot (Dec 2023)
- Viking VK2735 P2 readout + stock surge (Feb 2024)
- FLOW positive readout (Mar 2024)
- EMPACT-MI failed primary (Apr 2024)
- SUMMIT positive HFpEF readout (Aug 2024)
- SEQUOIA-HCM positive (Q3 2024)
- ODYSSEY-HCM failure (2024)
- ATTRibute-CM approval (Nov 2024)
- SURMOUNT-OSA approval (Dec 2024)
- REDEFINE-1 disappointment (Dec 2024)
- FLOW approval (Jan 2025)

### Ad hoc memos (~12)

Client-triggered analyses spread across the engagement:
- Tirzepatide salesforce sizing (early 2024)
- Wegovy formulary access analysis (mid 2024)
- Viking takeout scenarios memo (post P2 readout, Q1 2024)
- HFpEF white space analysis (post-FINEARTS, Q4 2024)
- Cardiometabolic lipid franchise add-on (Leqvio scenario, 2024)
- Aficamten launch readiness assessment (mid-2025)
- Orforglipron pricing scenarios (early 2026)
- ATTR-CM market expansion memo (post-Attruby launch, Q1 2025)
- HCM diagnostic / undiagnosed pool sizing (2024)
- Salesforce reorg memo for HFpEF launches (2025)
- Long-acting incretin landscape memo (2025)
- Generic-entry timing memo for Entresto (2025)

### Material storage paths

File rows reference plausible storage paths (`materials/<space_id>/<material_id>/<file_name>`) but don't upload actual files. Download flows 404 cleanly -- matches current behavior in the existing seed.

## `conference_report` material_type addition

### Schema change

```sql
alter table public.materials
  drop constraint materials_material_type_check;

alter table public.materials
  add constraint materials_material_type_check
  check (material_type in ('briefing', 'priority_notice', 'ad_hoc', 'conference_report'));
```

### RPC whitelist updates

`create_material` and `update_material` -- both validate `p_material_type` against a hardcoded list. Both lists extended to include `'conference_report'`. Use `create or replace function` to overwrite cleanly without dropping the function (preserves grants).

### Frontend changes

- `material.model.ts` -- extend the `MaterialType` union: `'briefing' | 'priority_notice' | 'ad_hoc' | 'conference_report'`.
- `material.service.ts` -- extend any label / icon lookup map. Proposed label: `"Conference report"`.
- `material-row.component.ts` -- add icon mapping. Proposed: lucide `presentation` icon, color `text-slate-600`. Confirm there's no existing icon collision.
- `material-upload-zone.component.ts` -- add dropdown option `Conference report`.
- `materials-browse-page.component.ts` -- add filter chip `Conference reports`.
- `materials-section.component.ts` -- if grouped rendering exists, add a group for conference reports between briefings and priority notices.

## Verification convention

Every entry in the migration that comes from real data carries an inline SQL comment with its source URL. Format:

```sql
-- src: https://clinicaltrials.gov/study/NCT04184622
(t_surmount_1, p_space_id, p_uid, p_zepbound, ta_obesity, 'SURMOUNT-1', 'NCT04184622', 2539, ...);
```

Entries marked `VERIFY:` in the spec get explicit verification during the implementation pass:
1. ClinicalTrials.gov REST API search (`https://clinicaltrials.gov/api/v2/studies?query.term=...`) for trial NCT IDs and trial-level data (sample size, primary completion date, recruitment status).
2. FDA approval letters / company press releases for approval and filing dates.
3. NEJM / journal abstracts for publication dates.

Findings written to `docs/specs/seed-data-verification.md`:

```markdown
# Seed data verification report

Snapshot date: 2026-05-02. All entries verified against public sources.

## Trials

### SURMOUNT-1
- NCT: NCT04184622
- Source: https://clinicaltrials.gov/study/NCT04184622
- Sample size: 2539
- Primary completion: 2022-04-25
- Approval: 2023-11-08 (FDA approval letter https://...)

[... one entry per trial / marker / approval ...]

## Unverified entries

The following entries could not be verified against public sources at snapshot date and are seeded with null `identifier`:

- ATTAIN-1 (Lilly orforglipron obesity Phase 3) -- likely registered Q4 2025 or later, no public NCT match yet
[...]
```

If a row truly cannot be verified, its `identifier` is set to null and a SQL comment lists my best guess and the reason for the null. The trial / marker still seeds -- only the NCT ID is missing.

## Open questions

None. The remaining unknowns are factual (exact NCT IDs, dates) and resolved during the verification pass.

## Implementation notes

- Migration runs after `20260501132002_seed_demo_intelligence_security_definer.sql` (the latest seed-related migration). New filename: `<timestamp>_seed_demo_realistic_cardiometabolic.sql` where timestamp follows the existing `YYYYMMDDHHmmss` convention.
- Seed dependency order in helpers preserved (companies -> TAs -> products -> MoA/RoA -> trials -> markers -> notes -> events -> primary_intelligence -> materials). The orchestrator `seed_demo_data` already calls them in this order; only the bodies change.
- Verification step (`supabase db reset`) confirms the migration runs cleanly and `seed_demo_data` returns successfully.
- Frontend verification (`cd src/client && ng lint && ng build`) confirms the `conference_report` additions compile.

## Acceptance criteria

1. `supabase db reset` runs cleanly through all migrations including the new one.
2. Calling `seed_demo_data(<space_id>)` for a space-owner test user populates 13 companies, 28 products, 5 TAs, ~35 trials, ~75 markers, ~15 notes, ~10 events, ~10 primary intelligence reads, and ~76 materials.
3. The materials browse page renders the `Conference reports` filter chip and applies it correctly when clicked.
4. `cd src/client && ng lint && ng build` passes.
5. `docs/specs/seed-data-verification.md` exists and documents every NCT / date with its source URL.
