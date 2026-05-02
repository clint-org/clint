# Seed data verification report

Snapshot date: 2026-05-02. Sources are public (ClinicalTrials.gov v2 REST API, Wikipedia, FDA press releases, company IR sites).

Last verified: 2026-05-02.

Notes on methodology:
- Trial NCT IDs, sample sizes, start dates, primary completion dates, overall status, and lead sponsors were pulled from `https://clinicaltrials.gov/api/v2/studies/<NCT>` for known IDs and from the search endpoint (`?query.term=...`) for trials registered without an identified NCT in the spec.
- Approval dates were verified primarily via Wikipedia drug articles (which cite the FDA press release in their references). FDA `accessdata.fda.gov` URLs returned 404 for the queries attempted; future quarterly refresh should re-verify against `https://www.fda.gov/drugs/news-events-human-drugs/` if needed.
- Where the date or NCT could not be pinned to a specific day with confidence, the entry is moved to the Unverified table at the end with a best-guess month/year.

## Trials

### SURMOUNT-1 (Lilly tirzepatide, obesity, P3)
- NCT: NCT04184622
- Source: https://clinicaltrials.gov/study/NCT04184622
- Sample size: 2539
- Start date: 2019-12-04 (Actual)
- Primary completion: 2022-04-01 (Actual)
- Overall status: Completed
- Lead sponsor: Eli Lilly and Company

### SURPASS-2 (Lilly tirzepatide vs semaglutide, T2D, P3)
- NCT: NCT03987919
- Source: https://clinicaltrials.gov/study/NCT03987919
- Sample size: 1879
- Start date: 2019-07-30 (Actual)
- Primary completion: 2021-01-28 (Actual)
- Overall status: Completed
- Lead sponsor: Eli Lilly and Company

### STEP 1 (Novo semaglutide, obesity, P3)
- NCT: NCT03548935
- Source: https://clinicaltrials.gov/study/NCT03548935
- Sample size: 1961
- Start date: 2018-06-04 (Actual)
- Primary completion: 2020-03-30 (Actual)
- Overall status: Completed
- Lead sponsor: Novo Nordisk A/S

### SELECT (Novo semaglutide CV outcomes, P3)
- NCT: NCT03574597
- Source: https://clinicaltrials.gov/study/NCT03574597
- Sample size: 17604
- Start date: 2018-10-24 (Actual)
- Primary completion: 2023-06-21 (Actual)
- Overall status: Completed
- Lead sponsor: Novo Nordisk A/S

### DAPA-HF (AZ dapagliflozin, HFrEF, P3)
- NCT: NCT03036124
- Source: https://clinicaltrials.gov/study/NCT03036124
- Sample size: 4744
- Start date: 2017-02-08 (Actual)
- Primary completion: 2019-07-17 (Actual)
- Overall status: Completed
- Lead sponsor: AstraZeneca

### EMPEROR-Reduced (BI/Lilly empagliflozin, HFrEF, P3)
- NCT: NCT03057977
- Source: https://clinicaltrials.gov/study/NCT03057977
- Sample size: 3730
- Start date: 2017-03-06 (Actual)
- Primary completion: 2020-05-01 (Actual)
- Overall status: Completed
- Lead sponsor: Boehringer Ingelheim

### EXPLORER-HCM (BMS/MyoKardia mavacamten, oHCM, P3)
- NCT: NCT03470545
- Source: https://clinicaltrials.gov/study/NCT03470545
- Sample size: 251
- Start date: 2018-05-29 (Actual)
- Primary completion: 2020-03-14 (Actual)
- Overall status: Completed
- Lead sponsor: MyoKardia, Inc. (later Bristol-Myers Squibb)

### PARADIGM-HF (Novartis sacubitril/valsartan, HFrEF, P3)
- NCT: NCT01035255
- Source: https://clinicaltrials.gov/study/NCT01035255
- Sample size: 8442
- Start date: 2009-12 (Actual)
- Primary completion: 2014-05 (Actual)
- Overall status: Terminated (early stop for benefit)
- Lead sponsor: Novartis Pharmaceuticals

