-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
-- it populates system marker types and demo data for development.

-- =============================================================================
-- system marker types
-- =============================================================================

insert into public.marker_types (id, user_id, name, icon, shape, fill_style, color, is_system, display_order)
values
  ('a0000000-0000-0000-0000-000000000001', null, 'Projected Data Reported', 'projected-data', 'circle', 'outline', '#22c55e', true, 1),
  ('a0000000-0000-0000-0000-000000000002', null, 'Data Reported', 'data-reported', 'circle', 'filled', '#22c55e', true, 2),
  ('a0000000-0000-0000-0000-000000000003', null, 'Projected Regulatory Filing', 'projected-filing', 'diamond', 'outline', '#ef4444', true, 3),
  ('a0000000-0000-0000-0000-000000000004', null, 'Submitted Regulatory Filing', 'submitted-filing', 'diamond', 'filled', '#ef4444', true, 4),
  ('a0000000-0000-0000-0000-000000000005', null, 'Label Projected Approval/Launch', 'projected-approval', 'flag', 'outline', '#3b82f6', true, 5),
  ('a0000000-0000-0000-0000-000000000006', null, 'Label Update', 'label-update', 'flag', 'striped', '#3b82f6', true, 6),
  ('a0000000-0000-0000-0000-000000000007', null, 'Est. Range of Potential Launch', 'est-launch-range', 'bar', 'gradient', '#3b82f6', true, 7),
  ('a0000000-0000-0000-0000-000000000008', null, 'Primary Completion Date (PCD)', 'pcd', 'circle', 'filled', '#374151', true, 8),
  ('a0000000-0000-0000-0000-000000000009', null, 'Change from Prior Update', 'change-prior', 'arrow', 'filled', '#f97316', true, 9),
  ('a0000000-0000-0000-0000-000000000010', null, 'Event No Longer Expected', 'no-longer-expected', 'x', 'filled', '#ef4444', true, 10);

-- =============================================================================
-- demo data (only inserted if a demo user exists)
-- =============================================================================
-- this block creates demo data for the first authenticated user found.
-- on a fresh local setup, sign in via Google first, then run `supabase db reset`
-- to populate demo data under your account.

do $$
declare
  uid uuid := 'a1a1a1a1-a1a1-a1a1-a1a1-a1a1a1a1a1a1';
  -- companies
  c_az uuid := 'c0c0c0c0-0000-0000-0000-000000000001';
  c_lilly uuid := 'c0c0c0c0-0000-0000-0000-000000000002';
  c_novo uuid := 'c0c0c0c0-0000-0000-0000-000000000003';
  -- products
  p_farxiga uuid := 'b0b0b0b0-0000-0000-0000-000000000001';
  p_jardiance uuid := 'b0b0b0b0-0000-0000-0000-000000000002';
  p_mounjaro uuid := 'b0b0b0b0-0000-0000-0000-000000000003';
  p_ozempic uuid := 'b0b0b0b0-0000-0000-0000-000000000004';
  -- therapeutic areas
  ta_hf uuid := 'd0d0d0d0-0000-0000-0000-000000000001';
  ta_ckd uuid := 'd0d0d0d0-0000-0000-0000-000000000002';
  ta_t2d uuid := 'd0d0d0d0-0000-0000-0000-000000000003';
  ta_obesity uuid := 'd0d0d0d0-0000-0000-0000-000000000004';
  -- trials
  t1 uuid := 'e0e0e0e0-0000-0000-0000-000000000001';
  t2 uuid := 'e0e0e0e0-0000-0000-0000-000000000002';
  t3 uuid := 'e0e0e0e0-0000-0000-0000-000000000003';
  t4 uuid := 'e0e0e0e0-0000-0000-0000-000000000004';
  t5 uuid := 'e0e0e0e0-0000-0000-0000-000000000005';
  t6 uuid := 'e0e0e0e0-0000-0000-0000-000000000006';
  t7 uuid := 'e0e0e0e0-0000-0000-0000-000000000007';
  t8 uuid := 'e0e0e0e0-0000-0000-0000-000000000008';
