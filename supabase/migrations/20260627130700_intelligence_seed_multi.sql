-- migration: 20260627130700_intelligence_seed_multi
-- purpose: replace the no-op stub _seed_demo_primary_intelligence (added in
--   20260627130200 to keep db reset clean while Tasks 1-7 rewired the schema)
--   with a real anchor-aware seed. For each brief, an anchor row is inserted
--   first (carrying entity_type, entity_id, is_lead, display_order), and the
--   version row references it via anchor_id. entity_type/entity_id are NOT
--   stored on the version row (they moved to the anchor in 20260627130000).
--
-- Changes vs the previous body (20260626120000_seed_demo_redefine2_trial_events_and_reference):
--   - Read 9 (marker-anchored orforglipron draft) removed; markers are not
--     anchor owners in the new model.
--   - A SECOND brief is added for SUMMIT (non-lead sibling, is_lead=false,
--     display_order=1) with a commercial-angle read so the drawer shows two
--     entries for that trial.
--   - Per read, an anchor row is inserted before the version row.
--   - Version row columns: (id, space_id, anchor_id, state, headline,
--     summary_md, implications_md, last_edited_by, created_at, updated_at).
--
-- No notify pgrst: the function signature is unchanged (uuid, uuid) -> void.

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid      uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t_summit            uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_summit');
  t_redefine_1        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_1');
  t_redefine_2        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_redefine_2');
  t_sequoia_hcm       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_sequoia_hcm');
  t_fineart_hf        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fineart_hf');
  t_vk2735_sc_p2      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vk2735_sc_p2');
  t_attribute_cm      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attribute_cm');
  t_attr_act          uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attr_act');
  t_maritide_p2       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maritide_p2');
  t_attain_1          uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_attain_1');
  t_achieve_1         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_achieve_1');
  t_maple_hcm         uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_maple_hcm');
  t_deliver           uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_deliver');
  t_emperor_preserved uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_emperor_preserved');
  t_paradigm_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_paradigm_hf');

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

  -- anchor IDs (one per brief; SUMMIT gets a second)
  pi_summit_anch     uuid := gen_random_uuid();
  pi_summit_anch2    uuid := gen_random_uuid();
  pi_redefine_anch   uuid := gen_random_uuid();
  pi_sequoia_anch    uuid := gen_random_uuid();
  pi_finearts_anch   uuid := gen_random_uuid();
  pi_vk2735_anch     uuid := gen_random_uuid();
  pi_attribute_anch  uuid := gen_random_uuid();
  pi_pfizer_anch     uuid := gen_random_uuid();
  pi_thematic_anch   uuid := gen_random_uuid();
  pi_maritide_d_anch uuid := gen_random_uuid();

  -- version row IDs
  pi_summit     uuid := gen_random_uuid();
  pi_summit2    uuid := gen_random_uuid();
  pi_redefine   uuid := gen_random_uuid();
  pi_sequoia    uuid := gen_random_uuid();
  pi_finearts   uuid := gen_random_uuid();
  pi_vk2735     uuid := gen_random_uuid();
  pi_attribute  uuid := gen_random_uuid();
  pi_pfizer     uuid := gen_random_uuid();
  pi_thematic   uuid := gen_random_uuid();
  pi_maritide_d uuid := gen_random_uuid();
