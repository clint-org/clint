-- Fix: _seed_demo_primary_intelligence must run as security definer.
--
-- The primary_intelligence write policies require is_agency_member_of_space,
-- which a typical space-owner test user does not satisfy. The seed
-- orchestrator's space-owner gate is the actual authorization for this
-- helper; security definer lets the inserts go through without weakening
-- the orchestrator's gate.
--
-- The revision trigger on primary_intelligence inherits this security
-- context, so per-row revision rows are written without an additional RLS
-- check. auth.uid() inside a security definer function still resolves to
-- the caller, so last_edited_by / edited_by remain attributable.
--
-- _seed_demo_materials does not need this change: materials insert RLS
-- uses has_space_access (which space owners satisfy), not the agency
-- check.

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  -- Trials.
  t_cardio_shield  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_cardio_shield');
  t_fortify_hf     uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fortify_hf');
  t_heart_preserve uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_heart_preserve');
  t_glyco_advance  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glyco_advance');
  t_valor_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_valor_hf');
  t_pulse_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_pulse_hf');
  t_vbx_scout      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_vbx_scout');

  -- Companies.
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_cardinal uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cardinal');
  c_helios   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');

  -- Products.
  p_zelvox    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');
  p_cardivant uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cardivant');

  -- Markers.
  m_pulse_topline uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_pulse_topline');

  pi_cardio    uuid := gen_random_uuid();
  pi_fortify   uuid := gen_random_uuid();
  pi_glyco     uuid := gen_random_uuid();
  pi_valor     uuid := gen_random_uuid();
  pi_thematic  uuid := gen_random_uuid();
  pi_pulse_d   uuid := gen_random_uuid();
  pi_vbx_d     uuid := gen_random_uuid();
