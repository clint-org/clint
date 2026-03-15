-- seed pharma demo data: two tenants with real-world-inspired clinical trial data
-- this runs as a SECURITY DEFINER function to bypass RLS

create or replace function public.seed_pharma_demo()
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- your account (gets access to everything)
  uid_aaditya uuid;

  -- dummy users
  uid_sarah uuid;
  uid_marcus uuid;
  uid_yuki uuid;

  -- tenants
  t_bi uuid := gen_random_uuid();
  t_azurity uuid := gen_random_uuid();

  -- spaces
  s_vicadrastat uuid := gen_random_uuid();
  s_survodutide uuid := gen_random_uuid();
  s_sah uuid := gen_random_uuid();

  -- therapeutic areas (per space)
  ta_ckd uuid; ta_hf uuid; ta_crr uuid;
  ta_obesity uuid; ta_mash uuid;
  ta_neuro uuid;

  -- companies and products
  c_bi uuid; c_bayer uuid; c_astra uuid; c_lilly uuid; c_novo uuid;
  c_azurity uuid; c_ucb uuid; c_edge uuid;
  p_vic uuid; p_fin uuid; p_dapa uuid;
  p_survo uuid; p_tirz uuid; p_sema uuid;
  p_intra uuid; p_brivar uuid; p_clari uuid;

  -- trials
  tr uuid;
