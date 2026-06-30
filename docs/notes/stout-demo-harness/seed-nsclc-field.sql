-- seed-nsclc-field.sql : broader NSCLC field on top of the ADC core.
-- \i AFTER seed-nsclc-lib.sql. Call pg_temp.seed_nsclc_field(space, asof, tier).
--   tier 1 = nothing (pitch stays lean ADC core)
--   tier 2 = ~half the field (major EGFR/KRAS/IO/ALK franchises + some company events)
--   tier 3 = full field (+ ALK/ROS1/RET/MET insurgents, all company + projected events, extra intel)
create or replace function pg_temp.seed_nsclc_field(p_space uuid, p_asof date, p_tier int)
returns void language plpgsql as $f$
declare
  EVT_TOP uuid := 'a0000000-0000-0000-0000-000000000013';
  EVT_APPR uuid := 'a0000000-0000-0000-0000-000000000035';
  EVT_FILE uuid := 'a0000000-0000-0000-0000-000000000032';
  EVT_PCOMP uuid := 'a0000000-0000-0000-0000-000000000008'; -- Primary Completion
  EVT_LOE uuid := 'a0000000-0000-0000-0000-000000000020';   -- Loss of Exclusivity (amber)
  EVT_LAUNCH uuid := 'a0000000-0000-0000-0000-000000000036'; -- Launch (violet)
  EVT_DIST uuid := 'a0000000-0000-0000-0000-000000000040';  -- Distribution
  EVT_LEAD uuid := 'a0000000-0000-0000-0000-000000000050';  -- Leadership Change (corporate, slate)
  EVT_STRAT uuid := 'a0000000-0000-0000-0000-000000000050'; -- Leadership Change (corporate, slate)
  EVT_FIN uuid := 'a0000000-0000-0000-0000-000000000060';   -- Financial
  EVT_DEAL uuid := 'a0000000-0000-0000-0000-000000000070';  -- Strategic
  L text := 'https://cdn.brandfetch.io/domain/';
  N text := 'Non-Small Cell Lung Cancer';
  -- existing core companies (look up by name)
  c_pfizer uuid; c_az uuid; c_merck uuid;
  -- new companies
  c_jnj uuid; c_amgen uuid; c_bms uuid; c_summit uuid;
  c_roche uuid; c_lilly uuid; c_novartis uuid; c_nuvalent uuid; c_revmed uuid; c_bi uuid;
  a uuid; t uuid;
  procedure_done boolean;
