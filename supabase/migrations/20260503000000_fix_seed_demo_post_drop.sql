-- migration: 20260503000000_fix_seed_demo_post_drop
-- purpose: repair public._seed_demo_trials after migration
--   20260502122000_drop_orphaned_trial_columns dropped 36 columns from
--   public.trials. The realistic cardiometabolic seed in
--   20260502130000_seed_demo_realistic_cardiometabolic.sql still references
--   sample_size in its INSERT column lists and references 13 other dropped
--   columns (design_*, conditions, intervention_*, outcome_measures,
--   eligibility_*, start_date*, primary_completion_date*, has_dmc,
--   is_fda_regulated_*) in 16 follow-up UPDATE statements. plpgsql validates
--   bodies lazily, so `supabase db reset` succeeds but every runtime call to
--   public.seed_demo_data(...) (and therefore _seed_demo_trials) fails when
--   the UI tries to seed a fresh space.
--
-- audit:
--   _seed_demo_companies          -- clean (no trial column refs)
--   _seed_demo_therapeutic_areas  -- clean
--   _seed_demo_products           -- clean
--   _seed_demo_moa_roa            -- clean
--   _seed_demo_trials             -- BROKEN. references sample_size in two
--                                    INSERTs and the full set of dropped
--                                    columns in 16 UPDATEs.
--   _seed_demo_markers            -- clean (reads trials only)
--   _seed_demo_trial_notes        -- clean
--   _seed_demo_events             -- clean
--   _seed_demo_primary_intelligence -- clean
--   _seed_demo_materials          -- clean
--
-- strategy:
--   1. drop sample_size from both INSERT column lists in _seed_demo_trials.
--      Drop the matching scalar from every VALUES tuple. (Sample-size data
--      is gone forever per the trial-change-feed spec.)
--   2. drop all 16 follow-up UPDATE statements wholesale -- every assignment
--      in each block targets a dropped column, so no mixed-column rewrites
--      are needed.
--   3. keep phase_type, phase_start_date, phase_end_date untouched. Those
--      columns live on public.trials in the current schema (the
--      trial_phases table was removed in 2026-04-12), so the existing INSERT
--      column list and tuple positions remain correct after sample_size is
--      stripped.
--
-- spec: docs/superpowers/specs/2026-05-02-trial-change-feed-design.md

-- =============================================================================
-- 1. recreate _seed_demo_trials without dropped-column references.
-- =============================================================================

create or replace function public._seed_demo_trials(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  -- Products
  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_ozempic      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ozempic');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_cagrisema    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cagrisema');
  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_survodutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_survodutide');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_aficamten    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_aficamten');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_ct388        uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ct388');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_vk2735_oral  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_oral');
  p_attruby      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_attruby');

  -- Therapeutic areas
  ta_hf      uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_hf');
  ta_ckd     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_ckd');
  ta_t2d     uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_t2d');
  ta_obesity uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_obesity');
  ta_attr_cm uuid := (select id from _seed_ids where entity_type = 'ta' and key = 'ta_attr_cm');

  -- Timeline trials (10 pivotal)
  t_surmount_1       uuid := gen_random_uuid();
  t_surpass_2        uuid := gen_random_uuid();
  t_step_1           uuid := gen_random_uuid();
  t_select           uuid := gen_random_uuid();
  t_dapa_hf          uuid := gen_random_uuid();
  t_emperor_reduced  uuid := gen_random_uuid();
  t_explorer_hcm     uuid := gen_random_uuid();
  t_paradigm_hf      uuid := gen_random_uuid();
  t_attr_act         uuid := gen_random_uuid();
  t_attribute_cm     uuid := gen_random_uuid();

  -- Landscape trials (25)
  t_surmount_mmo     uuid := gen_random_uuid();
  t_summit           uuid := gen_random_uuid();
  t_surmount_osa     uuid := gen_random_uuid();
  t_attain_1         uuid := gen_random_uuid();
  t_achieve_1        uuid := gen_random_uuid();
  t_triumph_1        uuid := gen_random_uuid();
  t_flow             uuid := gen_random_uuid();
  t_redefine_1       uuid := gen_random_uuid();
  t_redefine_2       uuid := gen_random_uuid();
  t_soul             uuid := gen_random_uuid();
  t_deliver          uuid := gen_random_uuid();
  t_dapa_ckd         uuid := gen_random_uuid();
  t_emperor_preserved uuid := gen_random_uuid();
  t_empa_kidney      uuid := gen_random_uuid();
  t_empact_mi        uuid := gen_random_uuid();
  t_survodutide_p2   uuid := gen_random_uuid();
  t_fineart_hf       uuid := gen_random_uuid();
  t_sequoia_hcm      uuid := gen_random_uuid();
  t_maple_hcm        uuid := gen_random_uuid();
  t_acacia_hcm       uuid := gen_random_uuid();
  t_odyssey_hcm      uuid := gen_random_uuid();
  t_ct388_p2         uuid := gen_random_uuid();
  t_vk2735_sc_p2     uuid := gen_random_uuid();
  t_vk2735_oral_p2   uuid := gen_random_uuid();
  t_maritide_p2      uuid := gen_random_uuid();
  t_danuglipron_p2   uuid := gen_random_uuid();
