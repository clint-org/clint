-- enrich existing demo trials with realistic CT.gov dimension data

update public.trials set
  recruitment_status = 'Active, not recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_intervention_model = 'Parallel Assignment',
  design_masking = 'Quadruple',
  design_primary_purpose = 'Treatment',
  enrollment_type = 'Estimated',
  intervention_type = 'Drug',
  intervention_name = 'BI 690517 (vicadrastat)',
  conditions = array['Chronic Kidney Disease', 'Diabetic Kidney Disease'],
  eligibility_sex = 'All',
  eligibility_min_age = '18 Years',
  eligibility_max_age = '85 Years',
  accepts_healthy_volunteers = false,
  has_dmc = true,
  is_fda_regulated_drug = true,
  is_fda_regulated_device = false,
  study_countries = array['United States', 'Germany', 'Japan', 'United Kingdom', 'France'],
  study_regions = array['North America', 'Europe', 'Asia Pacific'],
  start_date = '2022-03-15',
  start_date_type = 'Actual',
  primary_completion_date = '2026-12-31',
  primary_completion_date_type = 'Estimated'
where name = 'VALOR-CKD';

update public.trials set
  recruitment_status = 'Recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'BI 690517 (vicadrastat)',
  conditions = array['Heart Failure', 'Heart Failure with Reduced Ejection Fraction'],
  study_countries = array['United States', 'Germany', 'Japan', 'Canada', 'Australia'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2023-09-01',
  start_date_type = 'Actual'
where name = 'VALOR-HF';

update public.trials set
  recruitment_status = 'Recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Prevention',
  intervention_type = 'Drug',
  intervention_name = 'BI 690517 (vicadrastat)',
  conditions = array['Cardiovascular Risk', 'Major Adverse Cardiac Events'],
  study_countries = array['United States', 'Germany', 'United Kingdom', 'Brazil', 'India'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2024-06-01',
  start_date_type = 'Actual'
where name = 'VICTOR';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Finerenone',
  conditions = array['Chronic Kidney Disease', 'Type 2 Diabetes'],
  fda_designations = array['Fast Track'],
  study_countries = array['United States', 'Germany', 'Japan', 'South Korea'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2015-09-01',
  start_date_type = 'Actual',
  primary_completion_date = '2020-10-31',
  primary_completion_date_type = 'Actual',
  study_completion_date = '2021-06-30',
  study_completion_date_type = 'Actual'
where name = 'FIDELIO-DKD';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Finerenone',
  conditions = array['Heart Failure with Preserved Ejection Fraction', 'Heart Failure with Mildly Reduced Ejection Fraction'],
  study_countries = array['United States', 'Germany', 'France', 'Spain', 'Italy'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2020-09-01',
  start_date_type = 'Actual',
  primary_completion_date = '2024-06-30',
  primary_completion_date_type = 'Actual'
where name = 'FINEARTS-HF';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Dapagliflozin',
  conditions = array['Chronic Kidney Disease'],
  study_countries = array['United States', 'United Kingdom', 'Brazil', 'Mexico'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2017-02-01',
  start_date_type = 'Actual',
  primary_completion_date = '2020-06-30',
  primary_completion_date_type = 'Actual'
where name = 'DAPA-CKD';

update public.trials set
  recruitment_status = 'Active, not recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Survodutide (BI 456906)',
  conditions = array['Obesity', 'Overweight'],
  study_countries = array['United States', 'Germany', 'Japan', 'Australia', 'Canada'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2023-10-01',
  start_date_type = 'Actual'
where name = 'ACHIEVE-1';

update public.trials set
  recruitment_status = 'Active, not recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Survodutide (BI 456906)',
  conditions = array['MASH', 'Non-alcoholic Steatohepatitis', 'Liver Fibrosis'],
  fda_designations = array['Fast Track'],
  study_countries = array['United States', 'Germany', 'United Kingdom', 'Spain'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2022-06-01',
  start_date_type = 'Actual'
where name = 'SYNCHRONIZE-1';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Tirzepatide',
  conditions = array['Obesity', 'Overweight'],
  fda_designations = array['Breakthrough Therapy'],
  study_countries = array['United States', 'Argentina', 'Brazil', 'India', 'China'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2019-12-01',
  start_date_type = 'Actual',
  primary_completion_date = '2022-04-30',
  primary_completion_date_type = 'Actual'
where name = 'SURMOUNT-1';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 2',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Tirzepatide',
  conditions = array['NASH', 'Non-alcoholic Steatohepatitis'],
  study_countries = array['United States'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2020-01-01',
  start_date_type = 'Actual',
  primary_completion_date = '2023-09-30',
  primary_completion_date_type = 'Actual'
where name = 'SYNERGY-NASH';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Semaglutide 2.4 mg',
  conditions = array['Obesity', 'Overweight'],
  study_countries = array['United States', 'United Kingdom', 'Canada', 'Germany', 'Japan'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2018-06-01',
  start_date_type = 'Actual',
  primary_completion_date = '2021-03-31',
  primary_completion_date_type = 'Actual'
where name = 'STEP 1';

update public.trials set
  recruitment_status = 'Active, not recruiting',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Nimodipine IV (Intra-V)',
  conditions = array['Subarachnoid Hemorrhage', 'Cerebral Vasospasm'],
  study_countries = array['United States'],
  has_dmc = true,
  is_fda_regulated_drug = true,
  start_date = '2022-01-01',
  start_date_type = 'Actual'
where name = 'NIMO-SAH-301';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 1',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Nimodipine IV',
  conditions = array['Subarachnoid Hemorrhage'],
  study_countries = array['United States'],
  is_fda_regulated_drug = true,
  start_date = '2021-06-01',
  start_date_type = 'Actual',
  primary_completion_date = '2022-08-31',
  primary_completion_date_type = 'Actual'
where name = 'NIMO-SAH-PK';

update public.trials set
  recruitment_status = 'Completed',
  study_type = 'Interventional',
  phase = 'Phase 3',
  design_allocation = 'Randomized',
  design_masking = 'Double',
  design_primary_purpose = 'Treatment',
  intervention_type = 'Drug',
  intervention_name = 'Clazosentan',
  conditions = array['Subarachnoid Hemorrhage', 'Cerebral Vasospasm'],
  study_countries = array['Japan', 'South Korea', 'Taiwan'],
  study_regions = array['Asia Pacific'],
  has_dmc = true,
  start_date = '2018-10-01',
  start_date_type = 'Actual',
  primary_completion_date = '2022-03-31',
  primary_completion_date_type = 'Actual'
where name = 'REACT';

update public.trials set
  recruitment_status = 'Active, not recruiting',
  study_type = 'Interventional',
  phase = 'Phase 2',
  design_allocation = 'Randomized',
  design_masking = 'Open Label',
  design_primary_purpose = 'Prevention',
  intervention_type = 'Drug',
  intervention_name = 'Brivaracetam',
  conditions = array['Subarachnoid Hemorrhage', 'Post-SAH Seizures'],
  study_countries = array['United States', 'Belgium'],
  is_fda_regulated_drug = true,
  start_date = '2021-03-01',
  start_date_type = 'Actual',
  primary_completion_date = '2024-12-31',
  primary_completion_date_type = 'Estimated'
where name = 'SAH-Seizure Prevention';