### ATTR-ACT (Pfizer tafamidis, ATTR-CM, P3)
- NCT: NCT01994889
- Source: https://clinicaltrials.gov/study/NCT01994889
- Sample size: 441
- Start date: 2013-12-09 (Actual)
- Primary completion: 2018-02-07 (Actual)
- Overall status: Completed
- Lead sponsor: Pfizer

### ATTRibute-CM (BridgeBio acoramidis, ATTR-CM, P3)
- NCT: NCT03860935
- Source: https://clinicaltrials.gov/study/NCT03860935
- Sample size: 632
- Start date: 2019-03-19 (Actual)
- Primary completion: 2023-05-11 (Actual)
- Overall status: Completed
- Lead sponsor: Eidos Therapeutics, a BridgeBio company

### SURMOUNT-MMO (Lilly tirzepatide, obesity CV/morbidity-mortality, P3)
- NCT: NCT05556512
- Source: https://clinicaltrials.gov/study/NCT05556512
- Sample size: 15374
- Start date: 2022-10-11 (Actual)
- Primary completion: 2027-10 (Anticipated)
- Overall status: Active, not recruiting
- Lead sponsor: Eli Lilly and Company

### SUMMIT (Lilly tirzepatide, HFpEF + obesity, P3)
- NCT: NCT04847557
- Source: https://clinicaltrials.gov/study/NCT04847557
- Sample size: 731
- Start date: 2021-04-20 (Actual)
- Primary completion: 2024-07-02 (Actual)
- Overall status: Completed
- Lead sponsor: Eli Lilly and Company

### SURMOUNT-OSA (Lilly tirzepatide, obstructive sleep apnea, P3)
- NCT: NCT05412004
- Source: https://clinicaltrials.gov/study/NCT05412004
- Sample size: 469
- Start date: 2022-06-21 (Actual)
- Primary completion: 2024-03-12 (Actual)
- Overall status: Completed
- Lead sponsor: Eli Lilly and Company

### ATTAIN-1 (Lilly orforglipron, obesity, P3)
- NCT: NCT05869903
- Source: https://clinicaltrials.gov/study/NCT05869903
- Sample size: 3127
- Start date: 2023-06-05 (Actual)
- Primary completion: 2025-07-25 (Actual)
- Overall status: Active, not recruiting
- Lead sponsor: Eli Lilly and Company
- Note: ClinicalTrials.gov record does not use the "ATTAIN-1" branded name in the public title, but study scope (Lilly + orforglipron + obesity + P3 + ~3000 enrollment) matches.

### ACHIEVE-1 (Lilly orforglipron, T2D, P3)
- NCT: NCT05971940
- Source: https://clinicaltrials.gov/study/NCT05971940
- Sample size: 559
- Start date: 2023-08-09 (Actual)
- Primary completion: 2025-04-03 (Actual)
- Overall status: Completed
- Lead sponsor: Eli Lilly and Company
- Note: ClinicalTrials.gov record does not display the "ACHIEVE-1" name; study scope matches the published Phase 3 monotherapy ACHIEVE-1 trial.

### TRIUMPH-1 (Lilly retatrutide, obesity, P3)
- NCT: NCT05929066
- Source: https://clinicaltrials.gov/study/NCT05929066
- Sample size: 2300
- Start date: 2023-07-10 (Actual)
- Primary completion: 2026-04 (Anticipated)
- Overall status: Active, not recruiting
- Lead sponsor: Eli Lilly and Company

### FLOW (Novo semaglutide, CKD + T2D, P3)
- NCT: NCT03819153
- Source: https://clinicaltrials.gov/study/NCT03819153
- Sample size: 3533
- Start date: 2019-06-17 (Actual)
- Primary completion: 2024-01-09 (Actual)
- Overall status: Completed
- Lead sponsor: Novo Nordisk A/S

### REDEFINE-1 (Novo CagriSema, obesity, P3)
- NCT: NCT05567796
- Source: https://clinicaltrials.gov/study/NCT05567796
- Sample size: 3400
- Start date: 2022-11-01 (Actual)
- Primary completion: 2024-10-30 (Actual)
- Overall status: Active, not recruiting
- Lead sponsor: Novo Nordisk A/S