begin
  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_cardio, p_space_id, 'trial', t_cardio_shield, 'published',
    'CARDIO-SHIELD topline reinforces zelvox HF moat',
    E'Meridian''s launched HF program continues to widen the gap on standard of care. The 4,744-patient all-cause mortality readout from CARDIO-SHIELD held up at 24 months with no signal of attenuation, and the per-protocol subgroup (~70% adherence) tracked the ITT result inside one decimal point. The competitive read: Cardinal''s HEART-PRESERVE program now needs to differentiate on something other than mortality.',
    E'- Cardinal Q4 2026 protocol amendment language\n- AHA late-breaker session for any subgroup analyses\n- Generic LoE clock on zelvox in EU5 (LoE 2034 in major markets)',
    E'Reinforces the thesis that Meridian sits in a 3-4 year ramp window before generic pressure. Licensing window for combination partners is open through Q3 2027.',
    p_uid, now() - interval '2 days', now() - interval '2 days'
  );

  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, gloss, display_order
  ) values
    (pi_cardio, 'trial',   t_heart_preserve, 'Competitor',  'Cardinal HF program in same indication',  0),
    (pi_cardio, 'product', p_cardivant,      'Same class',  'Cardinal competing molecule',             1),
    (pi_cardio, 'company', c_cardinal,       'Competitor',  'Primary HF competitor in this engagement', 2);

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_fortify, p_space_id, 'trial', t_fortify_hf, 'published',
    'FORTIFY-HF P3 ramp on track despite enrollment slowdown',
    E'Meridian''s second-generation HF asset is roughly 60% enrolled with a Q4 2027 PDUFA in view. The slower enrollment is a function of competing recruitment, not safety: drop-out remains under 8% and the DSMB has cleared three interim looks without requesting protocol changes. Topline expectation remains favorable on the primary endpoint.',
    E'- Q4 enrollment update at the Meridian R&D day\n- Any DSMB statement following the November interim\n- Cardinal''s MYOCARD-1 readout for read-across signal',
    E'A clean Phase 3 readout positions Meridian as the only company with two on-market HF assets in this LoE band. Begin scenario planning for portfolio implications on the existing zelvox launch.',
    p_uid, now() - interval '5 days', now() - interval '5 days'
  );

  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, display_order
  ) values
    (pi_fortify, 'trial',   t_cardio_shield, 'Predecessor', 0),
    (pi_fortify, 'product', p_zelvox,        'Same class',  1);

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_glyco, p_space_id, 'trial', t_glyco_advance, 'published',
    'GLYCO-ADVANCE 478-pt readout repositions Solara T2D franchise',
    E'The smaller-than-typical readout (478 pts) hit the primary endpoint with a HbA1c delta of 0.9% versus standard of care. Solara is positioning glytara as a third-line option for patients who fail GLP-1 / SGLT2 combinations rather than as a front-line replacement, which we read as a defensive segmentation play given Novo / Lilly category dominance.',
    E'- Solara investor day pricing language\n- Any payer formulary signal in the next 90 days\n- ADA late-breaker submission window',
    E'Confirms Solara stays in T2D but at the margin. Combination partnerships are the more likely growth vector than head-to-head positioning.',
    p_uid, now() - interval '7 days', now() - interval '7 days'
  );

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_valor, p_space_id, 'trial', t_valor_hf, 'published',
    'VALOR-HF early signal: rethinking Helios HF roadmap',
    E'Helios''s VALOR-HF Phase 2 came in with a directional but underpowered efficacy signal. The board is reportedly weighing whether to take the program straight to Phase 3 or to fold the asset into a broader licensing package. The latter would meaningfully change the competitive picture in HF.',
    E'- Helios board commentary at Q1 2027 call\n- Any BD activity around the asset\n- Comp-set pricing changes in the post-readout window',
    E'A Helios licensing event would compress the field. Worth a refreshed competitive map within 30 days regardless of outcome.',
    p_uid, now() - interval '10 days', now() - interval '10 days'
  );

  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, display_order
  ) values
    (pi_valor, 'company', c_helios, 'Competitor', 0);

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_thematic, p_space_id, 'space', p_space_id, 'published',
    'HF / CKD landscape: catalysts cluster Q3-Q4 2027',
    E'The four asset programs we are tracking (Meridian zelvox, Cardinal cardivant, Helios renoquil, Solara glytara) all have decision-grade catalysts inside a four-month window. Three of those map to primary endpoints; one (Helios) is a BD signal more than a clinical one. The implication for clients is that a Q2 reset on the competitive map will be necessary regardless of any single readout.',
    E'- Cluster of catalysts: AHA late-breakers, ESC late-breakers, EMA approval window\n- BD signal from Helios licensing process\n- Any pricing signals from the launch comp set',
    E'Recommend a shared briefing cadence with all four engagement stakeholders during the catalyst window. Daily briefings make sense from October to December.',
    p_uid, now() - interval '1 day', now() - interval '1 day'
  );

  insert into public.primary_intelligence_links (
    primary_intelligence_id, entity_type, entity_id, relationship_type, display_order
  ) values
    (pi_thematic, 'company', c_meridian, 'Future window',  0),
    (pi_thematic, 'company', c_cardinal, 'Future window',  1),
    (pi_thematic, 'company', c_helios,   'Future window',  2);

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_pulse_d, p_space_id, 'marker', m_pulse_topline, 'draft',
    'PULSE-HF topline expectations and pre-read framework',
    E'The PULSE-HF topline lands inside the cluster window. Initial framing: this is a confirmatory readout for Meridian rather than a value-creating one, since the primary endpoint is identical to CARDIO-SHIELD and the sample size is comparable. The watch is more about the hierarchy of secondaries than the primary itself.',
    E'- Order of secondary endpoints in the SAP\n- Any change in the publication strategy',
    E'',
    p_uid, now() - interval '3 hours', now() - interval '3 hours'
  );

  insert into public.primary_intelligence (
    id, space_id, entity_type, entity_id, state, headline,
    thesis_md, watch_md, implications_md, last_edited_by,
    created_at, updated_at
  ) values (
    pi_vbx_d, p_space_id, 'trial', t_vbx_scout, 'draft',
    'VBX-SCOUT: scout-phase read-across to the broader Vantage portfolio',
    E'The scout phase is too small to be definitive but the PK / PD pattern is consistent with the in-class precedent. Drafting a forward-looking read so the team has framing in place before the late-2027 readout window.',
    E'',
    E'',
    p_uid, now() - interval '1 hour', now() - interval '1 hour'
  );
end;
$$;

comment on function public._seed_demo_primary_intelligence(uuid, uuid) is
  'Seeds five published primary intelligence reads (four trial-anchored, one space-level thematic) plus two drafts. Includes cross-entity links and the revision rows are written by the existing trigger on insert. Runs as security definer so the orchestrator''s space-owner gate is the authoritative permission check; bypasses the agency-only write RLS that would otherwise block space owners who are not also agency members.';
