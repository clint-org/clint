-- =====================================================================
-- seed-nsclc-lib.sql  —  Stout demo harness: reusable seeding helpers (v2)
-- pg_temp functions only. \i this, then call pg_temp.seed_nsclc_space().
-- Caller must have set request.jwt.claims sub to a space-owner uid.
-- v2: company logos; SigVie-002 concluded pre-"today" (interesting home hero);
--     trial markers preserved (bars need them); enrichment events + 4 pitch briefs.
-- =====================================================================

create or replace function pg_temp.ensure_space(p_tenant uuid, p_name text)
returns uuid language plpgsql as $f$
declare s uuid;
begin
  select id into s from public.spaces where tenant_id = p_tenant and name = p_name limit 1;
  if s is null then s := ((public.create_space(p_tenant, p_name))->>'id')::uuid; end if;
  return s;
end $f$;

-- ensure_moa_roa: create the space's mechanism-of-action / route-of-administration
-- rows BEFORE assets. create_asset -> link_asset_moa_roa only LINKS to pre-existing
-- MoA/RoA rows (it never creates them), so without this the MoA/RoA join tables stay
-- empty and every MoA/RoA-grouped view (heatmap, bullseye "which science") is blank.
create or replace function pg_temp.ensure_moa_roa(p_space uuid, p_moas text[], p_roas text[])
returns void language plpgsql as $f$
declare v_name text;
begin
  if p_moas is not null then
    foreach v_name in array p_moas loop
      insert into public.mechanisms_of_action(space_id, name, created_by, display_order)
        values (p_space, v_name, auth.uid(), 0) on conflict (space_id, name) do nothing;
    end loop;
  end if;
  if p_roas is not null then
    foreach v_name in array p_roas loop
      insert into public.routes_of_administration(space_id, name, created_by, display_order)
        values (p_space, v_name, auth.uid(), 0) on conflict (space_id, name) do nothing;
    end loop;
  end if;
end $f$;

create or replace function pg_temp.grant_members(p_space uuid, p_members uuid[])
returns void language plpgsql as $f$
declare m uuid;
begin
  foreach m in array p_members loop
    insert into public.space_members(space_id, user_id, role) values (p_space, m, 'owner')
    on conflict do nothing;
  end loop;
end $f$;

create or replace function pg_temp.mk_event(
  p_space uuid, p_type uuid, p_title text, p_date date,
  p_anchor_type text, p_anchor uuid, p_proj_tier text, p_asof date,
  p_sig text default 'high', p_prec text default 'exact',
  p_desc text default null, p_url text default null)
returns void language plpgsql as $f$
begin
  perform public.create_event(
    p_space_id => p_space, p_event_type_id => p_type, p_title => p_title, p_event_date => p_date,
    p_anchor_type => p_anchor_type, p_anchor_id => p_anchor,
    p_projection => case when p_date <= p_asof then 'actual' else p_proj_tier end,
    p_date_precision => p_prec, p_description => p_desc, p_source_url => p_url, p_significance => p_sig);
end $f$;

create or replace function pg_temp.mk_intel(
  p_space uuid, p_etype text, p_eid uuid,
  p_headline text, p_summary text, p_impl text, p_when timestamptz,
  p_prev_summary text default null, p_when_prev timestamptz default null, p_headline_prev text default null,
  p_links jsonb default null)
returns void language plpgsql as $f$
declare v_anchor uuid; v_pi uuid;
begin
  select id into v_anchor from public.primary_intelligence_anchors
   where space_id = p_space and entity_type = p_etype and entity_id = p_eid limit 1;
  if v_anchor is null then
    insert into public.primary_intelligence_anchors(space_id, entity_type, entity_id, is_lead, created_by)
    values (p_space, p_etype, p_eid, true, auth.uid()) returning id into v_anchor;
  end if;
  if p_prev_summary is not null then
    v_pi := public.upsert_primary_intelligence(null, v_anchor, p_space, p_etype, p_eid,
      coalesce(p_headline_prev, p_headline), p_prev_summary, p_impl, 'published', 'Initial publication', null);
    update public.primary_intelligence set published_at = p_when_prev, created_at = p_when_prev, updated_at = p_when_prev where id = v_pi;
  end if;
  v_pi := public.upsert_primary_intelligence(null, v_anchor, p_space, p_etype, p_eid,
    p_headline, p_summary, p_impl, 'published',
    case when p_prev_summary is not null then 'Revised after latest readout' else 'Initial publication' end, p_links);
  update public.primary_intelligence set published_at = p_when, created_at = p_when, updated_at = p_when where id = v_pi;
  if p_prev_summary is not null then
    update public.primary_intelligence set archived_at = p_when where anchor_id = v_anchor and state = 'archived';
  end if;
end $f$;