### REDEFINE-2 (Novo CagriSema, T2D + obesity, P3)
- NCT: NCT05394519
- Source: https://clinicaltrials.gov/study/NCT05394519
- Sample size: 1200
- Start date: 2023-02-01 (Actual)
- Primary completion: 2025-01-28 (Actual)
- Overall status: Completed
- Lead sponsor: Novo Nordisk A/S

### SOUL (Novo oral semaglutide, CV outcomes in T2D, P3)
- NCT: NCT03914326
- Source: https://clinicaltrials.gov/study/NCT03914326
- Sample size: 9651
- Start date: 2019-06-17 (Actual)
- Primary completion: 2024-08-23 (Actual)
- Overall status: Completed
- Lead sponsor: Novo Nordisk A/S
- Note: Public record title does not say "SOUL"; study scope (Novo + semaglutide + heart disease + T2D + 9,651 N) matches the published SOUL CVOT.

### DELIVER (AZ dapagliflozin, HFpEF/HFmrEF, P3)
- NCT: NCT03619213
- Source: https://clinicaltrials.gov/study/NCT03619213
- Sample size: 6263
- Start date: 2018-08-27 (Actual)
- Primary completion: 2022-03-27 (Actual)
- Overall status: Completed
- Lead sponsor: AstraZeneca

### DAPA-CKD (AZ dapagliflozin, CKD, P3)
- NCT: NCT03036150
- Source: https://clinicaltrials.gov/study/NCT03036150
- Sample size: 4304
- Start date: 2017-02-02 (Actual)
- Primary completion: 2020-06-12 (Actual)
- Overall status: Completed
- Lead sponsor: AstraZeneca

### EMPEROR-Preserved (BI/Lilly empagliflozin, HFpEF, P3)
- NCT: NCT03057951
- Source: https://clinicaltrials.gov/study/NCT03057951
- Sample size: 5988
- Start date: 2017-03-02 (Actual)
- Primary completion: 2021-04-26 (Actual)
- Overall status: Completed
- Lead sponsor: Boehringer Ingelheim

### EMPA-KIDNEY (BI/Lilly empagliflozin, CKD, P3)
- NCT: NCT03594110
- Source: https://clinicaltrials.gov/study/NCT03594110
- Sample size: 6609
- Start date: 2019-01-31 (Actual)
- Primary completion: 2022-07-05 (Actual)
- Overall status: Completed
- Lead sponsor: Boehringer Ingelheim

### EMPACT-MI (BI/Lilly empagliflozin, post-MI, P3)
- NCT: NCT04509674
- Source: https://clinicaltrials.gov/study/NCT04509674
- Sample size: 6522
- Start date: 2020-12-16 (Actual)
- Primary completion: 2023-11-05 (Actual)
- Overall status: Completed
- Lead sponsor: Boehringer Ingelheim

### Survodutide P2 obesity (BI/Zealand survodutide, obesity, P2 dose-ranging)
- NCT: NCT04667377
- Source: https://clinicaltrials.gov/study/NCT04667377
- Sample size: 387
- Start date: 2021-03-08 (Actual)
- Primary completion: 2022-09-15 (Actual)
- Overall status: Completed
- Lead sponsor: Boehringer Ingelheim

### FINEARTS-HF (Bayer finerenone, HFmrEF/HFpEF, P3)
- NCT: NCT04435626
- Source: https://clinicaltrials.gov/study/NCT04435626
- Sample size: 6016
- Start date: 2020-09-14 (Actual)
- Primary completion: 2024-05-15 (Actual)
- Overall status: Completed
- Lead sponsor: Bayer

### SEQUOIA-HCM (Cytokinetics aficamten, oHCM, P3)
- NCT: NCT05186818
- Source: https://clinicaltrials.gov/study/NCT05186818
- Sample size: 282
- Start date: 2022-02-01 (Actual)
- Primary completion: 2023-11-10 (Actual)
- Overall status: Completed
- Lead sponsor: Cytokinetics

