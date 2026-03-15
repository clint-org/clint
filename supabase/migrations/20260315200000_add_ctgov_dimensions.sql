-- add clinicaltrials.gov dimension columns to the trials table
-- all columns nullable for backward compatibility

-- 1. logistics (where & who)
alter table public.trials add column if not exists recruitment_status varchar(50);
alter table public.trials add column if not exists sponsor_type varchar(50);
alter table public.trials add column if not exists lead_sponsor varchar(255);
alter table public.trials add column if not exists collaborators text[];
alter table public.trials add column if not exists study_countries text[];
alter table public.trials add column if not exists study_regions text[];

-- 2. scientific design (what & how)
alter table public.trials add column if not exists study_type varchar(50);
alter table public.trials add column if not exists phase varchar(20);
alter table public.trials add column if not exists design_allocation varchar(50);
alter table public.trials add column if not exists design_intervention_model varchar(50);
alter table public.trials add column if not exists design_masking varchar(50);
alter table public.trials add column if not exists design_primary_purpose varchar(50);
alter table public.trials add column if not exists enrollment_type varchar(20);

-- 3. clinical context (target)
alter table public.trials add column if not exists conditions text[];
alter table public.trials add column if not exists intervention_type varchar(50);
alter table public.trials add column if not exists intervention_name varchar(500);
alter table public.trials add column if not exists primary_outcome_measures text[];
alter table public.trials add column if not exists secondary_outcome_measures text[];
alter table public.trials add column if not exists is_rare_disease boolean;

-- 4. eligibility (patient demographics)
alter table public.trials add column if not exists eligibility_sex varchar(10);
alter table public.trials add column if not exists eligibility_min_age varchar(20);
alter table public.trials add column if not exists eligibility_max_age varchar(20);
alter table public.trials add column if not exists accepts_healthy_volunteers boolean;
alter table public.trials add column if not exists eligibility_criteria text;
alter table public.trials add column if not exists sampling_method varchar(50);

-- 5. timeline (operational milestones)
alter table public.trials add column if not exists start_date date;
alter table public.trials add column if not exists start_date_type varchar(10);
alter table public.trials add column if not exists primary_completion_date date;
alter table public.trials add column if not exists primary_completion_date_type varchar(10);
alter table public.trials add column if not exists study_completion_date date;
alter table public.trials add column if not exists study_completion_date_type varchar(10);
alter table public.trials add column if not exists first_posted_date date;
alter table public.trials add column if not exists results_first_posted_date date;
alter table public.trials add column if not exists last_update_posted_date date;

-- 6. regulatory/labeling (commercial impact)
alter table public.trials add column if not exists has_dmc boolean;
alter table public.trials add column if not exists is_fda_regulated_drug boolean;
alter table public.trials add column if not exists is_fda_regulated_device boolean;
alter table public.trials add column if not exists fda_designations text[];
alter table public.trials add column if not exists submission_type varchar(20);

-- sync tracking
alter table public.trials add column if not exists ctgov_last_synced_at timestamptz;
alter table public.trials add column if not exists ctgov_raw_json jsonb;

-- indexes on frequently filtered columns
create index if not exists idx_trials_recruitment_status on public.trials (recruitment_status);
create index if not exists idx_trials_study_type on public.trials (study_type);
create index if not exists idx_trials_phase on public.trials (phase);
create index if not exists idx_trials_intervention_type on public.trials (intervention_type);