-- mk_change: insert a detected change-feed row (lights "What changed (7d)").
-- get_activity_feed reads trial_change_events; the widget shows the 3 newest
-- by observed_at. Payload shapes follow change-event-summary.ts so the row
-- renders rich text from payload alone (no marker join needed):
--   status_changed {from,to} | date_moved {which_date,direction,days_diff,from,to}
--   enrollment_target_changed {from,to,percent_change} | phase_transitioned {from[],to[]}
create or replace function pg_temp.mk_change(
  p_space uuid, p_trial uuid, p_etype text, p_source text, p_payload jsonb, p_observed timestamptz)
returns void language plpgsql as $f$
begin
  if p_trial is null then return; end if;
  insert into public.trial_change_events(trial_id, space_id, event_type, source, payload, occurred_at, observed_at)
  values (p_trial, p_space, p_etype, p_source, p_payload, p_observed, p_observed);
end $f$;

-- mk_material: insert a deliverable + its entity links (lights "Recent materials").
-- p_links: jsonb array of [etype, eid] pairs; etype in 'product'|'trial'|'company'
-- (assets link as 'product'). File paths are plausible-but-absent (download 404s clean).
create or replace function pg_temp.mk_material(
  p_space uuid, p_type text, p_title text, p_file text, p_mime text, p_size bigint,
  p_uploaded timestamptz, p_links jsonb default '[]')
returns void language plpgsql as $f$
declare v_mat uuid := gen_random_uuid(); v_link jsonb; v_ord int := 0;
begin
  insert into public.materials(id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at, finalized_at)
  values (v_mat, p_space, auth.uid(),
    'materials/'||p_space::text||'/'||v_mat::text||'/'||p_file, p_file, p_size,
    p_mime, p_type, p_title, p_uploaded, p_uploaded);
  for v_link in select * from jsonb_array_elements(p_links) loop
    insert into public.material_links(material_id, entity_type, entity_id, display_order)
    values (v_mat, v_link->>0, (v_link->>1)::uuid, v_ord);
    v_ord := v_ord + 1;
  end loop;
end $f$;

-- =====================================================================
create or replace function pg_temp.seed_nsclc_space(p_space uuid, p_asof date, p_depth int)
returns void language plpgsql as $f$
declare
  EVT_PCOMP uuid := 'a0000000-0000-0000-0000-000000000008';
  EVT_TOP   uuid := 'a0000000-0000-0000-0000-000000000013';
  EVT_FILE  uuid := 'a0000000-0000-0000-0000-000000000032';
  EVT_APPR  uuid := 'a0000000-0000-0000-0000-000000000035';
  EVT_STRAT uuid := 'a0000000-0000-0000-0000-000000000070';
  L_BRAND text := 'https://cdn.brandfetch.io/domain/';
  co_pfizer uuid; co_az uuid; co_merck uuid; co_abbvie uuid; co_gilead uuid;
  a_sv uuid; a_dato uuid; a_enh uuid; a_sac uuid; a_teliso uuid; a_her3 uuid; a_sg uuid;
  t_sigvie uuid; t_sv1l uuid; t_tl01 uuid; t_tl08 uuid; t_tl07 uuid;
  t_dl02 uuid; t_dl04 uuid; t_otl05 uuid; t_mk009 uuid; t_lumi uuid; t_her2 uuid; t_evoke01 uuid; t_evoke03 uuid;
  v_nsclc text := 'Non-Small Cell Lung Cancer';