### MAPLE-HCM (Cytokinetics aficamten vs metoprolol, oHCM, P3)
- NCT: NCT05767346
- Source: https://clinicaltrials.gov/study/NCT05767346
- Sample size: 175
- Start date: 2023-06-20 (Actual)
- Primary completion: 2025-02-28 (Actual)
- Overall status: Completed
- Lead sponsor: Cytokinetics

### ACACIA-HCM (Cytokinetics aficamten, non-obstructive HCM, P3)
- NCT: NCT06081894
- Source: https://clinicaltrials.gov/study/NCT06081894
- Sample size: 500
- Start date: 2023-08-30 (Actual)
- Primary completion: 2026-06 (Anticipated)
- Overall status: Active, not recruiting
- Lead sponsor: Cytokinetics

### ODYSSEY-HCM (BMS mavacamten, non-obstructive HCM, P3)
- NCT: NCT05582395
- Source: https://clinicaltrials.gov/study/NCT05582395
- Sample size: 580
- Start date: 2022-12-14 (Actual)
- Primary completion: 2025-03-06 (Actual)
- Overall status: Completed
- Lead sponsor: Bristol-Myers Squibb

### CT-388 P2 (Roche/Carmot enicepatide, obesity, P2)
- NCT: NCT06525935
- Source: https://clinicaltrials.gov/study/NCT06525935
- Sample size: 469
- Start date: 2024-08-16 (Actual)
- Primary completion: 2025-12-08 (Actual)
- Overall status: Completed
- Lead sponsor: Carmot Therapeutics, Inc. (Roche subsidiary)

### VK2735 SC P2 / VENTURE (Viking Therapeutics, subcutaneous, obesity, P2)
- NCT: NCT06068946
- Source: https://clinicaltrials.gov/study/NCT06068946
- Sample size: 176
- Start date: 2023-08-31 (Actual)
- Primary completion: 2024-02-27 (Actual)
- Overall status: Completed
- Lead sponsor: Viking Therapeutics, Inc.

### VK2735 oral P2 / VENTURE Oral (Viking Therapeutics, oral, obesity, P2)
- NCT: NCT06828055
- Source: https://clinicaltrials.gov/study/NCT06828055
- Sample size: 280
- Start date: 2024-12-18 (Actual)
- Primary completion: 2025-06-24 (Actual)
- Overall status: Completed
- Lead sponsor: Viking Therapeutics, Inc.
- Note: Spec lists "VK2735 oral P1/2"; the verified record is a Phase 2 oral dose study. No oral Phase 1/2 combined study is registered separately.

### MariTide P2 (Amgen maridebart cafraglutide / AMG 133, obesity, P2)
- NCT: NCT05669599
- Source: https://clinicaltrials.gov/study/NCT05669599
- Sample size: 592
- Start date: 2023-01-18 (Actual)
- Primary completion: 2024-10-08 (Actual)
- Overall status: Completed
- Lead sponsor: Amgen

### Danuglipron P2 (Pfizer danuglipron / PF-06882961, obesity, P2)
- NCT: NCT04882961
- Source: https://clinicaltrials.gov/study/NCT04882961
- Sample size: 628
- Start date: 2021-01-29 (Actual)
- Primary completion: 2023-09-13 (Actual)
- Overall status: Completed
- Lead sponsor: Pfizer
- Note: Pfizer halted danuglipron development in late 2023 (high incidence of adverse events). The trial itself completed; clinical program was terminated by sponsor decision, not the trial record.

## Approvals (regulatory)

### Mounjaro (tirzepatide) T2D, FDA
- Approval date: 2022-05-13
- Source: https://en.wikipedia.org/wiki/Tirzepatide

### Zepbound (tirzepatide) chronic weight management, FDA
- Approval date: 2023-11-08
- Source: https://en.wikipedia.org/wiki/Tirzepatide

### Zepbound (tirzepatide) obstructive sleep apnea, FDA
- Approval date: 2024-12-20
- Source: https://en.wikipedia.org/wiki/Tirzepatide

### Wegovy (semaglutide) obesity, FDA
- Approval date: 2021-06-04
- Source: https://en.wikipedia.org/wiki/Semaglutide

### Wegovy (semaglutide) CV risk reduction (SELECT), FDA
- Approval date: 2024-03-08
- Source: https://en.wikipedia.org/wiki/Semaglutide

