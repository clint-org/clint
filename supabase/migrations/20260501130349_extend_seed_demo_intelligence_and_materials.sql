-- Extend seed_demo_data with primary intelligence and materials.
--
-- Adds two helpers:
--   _seed_demo_primary_intelligence  -- 5 published reads + 2 drafts, with
--                                       cross-entity links and revisions.
--   _seed_demo_materials             -- 3 materials (briefing / priority
--                                       notice / ad hoc) with multi-entity
--                                       links. File rows reference plausible
--                                       storage paths but do not upload
--                                       actual files; demo download flows
--                                       will 404 cleanly.
--
-- Updates seed_demo_data to call the new helpers after markers are seeded
-- so cross-entity links resolve to real ids.

-- =============================================================================
-- helper: _seed_demo_primary_intelligence
-- =============================================================================

create or replace function public._seed_demo_primary_intelligence(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security invoker
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
  -- Published: CARDIO-SHIELD topline read with cross-entity links to the
  -- Cardinal competitor program and the Cardivant product.
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

  -- Published: FORTIFY-HF mid-phase read.
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

  -- Published: GLYCO-ADVANCE diabetes read.
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

  -- Published: VALOR-HF early read.
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

  -- Published thematic read at the engagement (space) level.
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

  -- Draft: PULSE-HF anchored on a marker. Only visible to agency members.
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

  -- Draft: VBX-SCOUT.
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
  'Seeds five published primary intelligence reads (four trial-anchored, one space-level thematic) plus two drafts. Includes cross-entity links and the revision rows are written by the existing trigger on insert.';

-- =============================================================================
-- helper: _seed_demo_materials
-- =============================================================================

create or replace function public._seed_demo_materials(
  p_space_id uuid,
  p_uid uuid
) returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  t_cardio_shield uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_cardio_shield');
  t_fortify_hf    uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_fortify_hf');
  t_glyco_advance uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_glyco_advance');
  t_valor_hf      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_valor_hf');

  c_cardinal uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_cardinal');
  c_meridian uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');

  p_zelvox uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');

  mat_briefing  uuid := gen_random_uuid();
  mat_notice    uuid := gen_random_uuid();
  mat_adhoc     uuid := gen_random_uuid();
begin
  -- Briefing: cross-cutting catalyst review deck.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at
  ) values (
    mat_briefing, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_briefing::text || '/q3-catalyst-briefing.pptx',
    'q3-catalyst-briefing.pptx',
    2457600,
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'briefing',
    'Q3 catalyst briefing -- HF / CKD',
    now() - interval '4 days'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_briefing, 'trial',   t_cardio_shield, 0),
    (mat_briefing, 'trial',   t_fortify_hf,    1),
    (mat_briefing, 'trial',   t_valor_hf,      2),
    (mat_briefing, 'company', c_meridian,      3);

  -- Priority notice: regulatory / late-breaker note.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at
  ) values (
    mat_notice, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_notice::text || '/aha-late-breaker-priority-notice.pdf',
    'aha-late-breaker-priority-notice.pdf',
    876544,
    'application/pdf',
    'priority_notice',
    'Priority notice: AHA late-breaker session schedule',
    now() - interval '1 day'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_notice, 'trial',   t_cardio_shield, 0),
    (mat_notice, 'product', p_zelvox,        1);

  -- Ad hoc: licensing memo.
  insert into public.materials (
    id, space_id, uploaded_by, file_path, file_name, file_size_bytes,
    mime_type, material_type, title, uploaded_at
  ) values (
    mat_adhoc, p_space_id, p_uid,
    'materials/' || p_space_id::text || '/' || mat_adhoc::text || '/cardinal-licensing-memo.docx',
    'cardinal-licensing-memo.docx',
    154688,
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'ad_hoc',
    'Cardinal licensing memo (preliminary)',
    now() - interval '6 hours'
  );

  insert into public.material_links (material_id, entity_type, entity_id, display_order) values
    (mat_adhoc, 'company', c_cardinal,       0),
    (mat_adhoc, 'trial',   t_glyco_advance,  1);
end;
$$;

comment on function public._seed_demo_materials(uuid, uuid) is
  'Seeds three demo materials: a briefing PPTX, a priority notice PDF, and an ad hoc DOCX, each with multi-entity links. File rows reference plausible storage paths but do not upload actual files; demo download flows will 404 cleanly.';

-- =============================================================================
-- update seed_demo_data orchestrator
-- =============================================================================

create or replace function public.seed_demo_data(p_space_id uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  existing_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated to seed demo data'
      using errcode = '28000';
  end if;

  if not exists (
    select 1 from public.space_members
     where space_id = p_space_id
       and user_id = uid
       and role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Insufficient permissions: must be space owner to seed demo data'
      using errcode = '42501';
  end if;

  select count(*) into existing_count
    from public.companies
    where space_id = p_space_id;

  if existing_count > 0 then
    return;
  end if;

  create temp table if not exists _seed_ids (
    entity_type text not null,
    key         text not null,
    id          uuid not null,
    primary key (entity_type, key)
  ) on commit drop;

  perform public._seed_demo_companies(p_space_id, uid);
  perform public._seed_demo_therapeutic_areas(p_space_id, uid);
  perform public._seed_demo_products(p_space_id, uid);
  perform public._seed_demo_moa_roa(p_space_id, uid);
  perform public._seed_demo_trials(p_space_id, uid);
  perform public._seed_demo_markers(p_space_id, uid);
  perform public._seed_demo_trial_notes(p_space_id, uid);
  perform public._seed_demo_events(p_space_id, uid);
  perform public._seed_demo_notifications(p_space_id, uid);
  perform public._seed_demo_primary_intelligence(p_space_id, uid);
  perform public._seed_demo_materials(p_space_id, uid);
end;
$$;

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies, 20 fictional products across 4 therapeutic areas, 26 trials covering all phases, 55+ markers, 12 trial notes, 20 events, 5 notifications, plus 5 published primary intelligence reads (4 trial-anchored, 1 space-level thematic), 2 drafts, and 3 materials (briefing PPTX / priority notice PDF / ad hoc DOCX) with multi-entity links. Permission gate: caller must be a space owner of p_space_id or a platform admin. Idempotent: returns early if the space already has companies.';