begin
  -- Timeline trials (10 pivotal, all completed and tied to launched products).
  -- sample_size dropped 2026-05-02; live snapshots track enrolment via
  -- trial_ctgov_snapshots.payload going forward.
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    -- src: https://clinicaltrials.gov/study/NCT04184622
    (t_surmount_1,      p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-1',      'NCT04184622', 'Completed', 1, 'LAUNCHED', '2019-12-04', '2022-04-01'),
    -- src: https://clinicaltrials.gov/study/NCT03987919
    (t_surpass_2,       p_space_id, p_uid, p_mounjaro,    ta_t2d,     'SURPASS-2',       'NCT03987919', 'Completed', 1, 'LAUNCHED', '2019-07-30', '2021-01-28'),
    -- src: https://clinicaltrials.gov/study/NCT03548935
    (t_step_1,          p_space_id, p_uid, p_wegovy,      ta_obesity, 'STEP 1',          'NCT03548935', 'Completed', 1, 'LAUNCHED', '2018-06-04', '2020-03-30'),
    -- src: https://clinicaltrials.gov/study/NCT03574597
    (t_select,          p_space_id, p_uid, p_wegovy,      ta_obesity, 'SELECT',          'NCT03574597', 'Completed', 2, 'APPROVED', '2018-10-24', '2023-06-21'),
    -- src: https://clinicaltrials.gov/study/NCT03036124
    (t_dapa_hf,         p_space_id, p_uid, p_farxiga,     ta_hf,      'DAPA-HF',         'NCT03036124', 'Completed', 1, 'LAUNCHED', '2017-02-08', '2019-07-17'),
    -- src: https://clinicaltrials.gov/study/NCT03057977
    (t_emperor_reduced, p_space_id, p_uid, p_jardiance,   ta_hf,      'EMPEROR-Reduced', 'NCT03057977', 'Completed', 1, 'LAUNCHED', '2017-03-06', '2020-05-01'),
    -- src: https://clinicaltrials.gov/study/NCT03470545
    (t_explorer_hcm,    p_space_id, p_uid, p_camzyos,     ta_hf,      'EXPLORER-HCM',    'NCT03470545', 'Completed', 1, 'LAUNCHED', '2018-05-29', '2020-03-14'),
    -- src: https://clinicaltrials.gov/study/NCT01035255
    (t_paradigm_hf,     p_space_id, p_uid, p_entresto,    ta_hf,      'PARADIGM-HF',     'NCT01035255', 'Terminated', 1, 'LAUNCHED', '2009-12-08', '2014-05-31'),
    -- src: https://clinicaltrials.gov/study/NCT01994889
    (t_attr_act,        p_space_id, p_uid, p_vyndaqel,    ta_attr_cm, 'ATTR-ACT',        'NCT01994889', 'Completed', 1, 'LAUNCHED', '2013-12-09', '2018-02-07'),
    -- src: https://clinicaltrials.gov/study/NCT03860935
    (t_attribute_cm,    p_space_id, p_uid, p_attruby,     ta_attr_cm, 'ATTRibute-CM',    'NCT03860935', 'Completed', 1, 'LAUNCHED', '2019-03-19', '2023-05-11');

  -- Landscape trials (25 active or recently read out)
  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id,
    name, identifier, status, display_order,
    phase_type, phase_start_date, phase_end_date) values
    -- src: https://clinicaltrials.gov/study/NCT05556512
    (t_surmount_mmo,    p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-MMO',    'NCT05556512', 'Active, not recruiting', 3, 'P3', '2022-10-11', null),
    -- src: https://clinicaltrials.gov/study/NCT04847557
    (t_summit,          p_space_id, p_uid, p_zepbound,    ta_hf,      'SUMMIT',          'NCT04847557', 'Completed', 4, 'P3', '2021-04-20', '2024-07-02'),
    -- src: https://clinicaltrials.gov/study/NCT05412004
    (t_surmount_osa,    p_space_id, p_uid, p_zepbound,    ta_obesity, 'SURMOUNT-OSA',    'NCT05412004', 'Completed', 5, 'APPROVED', '2022-06-21', '2024-03-12'),
    -- src: https://clinicaltrials.gov/study/NCT05869903
    (t_attain_1,        p_space_id, p_uid, p_orforglipron, ta_obesity,'ATTAIN-1',        'NCT05869903', 'Active, not recruiting', 6, 'P3', '2023-06-05', '2025-07-25'),
    -- src: https://clinicaltrials.gov/study/NCT05971940
    (t_achieve_1,       p_space_id, p_uid, p_orforglipron, ta_t2d,    'ACHIEVE-1',       'NCT05971940', 'Completed', 7, 'P3', '2023-08-09', '2025-04-03'),
    -- src: https://clinicaltrials.gov/study/NCT05929066
    (t_triumph_1,       p_space_id, p_uid, p_retatrutide, ta_obesity, 'TRIUMPH-1',       'NCT05929066', 'Active, not recruiting', 8, 'P3', '2023-07-10', null),
    -- src: https://clinicaltrials.gov/study/NCT03819153
    (t_flow,            p_space_id, p_uid, p_ozempic,     ta_ckd,     'FLOW',            'NCT03819153', 'Completed', 4, 'APPROVED', '2019-06-17', '2024-01-09'),
    -- src: https://clinicaltrials.gov/study/NCT05567796
    (t_redefine_1,      p_space_id, p_uid, p_cagrisema,   ta_obesity, 'REDEFINE-1',      'NCT05567796', 'Active, not recruiting', 5, 'P3', '2022-11-01', '2024-10-30'),
    -- src: https://clinicaltrials.gov/study/NCT05394519
    (t_redefine_2,      p_space_id, p_uid, p_cagrisema,   ta_obesity, 'REDEFINE-2',      'NCT05394519', 'Completed', 6, 'P3', '2023-02-01', '2025-01-28'),
    -- src: https://clinicaltrials.gov/study/NCT03914326
    (t_soul,            p_space_id, p_uid, p_rybelsus,    ta_t2d,     'SOUL',            'NCT03914326', 'Completed', 7, 'P3', '2019-06-17', '2024-08-23'),
    -- src: https://clinicaltrials.gov/study/NCT03619213
    (t_deliver,         p_space_id, p_uid, p_farxiga,     ta_hf,      'DELIVER',         'NCT03619213', 'Completed', 2, 'APPROVED', '2018-08-27', '2022-03-27'),
    -- src: https://clinicaltrials.gov/study/NCT03036150
    (t_dapa_ckd,        p_space_id, p_uid, p_farxiga,     ta_ckd,     'DAPA-CKD',        'NCT03036150', 'Completed', 3, 'APPROVED', '2017-02-02', '2020-06-12'),
    -- src: https://clinicaltrials.gov/study/NCT03057951
    (t_emperor_preserved, p_space_id, p_uid, p_jardiance, ta_hf,      'EMPEROR-Preserved', 'NCT03057951', 'Completed', 2, 'APPROVED', '2017-03-02', '2021-04-26'),
    -- src: https://clinicaltrials.gov/study/NCT03594110
    (t_empa_kidney,     p_space_id, p_uid, p_jardiance,   ta_ckd,     'EMPA-KIDNEY',     'NCT03594110', 'Completed', 3, 'APPROVED', '2019-01-31', '2022-07-05'),
    -- src: https://clinicaltrials.gov/study/NCT04509674
    (t_empact_mi,       p_space_id, p_uid, p_jardiance,   ta_hf,      'EMPACT-MI',       'NCT04509674', 'Completed', 4, 'P3', '2020-12-16', '2023-11-05'),
    -- src: https://clinicaltrials.gov/study/NCT04667377
    (t_survodutide_p2,  p_space_id, p_uid, p_survodutide, ta_obesity, 'Survodutide P2 obesity', 'NCT04667377', 'Completed', 1, 'P2', '2021-03-08', '2022-09-15'),
    -- src: https://clinicaltrials.gov/study/NCT04435626
    (t_fineart_hf,      p_space_id, p_uid, p_kerendia,    ta_hf,      'FINEARTS-HF',     'NCT04435626', 'Completed', 2, 'APPROVED', '2020-09-14', '2024-05-15'),
    -- src: https://clinicaltrials.gov/study/NCT05186818
    (t_sequoia_hcm,     p_space_id, p_uid, p_aficamten,   ta_hf,      'SEQUOIA-HCM',     'NCT05186818', 'Completed', 1, 'P3', '2022-02-01', '2023-11-10'),
    -- src: https://clinicaltrials.gov/study/NCT05767346
    (t_maple_hcm,       p_space_id, p_uid, p_aficamten,   ta_hf,      'MAPLE-HCM',       'NCT05767346', 'Completed', 2, 'P3', '2023-06-20', '2025-02-28'),
    -- src: https://clinicaltrials.gov/study/NCT06081894
    (t_acacia_hcm,      p_space_id, p_uid, p_aficamten,   ta_hf,      'ACACIA-HCM',      'NCT06081894', 'Active, not recruiting', 3, 'P3', '2023-08-30', null),
    -- src: https://clinicaltrials.gov/study/NCT05582395
    (t_odyssey_hcm,     p_space_id, p_uid, p_camzyos,     ta_hf,      'ODYSSEY-HCM',     'NCT05582395', 'Completed', 2, 'P3', '2022-12-14', '2025-03-06'),
    -- src: https://clinicaltrials.gov/study/NCT06525935
    (t_ct388_p2,        p_space_id, p_uid, p_ct388,       ta_obesity, 'CT-388 P2',       'NCT06525935', 'Completed', 1, 'P2', '2024-08-16', '2025-12-08'),
    -- src: https://clinicaltrials.gov/study/NCT06068946
    (t_vk2735_sc_p2,    p_space_id, p_uid, p_vk2735_sc,   ta_obesity, 'VK2735 SC P2',    'NCT06068946', 'Completed', 1, 'P2', '2023-08-31', '2024-02-27'),
    -- src: https://clinicaltrials.gov/study/NCT06828055
    (t_vk2735_oral_p2,  p_space_id, p_uid, p_vk2735_oral, ta_obesity, 'VK2735 oral P2',  'NCT06828055', 'Completed', 2, 'P2', '2024-12-18', '2025-06-24'),
    -- src: https://clinicaltrials.gov/study/NCT05669599
    (t_maritide_p2,     p_space_id, p_uid, p_maritide,    ta_obesity, 'MariTide P2',     'NCT05669599', 'Completed', 1, 'P2', '2023-01-18', '2024-10-08'),
    -- src: https://clinicaltrials.gov/study/NCT04882961
    (t_danuglipron_p2,  p_space_id, p_uid, p_danuglipron, ta_obesity, 'Danuglipron P2',  'NCT04882961', 'Terminated', 1, 'P2', '2021-01-29', '2023-09-13');

  -- The 16 follow-up UPDATE statements that previously enriched trials with
  -- design_*, conditions, intervention_*, outcome_measures, eligibility_*,
  -- start_date*, primary_completion_date*, has_dmc, is_fda_regulated_* were
  -- removed in this migration. Every assignment in those blocks targeted a
  -- column dropped in 20260502122000_drop_orphaned_trial_columns; nothing
  -- replaces them because that data now lives in
  -- trial_ctgov_snapshots.payload.

  -- Register all trial UUIDs in _seed_ids
  insert into _seed_ids (entity_type, key, id) values
    ('trial', 't_surmount_1',       t_surmount_1),
    ('trial', 't_surpass_2',        t_surpass_2),
    ('trial', 't_step_1',           t_step_1),
    ('trial', 't_select',           t_select),
    ('trial', 't_dapa_hf',          t_dapa_hf),
    ('trial', 't_emperor_reduced',  t_emperor_reduced),
    ('trial', 't_explorer_hcm',     t_explorer_hcm),
    ('trial', 't_paradigm_hf',      t_paradigm_hf),
    ('trial', 't_attr_act',         t_attr_act),
    ('trial', 't_attribute_cm',     t_attribute_cm),
    ('trial', 't_surmount_mmo',     t_surmount_mmo),
    ('trial', 't_summit',           t_summit),
    ('trial', 't_surmount_osa',     t_surmount_osa),
    ('trial', 't_attain_1',         t_attain_1),
    ('trial', 't_achieve_1',        t_achieve_1),
    ('trial', 't_triumph_1',        t_triumph_1),
    ('trial', 't_flow',             t_flow),
    ('trial', 't_redefine_1',       t_redefine_1),
    ('trial', 't_redefine_2',       t_redefine_2),
    ('trial', 't_soul',             t_soul),
    ('trial', 't_deliver',          t_deliver),
    ('trial', 't_dapa_ckd',         t_dapa_ckd),
    ('trial', 't_emperor_preserved', t_emperor_preserved),
    ('trial', 't_empa_kidney',      t_empa_kidney),
    ('trial', 't_empact_mi',        t_empact_mi),
    ('trial', 't_survodutide_p2',   t_survodutide_p2),
    ('trial', 't_fineart_hf',       t_fineart_hf),
    ('trial', 't_sequoia_hcm',      t_sequoia_hcm),
    ('trial', 't_maple_hcm',        t_maple_hcm),
    ('trial', 't_acacia_hcm',       t_acacia_hcm),
    ('trial', 't_odyssey_hcm',      t_odyssey_hcm),
    ('trial', 't_ct388_p2',         t_ct388_p2),
    ('trial', 't_vk2735_sc_p2',     t_vk2735_sc_p2),
    ('trial', 't_vk2735_oral_p2',   t_vk2735_oral_p2),
    ('trial', 't_maritide_p2',      t_maritide_p2),
    ('trial', 't_danuglipron_p2',   t_danuglipron_p2);
end;
$$;

-- =============================================================================
-- 2. smoke test: stand up a hermetic agency/tenant/space/owner fixture and
--    invoke every helper required to exercise _seed_demo_trials end to end.
--    Asserts:
--      a. _seed_demo_trials does not raise (i.e. no dropped-column refs).
--      b. exactly 36 trials land in the fixture space (10 pivotal + 26
--         landscape, matching the source seed contract).
--      c. every inserted trial carries the phase_type / phase_start_date
--         columns that survived the drop (sanity check that those columns
--         are still on public.trials).
--    Cleans up via tenant + agency cascades, mirroring the smoke style in
--    20260502122000_drop_orphaned_trial_columns.sql.
-- =============================================================================

do $$
declare
  v_agency_id uuid := '99999991-9999-9999-9999-999999999991';
  v_tenant_id uuid := '99999992-9999-9999-9999-999999999992';
  v_user_id   uuid := '99999993-9999-9999-9999-999999999993';
  v_space_id  uuid := '99999994-9999-9999-9999-999999999994';
  v_trial_count int;
  v_phase_typed_count int;
begin
  -- temp scratch table that the helpers write into.
  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  insert into auth.users (id, email)
    values (v_user_id, 'fix-seed-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'Fix Seed Smoke', 'fix-seed-smoke', 'fixseedsmoke', 'FSS', 'fss@x.y');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'FSS', 'fss-smoke-t', 'fsssmoket', 'FSS');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  -- Run the helpers _seed_demo_trials depends on, in dispatcher order.
  perform public._seed_demo_companies(v_space_id, v_user_id);
  perform public._seed_demo_therapeutic_areas(v_space_id, v_user_id);
  perform public._seed_demo_products(v_space_id, v_user_id);
  perform public._seed_demo_moa_roa(v_space_id, v_user_id);
  perform public._seed_demo_trials(v_space_id, v_user_id);

  -- a + b: trial count matches the seed contract.
  select count(*) into v_trial_count
    from public.trials
    where space_id = v_space_id;

  if v_trial_count <> 36 then
    raise exception 'fix seed demo post drop smoke FAIL: expected 36 trials, got %', v_trial_count;
  end if;

  -- c: surviving phase_type column still populated on every trial.
  select count(*) into v_phase_typed_count
    from public.trials
    where space_id = v_space_id
      and phase_type is not null
      and phase_start_date is not null;

  if v_phase_typed_count <> 36 then
    raise exception 'fix seed demo post drop smoke FAIL: expected 36 phase-typed trials, got %', v_phase_typed_count;
  end if;

  -- cleanup: tenant + agency cascades take care of dependent rows.
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'fix seed demo post drop smoke test: PASS';
end$$;