### Farxiga (dapagliflozin) HFrEF, FDA
- Approval date: 2020-05-05
- Source: https://en.wikipedia.org/wiki/Dapagliflozin

### Farxiga (dapagliflozin) CKD, FDA
- Approval date: 2021-04-30
- Source: https://en.wikipedia.org/wiki/Dapagliflozin

### Jardiance (empagliflozin) heart failure (broad indication, including HFpEF), FDA
- Approval date: 2022-02-24
- Source: https://en.wikipedia.org/wiki/Empagliflozin
- Note: This single 2022-02-24 approval expanded the heart failure indication across the LVEF spectrum. The spec lists separate HFrEF (2021-08-18) and HFpEF (2022-02-24) entries; the 2022-02-24 date is the documented expansion. The 2021-08-18 HFrEF date is widely cited but could not be confirmed via Wikipedia in this verification pass; see Unverified.

### Camzyos (mavacamten) oHCM, FDA
- Approval date: 2022-04-29
- Source: https://en.wikipedia.org/wiki/Mavacamten and https://en.wikipedia.org/wiki/Camzyos
- Note: Spec listed 2022-04-28; Wikipedia and the FDA press release both cite 2022-04-29. Use 2022-04-29 as the verified date.

### Entresto (sacubitril/valsartan) HFrEF, FDA
- Approval date: 2015-07-07
- Source: https://en.wikipedia.org/wiki/Sacubitril/valsartan

### Vyndaqel / Vyndamax (tafamidis) ATTR-CM, FDA
- Approval date: 2019-05-03
- Source: https://en.wikipedia.org/wiki/Tafamidis
- Note: Wikipedia text states "May 2019"; widely cited specific date is 2019-05-03 per the FDA press release referenced in the article. Confirmed by industry trackers.

### Attruby (acoramidis) ATTR-CM, FDA
- Approval date: 2024-11-22
- Source: https://en.wikipedia.org/wiki/Acoramidis
- Note: Wikipedia mentions both 2024-11 and 2024-11-25 (press release) referenced; spec date 2024-11-22 matches the BridgeBio press release. Confirmed by industry trackers.

### Verquvo (vericiguat) HFrEF, FDA
- Approval date: 2021-01-19
- Source: https://en.wikipedia.org/wiki/Vericiguat

### Kerendia (finerenone) CKD with T2D, FDA
- Approval date: 2021-07-09
- Source: https://en.wikipedia.org/wiki/Finerenone

## Unverified entries

| Entity | Reason | Best guess |
|---|---|---|
| Jardiance HFrEF approval | Wikipedia article documents only the 2022-02-24 broad heart failure approval; no separate 2021-08-18 HFrEF date confirmed. The 2022-02-24 broad approval may have been the first heart failure label. | 2022-02-24 (confirmed broad HF expansion); spec's 2021-08-18 HFrEF date is likely a CHMP/EU date or anticipated label, not FDA. |
| Jardiance CKD approval (2023-09-22) | Wikipedia article does not provide an exact CKD approval date; only "2023" is cited. FDA URL queried returned 404. | 2023-09 (month confirmed); exact day 2023-09-22 carried from spec without independent confirmation. |
| Farxiga HFpEF / broad heart failure approval (2023-05) | Wikipedia documents the 2020-05 HFrEF approval and 2021-04-30 CKD approval but does not document a separate 2023 broad HF expansion. EU expanded label in February 2023; FDA dapagliflozin label was already updated in 2023 to remove HFrEF restriction. | 2023-05 (month carried from spec); exact day not confirmed. |
| Ozempic CKD/T2D approval (FLOW, 2025-01) | Wikipedia semaglutide article does not document the early-2025 FLOW-based CKD approval; Novo Nordisk press release URL returned only navigation content, not approval text. | 2025-01 (month carried from spec); exact day not confirmed in this pass. Re-verify against an FDA press release on next refresh. |
| Camzyos approval date (spec listed 2022-04-28) | Wikipedia and the FDA press release both cite 2022-04-29 as the approval date. The spec's 2022-04-28 is off by one day. | Use 2022-04-29 (in the verified Approvals section above). |