begin
  if p_tier < 2 then return; end if;
  select id into c_pfizer from public.companies where space_id=p_space and name='Pfizer';
  select id into c_az from public.companies where space_id=p_space and name='AstraZeneca';
  select id into c_merck from public.companies where space_id=p_space and name='Merck';

  -- ================= TIER 2: major franchises =================
  c_jnj   := public.create_company(p_space_id=>p_space, p_name=>'Johnson & Johnson', p_logo_url=>L||'jnj.com');
  c_amgen := public.create_company(p_space_id=>p_space, p_name=>'Amgen', p_logo_url=>L||'amgen.com');
  c_bms   := public.create_company(p_space_id=>p_space, p_name=>'Bristol Myers Squibb', p_logo_url=>L||'bms.com');
  c_summit:= public.create_company(p_space_id=>p_space, p_name=>'Summit Therapeutics', p_logo_url=>L||'smmttx.com');

  -- AstraZeneca Tagrisso (EGFR TKI, marketed SOC)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_az, p_name=>'Osimertinib', p_generic_name=>'osimertinib (Tagrisso)', p_moa_names=>array['EGFR TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'FLAURA2', p_identifier=>'NCT04035486', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2020-03-01', p_phase_end_date=>'2025-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — osimertinib + chemo 1L (FLAURA2)', '2024-02-16', 'asset', a, 'forecasted', p_asof, 'high', 'exact');

  -- Merck Keytruda (anti-PD-1, category SOC)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_merck, p_name=>'Pembrolizumab', p_generic_name=>'pembrolizumab (Keytruda)', p_moa_names=>array['Anti-PD-1'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'KEYNOTE-189', p_identifier=>'NCT02578680', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2016-02-01', p_phase_end_date=>'2025-06-30', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'Keytruda Qlex (subcutaneous) FDA approval', '2025-09-19', 'asset', a, 'forecasted', p_asof, 'high', 'exact', '2028 LOE defense.');

  -- Pfizer Lorbrena (ALK TKI, marketed)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_pfizer, p_name=>'Lorlatinib', p_generic_name=>'lorlatinib (Lorbrena)', p_moa_names=>array['ALK TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'CROWN', p_identifier=>'NCT03052608', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2017-05-01', p_phase_end_date=>'2025-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_TOP, 'CROWN 5-year PFS 60% vs 8% (1L ALK)', '2024-09-01', 'asset', a, 'forecasted', p_asof, 'low', 'month');

  -- J&J Rybrevant (EGFR-MET bispecific, marketed 1L)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_jnj, p_name=>'Amivantamab', p_generic_name=>'amivantamab (Rybrevant)', p_moa_names=>array['EGFR-MET bispecific'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'MARIPOSA', p_identifier=>'NCT04487080', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2020-11-01', p_phase_end_date=>'2027-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — amivantamab + lazertinib 1L EGFRm (MARIPOSA)', '2024-08-19', 'asset', a, 'forecasted', p_asof, 'high', 'exact');

  -- Amgen Lumakras (KRAS G12C)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_amgen, p_name=>'Sotorasib', p_generic_name=>'sotorasib (Lumakras)', p_moa_names=>array['KRAS G12C inhibitor'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'CodeBreaK 200', p_identifier=>'NCT04303780', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2020-06-01', p_phase_end_date=>'2024-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='APPROVED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_TOP, 'ODAC votes against accelerated-to-full conversion', '2023-10-05', 'asset', a, 'forecasted', p_asof, 'low', 'month');

  -- BMS Krazati (KRAS G12C) + Opdivo (PD-1)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_bms, p_name=>'Adagrasib', p_generic_name=>'adagrasib (Krazati)', p_moa_names=>array['KRAS G12C inhibitor'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'KRYSTAL-12', p_identifier=>'NCT04685135', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2021-02-01', p_phase_end_date=>'2025-06-30', p_indication_name=>N);
  update public.asset_indications set development_status='APPROVED', development_status_source='analyst' where asset_id=a;
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_bms, p_name=>'Nivolumab', p_generic_name=>'nivolumab (Opdivo)', p_moa_names=>array['Anti-PD-1'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'CheckMate-816', p_identifier=>'NCT02998528', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2017-03-01', p_phase_end_date=>'2024-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'Opdivo Qvantig (subcutaneous) FDA approval', '2024-12-27', 'asset', a, 'forecasted', p_asof, 'low', 'exact');

  -- Summit ivonescimab (PD-1xVEGF bispecific) — the disruptor
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_summit, p_name=>'Ivonescimab', p_generic_name=>'ivonescimab (AK112)', p_moa_names=>array['PD-1/VEGF bispecific'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'HARMONi-3 (1L vs pembro+chemo)', p_identifier=>'NCT05899608', p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2023-07-01', p_phase_end_date=>'2026-12-31', p_indication_name=>N);
  perform pg_temp.mk_event(p_space, EVT_TOP, 'HARMONi-2: ivonescimab beats pembrolizumab (WCLC)', '2024-09-08', 'asset', a, 'forecasted', p_asof, 'high', 'exact', 'First molecule to beat Keytruda head-to-head on PFS.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'HARMONi global: PFS hit, OS missed (HR 0.79)', '2025-05-30', 'asset', a, 'forecasted', p_asof, 'high', 'exact');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'HARMONi-3 1L final PFS', '2026-11-30', 'asset', a, 'forecasted', p_asof, 'high', 'quarter');

  -- ===== near-term catalysts (Jul-Sep 2026): the home hero + a dense Next-90 =====
  -- These land in the live demo's [today, today+90] window. The soonest high-sig
  -- one becomes the home hero. Anchor the very first to Pfizer's own 1L asset so
  -- the renewal-space hero is a sigvotatug story, not a competitor's trial-end.
  declare
    t_sv1l uuid; t_tl08 uuid; t_otl05 uuid; t_evoke03 uuid;
    a_sv uuid; a_sac uuid; a_dato uuid;
  begin
    select id into t_sv1l from public.trials where space_id=p_space and name like 'Sigvotatug + pembrolizumab%';
    select id into t_tl08 from public.trials where space_id=p_space and name like 'TROPION-Lung08%';
    select id into t_otl05 from public.trials where space_id=p_space and name like 'OptiTROP-Lung05%';
    select id into t_evoke03 from public.trials where space_id=p_space and name like 'EVOKE-03%';
    select id into a_sv from public.assets where space_id=p_space and name='Sigvotatug vedotin';
    select id into a_sac from public.assets where space_id=p_space and name='Sacituzumab tirumotecan';
    select id into a_dato from public.assets where space_id=p_space and name='Datopotamab deruxtecan';

    -- HERO: Pfizer's near-term sigvotatug 1L combination interim (company-guided).
    perform pg_temp.mk_event(p_space, EVT_TOP, 'Sigvotatug + pembrolizumab 1L: first interim safety + activity (IASLC Targeted Therapies)', '2026-07-15', 'trial', t_sv1l, 'company', p_asof, 'high', 'exact',
      'Pfizer''s first look at the 1L sigvotatug + pembrolizumab combination in PD-L1 >=50% -- the readout the franchise case now rests on.');
    perform pg_temp.mk_event(p_space, EVT_FILE, 'Sac-TMT: anticipated US BLA submission (1L NSCLC)', '2026-08-12', 'asset', a_sac, 'company', p_asof, 'high', 'month',
      'Merck''s expected global filing off the OptiTROP-Lung05 1L win.');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'Dato-DXd: TROPION-Lung08 1L interim disclosure (investor call)', '2026-08-27', 'asset', a_dato, 'company', p_asof, 'low', 'month');
    -- WCLC 2026 cluster (Sep 6) already seeded in core; add field readouts at the congress.
    perform pg_temp.mk_event(p_space, EVT_TOP, 'OptiTROP-Lung05 full 1L dataset (WCLC plenary)', '2026-09-06', 'trial', t_otl05, 'primary', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'EVOKE-03 1L interim (WCLC)', '2026-09-07', 'trial', t_evoke03, 'forecasted', p_asof, 'high', 'month');
  end;

  -- ===== light deliverables + detected activity (both 3mo and year-in) =====
  declare
    c_summit uuid; c_jnj uuid;
    t_mariposa uuid; t_harmoni3 uuid; t_keynote uuid;
  begin
    select id into c_summit from public.companies where space_id=p_space and name='Summit Therapeutics';
    select id into c_jnj from public.companies where space_id=p_space and name='Johnson & Johnson';
    select id into t_mariposa from public.trials where space_id=p_space and name='MARIPOSA';
    select id into t_harmoni3 from public.trials where space_id=p_space and name like 'HARMONi-3%';
    select id into t_keynote from public.trials where space_id=p_space and name='KEYNOTE-189';

    perform pg_temp.mk_material(p_space, 'briefing', 'NSCLC ADC + IO landscape -- catalyst briefing', 'nsclc-adc-io-catalyst-briefing.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', 3242240, now() - interval '2 days',
      jsonb_build_array(jsonb_build_array('product', (select id from public.assets where space_id=p_space and name='Sigvotatug vedotin')::text),
                        jsonb_build_array('product', (select id from public.assets where space_id=p_space and name='Sacituzumab tirumotecan')::text)));
    perform pg_temp.mk_material(p_space, 'conference_report', 'WCLC 2026 -- pre-read and session map', 'wclc-2026-preread.pdf',
      'application/pdf', 982016, now() - interval '5 days',
      jsonb_build_array(jsonb_build_array('product', (select id from public.assets where space_id=p_space and name='Datopotamab deruxtecan')::text)));

    -- detected registry/analyst changes -> "What changed (7d)". observed within last week.
    perform pg_temp.mk_change(p_space, t_mariposa, 'date_moved', 'ctgov',
      jsonb_build_object('which_date','primary_completion','direction','delay','days_diff',180,'from','2026-06-30','to','2027-12-31'), now() - interval '1 day');
    perform pg_temp.mk_change(p_space, t_harmoni3, 'status_changed', 'ctgov',
      jsonb_build_object('from','RECRUITING','to','ACTIVE_NOT_RECRUITING'), now() - interval '2 days');
    perform pg_temp.mk_change(p_space, t_keynote, 'enrollment_target_changed', 'ctgov',
      jsonb_build_object('from',616,'to',648,'percent_change',5), now() - interval '3 days');
  end;

  if p_tier < 3 then return; end if;
  -- ================= TIER 3: the rest of the field =================
  c_roche    := public.create_company(p_space_id=>p_space, p_name=>'Roche', p_logo_url=>L||'roche.com');
  c_lilly    := public.create_company(p_space_id=>p_space, p_name=>'Eli Lilly', p_logo_url=>L||'lilly.com');
  c_novartis := public.create_company(p_space_id=>p_space, p_name=>'Novartis', p_logo_url=>L||'novartis.com');
  c_nuvalent := public.create_company(p_space_id=>p_space, p_name=>'Nuvalent', p_logo_url=>L||'nuvalent.com');
  c_revmed   := public.create_company(p_space_id=>p_space, p_name=>'Revolution Medicines', p_logo_url=>L||'revmed.com');
  c_bi       := public.create_company(p_space_id=>p_space, p_name=>'Boehringer Ingelheim', p_logo_url=>L||'boehringer-ingelheim.com');

  -- Roche: Alecensa (ALK) + Tecentriq (PD-L1)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_roche, p_name=>'Alectinib', p_generic_name=>'alectinib (Alecensa)', p_moa_names=>array['ALK TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'ALINA (adjuvant)', p_identifier=>'NCT03456076', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2018-08-01', p_phase_end_date=>'2025-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — alectinib adjuvant ALK (ALINA)', '2024-04-18', 'asset', a, 'forecasted', p_asof, 'low', 'exact');
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_roche, p_name=>'Atezolizumab', p_generic_name=>'atezolizumab (Tecentriq)', p_moa_names=>array['Anti-PD-L1'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'IMpower010 (adjuvant)', p_identifier=>'NCT02486718', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2015-08-01', p_phase_end_date=>'2024-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;

  -- AstraZeneca Imfinzi (PD-L1)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_az, p_name=>'Durvalumab', p_generic_name=>'durvalumab (Imfinzi)', p_moa_names=>array['Anti-PD-L1'], p_roa_names=>array['Intravenous']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'AEGEAN (perioperative)', p_identifier=>'NCT03800134', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2019-01-01', p_phase_end_date=>'2027-12-31', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — durvalumab perioperative (AEGEAN)', '2024-08-15', 'asset', a, 'forecasted', p_asof, 'low', 'exact');

  -- Eli Lilly Retevmo (RET)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_lilly, p_name=>'Selpercatinib', p_generic_name=>'selpercatinib (Retevmo)', p_moa_names=>array['RET inhibitor'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'LIBRETTO-431', p_identifier=>'NCT04194944', p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2020-02-01', p_phase_end_date=>'2025-06-30', p_indication_name=>N);
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id=a;

  -- Novartis Tabrecta (MET)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_novartis, p_name=>'Capmatinib', p_generic_name=>'capmatinib (Tabrecta)', p_moa_names=>array['MET inhibitor'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'GEOMETRY mono-1', p_identifier=>'NCT02414139', p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2015-06-01', p_phase_end_date=>'2024-06-30', p_indication_name=>N);
  update public.asset_indications set development_status='APPROVED', development_status_source='analyst' where asset_id=a;

  -- Nuvalent: neladalkib (ALK post-TKI) + zidesamtinib (ROS1) — the GSK acquisition assets
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_nuvalent, p_name=>'Neladalkib', p_generic_name=>'neladalkib (NVL-655)', p_moa_names=>array['ALK TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'ALKOVE-1', p_identifier=>'NCT05384626', p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2022-05-01', p_phase_end_date=>'2027-06-30', p_indication_name=>N);
  perform pg_temp.mk_event(p_space, EVT_FILE, 'NDA filed — neladalkib (ALK post-TKI)', '2026-04-07', 'asset', a, 'forecasted', p_asof, 'high', 'exact');
  perform pg_temp.mk_event(p_space, EVT_APPR, 'Anticipated FDA decision — neladalkib', '2026-11-27', 'asset', a, 'forecasted', p_asof, 'high', 'month');
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_nuvalent, p_name=>'Zidesamtinib', p_generic_name=>'zidesamtinib (NVL-520)', p_moa_names=>array['ROS1 TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'ARROS-1', p_identifier=>'NCT05118789', p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2021-11-01', p_phase_end_date=>'2027-09-30', p_indication_name=>N);
  perform pg_temp.mk_event(p_space, EVT_APPR, 'Anticipated FDA decision — zidesamtinib (ROS1 PDUFA)', '2026-09-18', 'asset', a, 'forecasted', p_asof, 'high', 'month');

  -- Revolution Medicines daraxonrasib (pan-RAS)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_revmed, p_name=>'Daraxonrasib', p_generic_name=>'daraxonrasib (RMC-6236)', p_moa_names=>array['pan-RAS(ON) inhibitor'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'RASolve-301 (2L NSCLC)', p_identifier=>'NCT06881784', p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2025-05-01', p_phase_end_date=>'2027-12-31', p_indication_name=>N);
  perform pg_temp.mk_event(p_space, EVT_TOP, 'RASolve-301 2L NSCLC readout', '2027-03-31', 'asset', a, 'forecasted', p_asof, 'high', 'quarter');

  -- Boehringer zongertinib (HER2 TKI)
  a := public.create_asset(p_space_id=>p_space, p_company_id=>c_bi, p_name=>'Zongertinib', p_generic_name=>'zongertinib (Hernexeos)', p_moa_names=>array['HER2 TKI'], p_roa_names=>array['Oral']);
  t := public.create_trial(p_space_id=>p_space, p_asset_id=>a, p_name=>'Beamion LUNG-1', p_identifier=>'NCT04886804', p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2021-06-01', p_phase_end_date=>'2027-03-31', p_indication_name=>N);
  update public.asset_indications set development_status='APPROVED', development_status_source='analyst' where asset_id=a;
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA accelerated approval — zongertinib HER2 2L', '2025-08-08', 'asset', a, 'forecasted', p_asof, 'high', 'exact');

  -- ===== company-level events (anchor_type='company') =====
  perform pg_temp.mk_event(p_space, EVT_DEAL, 'Completes $43B Seagen acquisition (ADC platform)', '2023-12-14', 'company', c_pfizer, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_DEAL, 'Completes ~$5.8B Mirati acquisition (adagrasib)', '2024-01-15', 'company', c_bms, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_DEAL, '"Ambition 2030": $80B revenue target', '2024-05-21', 'company', c_az, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_DEAL, 'Ivonescimab licensed from Akeso ($500M upfront)', '2023-01-20', 'company', c_summit, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_FIN, 'HARMONi global OS miss; shares fall sharply', '2025-05-30', 'company', c_summit, 'forecasted', p_asof, 'high', 'exact');
  perform pg_temp.mk_event(p_space, EVT_DEAL, '$11.1B BNT327 (PD-L1xVEGF) partnership with BioNTech', '2025-06-02', 'company', c_bms, 'forecasted', p_asof, 'high', 'exact');
  perform pg_temp.mk_event(p_space, EVT_STRAT, 'China president detained (China-risk overhang)', '2024-11-06', 'company', c_az, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_DEAL, 'GSK announces $10.6B acquisition (ALK + ROS1)', '2026-06-09', 'company', c_nuvalent, 'forecasted', p_asof, 'high', 'exact', 'Validates the next-gen resistance-TKI thesis.');

  -- ===== field-level projected + conferences (space) =====
  perform pg_temp.mk_event(p_space, EVT_TOP, 'Ivonescimab 2L EGFRm PDUFA (first US PD-1xVEGF decision)', '2026-11-14', 'space', null, 'forecasted', p_asof, 'high', 'month');

  -- ===== extra intelligence (tier 3 only) =====
  perform pg_temp.mk_intel(p_space, 'product', (select id from public.assets where space_id=p_space and name='Ivonescimab'),
    'Ivonescimab: the only molecule to beat Keytruda head-to-head',
    'The PD-1xVEGF bispecific beat pembrolizumab on PFS in HARMONi-2 and carries two mature OS wins in China, but the global HARMONi OS miss (HR 0.79) leaves US approvability open. HARMONi-3 and the November 2026 PDUFA are the decisive catalysts; BMS''s $11.1B BNT327 bet validates the class.',
    'If ivonescimab clears the FDA, the IO backbone itself is contestable for the first time since Keytruda. Track it as the single biggest threat to the checkpoint-inhibitor franchise Pfizer''s ADC has to layer onto.',
    (p_asof - 12)::timestamptz);
  perform pg_temp.mk_intel(p_space, 'space', p_space,
    'The NSCLC center of gravity is moving to VEGF-combined bispecifics and resistance-tailored regimens',
    'PD-(L)1 monotherapy is mature and on the defensive (Keytruda''s 2028 LOE, SC conversions across the majors). Oncogene-driven care is shifting to durable post-TKI and CNS control (Nuvalent''s ALK/ROS1 assets behind GSK''s $10.6B buy; Revolution''s RAS(ON) opening G12D), with an adjuvant land-grab extending franchises into early disease. The ADC/bispecific supercycle is meeting reality after $75B+ in deals.',
    'For Pfizer, the read is that an ADC has to win in a field whose backbone is itself in motion. The 1L combination decision for sigvotatug cannot be made in isolation from where IO is heading.',
    (p_asof - 20)::timestamptz);

  -- =====================================================================
  -- TIER 3 DENSITY: per-trial markers, projection/precision variety, lots of
  -- projected futures, corporate lifecycle, fuzzy bar ends, recent activity,
  -- and deliverables -- to bring the renewal space to obesity-seed density.
  -- =====================================================================
  declare
    -- assets
    a_sv uuid; a_dato uuid; a_enh uuid; a_sac uuid; a_teliso uuid; a_sg uuid;
    a_keytruda uuid; a_opdivo uuid; a_tagrisso uuid; a_amiv uuid; a_zong uuid;
    a_nela uuid; a_zide uuid; a_ivo uuid; a_alecensa uuid; a_lorla uuid;
    -- trials
    t_sv1l uuid; t_tl08 uuid; t_tl07 uuid; t_dl04 uuid; t_otl05 uuid; t_mk009 uuid;
    t_mariposa uuid; t_harmoni3 uuid; t_alkove uuid; t_arros uuid; t_rasolve uuid;
    t_aegean uuid; t_flaura2 uuid; t_beamion uuid; t_evoke03 uuid;
    -- companies
    c_pfizer uuid; c_az uuid; c_merck uuid; c_jnj uuid; c_summit uuid; c_bms uuid; c_lilly uuid;
  begin
    select id into a_sv from public.assets where space_id=p_space and name='Sigvotatug vedotin';
    select id into a_dato from public.assets where space_id=p_space and name='Datopotamab deruxtecan';
    select id into a_enh from public.assets where space_id=p_space and name='Trastuzumab deruxtecan';
    select id into a_sac from public.assets where space_id=p_space and name='Sacituzumab tirumotecan';
    select id into a_teliso from public.assets where space_id=p_space and name='Telisotuzumab vedotin';
    select id into a_sg from public.assets where space_id=p_space and name='Sacituzumab govitecan';
    select id into a_keytruda from public.assets where space_id=p_space and name='Pembrolizumab';
    select id into a_opdivo from public.assets where space_id=p_space and name='Nivolumab';
    select id into a_tagrisso from public.assets where space_id=p_space and name='Osimertinib';
    select id into a_amiv from public.assets where space_id=p_space and name='Amivantamab';
    select id into a_zong from public.assets where space_id=p_space and name='Zongertinib';
    select id into a_nela from public.assets where space_id=p_space and name='Neladalkib';
    select id into a_zide from public.assets where space_id=p_space and name='Zidesamtinib';
    select id into a_ivo from public.assets where space_id=p_space and name='Ivonescimab';
    select id into a_alecensa from public.assets where space_id=p_space and name='Alectinib';
    select id into a_lorla from public.assets where space_id=p_space and name='Lorlatinib';

    select id into t_sv1l from public.trials where space_id=p_space and name like 'Sigvotatug + pembrolizumab%';
    select id into t_tl08 from public.trials where space_id=p_space and name like 'TROPION-Lung08%';
    select id into t_tl07 from public.trials where space_id=p_space and name like 'TROPION-Lung07%';
    select id into t_dl04 from public.trials where space_id=p_space and name like 'DESTINY-Lung04%';
    select id into t_otl05 from public.trials where space_id=p_space and name like 'OptiTROP-Lung05%';
    select id into t_mk009 from public.trials where space_id=p_space and name like 'MK-2870-009%';
    select id into t_mariposa from public.trials where space_id=p_space and name='MARIPOSA';
    select id into t_harmoni3 from public.trials where space_id=p_space and name like 'HARMONi-3%';
    select id into t_alkove from public.trials where space_id=p_space and name='ALKOVE-1';
    select id into t_arros from public.trials where space_id=p_space and name='ARROS-1';
    select id into t_rasolve from public.trials where space_id=p_space and name like 'RASolve-301%';
    select id into t_aegean from public.trials where space_id=p_space and name like 'AEGEAN%';
    select id into t_flaura2 from public.trials where space_id=p_space and name='FLAURA2';
    select id into t_beamion from public.trials where space_id=p_space and name like 'Beamion%';
    select id into t_evoke03 from public.trials where space_id=p_space and name like 'EVOKE-03%';

    select id into c_pfizer from public.companies where space_id=p_space and name='Pfizer';
    select id into c_az from public.companies where space_id=p_space and name='AstraZeneca';
    select id into c_merck from public.companies where space_id=p_space and name='Merck';
    select id into c_jnj from public.companies where space_id=p_space and name='Johnson & Johnson';
    select id into c_summit from public.companies where space_id=p_space and name='Summit Therapeutics';
    select id into c_bms from public.companies where space_id=p_space and name='Bristol Myers Squibb';
    select id into c_lilly from public.companies where space_id=p_space and name='Eli Lilly';

    -- ---- Primary Completion markers (green data nodes), projection + precision varied ----
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'TROPION-Lung08 primary completion', '2026-09-30', 'trial', t_tl08, 'company', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'TROPION-Lung07 primary completion', '2027-03-31', 'trial', t_tl07, 'forecasted', p_asof, 'low', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'DESTINY-Lung04 primary completion', '2026-12-31', 'trial', t_dl04, 'company', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'OptiTROP-Lung05 primary completion', '2026-08-31', 'trial', t_otl05, 'company', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'MK-2870-009 primary completion', '2027-06-30', 'trial', t_mk009, 'forecasted', p_asof, 'low', 'half');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'Sigvotatug + pembro 1L primary completion', '2028-03-31', 'trial', t_sv1l, 'forecasted', p_asof, 'high', 'half');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'MARIPOSA primary completion (final OS)', '2027-06-30', 'trial', t_mariposa, 'company', p_asof, 'low', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'HARMONi-3 primary completion', '2026-10-31', 'trial', t_harmoni3, 'company', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'ALKOVE-1 primary completion', '2026-12-31', 'trial', t_alkove, 'company', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'ARROS-1 primary completion', '2026-09-30', 'trial', t_arros, 'company', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'RASolve-301 primary completion', '2027-09-30', 'trial', t_rasolve, 'forecasted', p_asof, 'high', 'half');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'AEGEAN final OS analysis', '2027-06-30', 'trial', t_aegean, 'forecasted', p_asof, 'low', 'quarter');

    -- ---- extra readouts / interims (Topline) on competitive trials ----
    perform pg_temp.mk_event(p_space, EVT_TOP, 'TROPION-Lung08 1L OS interim (immature)', '2027-06-30', 'trial', t_tl08, 'forecasted', p_asof, 'high', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'MK-2870-009 EGFR post-TKI topline', '2027-03-31', 'trial', t_mk009, 'primary', p_asof, 'high', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'ALKOVE-1 confirmatory ORR update', '2026-10-15', 'trial', t_alkove, 'company', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'EVOKE-03 1L final PFS', '2027-09-30', 'trial', t_evoke03, 'forecasted', p_asof, 'low', 'half');

    -- ---- Launch markers (violet) for newly approved assets ----
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Datroway US launch (EGFRm 2L)', '2025-07-07', 'asset', a_dato, 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Emrelis US launch (c-Met-high 2L)', '2025-06-02', 'asset', a_teliso, 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Hernexeos US launch (HER2 2L)', '2025-09-15', 'asset', a_zong, 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Rybrevant SC 1L EGFRm launch', '2024-10-01', 'asset', a_amiv, 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Enhertu HER2-mut NSCLC launch', '2022-09-12', 'asset', a_enh, 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Anticipated neladalkib launch (post-PDUFA)', '2027-01-15', 'asset', a_nela, 'forecasted', p_asof, 'high', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Anticipated zidesamtinib launch', '2026-11-01', 'asset', a_zide, 'forecasted', p_asof, 'high', 'month');

    -- ---- Loss of Exclusivity (amber) for the marketed IO/TKI backbone ----
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Keytruda US composition-of-matter LOE', '2028-09-30', 'asset', a_keytruda, 'forecasted', p_asof, 'high', 'half');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Opdivo US LOE', '2028-12-31', 'asset', a_opdivo, 'forecasted', p_asof, 'low', 'year');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Tagrisso US LOE', '2032-04-30', 'asset', a_tagrisso, 'forecasted', p_asof, 'low', 'year');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Alecensa US LOE', '2029-06-30', 'asset', a_alecensa, 'forecasted', p_asof, 'low', 'year');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Lorbrena US LOE', '2030-01-31', 'asset', a_lorla, 'forecasted', p_asof, 'low', 'year');

    -- ---- more projected regulatory milestones (Filing / Approval) ----
    perform pg_temp.mk_event(p_space, EVT_FILE, 'Dato-DXd 1L sBLA submission (PD-L1 >=50%)', '2027-01-31', 'asset', a_dato, 'forecasted', p_asof, 'high', 'month');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'Anticipated sac-TMT FDA accelerated approval (1L)', '2027-05-31', 'asset', a_sac, 'forecasted', p_asof, 'high', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'Anticipated ivonescimab FDA decision (2L EGFRm)', '2026-11-14', 'asset', a_ivo, 'forecasted', p_asof, 'high', 'exact');
    perform pg_temp.mk_event(p_space, EVT_FILE, 'Sigvotatug 1L combination BLA (scenario)', '2028-09-30', 'asset', a_sv, 'forecasted', p_asof, 'low', 'half');

    -- ---- corporate lifecycle (Financial / Leadership / Distribution), some within last 30d ----
    perform pg_temp.mk_event(p_space, EVT_FIN, 'Pfizer Q2 2026 results -- Oncology +12% YoY', '2026-06-24', 'company', c_pfizer, 'company', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_FIN, 'AstraZeneca H1 2026 results -- Enhertu/Datroway ramp', '2026-06-26', 'company', c_az, 'company', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_LEAD, 'Merck names new oncology R&D head', '2026-06-20', 'company', c_merck, 'company', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_DIST, 'J&J expands Rybrevant SC distribution to EU5', '2026-06-18', 'company', c_jnj, 'company', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_DEAL, 'Pfizer R&D Day -- ADC platform roadmap', '2026-06-12', 'company', c_pfizer, 'company', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_FIN, 'Summit raises $235M to fund HARMONi-3 readout', '2026-05-05', 'company', c_summit, 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_LEAD, 'BMS appoints new Worldwide Oncology lead', '2026-04-22', 'company', c_bms, 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_DIST, 'Lilly opens new ADC fill-finish capacity (Indiana)', '2026-03-10', 'company', c_lilly, 'forecasted', p_asof, 'low', 'month');

    -- ---- fuzzy bar ends: mark ongoing-trial Trial End events as estimated ----
    update public.events set date_precision='quarter'
      where space_id=p_space and event_type_id='a0000000-0000-0000-0000-000000000012'
        and event_date > current_date and event_date <= '2027-12-31';

    -- ---- more deliverables (year-in archive depth) ----
    perform pg_temp.mk_material(p_space, 'priority_notice', 'Priority notice: sigvotatug 1L interim -- read-through plan', 'sigvotatug-1l-interim-priority-notice.pdf',
      'application/pdf', 612352, now() - interval '8 hours',
      jsonb_build_array(jsonb_build_array('product', a_sv::text), jsonb_build_array('trial', t_sv1l::text)));
    perform pg_temp.mk_material(p_space, 'ad_hoc', 'Sac-TMT competitive threat memo (renewal)', 'sac-tmt-threat-memo.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 198656, now() - interval '3 days',
      jsonb_build_array(jsonb_build_array('product', a_sac::text), jsonb_build_array('company', c_merck::text)));
    perform pg_temp.mk_material(p_space, 'briefing', 'Year-in portfolio review -- ADC franchise scenarios', 'year-in-portfolio-review.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', 4587520, now() - interval '6 days',
      jsonb_build_array(jsonb_build_array('product', a_sv::text), jsonb_build_array('product', a_dato::text), jsonb_build_array('product', a_sac::text)));

    -- ---- additional historical regulatory actuals + a few more futures (depth) ----
    perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — sotorasib 2L KRAS G12C (Lumakras)', '2021-05-28', 'asset', (select id from public.assets where space_id=p_space and name='Sotorasib'), 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_LAUNCH, 'Lumakras US launch', '2021-06-15', 'asset', (select id from public.assets where space_id=p_space and name='Sotorasib'), 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — adagrasib 2L KRAS G12C (Krazati)', '2022-12-12', 'asset', (select id from public.assets where space_id=p_space and name='Adagrasib'), 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — selpercatinib 1L RET (LIBRETTO)', '2022-09-21', 'asset', (select id from public.assets where space_id=p_space and name='Selpercatinib'), 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — capmatinib METex14 (Tabrecta)', '2020-05-06', 'asset', (select id from public.assets where space_id=p_space and name='Capmatinib'), 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — amivantamab + chemo 1L EGFR exon20 (PAPILLON)', '2024-03-01', 'asset', a_amiv, 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'FLAURA2 final OS positive (HR 0.75)', '2025-05-30', 'trial', t_flaura2, 'forecasted', p_asof, 'low', 'month');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Imfinzi US LOE', '2030-09-30', 'asset', (select id from public.assets where space_id=p_space and name='Durvalumab'), 'forecasted', p_asof, 'low', 'year');
    perform pg_temp.mk_event(p_space, EVT_LOE, 'Tecentriq US LOE', '2028-12-31', 'asset', (select id from public.assets where space_id=p_space and name='Atezolizumab'), 'forecasted', p_asof, 'low', 'year');
    perform pg_temp.mk_event(p_space, EVT_FIN, 'Merck Q1 2026 results -- Keytruda $7.2B quarter', '2026-04-30', 'company', c_merck, 'forecasted', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_FIN, 'J&J Q2 2026 results -- Rybrevant ramp', '2026-06-16', 'company', c_jnj, 'company', p_asof, 'low', 'exact');
    perform pg_temp.mk_event(p_space, EVT_PCOMP, 'CROWN final analysis (5-yr)', '2025-12-31', 'asset', a_lorla, 'forecasted', p_asof, 'low', 'quarter');
    perform pg_temp.mk_event(p_space, EVT_TOP, 'MARIPOSA OS final (significant)', '2026-06-02', 'trial', t_mariposa, 'forecasted', p_asof, 'high', 'exact');
    perform pg_temp.mk_event(p_space, EVT_FILE, 'Sac-TMT EU MAA submission', '2027-02-28', 'asset', a_sac, 'forecasted', p_asof, 'low', 'quarter');

    -- ---- more detected activity (year-in: a richer "What changed" stream) ----
    perform pg_temp.mk_change(p_space, t_tl08, 'date_moved', 'ctgov',
      jsonb_build_object('which_date','primary_completion','direction','accelerate','days_diff',92,'from','2026-12-31','to','2026-09-30'), now() - interval '4 hours');
    perform pg_temp.mk_change(p_space, t_otl05, 'status_changed', 'ctgov',
      jsonb_build_object('from','RECRUITING','to','ACTIVE_NOT_RECRUITING'), now() - interval '1 day');
    perform pg_temp.mk_change(p_space, t_arros, 'phase_transitioned', 'ctgov',
      jsonb_build_object('from', jsonb_build_array('PHASE1'), 'to', jsonb_build_array('PHASE2')), now() - interval '2 days');
    perform pg_temp.mk_change(p_space, t_aegean, 'date_moved', 'ctgov',
      jsonb_build_object('which_date','study_completion','direction','delay','days_diff',180,'from','2026-06-30','to','2027-12-31'), now() - interval '5 days');
  end;
end $f$;