begin
  if (select count(*) from public.companies where space_id = p_space) > 0 then return; end if;

  -- MoA/RoA rows must exist before create_asset can link them (core ADC set)
  perform pg_temp.ensure_moa_roa(p_space,
    array['Integrin beta-6 directed ADC','TROP2-directed ADC','HER2-directed ADC','c-Met-directed ADC','HER3-directed ADC'],
    array['Intravenous']);

  -- companies (with logos)
  co_pfizer := public.create_company(p_space_id=>p_space, p_name=>'Pfizer',          p_logo_url=>L_BRAND||'pfizer.com');
  co_az     := public.create_company(p_space_id=>p_space, p_name=>'AstraZeneca',     p_logo_url=>L_BRAND||'astrazeneca.com');
  co_merck  := public.create_company(p_space_id=>p_space, p_name=>'Merck',           p_logo_url=>L_BRAND||'merck.com');
  co_abbvie := public.create_company(p_space_id=>p_space, p_name=>'AbbVie',          p_logo_url=>L_BRAND||'abbvie.com');
  co_gilead := public.create_company(p_space_id=>p_space, p_name=>'Gilead Sciences', p_logo_url=>L_BRAND||'gilead.com');

  -- assets
  a_sv := public.create_asset(p_space_id=>p_space, p_company_id=>co_pfizer, p_name=>'Sigvotatug vedotin',
            p_generic_name=>'sigvotatug vedotin', p_moa_names=>array['Integrin beta-6 directed ADC'], p_roa_names=>array['Intravenous']);
  a_dato := public.create_asset(p_space_id=>p_space, p_company_id=>co_az, p_name=>'Datopotamab deruxtecan',
            p_generic_name=>'datopotamab deruxtecan', p_moa_names=>array['TROP2-directed ADC'], p_roa_names=>array['Intravenous']);
  a_enh := public.create_asset(p_space_id=>p_space, p_company_id=>co_az, p_name=>'Trastuzumab deruxtecan',
            p_generic_name=>'trastuzumab deruxtecan', p_moa_names=>array['HER2-directed ADC'], p_roa_names=>array['Intravenous']);
  a_sac := public.create_asset(p_space_id=>p_space, p_company_id=>co_merck, p_name=>'Sacituzumab tirumotecan',
            p_generic_name=>'sacituzumab tirumotecan', p_moa_names=>array['TROP2-directed ADC'], p_roa_names=>array['Intravenous']);
  a_teliso := public.create_asset(p_space_id=>p_space, p_company_id=>co_abbvie, p_name=>'Telisotuzumab vedotin',
            p_generic_name=>'telisotuzumab vedotin', p_moa_names=>array['c-Met-directed ADC'], p_roa_names=>array['Intravenous']);
  a_her3 := public.create_asset(p_space_id=>p_space, p_company_id=>co_merck, p_name=>'Patritumab deruxtecan',
            p_generic_name=>'patritumab deruxtecan', p_moa_names=>array['HER3-directed ADC'], p_roa_names=>array['Intravenous']);
  a_sg := public.create_asset(p_space_id=>p_space, p_company_id=>co_gilead, p_name=>'Sacituzumab govitecan',
            p_generic_name=>'sacituzumab govitecan', p_moa_names=>array['TROP2-directed ADC'], p_roa_names=>array['Intravenous']);

  -- trials (real NCT IDs). SigVie-002 concluded just before "today" so its Trial End
  -- is past (not the home hero) and the awaited full readout becomes the next event.
  -- Per-asset NSCLC biomarker niche so the Indication cut has multiple wedges
  -- (and reinforces the "which niche wins" pitch), not one flat "NSCLC" spoke.
  t_sigvie := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sv, p_name=>'SigVie-002', p_identifier=>'NCT06012435',
                p_status=>'Completed', p_phase_type=>'P3', p_phase_start_date=>'2023-09-01', p_phase_end_date=>'2026-06-25', p_indication_name=>'Non-squamous NSCLC');
  t_sv1l := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sv, p_name=>'Sigvotatug + pembrolizumab (1L PD-L1 >=50%)', p_identifier=>'NCT06758401',
                p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2025-01-15', p_phase_end_date=>'2028-06-30', p_indication_name=>'Non-squamous NSCLC');
  t_tl01 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_dato, p_name=>'TROPION-Lung01', p_identifier=>'NCT04656652',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2021-02-01', p_phase_end_date=>'2024-12-31', p_indication_name=>'EGFR-mutant NSCLC');
  t_tl08 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_dato, p_name=>'TROPION-Lung08 (1L PD-L1 >=50%)', p_identifier=>'NCT05215340',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2022-11-01', p_phase_end_date=>'2026-12-31', p_indication_name=>'EGFR-mutant NSCLC');
  t_tl07 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_dato, p_name=>'TROPION-Lung07 (1L PD-L1 <50%)', p_identifier=>'NCT05555732',
                p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2023-01-01', p_phase_end_date=>'2027-06-30', p_indication_name=>'EGFR-mutant NSCLC');
  t_dl02 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_enh, p_name=>'DESTINY-Lung02', p_identifier=>'NCT04644237',
                p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2020-12-01', p_phase_end_date=>'2024-06-30', p_indication_name=>'HER2-mutant NSCLC');
  t_dl04 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_enh, p_name=>'DESTINY-Lung04 (1L HER2-mut)', p_identifier=>'NCT05048797',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2021-12-01', p_phase_end_date=>'2027-03-31', p_indication_name=>'HER2-mutant NSCLC');
  t_otl05 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sac, p_name=>'OptiTROP-Lung05 (1L PD-L1+)', p_identifier=>'NCT06448312',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2024-06-01', p_phase_end_date=>'2026-11-30', p_indication_name=>'EGFR-mutant NSCLC');
  t_mk009 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sac, p_name=>'MK-2870-009 (EGFR post-TKI)', p_identifier=>'NCT06305754',
                p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2024-03-01', p_phase_end_date=>'2027-06-30', p_indication_name=>'EGFR-mutant NSCLC');
  t_lumi := public.create_trial(p_space_id=>p_space, p_asset_id=>a_teliso, p_name=>'LUMINOSITY (c-Met-high)', p_identifier=>'NCT03539536',
                p_status=>'Active, not recruiting', p_phase_type=>'P2', p_phase_start_date=>'2019-01-01', p_phase_end_date=>'2024-12-31', p_indication_name=>'c-Met-high NSCLC');
  t_her2 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_her3, p_name=>'HERTHENA-Lung02 (EGFR post-TKI)', p_identifier=>'NCT05338970',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2021-09-01', p_phase_end_date=>'2025-03-31', p_indication_name=>'EGFR-mutant NSCLC');
  t_evoke01 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sg, p_name=>'EVOKE-01', p_identifier=>'NCT05089734',
                p_status=>'Active, not recruiting', p_phase_type=>'P3', p_phase_start_date=>'2021-12-01', p_phase_end_date=>'2024-06-30', p_indication_name=>'All-comers NSCLC');
  t_evoke03 := public.create_trial(p_space_id=>p_space, p_asset_id=>a_sg, p_name=>'EVOKE-03 (1L PD-L1 >=50%)', p_identifier=>'NCT05609968',
                p_status=>'Recruiting', p_phase_type=>'P3', p_phase_start_date=>'2023-02-01', p_phase_end_date=>'2027-06-30', p_indication_name=>'All-comers NSCLC');

  -- Ring placement: give the core assets their real NSCLC market stage so the
  -- bullseye spreads radially (competitors ahead, Pfizer's sigvotatug the P3
  -- laggard after the miss) instead of everything clustering at P3.
  update public.asset_indications set development_status='LAUNCHED', development_status_source='analyst' where asset_id in (a_dato, a_enh); -- Datroway, Enhertu launched in NSCLC
  update public.asset_indications set development_status='APPROVED', development_status_source='analyst' where asset_id in (a_teliso, a_sac); -- Emrelis (c-Met), sac-TMT (China EGFR)
  update public.asset_indications set development_status='P3', development_status_source='analyst' where asset_id in (a_sv, a_sg, a_her3); -- sigvotatug (miss), Trodelvy (EVOKE-01 fail), patritumab (BLA withdrawn)

  -- editorial events (the interesting glyphs). Trial Start/End dots are auto-created by create_trial.
  perform pg_temp.mk_event(p_space, EVT_TOP, 'SigVie-002 misses primary OS endpoint', '2026-06-22', 'asset', a_sv, 'forecasted', p_asof, 'high', 'exact',
    'Pivotal phase 3 in 2L+ non-squamous NSCLC did not meet its primary overall-survival endpoint vs docetaxel. Stronger trend in the 1-prior-line subgroup; full data to a congress.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'Full SigVie-002 data presentation (WCLC)', '2026-09-06', 'asset', a_sv, 'forecasted', p_asof, 'high', 'month',
    'Detailed SigVie-002 readout, including the 1-prior-line subgroup analysis.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'Sigvotatug + pembro 1L topline', '2027-09-30', 'trial', t_sv1l, 'forecasted', p_asof, 'high', 'quarter',
    'Binary make-or-break readout for sigvotatug in first-line PD-L1 >=50%.');

  perform pg_temp.mk_event(p_space, EVT_TOP, 'TROPION-Lung01 PFS positive', '2024-09-10', 'trial', t_tl01, 'forecasted', p_asof, 'high');
  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — EGFR-mutant 2L+ (Datroway)', '2025-06-23', 'asset', a_dato, 'forecasted', p_asof, 'high', 'exact',
    'First TROP2 ADC approved in NSCLC; accelerated approval in previously-treated EGFR-mutant disease.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'TROPION-Lung08 1L topline', '2026-12-15', 'trial', t_tl08, 'primary', p_asof, 'high', 'month',
    'Dato-DXd + pembrolizumab vs pembrolizumab in 1L PD-L1 >=50% — the front-line prize.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'TROPION-Lung07 1L topline', '2027-06-30', 'trial', t_tl07, 'forecasted', p_asof, 'high', 'quarter');

  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA approval — HER2-mutant 2L (Enhertu)', '2022-08-11', 'asset', a_enh, 'forecasted', p_asof, 'high', 'exact',
    'First drug ever approved in HER2-mutant NSCLC.');
  perform pg_temp.mk_event(p_space, EVT_APPR, 'EMA approval — HER2-mutant NSCLC (Enhertu)', '2023-02-15', 'asset', a_enh, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'DESTINY-Lung02 long-term data at ESMO (ORR 58%)', '2024-10-01', 'asset', a_enh, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'DESTINY-Lung04 1L HER2-mut topline', '2027-03-31', 'trial', t_dl04, 'primary', p_asof, 'high', 'quarter');

  perform pg_temp.mk_event(p_space, EVT_APPR, 'China NMPA approval — EGFR-mutant NSCLC', '2025-03-20', 'asset', a_sac, 'forecasted', p_asof, 'high', 'month');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'OptiTROP-Lung05 meets 1L PFS endpoint', '2025-11-12', 'trial', t_otl05, 'forecasted', p_asof, 'high', 'exact',
    'First ADC + IO combination to hit a first-line NSCLC primary endpoint — the most important data point in the field.');
  perform pg_temp.mk_event(p_space, EVT_FILE, 'Anticipated global (FDA) filing', '2026-10-31', 'asset', a_sac, 'forecasted', p_asof, 'high', 'month');

  perform pg_temp.mk_event(p_space, EVT_APPR, 'FDA accelerated approval — c-Met-high 2L (Emrelis)', '2025-05-14', 'asset', a_teliso, 'forecasted', p_asof, 'high', 'exact',
    'First-and-only approved c-Met ADC; defensible biomarker niche with companion diagnostic.');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'LUMINOSITY c-Met-high cohort data (ORR 35%)', '2024-09-01', 'asset', a_teliso, 'forecasted', p_asof, 'high', 'month');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'Teliso-V confirmatory phase 3 readout', '2027-06-30', 'asset', a_teliso, 'forecasted', p_asof, 'low', 'quarter');

  perform pg_temp.mk_event(p_space, EVT_TOP, 'HERTHENA-Lung02 OS threshold not met', '2025-02-15', 'trial', t_her2, 'forecasted', p_asof, 'high', 'month');
  perform pg_temp.mk_event(p_space, EVT_STRAT, 'BLA voluntarily withdrawn (US)', '2025-05-29', 'asset', a_her3, 'forecasted', p_asof, 'high', 'exact',
    'Regulatory path in the US stalled after the phase 3 OS miss; program continues in EGFR combinations.');

  perform pg_temp.mk_event(p_space, EVT_TOP, 'EVOKE-01 misses OS (11.1 vs 9.8 mo)', '2024-02-06', 'trial', t_evoke01, 'forecasted', p_asof, 'high', 'month',
    'Third ADC to fail to beat docetaxel on OS in pretreated NSCLC — signals the 2L monotherapy paradigm may be a dead end.');
  perform pg_temp.mk_event(p_space, EVT_STRAT, 'Gilead reprioritizes lung ADC program after EVOKE-01', '2024-03-15', 'asset', a_sg, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_TOP, 'EVOKE-03 1L interim signal', '2026-09-30', 'trial', t_evoke03, 'primary', p_asof, 'high', 'quarter');

  perform pg_temp.mk_event(p_space, EVT_STRAT, 'ASCO 2026 — ADC datasets', '2026-05-30', 'space', null, 'forecasted', p_asof, 'low', 'exact');
  perform pg_temp.mk_event(p_space, EVT_STRAT, 'WCLC 2026', '2026-09-06', 'space', null, 'forecasted', p_asof, 'low', 'month');
  perform pg_temp.mk_event(p_space, EVT_STRAT, 'ESMO 2026', '2026-10-23', 'space', null, 'forecasted', p_asof, 'low', 'month');

  -- intelligence (Stout voice). Pitch (depth 1) = 4 sharp field briefs -> bullseye badges.
  if p_depth >= 1 then
    perform pg_temp.mk_intel(p_space, 'product', a_sv,
      'Sigvotatug vedotin after the SigVie-002 miss',
      E'**SigVie-002 missed its primary overall-survival endpoint** in 2L+ non-squamous NSCLC vs docetaxel, with no significant benefit in the overall population. The cleanest path to a broad second-line label is gone, and the 2L ADC monotherapy lane is already a graveyard:\n\n- **Sacituzumab govitecan** (Gilead, EVOKE-01) and **patritumab deruxtecan** (Merck, HERTHENA-Lung02) both failed to beat docetaxel on OS; patritumab''s US filing was withdrawn.\n\n**What survives for sigvotatug:**\n\n- a stronger **OS/PFS trend** in the ~two-thirds of patients with a single prior line;\n- the first-line **sigvotatug + pembrolizumab** combination in PD-L1 >=50%.\n\nIntegrin beta-6 stays a differentiated, high-prevalence target, but the first-line lane is already contested: **datopotamab deruxtecan (Datroway)** is approved in EGFR-mutant 2L with the broadest 1L program, and **sacituzumab tirumotecan** was the first ADC+IO combination to hit a first-line NSCLC primary (OptiTROP-Lung05).',
      E'Pfizer''s near-term decision is **binary**:\n\n- chase a **narrow 1-prior-line label**, or\n- pivot weight onto the **1L pembrolizumab combination**, a lane where Dato-DXd and sac-TMT are already ahead.\n\nThe **biomarker-niche path** is the credible plan B: trastuzumab deruxtecan (HER2-mutant) and telisotuzumab vedotin (c-Met-high) both cleared the FDA by going narrow.\n\n**Recommended next steps:**\n\n1. Pressure-test the regulatory viability of the 1-prior-line subgroup before committing 1L resourcing.\n2. Model a sac-TMT global filing in 2026 compressing the first-line window.\n3. Keep the integrin-beta-6 biomarker-niche option open as a fallback.',
      (p_asof - 3)::timestamptz,
      p_links => jsonb_build_array(
        jsonb_build_object('entity_type','product','entity_id',a_dato::text,'relationship_type','Competitor','gloss','TROP2 ADC; broadest 1L program, the franchise to beat','display_order',0),
        jsonb_build_object('entity_type','product','entity_id',a_sac::text,'relationship_type','Competitor','gloss','First ADC + IO to hit a 1L NSCLC primary (OptiTROP-Lung05)','display_order',1),
        jsonb_build_object('entity_type','product','entity_id',a_enh::text,'relationship_type','Predecessor','gloss','Biomarker-niche precedent: HER2-mutant','display_order',2),
        jsonb_build_object('entity_type','product','entity_id',a_teliso::text,'relationship_type','Predecessor','gloss','Biomarker-niche precedent: c-Met-high','display_order',3),
        jsonb_build_object('entity_type','product','entity_id',a_sg::text,'relationship_type','Same class','gloss','2L ADC monotherapy OS miss (EVOKE-01)','display_order',4),
        jsonb_build_object('entity_type','product','entity_id',a_her3::text,'relationship_type','Same class','gloss','OS miss and withdrawn US filing (HERTHENA-Lung02)','display_order',5)));
    perform pg_temp.mk_intel(p_space, 'space', p_space,
      'NSCLC ADC field: the first-line prize is still open',
      'AstraZeneca/Daiichi own the category with two approved NSCLC ADCs (Dato-DXd, Enhertu) and the deepest 1L combination pipeline. Every 2L ADC monotherapy story is commoditizing — three ADCs have now failed to beat docetaxel on OS. The unclaimed prize is ADC + checkpoint inhibitor in first line, and sac-TMT (OptiTROP-Lung05) is the first to prove it can hit a 1L primary.',
      'For a Pfizer engagement the question is sequencing: defend the science in 1L combination, or retreat to a biomarker-defined niche the way Enhertu and Emrelis did. The next twelve months of 1L readouts decide the field.',
      (p_asof - 5)::timestamptz);
    perform pg_temp.mk_intel(p_space, 'product', a_dato,
      'Datroway: the franchise to beat',
      'Datopotamab deruxtecan is approved in EGFR-mutant 2L and carries the broadest first-line program in the class (TROPION-Lung07/08). The deruxtecan payload platform is the de facto standard the field is measured against.',
      'If TROPION-Lung08 wins in 1L PD-L1 >=50%, AstraZeneca/Daiichi lock the front line and the window for a differentiated Pfizer entry narrows sharply.',
      (p_asof - 4)::timestamptz);
    perform pg_temp.mk_intel(p_space, 'product', a_sac,
      'Sac-TMT is the asset that pressures Pfizer most',
      'OptiTROP-Lung05 made sacituzumab tirumotecan the first ADC + IO combination to meet a first-line NSCLC primary endpoint. With the China EGFR approval and Merck''s commercial reach, it is the most credible threat to a broad TROP2 or first-line franchise.',
      'Model a scenario where sac-TMT files globally in 2026 and reaches US first-line in 2027 — it compresses the runway for sigvotatug''s 1L combination.',
      (p_asof - 6)::timestamptz);
  end if;

  if p_depth >= 2 then
    -- version history on the sigvotatug brief: revised after the full WCLC readout
    perform pg_temp.mk_intel(p_space, 'product', a_sv,
      'Sigvotatug vedotin: subgroup signal firms up, 1L is the whole game',
      'Full SigVie-002 data confirmed a meaningful overall-survival benefit in the 1-prior-line subgroup despite the negative overall result. A narrow label is now conceivable but commercially thin. The franchise case rests almost entirely on the first-line sigvotatug + pembrolizumab readout.',
      'Recommend Pfizer treat the 1L combination as the single decision point and prepare both a go and a no-go portfolio plan around it. The biomarker-niche pivot remains a credible fallback.',
      (p_asof - 2)::timestamptz,
      'SigVie-002 missed its primary overall-survival endpoint. The cleanest path to a broad second-line label is gone; the franchise case now rests on the 1-prior-line subgroup and the first-line pembrolizumab combination.',
      (p_asof - 70)::timestamptz,
      'Sigvotatug vedotin after the SigVie-002 miss');
  end if;

  if p_depth >= 3 then
    perform pg_temp.mk_intel(p_space, 'product', a_enh,
      'Enhertu: the niche done right',
      'Trastuzumab deruxtecan built a defensible, approvable lane by going narrow — HER2-mutant disease with a clear biomarker — and is now pushing into first line (DESTINY-Lung04). It is the template for the biomarker-niche strategy.',
      'If Pfizer pivots sigvotatug away from all-comers, Enhertu is the precedent to study: how a narrow label compounds into a durable franchise.',
      (p_asof - 8)::timestamptz);
    perform pg_temp.mk_intel(p_space, 'product', a_teliso,
      'Emrelis: proof a c-Met niche can clear the FDA',
      'Telisotuzumab vedotin secured accelerated approval in c-Met-high non-squamous NSCLC with a companion diagnostic — a second example of the narrow, biomarker-led path working where broad monotherapy has failed.',
      'Reinforces the option value of a biomarker pivot for sigvotatug; the integrin beta-6 prevalence story would need a comparable diagnostic anchor.',
      (p_asof - 10)::timestamptz);
    perform pg_temp.mk_intel(p_space, 'space', p_space,
      'NSCLC ADC field, one year on: the front line is consolidating',
      'A year of first-line readouts has reshaped the field. The deruxtecan platform and sac-TMT have pulled ahead in 1L combinations; the 2L monotherapy lane is effectively closed. Biomarker niches (HER2-mut, c-Met-high) remain the only reliably approvable ground.',
      'For Pfizer the renewal-year read is stark: sigvotatug''s future is now a single binary 1L readout, with a biomarker pivot as the only credible plan B. Recommend the portfolio decision be made on that readout, not deferred.',
      (p_asof - 3)::timestamptz,
      'The first-line prize remains open but contested; sac-TMT''s 1L primary win and Datroway''s breadth set the pace. Pfizer''s path runs through its own 1L combination or a biomarker niche.',
      (p_asof - 150)::timestamptz,
      'NSCLC ADC field: the first-line prize is still open');

    -- ------------------------------------------------------------------
    -- A year of Stout coverage: 12 dated field briefs spread Jul 2025 ->
    -- Jun 2026 so the renewal-year feed reads as a sustained engagement,
    -- not a June cluster. Each anchors on a DISTINCT entity (trial /
    -- company / remaining asset) so it lands as its own feed row; two
    -- carry version history for the "the read evolved" click-through.
    -- Dates are literal (published_at = updated_at = created_at = p_when).
    -- ------------------------------------------------------------------

    -- Jul 2025 — Gilead concedes the 2L lane
    perform pg_temp.mk_intel(p_space, 'company', co_gilead,
      'Gilead: stepping back from lung after EVOKE-01',
      'Gilead has pulled back from its NSCLC ambitions for sacituzumab govitecan (Trodelvy) after EVOKE-01 failed to beat docetaxel on overall survival. The remaining lung bet is EVOKE-03 in first line; investment and messaging have shifted toward breast and bladder, where Trodelvy is already approved.',
      'Gilead is the clearest case of a competitor conceding the second-line lung ADC lane. It removes one rival from the near-term set but confirms how unforgiving 2L monotherapy has become.',
      '2025-07-22'::timestamptz);

    -- Aug 2025 — Pfizer's own position going in
    perform pg_temp.mk_intel(p_space, 'company', co_pfizer,
      'Pfizer oncology: sigvotatug is the lung ADC bet',
      'Sigvotatug vedotin is Pfizer''s lead solid-tumor ADC and its entry into the NSCLC category, built on the integrin beta-6 target from the Seagen platform. The SigVie-002 second-line readout is the near-term catalyst; the first-line pembrolizumab combination is the longer bet.',
      'Pfizer''s standing in NSCLC ADCs rides on two sequential readouts. A weak SigVie-002 would force the strategic question early, before the 1L combination matures.',
      '2025-08-14'::timestamptz);

    -- Sep 2025 — AZ/Daiichi own the category
    perform pg_temp.mk_intel(p_space, 'company', co_az,
      'AstraZeneca and Daiichi own the NSCLC ADC category',
      'AstraZeneca and Daiichi Sankyo hold the only two approved NSCLC ADCs, datopotamab deruxtecan (Datroway, EGFR-mutant 2L) and trastuzumab deruxtecan (Enhertu, HER2-mutant), and run the deepest first-line combination program (TROPION-Lung07/08, DESTINY-Lung04). The deruxtecan payload is the platform every rival is benchmarked against.',
      'Any Pfizer entry is measured against the deruxtecan standard. Differentiation has to come from target (integrin beta-6) or setting (1L combination), not from payload.',
      '2025-09-16'::timestamptz);

    -- Oct 2025 — the 2L monotherapy thesis hardens
    perform pg_temp.mk_intel(p_space, 'trial', t_evoke01,
      'EVOKE-01 confirms the 2L monotherapy dead end',
      'EVOKE-01 (sacituzumab govitecan vs docetaxel) missed overall survival, 11.1 vs 9.8 months, the third TROP2 or HER3 ADC to fail to beat chemotherapy in pretreated NSCLC after HERTHENA-Lung02 and the sigvotatug signal. The pattern is now a thesis, not a coincidence.',
      'Second-line ADC monotherapy is effectively closed as a broad-label strategy. Sigvotatug''s value has to be argued in first line or in a biomarker niche, not against docetaxel in all-comers.',
      '2025-10-09'::timestamptz);

    -- Nov 2025 — sac-TMT wins first line (revised from an Aug watch note)
    perform pg_temp.mk_intel(p_space, 'trial', t_otl05,
      'OptiTROP-Lung05: the first ADC + IO to win first line',
      'Sacituzumab tirumotecan plus a checkpoint inhibitor met its first-line PFS primary in OptiTROP-Lung05, the first time an ADC + IO combination has cleared a front-line NSCLC endpoint. It converts the 1L combination thesis from hypothetical to proven and puts Merck ahead in the most valuable setting.',
      'The front-line prize is now demonstrably winnable, and a competitor got there first. Every Pfizer 1L timeline should be modeled against a sac-TMT global filing in 2026.',
      '2025-11-18'::timestamptz,
      'OptiTROP-Lung05 is the first-line ADC + IO readout to watch. A win would prove the combination thesis; a miss would push the field back toward biomarker niches.',
      '2025-08-05'::timestamptz,
      'OptiTROP-Lung05: the first-line combination readout to watch');

    -- Dec 2025 — patritumab's US path closes
    perform pg_temp.mk_intel(p_space, 'product', a_her3,
      'Patritumab deruxtecan: US path closed, EGFR combinations remain',
      'Merck and Daiichi''s patritumab deruxtecan lost its US filing after HERTHENA-Lung02 missed overall survival, withdrawing the BLA in May. The HER3 program survives only in EGFR post-TKI combination settings, where it competes with Datroway and sac-TMT rather than leading.',
      'A second Merck-aligned ADC is out of the broad 2L race. It narrows the near-term competitive set but reinforces that overall survival, not response rate, is the bar sigvotatug must clear.',
      '2025-12-11'::timestamptz);

    -- Jan 2026 — Merck consolidates around sac-TMT
    perform pg_temp.mk_intel(p_space, 'company', co_merck,
      'Merck: sac-TMT is the lung ADC to build around',
      'Merck has consolidated its NSCLC ADC strategy around sacituzumab tirumotecan (licensed from Kelun) after the OptiTROP-Lung05 first-line win and China approval, while patritumab deruxtecan recedes to combination-only use. Merck''s checkpoint franchise gives sac-TMT a built-in 1L combination partner.',
      'Merck pairs a proven 1L ADC with the leading IO backbone, the exact combination Pfizer is chasing with sigvotatug plus pembrolizumab. Merck is the most direct threat to that plan.',
      '2026-01-20'::timestamptz);

    -- Feb 2026 — Enhertu presses into 1L
    perform pg_temp.mk_intel(p_space, 'trial', t_dl04,
      'DESTINY-Lung04: Enhertu presses into first line',
      'DESTINY-Lung04 tests trastuzumab deruxtecan in first-line HER2-mutant NSCLC, the move from a niche 2L label toward front-line standard of care. A win would show how a biomarker-defined ADC compounds a narrow approval into a durable franchise.',
      'The Enhertu arc is the template for a sigvotatug biomarker pivot: land narrow, then expand into 1L. Worth tracking as the proof case for plan B.',
      '2026-02-12'::timestamptz);

    -- Mar 2026 — the AZ front-line test (revised from a Dec preview)
    perform pg_temp.mk_intel(p_space, 'trial', t_tl08,
      'TROPION-Lung08: the front-line test AZ has to pass',
      'TROPION-Lung08 (datopotamab deruxtecan plus pembrolizumab vs pembrolizumab) is the definitive first-line PD-L1 >=50% test for the deruxtecan platform. A win locks AstraZeneca and Daiichi into the front line and compresses the window for any differentiated entrant, sigvotatug included.',
      'This is the single readout that most directly bounds sigvotatug''s 1L opportunity. Model both outcomes into the portfolio decision rather than waiting for topline.',
      '2026-03-19'::timestamptz,
      'TROPION-Lung08 is the first-line Dato-DXd plus pembrolizumab readout that will show whether the deruxtecan platform can own front-line PD-L1-high NSCLC.',
      '2025-12-20'::timestamptz,
      'TROPION-Lung08: AZ''s bid for the front line');

    -- Apr 2026 — sigvotatug's whole case narrows to one readout
    perform pg_temp.mk_intel(p_space, 'trial', t_sv1l,
      'Sigvotatug + pembrolizumab: the franchise in one readout',
      'With second-line monotherapy commoditized, the first-line sigvotatug plus pembrolizumab study (PD-L1 >=50%) has become the decisive catalyst for the entire integrin beta-6 program. It enters a field where sac-TMT has already won a 1L primary and Dato-DXd is close behind.',
      'Treat this as a binary, franchise-defining event. Pfizer should prepare both go and no-go portfolio plans, with the biomarker-niche pivot as the standing fallback.',
      '2026-04-15'::timestamptz);

    -- May 2026 — the c-Met niche proof point
    perform pg_temp.mk_intel(p_space, 'company', co_abbvie,
      'AbbVie''s Emrelis: proof a c-Met niche can clear the FDA',
      'AbbVie''s telisotuzumab vedotin (Emrelis) secured accelerated approval in c-Met-high non-squamous NSCLC with a companion diagnostic, a second example of the narrow, biomarker-led path working where broad monotherapy has failed. It sits alongside Enhertu as evidence the niche route is reliably approvable.',
      'Reinforces the option value of a biomarker pivot for sigvotatug. The integrin beta-6 prevalence story would need a comparable diagnostic anchor to follow the same path.',
      '2026-05-07'::timestamptz);

    -- Jun 2026 — the last untested 1L combination
    perform pg_temp.mk_intel(p_space, 'trial', t_evoke03,
      'EVOKE-03: the field''s last untested 1L combination',
      'EVOKE-03 (sacituzumab govitecan plus pembrolizumab in 1L PD-L1 >=50%) is the remaining front-line ADC + IO combination still to read out after OptiTROP-Lung05 set the pace. A second positive 1L combination would confirm the setting as a class effect rather than a single-asset win.',
      'The outcome sets the competitive baseline sigvotatug''s own 1L combination is measured against. A strong result raises the bar; a miss reopens room for a differentiated entrant.',
      '2026-06-10'::timestamptz);
  end if;
end $f$;
