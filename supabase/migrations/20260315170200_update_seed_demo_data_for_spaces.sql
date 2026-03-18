-- update seed_demo_data() to work with the spaces model
-- now requires a space_id parameter and uses created_by instead of user_id

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  c_az uuid := gen_random_uuid();
  c_lilly uuid := gen_random_uuid();
  c_novo uuid := gen_random_uuid();
  p_farxiga uuid := gen_random_uuid();
  p_jardiance uuid := gen_random_uuid();
  p_mounjaro uuid := gen_random_uuid();
  p_ozempic uuid := gen_random_uuid();
  ta_hf uuid := gen_random_uuid();
  ta_ckd uuid := gen_random_uuid();
  ta_t2d uuid := gen_random_uuid();
  ta_obesity uuid := gen_random_uuid();
  t1 uuid := gen_random_uuid();
  t2 uuid := gen_random_uuid();
  t3 uuid := gen_random_uuid();
  t4 uuid := gen_random_uuid();
  t5 uuid := gen_random_uuid();
  t6 uuid := gen_random_uuid();
  t7 uuid := gen_random_uuid();
  t8 uuid := gen_random_uuid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data';
  end if;

  select count(*) into existing_count from public.companies where space_id = p_space_id;
  if existing_count > 0 then
    return;
  end if;

  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_az, p_space_id, uid, 'AstraZeneca', 'https://cdn.brandfetch.io/idJpLuJVA4/theme/dark/symbol.svg?c=1bxid64Mup7aczewSAYMX&t=1677288655682', 1),
    (c_lilly, p_space_id, uid, 'Eli Lilly', 'https://cdn.brandfetch.io/idxr899feu/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1667576418707', 2),
    (c_novo, p_space_id, uid, 'Novo Nordisk', 'https://cdn.brandfetch.io/idzG7CuQEI/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1668424247400', 3);

  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (ta_hf, p_space_id, uid, 'Heart Failure', 'HF'),
    (ta_ckd, p_space_id, uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d, p_space_id, uid, 'Type 2 Diabetes', 'T2D'),
    (ta_obesity, p_space_id, uid, 'Obesity', 'OB');

  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (p_farxiga, p_space_id, uid, c_az, 'Farxiga', 'dapagliflozin', 1),
    (p_jardiance, p_space_id, uid, c_lilly, 'Jardiance', 'empagliflozin', 1),
    (p_mounjaro, p_space_id, uid, c_lilly, 'Mounjaro', 'tirzepatide', 2),
    (p_ozempic, p_space_id, uid, c_novo, 'Ozempic', 'semaglutide', 1);

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values
    (t1, p_space_id, uid, p_farxiga, ta_hf, 'DAPA-HF', 'NCT03036124', 4744, 'Completed', 1),
    (t2, p_space_id, uid, p_farxiga, ta_ckd, 'DAPA-CKD', 'NCT03036150', 4304, 'Completed', 2),
    (t3, p_space_id, uid, p_farxiga, ta_hf, 'DELIVER', 'NCT03619213', 6263, 'Completed', 3),
    (t4, p_space_id, uid, p_jardiance, ta_hf, 'EMPEROR-Preserved', 'NCT03057977', 5988, 'Completed', 1),
    (t5, p_space_id, uid, p_jardiance, ta_hf, 'EMPEROR-Reduced', 'NCT03057951', 3730, 'Completed', 2),
    (t6, p_space_id, uid, p_jardiance, ta_ckd, 'EMPA-KIDNEY', 'NCT03594110', 6609, 'Completed', 3),
    (t7, p_space_id, uid, p_mounjaro, ta_t2d, 'SURPASS-1', 'NCT03954834', 478, 'Completed', 1),
    (t8, p_space_id, uid, p_ozempic, ta_obesity, 'STEP 1', 'NCT03548935', 1961, 'Completed', 1);

  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, label) values
    (gen_random_uuid(), p_space_id, uid, t1, 'P1', '2015-06-01', '2016-12-31', 'P1'),
    (gen_random_uuid(), p_space_id, uid, t1, 'P2', '2017-02-01', '2018-06-30', 'P2'),
    (gen_random_uuid(), p_space_id, uid, t1, 'P3', '2017-02-01', '2019-09-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t2, 'P3', '2017-02-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t2, 'P4', '2021-06-01', '2024-12-31', 'P4'),
    (gen_random_uuid(), p_space_id, uid, t3, 'P3', '2018-08-01', '2022-05-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t4, 'P3', '2017-03-01', '2021-08-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t5, 'P3', '2017-03-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t6, 'P3', '2019-05-01', '2022-11-30', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t7, 'P3', '2019-06-01', '2021-05-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t8, 'P3', '2018-06-01', '2021-03-31', 'P3'),
    (gen_random_uuid(), p_space_id, uid, t8, 'OBS', '2021-06-01', '2023-12-31', 'OBS');

  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000002', '2019-09-19', null, 'Primary results presented at ESC 2019', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000004', '2020-05-05', null, 'sNDA submitted to FDA for HFrEF', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000008', '2019-09-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t1, 'a0000000-0000-0000-0000-000000000009', '2019-06-01', null, 'Primary completion date moved earlier from Q4 to Q3 2019', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000002', '2020-09-24', null, 'Top-line results announced', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000004', '2021-02-15', null, 'sNDA submitted for CKD', false),
    (gen_random_uuid(), p_space_id, uid, t2, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000001', '2022-08-01', null, 'Results expected at ESC 2022', true),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000002', '2022-08-26', null, 'Results presented at ESC 2022', false),
    (gen_random_uuid(), p_space_id, uid, t3, 'a0000000-0000-0000-0000-000000000008', '2022-05-31', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000002', '2021-08-27', null, 'Results presented at ESC 2021', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000004', '2022-02-24', null, 'sNDA submitted for HFpEF', false),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000005', '2022-10-01', null, 'FDA approval projected', true),
    (gen_random_uuid(), p_space_id, uid, t4, 'a0000000-0000-0000-0000-000000000006', '2022-06-15', null, 'Label updated to include HFpEF indication', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000002', '2020-06-29', null, 'Results presented at ESC 2020', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000004', '2020-11-15', null, 'sNDA submitted for HFrEF', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    (gen_random_uuid(), p_space_id, uid, t5, 'a0000000-0000-0000-0000-000000000010', '2021-06-01', null, 'Planned pediatric filing no longer expected', false),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000002', '2022-11-04', null, 'Results presented at ASN 2022', false),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000003', '2023-03-01', null, 'Regulatory filing projected', true),
    (gen_random_uuid(), p_space_id, uid, t6, 'a0000000-0000-0000-0000-000000000007', '2023-06-01', '2024-03-31', 'Estimated CKD launch window', true),
    (gen_random_uuid(), p_space_id, uid, t7, 'a0000000-0000-0000-0000-000000000002', '2021-05-28', null, 'Top-line results announced', false),
    (gen_random_uuid(), p_space_id, uid, t7, 'a0000000-0000-0000-0000-000000000004', '2022-05-13', null, 'NDA submitted to FDA', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000002', '2021-02-10', null, 'Published in NEJM', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000004', '2021-12-04', null, 'sNDA submitted for obesity', false),
    (gen_random_uuid(), p_space_id, uid, t8, 'a0000000-0000-0000-0000-000000000005', '2022-06-01', null, 'FDA approval projected', true);

  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values
    (gen_random_uuid(), p_space_id, uid, t1, 'Landmark trial establishing SGLT2i in HFrEF. Changed treatment guidelines.'),
    (gen_random_uuid(), p_space_id, uid, t2, 'First SGLT2i approved for CKD regardless of diabetes status.'),
    (gen_random_uuid(), p_space_id, uid, t4, 'First positive trial for HFpEF. Major unmet need addressed.'),
    (gen_random_uuid(), p_space_id, uid, t8, 'Demonstrated ~15% body weight reduction. Pivotal for obesity indication.');
end;
$$;