begin
  -- create a demo user for seeding (supabase db reset wipes auth.users)
  insert into auth.users (
    id, instance_id, aud, role, email, encrypted_password,
    email_confirmed_at, created_at, updated_at,
    confirmation_token, recovery_token, email_change, email_change_token_new,
    email_change_token_current, email_change_confirm_status,
    phone, phone_change, phone_change_token, reauthentication_token,
    is_sso_user, is_anonymous,
    raw_app_meta_data, raw_user_meta_data
  ) values (
    uid, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated',
    'aadityamadala@gmail.com', '',
    now(), now(), now(),
    '', '', '', '',
    '', 0,
    '', '', '', '',
    false, false,
    '{"provider":"google","providers":["google"]}'::jsonb,
    '{"full_name":"Aaditya Madala","email":"aadityamadala@gmail.com"}'::jsonb
  ) on conflict (id) do nothing;

  -- create identity for Google OAuth
  insert into auth.identities (
    id, user_id, identity_data, provider, provider_id, last_sign_in_at, created_at, updated_at
  ) values (
    uid, uid,
    jsonb_build_object('sub', uid::text, 'email', 'aadityamadala@gmail.com', 'full_name', 'Aaditya Madala'),
    'google', uid::text,
    now(), now(), now()
  ) on conflict do nothing;

  -- companies
  insert into public.companies (id, user_id, name, logo_url, display_order) values
    (c_az, uid, 'AstraZeneca', 'https://cdn.brandfetch.io/idJpLuJVA4/theme/dark/symbol.svg?c=1bxid64Mup7aczewSAYMX&t=1677288655682', 1),
    (c_lilly, uid, 'Eli Lilly', 'https://cdn.brandfetch.io/idxr899feu/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1667576418707', 2),
    (c_novo, uid, 'Novo Nordisk', 'https://cdn.brandfetch.io/idzG7CuQEI/theme/dark/logo.svg?c=1bxid64Mup7aczewSAYMX&t=1668424247400', 3);

  -- therapeutic areas
  insert into public.therapeutic_areas (id, user_id, name, abbreviation) values
    (ta_hf, uid, 'Heart Failure', 'HF'),
    (ta_ckd, uid, 'Chronic Kidney Disease', 'CKD'),
    (ta_t2d, uid, 'Type 2 Diabetes', 'T2D'),
    (ta_obesity, uid, 'Obesity', 'OB');

  -- products
  insert into public.products (id, user_id, company_id, name, generic_name, display_order) values
    (p_farxiga, uid, c_az, 'Farxiga', 'dapagliflozin', 1),
    (p_jardiance, uid, c_lilly, 'Jardiance', 'empagliflozin', 1),
    (p_mounjaro, uid, c_lilly, 'Mounjaro', 'tirzepatide', 2),
    (p_ozempic, uid, c_novo, 'Ozempic', 'semaglutide', 1);

  -- trials
  insert into public.trials (id, user_id, product_id, therapeutic_area_id, name, identifier, sample_size, status, display_order) values
    (t1, uid, p_farxiga, ta_hf, 'DAPA-HF', 'NCT03036124', 4744, 'Completed', 1),
    (t2, uid, p_farxiga, ta_ckd, 'DAPA-CKD', 'NCT03036150', 4304, 'Completed', 2),
    (t3, uid, p_farxiga, ta_hf, 'DELIVER', 'NCT03619213', 6263, 'Completed', 3),
    (t4, uid, p_jardiance, ta_hf, 'EMPEROR-Preserved', 'NCT03057977', 5988, 'Completed', 1),
    (t5, uid, p_jardiance, ta_hf, 'EMPEROR-Reduced', 'NCT03057951', 3730, 'Completed', 2),
    (t6, uid, p_jardiance, ta_ckd, 'EMPA-KIDNEY', 'NCT03594110', 6609, 'Completed', 3),
    (t7, uid, p_mounjaro, ta_t2d, 'SURPASS-1', 'NCT03954834', 478, 'Completed', 1),
    (t8, uid, p_ozempic, ta_obesity, 'STEP 1', 'NCT03548935', 1961, 'Completed', 1);

  -- trial phases (all 5 types represented: P1, P2, P3, P4, OBS)
  insert into public.trial_phases (id, user_id, trial_id, phase_type, start_date, end_date, label) values
    (gen_random_uuid(), uid, t1, 'P1', '2015-06-01', '2016-12-31', 'P1'),
    (gen_random_uuid(), uid, t1, 'P2', '2017-02-01', '2018-06-30', 'P2'),
    (gen_random_uuid(), uid, t1, 'P3', '2017-02-01', '2019-09-30', 'P3'),
    (gen_random_uuid(), uid, t2, 'P3', '2017-02-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), uid, t2, 'P4', '2021-06-01', '2024-12-31', 'P4'),
    (gen_random_uuid(), uid, t3, 'P3', '2018-08-01', '2022-05-31', 'P3'),
    (gen_random_uuid(), uid, t4, 'P3', '2017-03-01', '2021-08-31', 'P3'),
    (gen_random_uuid(), uid, t5, 'P3', '2017-03-01', '2020-06-30', 'P3'),
    (gen_random_uuid(), uid, t6, 'P3', '2019-05-01', '2022-11-30', 'P3'),
    (gen_random_uuid(), uid, t7, 'P3', '2019-06-01', '2021-05-31', 'P3'),
    (gen_random_uuid(), uid, t8, 'P3', '2018-06-01', '2021-03-31', 'P3'),
    (gen_random_uuid(), uid, t8, 'OBS', '2021-06-01', '2023-12-31', 'OBS');

  -- trial markers (all 10 marker types represented)
  insert into public.trial_markers (id, user_id, trial_id, marker_type_id, event_date, end_date, tooltip_text, is_projected) values
    -- DAPA-HF: Data Reported, Submitted Filing, PCD, Change from Prior
    (gen_random_uuid(), uid, t1, 'a0000000-0000-0000-0000-000000000002', '2019-09-19', null, 'Primary results presented at ESC 2019', false),
    (gen_random_uuid(), uid, t1, 'a0000000-0000-0000-0000-000000000004', '2020-05-05', null, 'sNDA submitted to FDA for HFrEF', false),
    (gen_random_uuid(), uid, t1, 'a0000000-0000-0000-0000-000000000008', '2019-09-30', null, 'Primary completion', false),
    (gen_random_uuid(), uid, t1, 'a0000000-0000-0000-0000-000000000009', '2019-06-01', null, 'Primary completion date moved earlier from Q4 to Q3 2019', false),
    -- DAPA-CKD: Data Reported, Submitted Filing, PCD
    (gen_random_uuid(), uid, t2, 'a0000000-0000-0000-0000-000000000002', '2020-09-24', null, 'Top-line results announced', false),
    (gen_random_uuid(), uid, t2, 'a0000000-0000-0000-0000-000000000004', '2021-02-15', null, 'sNDA submitted for CKD', false),
    (gen_random_uuid(), uid, t2, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    -- DELIVER: Projected Data, Data Reported, PCD
    (gen_random_uuid(), uid, t3, 'a0000000-0000-0000-0000-000000000001', '2022-08-01', null, 'Results expected at ESC 2022', true),
    (gen_random_uuid(), uid, t3, 'a0000000-0000-0000-0000-000000000002', '2022-08-26', null, 'Results presented at ESC 2022', false),
    (gen_random_uuid(), uid, t3, 'a0000000-0000-0000-0000-000000000008', '2022-05-31', null, 'Primary completion', false),
    -- EMPEROR-Preserved: Data Reported, Submitted Filing, Projected Approval, Label Update
    (gen_random_uuid(), uid, t4, 'a0000000-0000-0000-0000-000000000002', '2021-08-27', null, 'Results presented at ESC 2021', false),
    (gen_random_uuid(), uid, t4, 'a0000000-0000-0000-0000-000000000004', '2022-02-24', null, 'sNDA submitted for HFpEF', false),
    (gen_random_uuid(), uid, t4, 'a0000000-0000-0000-0000-000000000005', '2022-10-01', null, 'FDA approval projected', true),
    (gen_random_uuid(), uid, t4, 'a0000000-0000-0000-0000-000000000006', '2022-06-15', null, 'Label updated to include HFpEF indication', false),
    -- EMPEROR-Reduced: Data Reported, Submitted Filing, PCD, Event No Longer Expected
    (gen_random_uuid(), uid, t5, 'a0000000-0000-0000-0000-000000000002', '2020-06-29', null, 'Results presented at ESC 2020', false),
    (gen_random_uuid(), uid, t5, 'a0000000-0000-0000-0000-000000000004', '2020-11-15', null, 'sNDA submitted for HFrEF', false),
    (gen_random_uuid(), uid, t5, 'a0000000-0000-0000-0000-000000000008', '2020-06-30', null, 'Primary completion', false),
    (gen_random_uuid(), uid, t5, 'a0000000-0000-0000-0000-000000000010', '2021-06-01', null, 'Planned pediatric filing no longer expected', false),
    -- EMPA-KIDNEY: Data Reported, Projected Filing, Est. Range of Potential Launch
    (gen_random_uuid(), uid, t6, 'a0000000-0000-0000-0000-000000000002', '2022-11-04', null, 'Results presented at ASN 2022', false),
    (gen_random_uuid(), uid, t6, 'a0000000-0000-0000-0000-000000000003', '2023-03-01', null, 'Regulatory filing projected', true),
    (gen_random_uuid(), uid, t6, 'a0000000-0000-0000-0000-000000000007', '2023-06-01', '2024-03-31', 'Estimated CKD launch window', true),
    -- SURPASS-1: Data Reported, Submitted Filing
    (gen_random_uuid(), uid, t7, 'a0000000-0000-0000-0000-000000000002', '2021-05-28', null, 'Top-line results announced', false),
    (gen_random_uuid(), uid, t7, 'a0000000-0000-0000-0000-000000000004', '2022-05-13', null, 'NDA submitted to FDA', false),
    -- STEP 1: Data Reported, Submitted Filing, Projected Approval
    (gen_random_uuid(), uid, t8, 'a0000000-0000-0000-0000-000000000002', '2021-02-10', null, 'Published in NEJM', false),
    (gen_random_uuid(), uid, t8, 'a0000000-0000-0000-0000-000000000004', '2021-12-04', null, 'sNDA submitted for obesity', false),
    (gen_random_uuid(), uid, t8, 'a0000000-0000-0000-0000-000000000005', '2022-06-01', null, 'FDA approval projected', true);

  -- trial notes
  insert into public.trial_notes (id, user_id, trial_id, content) values
    (gen_random_uuid(), uid, t1, 'Landmark trial establishing SGLT2i in HFrEF. Changed treatment guidelines.'),
    (gen_random_uuid(), uid, t2, 'First SGLT2i approved for CKD regardless of diabetes status.'),
    (gen_random_uuid(), uid, t4, 'First positive trial for HFpEF. Major unmet need addressed.'),
    (gen_random_uuid(), uid, t8, 'Demonstrated ~15% body weight reduction. Pivotal for obesity indication.');

end;
$$;