begin
  -- ==========================================================================
  -- Read 1: SUMMIT trial (lead brief, clinical-outcomes angle)
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_summit_anch, p_space_id, 'trial', t_summit, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_summit, p_space_id, pi_summit_anch, 'published',
    'Tirzepatide HFpEF readout puts a GLP-1 in the cardiology guideline conversation for the first time',
    E'SUMMIT is the first dedicated outcomes trial showing that a GLP-1-class agent improves both KCCQ-CSS and clinical events in obese HFpEF patients. The composite of CV death and worsening HF events came in favorable, with KCCQ-CSS effect roughly twice the magnitude of the SGLT2 HFpEF wins. The competitive read: tirzepatide is no longer just an obesity drug, it is now a credible HFpEF treatment that will compete for guideline real estate alongside SGLT2 inhibitors and finerenone.',
    E'A guideline-grade HFpEF position for tirzepatide expands the addressable cardiology budget meaningfully. Reframes the competitive map: the HFpEF lane now includes incretins, SGLT2is, and nsMRAs, with combination therapy the likely steady state. Recommend cardiology KOL outreach in the next 60 days.',
    p_uid, now() - interval '14 days', now() - interval '14 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_summit, 'asset', p_farxiga,   'Same class',  'SGLT2 incumbent in HFpEF', 0),
    (pi_summit, 'asset', p_jardiance, 'Competitor',  'SGLT2 incumbent in HFpEF', 1),
    (pi_summit, 'asset', p_kerendia,  'Same class',  'nsMRA HFpEF entrant',      2),
    (pi_summit, 'asset', p_entresto,  'Predecessor', 'ARNI HFrEF predecessor',   3);

  -- ==========================================================================
  -- Read 1b: SUMMIT trial (second brief, non-lead, commercial-angle read)
  --   Demonstrates multi-entry drawer for the same trial.
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_summit_anch2, p_space_id, 'trial', t_summit, false, 1
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_summit2, p_space_id, pi_summit_anch2, 'published',
    'SUMMIT commercial framing: formulary and access dynamics for tirzepatide in HFpEF',
    E'Lilly has positioned SUMMIT as a formulary expansion argument, not just a clinical win. The label is expected to carry an HFpEF indication alongside obesity, opening a second reimbursement channel that does not compete with the obesity carve-out. Cardiology specialty pharmacies and integrated delivery networks are the early commercial targets; the obesity channel is already saturated with prior-auth requirements that a cardiology channel largely avoids.',
    E'Monitor Q1 2026 formulary decisions from the top five PBMs and the CMS NCD track. The cardiology channel is less price-sensitive than obesity, which supports Lilly holding list price while negotiating restricted formulary placement. A concurrent SGLT2 + tirzepatide combination strategy is the most plausible payer ask within 18 months.',
    p_uid, now() - interval '10 days', now() - interval '10 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_summit2, 'company', c_meridian,  'Future window', 'Lilly HFpEF commercial lead', 0),
    (pi_summit2, 'asset',   p_jardiance, 'Competitor',    'SGLT2 formulary incumbent',   1);

  -- ==========================================================================
  -- Read 2: REDEFINE-1 trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_redefine_anch, p_space_id, 'trial', t_redefine_1, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_redefine, p_space_id, pi_redefine_anch, 'published',
    'CagriSema misses 25% bar: Novos combo defense thesis under structural pressure',
    E'REDEFINE-1 delivered 22.7% weight loss at 68 weeks, below the ~25% bar Street consensus had built around CagriSema as the next-generation Novo defense against tirzepatide. The amylin combination thesis (additive to GLP-1) is not invalidated but the magnitude of incremental benefit is smaller than priced. Stock down 20% on the day reflects a structural rerating of Novos pipeline value rather than a simple miss.',
    E'Repositions Novo as a defender rather than a class-defining innovator in obesity. M&A and licensing posture likely to shift; Novo may need to acquire next-class assets rather than rely on internal combos. Recommend reviewing Novo BD activity and investor messaging at next earnings.',
    p_uid, now() - interval '13 days', now() - interval '13 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_redefine, 'asset', p_wegovy,      'Predecessor',   'Same molecule, single-agent',         0),
    (pi_redefine, 'asset', p_zepbound,    'Competitor',    'Tirzepatide obesity benchmark',        1),
    (pi_redefine, 'asset', p_retatrutide, 'Future window', 'Next-class triple agonist',            2),
    (pi_redefine, 'asset', p_vk2735_sc,   'Future window', 'Challenger GIP/GLP-1',                 3),
    (pi_redefine, 'trial', t_redefine_2,  'Future window', 'CagriSema obesity + T2D follow-on',   4);

  -- ==========================================================================
  -- Read 3: SEQUOIA-HCM trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_sequoia_anch, p_space_id, 'trial', t_sequoia_hcm, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_sequoia, p_space_id, pi_sequoia_anch, 'published',
    'Aficamten NDA filed: Cytokinetics vs BMS Camzyos becomes a real two-horse race',
    E'Cytokinetics filed the aficamten NDA for oHCM in Q3 2024 on the basis of a SEQUOIA-HCM readout that closely tracks EXPLORER-HCM with a cleaner safety story. The competitive setup post-PDUFA is now genuinely contested: BMS Camzyos has first-mover scale, but aficamten has a meaningfully simpler dosing regimen and faster onset. The HCM market expands fastest if both products co-promote diagnosis, slowest if they trench around incumbent prescribers.',
    E'A two-product oHCM market drives diagnosis volume up; both companies benefit if the segment doubles. Recommend a refreshed market sizing within 60 days assuming both are launched. Watch for partnership or co-promote commentary, especially from Cytokinetics on commercial scale-up.',
    p_uid, now() - interval '11 days', now() - interval '11 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_sequoia, 'asset',   p_camzyos,   'Competitor',    'BMS first-mover in oHCM',      0),
    (pi_sequoia, 'company', c_solara,    'Same class',    'Cytokinetics myosin platform',  1),
    (pi_sequoia, 'company', c_helios,    'Competitor',    'BMS HCM franchise',             2),
    (pi_sequoia, 'trial',   t_maple_hcm, 'Future window', 'Next aficamten readout',        3);

  -- ==========================================================================
  -- Read 4: FINEARTS-HF trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_finearts_anch, p_space_id, 'trial', t_fineart_hf, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_finearts, p_space_id, pi_finearts_anch, 'published',
    'Finerenone HFpEF win opens a non-SGLT2 / non-ARNI lane in HFpEF',
    E'FINEARTS-HF is the first nsMRA win in HFpEF/HFmrEF, with a 16% reduction in CV death and total HF events over a 32-month median follow-up. The clinical implication is meaningful: HFpEF treatment can no longer be characterized as SGLT2-only. The combination treatment cocktail (SGLT2 + finerenone, plus the GLP-1 lane opening from SUMMIT) is the new HFpEF reality, and that has implications for both cardiology economics and trial design.',
    E'HFpEF as a multi-mechanism disease unlocks combination economics for cardiology benefits managers. Recommend updating the HFpEF treatment-cocktail forecast assuming SGLT2 + finerenone as the new baseline, with tirzepatide layered on for obese HFpEF.',
    p_uid, now() - interval '9 days', now() - interval '9 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_finearts, 'trial', t_deliver,           'Same class',  'Dapagliflozin HFpEF win',                         0),
    (pi_finearts, 'trial', t_emperor_preserved, 'Same class',  'Empagliflozin HFpEF win',                         1),
    (pi_finearts, 'trial', t_paradigm_hf,       'Predecessor', 'Entresto HFrEF; PARAGON-HF HFpEF non-win read-across', 2);

  -- ==========================================================================
  -- Read 5: VK2735 SC P2 trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_vk2735_anch, p_space_id, 'trial', t_vk2735_sc_p2, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_vk2735, p_space_id, pi_vk2735_anch, 'published',
    'Viking VK2735 P2: takeout target or independent path, both scenarios under-priced',
    E'VK2735 SC delivered ~13-15% body weight reduction at 13 weeks, competitive with the front of the tirzepatide and semaglutide ramp. Viking is now under serious M&A consideration and the question is whether takeout pricing reflects a one-asset thesis (VK2735) or a platform thesis (oral analog, NASH, broader cardiometabolic). The asymmetry in the market is that takeout floors keep moving up as P3 readout proximity increases, while standalone valuation requires a P3 readout to be priced fully.',
    E'Both takeout and independent paths are worth modeling because Viking captures upside in both. Recommend updating the BD-target watch with Viking near the top of the obesity asset queue.',
    p_uid, now() - interval '7 days', now() - interval '7 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_vk2735, 'asset',   p_zepbound, 'Competitor',    'Tirzepatide obesity benchmark',  0),
    (pi_vk2735, 'asset',   p_wegovy,   'Competitor',    'Semaglutide obesity benchmark',  1),
    (pi_vk2735, 'asset',   p_maritide, 'Same class',    'Differentiated incretin combo',  2),
    (pi_vk2735, 'company', c_cascade,  'Future window', 'Roche obesity acquirer profile', 3);

  -- ==========================================================================
  -- Read 6: ATTRibute-CM trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_attribute_anch, p_space_id, 'trial', t_attribute_cm, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_attribute, p_space_id, pi_attribute_anch, 'published',
    'Acoramidis launches into a Vyndaqel-saturated market: switching dynamics will define 2026',
    E'BridgeBio Attruby launched December 2024 into a Vyndaqel-saturated ATTR-CM market. The clinical case for switching is supportable but not overwhelming: ATTRibute-CM was placebo-controlled, no head-to-head data exist, and Vyndaqel has multi-year real-world experience plus established prior-auth pathways. The 2026 question is how aggressively cardiology specialty pharmacies and TTR-CM specialists test switching, and whether payers create switch-friendly utilization management.',
    E'Switching velocity is the key 2026 metric. Recommend a quarterly tracker on specialty pharmacy script data plus payer policy changes. Both companies likely benefit from market expansion (undiagnosed pool) as long as awareness investments continue.',
    p_uid, now() - interval '5 days', now() - interval '5 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_attribute, 'asset',   p_vyndaqel, 'Competitor',  'Pfizer first-mover ATTR-CM', 0),
    (pi_attribute, 'company', c_apex,     'Competitor',  'Pfizer ATTR-CM franchise',   1),
    (pi_attribute, 'trial',   t_attr_act, 'Predecessor', 'Vyndaqel pivotal trial',     2);

  -- ==========================================================================
  -- Read 7: Pfizer (company)
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_pfizer_anch, p_space_id, 'company', c_apex, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_pfizer, p_space_id, pi_pfizer_anch, 'published',
    'Pfizers cardiometabolic exit: danuglipron discontinuation reframes the GLP-1 oral race',
    E'Pfizer halted danuglipron in December 2023 after high incidence of adverse events, effectively ending Pfizers near-term oral GLP-1 ambitions. The signal value is greater than the asset value: the drug class is structurally harder for small molecules than for peptides, which reads through to Lilly orforglipron and AZD5004. Pfizer has since signaled a shift away from cardiometabolic R&D, leaving Vyndaqel as the franchises remaining anchor.',
    E'Pfizers exit narrows the oral GLP-1 field meaningfully and concentrates risk on Lilly. Recommend updating the oral-GLP-1 race scoreboard and re-pricing implied probabilities of success for orforglipron given the cleaner field.',
    p_uid, now() - interval '4 days', now() - interval '4 days'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_pfizer, 'asset', p_orforglipron, 'Future window', 'Next oral GLP-1 readout',       0),
    (pi_pfizer, 'asset', p_rybelsus,     'Same class',    'Approved oral GLP-1 (peptide)', 1),
    (pi_pfizer, 'asset', p_azd5004,      'Competitor',    'AZ oral GLP-1 entrant',         2);

  -- ==========================================================================
  -- Read 8: Space (engagement-thematic)
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_thematic_anch, p_space_id, 'space', p_space_id, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_thematic, p_space_id, pi_thematic_anch, 'published',
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

  -- Read 9 (marker-anchored orforglipron draft) removed:
  --   markers are not anchor owners in the multi-brief schema.

  -- ==========================================================================
  -- Read 10: Draft, MariTide P2 trial
  -- ==========================================================================
  insert into public.primary_intelligence_anchors (
    id, space_id, entity_type, entity_id, is_lead, display_order
  ) values (
    pi_maritide_d_anch, p_space_id, 'trial', t_maritide_p2, true, 0
  );

  insert into public.primary_intelligence (
    id, space_id, anchor_id, state, headline,
    summary_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_maritide_d, p_space_id, pi_maritide_d_anch, 'draft',
    'MariTide differentiation thesis: GIPR antagonism vs agonism',
    E'MariTide is the only late-stage incretin program betting on GIPR antagonism rather than agonism (combined with GLP-1 agonism). The mechanistic case rests on whether GIPR signaling drives or counters obesity in chronic dosing. P2 readout supports the antagonism hypothesis but the magnitude of effect (~20% at 52 weeks) is competitive rather than category-leading. Drafting the second-mover positioning thesis ahead of P3 design announcements.',
    E'',
    p_uid, now() - interval '2 hours', now() - interval '2 hours'
  );
  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_maritide_d, 'asset', p_mounjaro,  'Same class',  'GIP/GLP-1 dual agonist incumbent', 0),
    (pi_maritide_d, 'asset', p_zepbound,  'Competitor',  'Tirzepatide obesity benchmark',    1),
    (pi_maritide_d, 'asset', p_vk2735_sc, 'Same class',  'Other GIP/GLP-1 challenger',       2);
end;
$$;

comment on function public._seed_demo_primary_intelligence(uuid, uuid) is
  'Seeds 8 published primary intelligence reads (6 trial-anchored, 1 company-anchored, '
  '1 space-thematic) plus 1 draft trial-anchored read, plus a second published brief on '
  'SUMMIT (non-lead sibling, display_order=1) demonstrating the multi-brief drawer. '
  'Read 9 (marker-anchored orforglipron draft) was removed: markers are not anchor owners. '
  'Each brief inserts an anchor row first, then a version row referencing it via anchor_id; '
  'entity_type/entity_id live on the anchor, not on the version row.';
