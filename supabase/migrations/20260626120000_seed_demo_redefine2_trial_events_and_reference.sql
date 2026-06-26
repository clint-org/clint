-- migration: 20260626120000_seed_demo_redefine2_trial_events_and_reference
--
-- Make REDEFINE-2 (Novo CagriSema) a fully-populated trial in the demo seed so
-- its trial-detail page exercises every section (markers, activity, referenced
-- in, AND scoped events) for screenshots and demos. Before this, the demo seed
-- had zero trial-scoped events anywhere, so the trial-detail "EVENTS" panel
-- ("External intelligence scoped to this trial") was always empty, and no
-- published analysis referenced REDEFINE-2 so "Referenced in" was empty too.
--
-- Two seed helpers are extended (CREATE OR REPLACE on the live bodies):
--   1. _seed_demo_events            -> add three REDEFINE-2-scoped events
--                                      (trial_id + asset_id + company_id set).
--   2. _seed_demo_primary_intelligence -> add a trial link from the published
--                                      REDEFINE-1 read to REDEFINE-2 so the
--                                      latter shows as "Referenced in" 1 analysis.
--
-- Reseed-safe: both helpers are append-only inserts run by seed_demo_data().
-- No standalone DML and no changes to existing rows; a fresh provision or a
-- delete-and-reseed of a space materializes the new data. Markers and activity
-- for REDEFINE-2 are already produced by _seed_demo_markers /
-- _seed_demo_recent_activity / _seed_demo_activity_variety; ctgov fields are
-- populated by the live CT.gov sync job. security definer is preserved on both
-- helpers (the orchestrator's space-owner gate is the authoritative check).

-- =============================================================================
-- 1. _seed_demo_events: base = 20260623120000_seed_demo_event_thread.sql
--    Only change vs that body: declarations for t_redefine_2 / p_cagrisema and
--    a trailing insert of three REDEFINE-2 trial-scoped events.
-- =============================================================================

create or replace function public._seed_demo_events(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');
  c_zenith   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_zenith');
  c_atlas    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_atlas');

  -- REDEFINE-2 scoping (Novo Nordisk / CagriSema): trial-scoped events so the
  -- trial-detail EVENTS panel has content.
  t_redefine_2 uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');

  ec_regulatory uuid := 'e0000000-0000-0000-0000-000000000002';
  ec_financial  uuid := 'e0000000-0000-0000-0000-000000000003';
  ec_strategic  uuid := 'e0000000-0000-0000-0000-000000000004';
  ec_clinical   uuid := 'e0000000-0000-0000-0000-000000000005';
  ec_commercial uuid := 'e0000000-0000-0000-0000-000000000006';

  thr_pfizer_glp1 uuid := gen_random_uuid();
begin
  -- Thread parent first (events.thread_id references event_threads).
  insert into public.event_threads (id, space_id, title, created_by) values
    (thr_pfizer_glp1, p_space_id, 'Pfizer oral GLP-1 retreat', p_uid);

  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (gen_random_uuid(), p_space_id, c_cascade,  ec_strategic,  null, null, 'Roche acquires Carmot Therapeutics ($2.7B)',
      '2023-12-04', 'Roche announces acquisition of Carmot Therapeutics for $2.7B upfront, gaining access to CT-388 and CT-996 obesity assets.',
      'high', array['m&a', 'obesity', 'incretin'], p_uid),
    (gen_random_uuid(), p_space_id, c_meridian, ec_strategic,  null, null, 'Lilly announces $4.5B manufacturing capacity expansion',
      '2024-02-23', 'Lilly to invest $4.5B in additional incretin manufacturing capacity to meet GLP-1 demand.',
      'high', array['manufacturing', 'capacity'], p_uid),
    (gen_random_uuid(), p_space_id, c_vantage,  ec_strategic,  null, null, 'Novo Holdings acquires Catalent ($16.5B)',
      '2024-02-05', 'Novo Holdings acquires Catalent for $16.5B; Novo Nordisk to acquire 3 Catalent fill-finish sites for Wegovy and Ozempic supply.',
      'high', array['m&a', 'manufacturing', 'supply'], p_uid),
    (gen_random_uuid(), p_space_id, c_apex,     ec_clinical,   thr_pfizer_glp1, 1, 'Pfizer discontinues danuglipron program',
      '2023-12-01', 'Pfizer halts development of oral GLP-1 small molecule danuglipron after high incidence of adverse events in P2.',
      'high', array['discontinuation', 'oral-glp1', 'safety'], p_uid),
    (gen_random_uuid(), p_space_id, c_zenith,   ec_financial,  null, null, 'Viking VK2735 P2 readout drives stock +120%',
      '2024-02-27', 'Viking Therapeutics VK2735 SC P2 obesity readout (~13-15% weight loss at 13 weeks) drives stock price up 120% in single session.',
      'high', array['readout', 'obesity', 'stock-move'], p_uid),
    (gen_random_uuid(), p_space_id, c_vantage,  ec_financial,  null, null, 'Novo CagriSema misses bar, stock -20%',
      '2024-12-20', 'REDEFINE-1 weight loss of 22.7% below ~25% Street consensus, Novo Nordisk stock drops 20% on disappointment.',
      'high', array['readout', 'obesity', 'stock-move'], p_uid),
    (gen_random_uuid(), p_space_id, c_atlas,    ec_commercial, null, null, 'BridgeBio Attruby commercial launch',
      '2024-12-09', 'BridgeBio launches Attruby (acoramidis) for ATTR-CM, second-to-market entrant against Pfizer Vyndaqel.',
      'high', array['launch', 'attr-cm'], p_uid),
    (gen_random_uuid(), p_space_id, c_meridian, ec_financial,  null, null, 'Lilly Mounjaro/Zepbound combined annual revenue exceeds $15B',
      '2024-02-06', 'Lilly FY2024 earnings: Mounjaro and Zepbound combined revenue exceeds $15B, anchor of cardiometabolic franchise.',
      'high', array['earnings', 'revenue', 'incretin'], p_uid),
    (gen_random_uuid(), p_space_id, c_vantage,  ec_regulatory, null, null, 'Wegovy SELECT label update for CV outcomes',
      '2024-03-08', 'FDA approves Wegovy label expansion to include reduced risk of CV death, MI, and stroke based on SELECT.',
      'high', array['fda', 'label-expansion', 'cv-outcomes'], p_uid),
    (gen_random_uuid(), p_space_id, c_apex,     ec_strategic,  thr_pfizer_glp1, 2, 'Pfizer pivots cardiometabolic R&D away from oral GLP-1',
      '2024-01-15', 'Following danuglipron discontinuation, Pfizer signals shift in cardiometabolic R&D away from oral GLP-1 small molecules.',
      'low', array['strategy', 'r&d', 'pivot'], p_uid);

  -- REDEFINE-2 trial-scoped events (Novo CagriSema, obesity + type 2 diabetes).
  -- events_entity_level_check allows at most one of company_id / asset_id /
  -- trial_id, so these set trial_id only -- which is exactly the column the
  -- trial-detail "EVENTS" panel (get_events_page_data, p_entity_level='trial')
  -- filters on. Skipped if the trial is absent from this seed variant.
  if t_redefine_2 is not null then
    insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
      (gen_random_uuid(), p_space_id, t_redefine_2, ec_clinical, 'REDEFINE-2 first participant dosed',
        '2023-03-20', 'Novo Nordisk doses the first participant in REDEFINE-2, the Phase 3 trial of CagriSema in adults with overweight or obesity and type 2 diabetes.',
        'low', array['phase-3', 'enrollment', 'cagrisema', 't2d'], p_uid),
      (gen_random_uuid(), p_space_id, t_redefine_2, ec_clinical, 'REDEFINE-2 completes target enrollment',
        '2024-08-14', 'REDEFINE-2 reaches its target enrollment of roughly 1,200 participants across the CagriSema obesity and type 2 diabetes program.',
        'low', array['phase-3', 'enrollment', 'milestone', 'cagrisema'], p_uid),
      (gen_random_uuid(), p_space_id, t_redefine_2, ec_clinical, 'REDEFINE-2 topline: CagriSema in type 2 diabetes',
        '2025-02-10', 'REDEFINE-2 topline reports approximately 15.7% mean weight reduction at 68 weeks in participants with type 2 diabetes, ahead of the REDEFINE-1 obesity result and reframing the CagriSema combination thesis.',
        'high', array['readout', 'topline', 'obesity', 't2d', 'cagrisema'], p_uid);
  end if;
end;
$$;

-- =============================================================================
-- 2. _seed_demo_primary_intelligence: base = 20260524121000_fix_remaining_product_refs.sql
--    Only change vs that body: declare t_redefine_2 and add one trial link from
--    the published REDEFINE-1 read (pi_redefine) to REDEFINE-2 so the latter is
--    "Referenced in" 1 published analysis.
-- =============================================================================

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_summit         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_summit');
  t_redefine_1     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_1');
  t_redefine_2     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');
  t_sequoia_hcm    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_sequoia_hcm');
  t_fineart_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fineart_hf');
  t_vk2735_sc_p2   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_sc_p2');
  t_attribute_cm   uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attribute_cm');
  t_attr_act       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attr_act');
  t_maritide_p2    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maritide_p2');
  t_attain_1       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attain_1');
  t_achieve_1      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_achieve_1');
  t_maple_hcm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maple_hcm');
  t_deliver        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_deliver');
  t_emperor_preserved uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_preserved');
  t_paradigm_hf    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_paradigm_hf');

  c_apex     uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_helios   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_solara   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_vantage  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_cascade  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cascade');

  p_farxiga      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_farxiga');
  p_jardiance    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_jardiance');
  p_kerendia     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_kerendia');
  p_entresto     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_entresto');
  p_wegovy       uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_wegovy');
  p_zepbound     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zepbound');
  p_retatrutide  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_retatrutide');
  p_vk2735_sc    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vk2735_sc');
  p_camzyos      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_camzyos');
  p_vyndaqel     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_vyndaqel');
  p_orforglipron uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_orforglipron');
  p_rybelsus     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_rybelsus');
  p_azd5004      uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_azd5004');
  p_danuglipron  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_danuglipron');
  p_maritide     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_maritide');
  p_mounjaro     uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_mounjaro');

  m_orforglipron_read uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_orforglipron_read');

  pi_summit       uuid := gen_random_uuid();
  pi_redefine     uuid := gen_random_uuid();
  pi_sequoia      uuid := gen_random_uuid();
  pi_finearts     uuid := gen_random_uuid();
  pi_vk2735       uuid := gen_random_uuid();
  pi_attribute    uuid := gen_random_uuid();
  pi_pfizer       uuid := gen_random_uuid();
  pi_thematic     uuid := gen_random_uuid();
  pi_orfo_draft   uuid := gen_random_uuid();
  pi_maritide_d   uuid := gen_random_uuid();
begin
  -- Read 1: SUMMIT trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_summit, p_space_id, 'trial', t_summit, 'published',
    'Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time',
    E'SUMMIT is the first dedicated outcomes trial showing that a GLP-1-class agent improves both KCCQ-CSS and clinical events in obese HFpEF patients. The composite of CV death and worsening HF events came in favorable, with KCCQ-CSS effect roughly twice the magnitude of the SGLT2 HFpEF wins. The competitive read: tirzepatide is no longer just an obesity drug, it is now a credible HFpEF treatment that will compete for guideline real estate alongside SGLT2 inhibitors and finerenone.',
    E'A guideline-grade HFpEF position for tirzepatide expands the addressable cardiology budget meaningfully. Reframes the competitive map: the HFpEF lane now includes incretins, SGLT2is, and nsMRAs, with combination therapy the likely steady state. Recommend cardiology KOL outreach in the next 60 days.',
    p_uid, now() - interval '14 days', now() - interval '14 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_summit, 'asset', p_farxiga,   'Same class',     'SGLT2 incumbent in HFpEF', 0),
    (pi_summit, 'asset', p_jardiance, 'Competitor',     'SGLT2 incumbent in HFpEF', 1),
    (pi_summit, 'asset', p_kerendia,  'Same class',     'nsMRA HFpEF entrant',      2),
    (pi_summit, 'asset', p_entresto,  'Predecessor',    'ARNI HFrEF predecessor',   3);

  -- Read 2: REDEFINE-1 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_redefine, p_space_id, 'trial', t_redefine_1, 'published',
    'CagriSema misses 25% bar: Novos combo defense thesis under structural pressure',
    E'REDEFINE-1 delivered 22.7% weight loss at 68 weeks, below the ~25% bar Street consensus had built around CagriSema as the next-generation Novo defense against tirzepatide. The amylin combination thesis (additive to GLP-1) is not invalidated but the magnitude of incremental benefit is smaller than priced. Stock down 20% on the day reflects a structural rerating of Novos pipeline value rather than a simple miss.',
    E'Repositions Novo as a defender rather than a class-defining innovator in obesity. M&A and licensing posture likely to shift; Novo may need to acquire next-class assets rather than rely on internal combos. Recommend reviewing Novo BD activity and investor messaging at next earnings.',
    p_uid, now() - interval '13 days', now() - interval '13 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_redefine, 'asset', p_wegovy,      'Predecessor',    'Same molecule, single-agent', 0),
    (pi_redefine, 'asset', p_zepbound,    'Competitor',     'Tirzepatide obesity benchmark', 1),
    (pi_redefine, 'asset', p_retatrutide, 'Future window',  'Next-class triple agonist',     2),
    (pi_redefine, 'asset', p_vk2735_sc,   'Future window',  'Challenger GIP/GLP-1',          3),
    -- REDEFINE-2 is the CagriSema obesity+T2D follow-on; linking it here makes the
    -- trial "Referenced in" this published read on its trial-detail page.
    (pi_redefine, 'trial', t_redefine_2,  'Future window',  'CagriSema obesity + T2D follow-on', 4);

  -- Read 3: SEQUOIA-HCM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_sequoia, p_space_id, 'trial', t_sequoia_hcm, 'published',
    'Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race',
    E'Cytokinetics filed the aficamten NDA for oHCM in Q3 2024 on the basis of a SEQUOIA-HCM readout that closely tracks EXPLORER-HCM with a cleaner safety story. The competitive setup post-PDUFA is now genuinely contested: BMS Camzyos has first-mover scale, but aficamten has a meaningfully simpler dosing regimen and faster onset. The HCM market expands fastest if both products co-promote diagnosis, slowest if they trench around incumbent prescribers.',
    E'A two-product oHCM market drives diagnosis volume up; both companies benefit if the segment doubles. Recommend a refreshed market sizing within 60 days assuming both are launched. Watch for partnership or co-promote commentary, especially from Cytokinetics on commercial scale-up.',
    p_uid, now() - interval '11 days', now() - interval '11 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_sequoia, 'asset', p_camzyos,    'Competitor',  'BMS first-mover in oHCM',    0),
    (pi_sequoia, 'company', c_solara,     'Same class',  'Cytokinetics myosin platform', 1),
    (pi_sequoia, 'company', c_helios,     'Competitor',  'BMS HCM franchise',           2),
    (pi_sequoia, 'trial',   t_maple_hcm,  'Future window', 'Next aficamten readout',    3);

  -- Read 4: FINEARTS-HF trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_finearts, p_space_id, 'trial', t_fineart_hf, 'published',
    'Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF',
    E'FINEARTS-HF is the first nsMRA win in HFpEF/HFmrEF, with a 16% reduction in CV death and total HF events over a 32-month median follow-up. The clinical implication is meaningful: HFpEF treatment can no longer be characterized as SGLT2-only. The combination treatment cocktail (SGLT2 + finerenone, plus the GLP-1 lane opening from SUMMIT) is the new HFpEF reality, and that has implications for both cardiology economics and trial design.',
    E'HFpEF as a multi-mechanism disease unlocks combination economics for cardiology benefits managers. Recommend updating the HFpEF treatment-cocktail forecast assuming SGLT2 + finerenone as the new baseline, with tirzepatide layered on for obese HFpEF.',
    p_uid, now() - interval '9 days', now() - interval '9 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_finearts, 'trial', t_deliver,           'Same class',  'Dapagliflozin HFpEF win',         0),
    (pi_finearts, 'trial', t_emperor_preserved, 'Same class',  'Empagliflozin HFpEF win',         1),
    (pi_finearts, 'trial', t_paradigm_hf,       'Predecessor', 'Entresto HFrEF; PARAGON-HF HFpEF non-win read-across', 2);

  -- Read 5: VK2735 SC P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_vk2735, p_space_id, 'trial', t_vk2735_sc_p2, 'published',
    'Viking VK2735 P2: takeout target or independent path, both scenarios under-priced',
    E'VK2735 SC delivered ~13-15% body weight reduction at 13 weeks, competitive with the front of the tirzepatide and semaglutide ramp. Viking is now under serious M&A consideration and the question is whether takeout pricing reflects a one-asset thesis (VK2735) or a platform thesis (oral analog, NASH, broader cardiometabolic). The asymmetry in the market is that takeout floors keep moving up as P3 readout proximity increases, while standalone valuation requires a P3 readout to be priced fully.',
    E'Both takeout and independent paths are worth modeling because Viking captures upside in both. Recommend updating the BD-target watch with Viking near the top of the obesity asset queue.',
    p_uid, now() - interval '7 days', now() - interval '7 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_vk2735, 'asset', p_zepbound,  'Competitor',     'Tirzepatide obesity benchmark', 0),
    (pi_vk2735, 'asset', p_wegovy,    'Competitor',     'Semaglutide obesity benchmark', 1),
    (pi_vk2735, 'asset', p_maritide,  'Same class',     'Differentiated incretin combo', 2),
    (pi_vk2735, 'company', c_cascade,   'Future window',  'Roche obesity acquirer profile',3);

  -- Read 6: ATTRibute-CM trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_attribute, p_space_id, 'trial', t_attribute_cm, 'published',
    'Acoramidis launches into a Vyndaqel-saturated market: switching dynamics will define 2026',
    E'BridgeBio Attruby launched December 2024 into a Vyndaqel-saturated ATTR-CM market. The clinical case for switching is supportable but not overwhelming: ATTRibute-CM was placebo-controlled, no head-to-head data exist, and Vyndaqel has multi-year real-world experience plus established prior-auth pathways. The 2026 question is how aggressively cardiology specialty pharmacies and TTR-CM specialists test switching, and whether payers create switch-friendly utilization management.',
    E'Switching velocity is the key 2026 metric. Recommend a quarterly tracker on specialty pharmacy script data plus payer policy changes. Both companies likely benefit from market expansion (undiagnosed pool) as long as awareness investments continue.',
    p_uid, now() - interval '5 days', now() - interval '5 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_attribute, 'asset', p_vyndaqel, 'Competitor',  'Pfizer first-mover ATTR-CM', 0),
    (pi_attribute, 'company', c_apex,     'Competitor',  'Pfizer ATTR-CM franchise',   1),
    (pi_attribute, 'trial',   t_attr_act, 'Predecessor', 'Vyndaqel pivotal trial',     2);

  -- Read 7: Pfizer (company)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_pfizer, p_space_id, 'company', c_apex, 'published',
    'Pfizers cardiometabolic exit: danuglipron discontinuation reframes the GLP-1 oral race',
    E'Pfizer halted danuglipron in December 2023 after high incidence of adverse events, effectively ending Pfizers near-term oral GLP-1 ambitions. The signal value is greater than the asset value: the drug class is structurally harder for small molecules than for peptides, which reads through to Lilly orforglipron and AZD5004. Pfizer has since signaled a shift away from cardiometabolic R&D, leaving Vyndaqel as the franchises remaining anchor.',
    E'Pfizers exit narrows the oral GLP-1 field meaningfully and concentrates risk on Lilly. Recommend updating the oral-GLP-1 race scoreboard and re-pricing implied probabilities of success for orforglipron given the cleaner field.',
    p_uid, now() - interval '4 days', now() - interval '4 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_pfizer, 'asset', p_orforglipron, 'Future window', 'Next oral GLP-1 readout',         0),
    (pi_pfizer, 'asset', p_rybelsus,     'Same class',    'Approved oral GLP-1 (peptide)',   1),
    (pi_pfizer, 'asset', p_azd5004,      'Competitor',    'AZ oral GLP-1 entrant',           2);

  -- Read 8: Space (engagement-thematic)
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_thematic, p_space_id, 'space', p_space_id, 'published',
    'Cardiometabolic catalyst cluster H2 2026: TRIUMPH-1, ATTAIN-1, ACHIEVE-1, MAPLE-HCM in one window',
    E'Four decision-grade catalysts cluster across May-October 2026: ATTAIN-1 (orforglipron obesity), ACHIEVE-1 (orforglipron T2D), TRIUMPH-1 (retatrutide obesity), and MAPLE-HCM (aficamten head-to-head). Three are Lilly-anchored, one is Cytokinetics. The cluster compresses analyst and KOL bandwidth and creates short windows where multiple readouts must be interpreted in parallel.',
    E'Recommend a daily cadence briefing during the May-October 2026 window plus pre-positioning analyst notes 2-3 weeks before each readout. Cluster-window coverage is the single most leveraged use of analyst time this year.',
    p_uid, now() - interval '2 days', now() - interval '2 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_thematic, 'company', c_meridian, 'Future window', 'Lilly multi-asset readout cluster', 0),
    (pi_thematic, 'company', c_vantage,  'Future window', 'Novo defensive positioning',        1),
    (pi_thematic, 'company', c_solara,   'Future window', 'Cytokinetics MAPLE-HCM readout',    2);

  -- Read 9: Draft, orforglipron readout marker
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_orfo_draft, p_space_id, 'marker', m_orforglipron_read, 'draft',
    'Pre-read framework for the orforglipron Phase 3 cluster',
    E'Drafting the pre-read framework before ATTAIN-1 and ACHIEVE-1 readouts. Three scenarios: (1) clean efficacy + clean tolerability validates oral GLP-1 as a credible peptide alternative; (2) acceptable efficacy with GI tolerability matching SC peptides keeps the oral lane open but commercially constrained; (3) tolerability footprint resembling danuglipron triggers a re-rating of the entire small-molecule GLP-1 thesis.',
    E'',
    p_uid, now() - interval '6 hours', now() - interval '6 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_orfo_draft, 'trial',   t_attain_1,     'Future window', 'Obesity P3 readout',      0),
    (pi_orfo_draft, 'trial',   t_achieve_1,    'Future window', 'T2D P3 readout',          1),
    (pi_orfo_draft, 'asset', p_danuglipron,  'Predecessor',   'Pfizer oral GLP-1 failure', 2);

  -- Read 10: Draft, MariTide P2 trial
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_maritide_d, p_space_id, 'trial', t_maritide_p2, 'draft',
    'MariTide differentiation thesis: GIPR antagonism vs agonism',
    E'MariTide is the only late-stage incretin program betting on GIPR antagonism rather than agonism (combined with GLP-1 agonism). The mechanistic case rests on whether GIPR signaling drives or counters obesity in chronic dosing. P2 readout supports the antagonism hypothesis but the magnitude of effect (~20% at 52 weeks) is competitive rather than category-leading. Drafting the second-mover positioning thesis ahead of P3 design announcements.',
    E'',
    p_uid, now() - interval '2 hours', now() - interval '2 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_maritide_d, 'asset', p_mounjaro,   'Same class',  'GIP/GLP-1 dual agonist incumbent', 0),
    (pi_maritide_d, 'asset', p_zepbound,   'Competitor',  'Tirzepatide obesity benchmark',    1),
    (pi_maritide_d, 'asset', p_vk2735_sc,  'Same class',  'Other GIP/GLP-1 challenger',       2);
end;
$$;

comment on function public._seed_demo_primary_intelligence(uuid, uuid) is
  'Seeds 8 published primary intelligence reads (6 trial-anchored, 1 company-anchored, 1 space-thematic) plus 2 drafts. The REDEFINE-1 read also links REDEFINE-2 (trial) so that trial reads as referenced-in. Writes summary_md with entity_type=asset for asset links.';