begin
  -- find aaditya's account
  select id into uid_aaditya from auth.users where email = 'aadityamadala@gmail.com' limit 1;
  if uid_aaditya is null then
    return; -- skip if user doesn't exist
  end if;

  -- create dummy users with fixed UUIDs
  uid_sarah := 'dddd0000-0000-0000-0000-000000000001'::uuid;
  uid_marcus := 'dddd0000-0000-0000-0000-000000000002'::uuid;
  uid_yuki := 'dddd0000-0000-0000-0000-000000000003'::uuid;

  -- clean up any partial previous run
  delete from auth.identities where user_id in (uid_sarah, uid_marcus, uid_yuki);
  delete from auth.users where id in (uid_sarah, uid_marcus, uid_yuki);
  delete from auth.users where email in ('sarah.chen@bi.example.com', 'marcus.weber@bi.example.com', 'yuki.tanaka@azurity.example.com');

  insert into auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at, confirmation_token, recovery_token, email_change, email_change_token_new, email_change_token_current, email_change_confirm_status, phone, phone_change, phone_change_token, reauthentication_token, is_sso_user, is_anonymous, raw_app_meta_data, raw_user_meta_data)
  values
    (uid_sarah, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'sarah.chen@bi.example.com', '', now(), now(), now(), '', '', '', '', '', 0, null, '', '', '', false, false, '{"provider":"google","providers":["google"]}'::jsonb, '{"full_name":"Sarah Chen"}'::jsonb),
    (uid_marcus, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'marcus.weber@bi.example.com', '', now(), now(), now(), '', '', '', '', '', 0, null, '', '', '', false, false, '{"provider":"google","providers":["google"]}'::jsonb, '{"full_name":"Marcus Weber"}'::jsonb),
    (uid_yuki, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated', 'yuki.tanaka@azurity.example.com', '', now(), now(), now(), '', '', '', '', '', 0, null, '', '', '', false, false, '{"provider":"google","providers":["google"]}'::jsonb, '{"full_name":"Yuki Tanaka"}'::jsonb);

  insert into auth.identities (id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at)
  values
    (uid_sarah, uid_sarah, jsonb_build_object('sub', uid_sarah::text, 'email', 'sarah.chen@bi.example.com'), 'google', uid_sarah::text, now(), now(), now()),
    (uid_marcus, uid_marcus, jsonb_build_object('sub', uid_marcus::text, 'email', 'marcus.weber@bi.example.com'), 'google', uid_marcus::text, now(), now(), now()),
    (uid_yuki, uid_yuki, jsonb_build_object('sub', uid_yuki::text, 'email', 'yuki.tanaka@azurity.example.com'), 'google', uid_yuki::text, now(), now(), now());

  -- =========================================================================
  -- TENANT 1: Boehringer Ingelheim
  -- =========================================================================
  insert into public.tenants (id, name, slug) values (t_bi, 'Boehringer Ingelheim', 'boehringer-ingelheim');
  insert into public.tenant_members (tenant_id, user_id, role) values
    (t_bi, uid_aaditya, 'owner'),
    (t_bi, uid_sarah, 'owner'),
    (t_bi, uid_marcus, 'member');

  -- =========================================================================
  -- SPACE 1: Vicadrastat (CKD, HF, Cardiac Risk)
  -- =========================================================================
  insert into public.spaces (id, tenant_id, name, description, created_by) values
    (s_vicadrastat, t_bi, 'Vicadrastat Pipeline', 'Aldosterone synthase inhibitor -- CKD, HF, and cardiac risk reduction', uid_aaditya);
  insert into public.space_members (space_id, user_id, role) values
    (s_vicadrastat, uid_aaditya, 'owner'),
    (s_vicadrastat, uid_sarah, 'editor'),
    (s_vicadrastat, uid_marcus, 'viewer');

  -- therapeutic areas
  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Chronic Kidney Disease', 'CKD'),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Heart Failure', 'HF'),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Cardiac Risk Reduction', 'CRR');
  select id into ta_ckd from public.therapeutic_areas where space_id = s_vicadrastat and abbreviation = 'CKD';
  select id into ta_hf from public.therapeutic_areas where space_id = s_vicadrastat and abbreviation = 'HF';
  select id into ta_crr from public.therapeutic_areas where space_id = s_vicadrastat and abbreviation = 'CRR';

  -- companies
  insert into public.companies (id, space_id, created_by, name, display_order) values
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Boehringer Ingelheim', 1),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Bayer', 2),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'AstraZeneca', 3),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, 'Eli Lilly', 4);
  select id into c_bi from public.companies where space_id = s_vicadrastat and name = 'Boehringer Ingelheim';
  select id into c_bayer from public.companies where space_id = s_vicadrastat and name = 'Bayer';
  select id into c_astra from public.companies where space_id = s_vicadrastat and name = 'AstraZeneca';
  select id into c_lilly from public.companies where space_id = s_vicadrastat and name = 'Eli Lilly';

  -- products
  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, c_bi, 'Vicadrastat', 'BI 690517', 1),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, c_bayer, 'Finerenone', 'Kerendia', 1),
    (gen_random_uuid(), s_vicadrastat, uid_aaditya, c_astra, 'Farxiga', 'dapagliflozin', 1);
  select id into p_vic from public.products where space_id = s_vicadrastat and name = 'Vicadrastat';
  select id into p_fin from public.products where space_id = s_vicadrastat and name = 'Finerenone';
  select id into p_dapa from public.products where space_id = s_vicadrastat and name = 'Farxiga';

  -- trials for Vicadrastat
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order)
  values (tr, s_vicadrastat, uid_aaditya, p_vic, ta_ckd, 'VALOR-CKD', 'NCT05182840', 7100, 'Active', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'P2', '2022-03-01', '2024-06-30', null, 'P2');
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'P3', '2024-01-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000001', '2025-06-01', null, 'Phase 2 topline results expected', true);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000002', '2024-11-15', null, 'Interim analysis presented at ASN 2024', false);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_vicadrastat, uid_aaditya, p_vic, ta_hf, 'VALOR-HF', 'NCT05887362', 4200, 'Active', 2);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'P3', '2023-09-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000001', '2027-03-01', null, 'Primary completion projected', true);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_vicadrastat, uid_aaditya, p_vic, ta_crr, 'VICTOR', 'NCT06218901', 8500, 'Active', 3);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'P3', '2024-06-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000003', '2028-01-01', null, 'Regulatory filing projected', true);

  -- competitor trials: Finerenone
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_vicadrastat, uid_sarah, p_fin, ta_ckd, 'FIDELIO-DKD', 'NCT02540993', 5734, 'Completed', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'P3', '2015-09-01', '2020-10-31', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2020-10-23', null, 'Positive topline results presented at ASN', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000004', '2021-03-15', null, 'NDA submitted to FDA', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000006', '2021-07-09', null, 'FDA approval for CKD+T2D', false);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_vicadrastat, uid_sarah, p_fin, ta_hf, 'FINEARTS-HF', 'NCT04435626', 6001, 'Completed', 2);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'P3', '2020-09-01', '2024-06-30', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2024-05-13', null, 'Positive results presented at AHA 2024', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000004', '2024-09-20', null, 'sNDA submitted for HFmrEF/HFpEF', false);

  -- competitor trials: Farxiga
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_vicadrastat, uid_sarah, p_dapa, ta_ckd, 'DAPA-CKD', 'NCT03036150', 4304, 'Completed', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'P3', '2017-02-01', '2020-06-30', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2020-09-24', null, 'Primary results announced', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_vicadrastat, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000006', '2021-04-30', null, 'FDA approval for CKD', false);

  -- notes
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values (gen_random_uuid(), s_vicadrastat, uid_aaditya, (select id from public.trials where space_id = s_vicadrastat and name = 'VALOR-CKD'), 'First-in-class aldosterone synthase inhibitor. Key differentiator vs finerenone: no hyperkalemia risk.');
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values (gen_random_uuid(), s_vicadrastat, uid_sarah, (select id from public.trials where space_id = s_vicadrastat and name = 'FIDELIO-DKD'), 'Established best-in-class for nonsteroidal MRA in CKD. Key benchmark for vicadrastat.');

  -- =========================================================================
  -- SPACE 2: Survodutide (Obesity, MASH)
  -- =========================================================================
  insert into public.spaces (id, tenant_id, name, description, created_by) values
    (s_survodutide, t_bi, 'Survodutide Pipeline', 'Dual GLP-1/glucagon receptor agonist -- obesity and MASH', uid_aaditya);
  insert into public.space_members (space_id, user_id, role) values
    (s_survodutide, uid_aaditya, 'owner'),
    (s_survodutide, uid_sarah, 'editor');

  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (gen_random_uuid(), s_survodutide, uid_aaditya, 'Obesity', 'OB'),
    (gen_random_uuid(), s_survodutide, uid_aaditya, 'MASH', 'MASH');
  select id into ta_obesity from public.therapeutic_areas where space_id = s_survodutide and abbreviation = 'OB';
  select id into ta_mash from public.therapeutic_areas where space_id = s_survodutide and abbreviation = 'MASH';

  insert into public.companies (id, space_id, created_by, name, display_order) values
    (gen_random_uuid(), s_survodutide, uid_aaditya, 'Boehringer Ingelheim', 1),
    (gen_random_uuid(), s_survodutide, uid_aaditya, 'Eli Lilly', 2),
    (gen_random_uuid(), s_survodutide, uid_aaditya, 'Novo Nordisk', 3);
  select id into c_bi from public.companies where space_id = s_survodutide and name = 'Boehringer Ingelheim';
  select id into c_lilly from public.companies where space_id = s_survodutide and name = 'Eli Lilly';
  select id into c_novo from public.companies where space_id = s_survodutide and name = 'Novo Nordisk';

  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (gen_random_uuid(), s_survodutide, uid_aaditya, c_bi, 'Survodutide', 'BI 456906', 1),
    (gen_random_uuid(), s_survodutide, uid_aaditya, c_lilly, 'Mounjaro', 'tirzepatide', 1),
    (gen_random_uuid(), s_survodutide, uid_aaditya, c_novo, 'Wegovy', 'semaglutide', 1);
  select id into p_survo from public.products where space_id = s_survodutide and name = 'Survodutide';
  select id into p_tirz from public.products where space_id = s_survodutide and name = 'Mounjaro';
  select id into p_sema from public.products where space_id = s_survodutide and name = 'Wegovy';

  -- Survodutide trials
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_survodutide, uid_aaditya, p_survo, ta_obesity, 'ACHIEVE-1', 'NCT06054867', 3200, 'Active', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'P3', '2023-10-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000001', '2025-12-01', null, 'Topline results projected', true);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_survodutide, uid_aaditya, p_survo, ta_mash, 'SYNCHRONIZE-1', 'NCT06178744', 1800, 'Active', 2);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'P2', '2022-06-01', '2024-03-31', null, 'P2');
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'P3', '2024-04-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000002', '2024-03-15', null, 'Phase 2 MASH results: 83% MASH resolution', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000001', '2026-06-01', null, 'Phase 3 results projected', true);

  -- Competitor: tirzepatide (Mounjaro)
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_survodutide, uid_sarah, p_tirz, ta_obesity, 'SURMOUNT-1', 'NCT04184622', 2539, 'Completed', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'P3', '2019-12-01', '2022-04-30', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2022-04-28', null, '22.5% body weight loss at highest dose', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000006', '2023-11-08', null, 'FDA approval for obesity (Zepbound)', false);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_survodutide, uid_sarah, p_tirz, ta_mash, 'SYNERGY-NASH', 'NCT04166773', 190, 'Completed', 2);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'P2', '2020-01-01', '2023-09-30', null, 'P2');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2023-06-24', null, '62% MASH resolution at highest dose', false);

  -- Competitor: semaglutide (Wegovy)
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_survodutide, uid_sarah, p_sema, ta_obesity, 'STEP 1', 'NCT03548935', 1961, 'Completed', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'P3', '2018-06-01', '2021-03-31', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000002', '2021-02-10', null, '14.9% body weight loss', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_survodutide, uid_sarah, tr, 'a0000000-0000-0000-0000-000000000006', '2021-06-04', null, 'FDA approval for obesity', false);

  -- =========================================================================
  -- TENANT 2: Azurity Pharmaceuticals
  -- =========================================================================
  insert into public.tenants (id, name, slug) values (t_azurity, 'Azurity Pharmaceuticals', 'azurity');
  insert into public.tenant_members (tenant_id, user_id, role) values
    (t_azurity, uid_aaditya, 'owner'),
    (t_azurity, uid_yuki, 'member');

  -- SPACE: Subarachnoid Hemorrhage
  insert into public.spaces (id, tenant_id, name, description, created_by) values
    (s_sah, t_azurity, 'SAH Pipeline', 'Subarachnoid hemorrhage treatment landscape', uid_aaditya);
  insert into public.space_members (space_id, user_id, role) values
    (s_sah, uid_aaditya, 'owner'),
    (s_sah, uid_yuki, 'editor');

  insert into public.therapeutic_areas (id, space_id, created_by, name, abbreviation) values
    (gen_random_uuid(), s_sah, uid_aaditya, 'Neurology / SAH', 'SAH');
  select id into ta_neuro from public.therapeutic_areas where space_id = s_sah and abbreviation = 'SAH';

  insert into public.companies (id, space_id, created_by, name, display_order) values
    (gen_random_uuid(), s_sah, uid_aaditya, 'Azurity Pharmaceuticals', 1),
    (gen_random_uuid(), s_sah, uid_aaditya, 'UCB', 2),
    (gen_random_uuid(), s_sah, uid_aaditya, 'Edge Therapeutics', 3);
  select id into c_azurity from public.companies where space_id = s_sah and name = 'Azurity Pharmaceuticals';
  select id into c_ucb from public.companies where space_id = s_sah and name = 'UCB';
  select id into c_edge from public.companies where space_id = s_sah and name = 'Edge Therapeutics';

  insert into public.products (id, space_id, created_by, company_id, name, generic_name, display_order) values
    (gen_random_uuid(), s_sah, uid_aaditya, c_azurity, 'Intra-V', 'nimodipine IV', 1),
    (gen_random_uuid(), s_sah, uid_aaditya, c_ucb, 'Brivaracetam', 'brivaracetam', 1),
    (gen_random_uuid(), s_sah, uid_aaditya, c_edge, 'Clazosentan', 'clazosentan', 1);
  select id into p_intra from public.products where space_id = s_sah and name = 'Intra-V';
  select id into p_brivar from public.products where space_id = s_sah and name = 'Brivaracetam';
  select id into p_clari from public.products where space_id = s_sah and name = 'Clazosentan';

  -- Intra-V trials
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_sah, uid_aaditya, p_intra, ta_neuro, 'NIMO-SAH-301', 'NCT05211024', 420, 'Active', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_sah, uid_aaditya, tr, 'P3', '2022-01-01', null, null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000001', '2026-03-01', null, 'Topline data expected', true);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000003', '2026-09-01', null, 'NDA submission projected', true);

  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_sah, uid_aaditya, p_intra, ta_neuro, 'NIMO-SAH-PK', 'NCT04832997', 60, 'Completed', 2);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_sah, uid_aaditya, tr, 'P1', '2021-06-01', '2022-08-31', null, 'P1');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_aaditya, tr, 'a0000000-0000-0000-0000-000000000002', '2022-09-15', null, 'PK results support IV formulation bioequivalence', false);

  -- Competitor: Clazosentan
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_sah, uid_yuki, p_clari, ta_neuro, 'REACT', 'NCT03585270', 409, 'Completed', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_sah, uid_yuki, tr, 'P3', '2018-10-01', '2022-03-31', null, 'P3');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_yuki, tr, 'a0000000-0000-0000-0000-000000000002', '2022-02-10', null, 'Positive results: reduced vasospasm-related morbidity', false);
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_yuki, tr, 'a0000000-0000-0000-0000-000000000006', '2022-09-01', null, 'Approved in Japan for SAH vasospasm', false);

  -- Competitor: Brivaracetam
  tr := gen_random_uuid();
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values (tr, s_sah, uid_yuki, p_brivar, ta_neuro, 'SAH-Seizure Prevention', 'NCT04710459', 280, 'Active', 1);
  insert into public.trial_phases (id, space_id, created_by, trial_id, phase_type, start_date, end_date, color, label) values (gen_random_uuid(), s_sah, uid_yuki, tr, 'P2', '2021-03-01', '2024-12-31', null, 'P2');
  insert into public.trial_markers (id, space_id, created_by, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values (gen_random_uuid(), s_sah, uid_yuki, tr, 'a0000000-0000-0000-0000-000000000001', '2025-03-01', null, 'Phase 2 results expected', true);

  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values (gen_random_uuid(), s_sah, uid_aaditya, (select id from public.trials where space_id = s_sah and name = 'NIMO-SAH-301'), 'IV nimodipine avoids oral route challenges in SAH patients. Key differentiation is delivery convenience.');
  insert into public.trial_notes (id, space_id, created_by, trial_id, content) values (gen_random_uuid(), s_sah, uid_yuki, (select id from public.trials where space_id = s_sah and name = 'REACT'), 'First endothelin receptor antagonist approved for SAH in Japan. US filing path unclear.');

end;
$$;

-- run the seed function
select public.seed_pharma_demo();

-- clean up the function after use (one-time seed)
drop function public.seed_pharma_demo();
