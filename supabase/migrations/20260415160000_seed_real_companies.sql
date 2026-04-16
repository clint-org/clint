-- migration: 20260415160000_seed_real_companies
-- purpose: replace fictional company names in seed functions with real pharma
--          companies so that logo APIs (brandfetch domain CDN) return valid images.
-- affected objects:
--   - public._seed_demo_companies (updated names + logo_url)
--   - public._seed_demo_events (updated company name references in text)

-- =============================================================================
-- 1. replace _seed_demo_companies with real pharma names + logo URLs
-- =============================================================================
-- Mapping (variable key -> new name):
--   c_meridian  -> AstraZeneca       (SGLT2i anchor, maps to Zelvox)
--   c_helios    -> Bristol-Myers Squibb (cardiac myosin, maps to Cardivant)
--   c_vantage   -> Novo Nordisk      (GLP-1/GIP, maps to Glytara)
--   c_apex      -> Pfizer            (TTR stabilizer, maps to Thyravex)
--   c_cardinal  -> Merck             (sGC, maps to Venatris)
--   c_solara    -> Bayer             (nsMRA, maps to Ketavora)
--   c_cascade   -> Boehringer Ingelheim (cardiac myosin, maps to Pravicel)
--   c_zenith    -> GSK               (early stage)

create or replace function public._seed_demo_companies(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian  uuid := gen_random_uuid();
  c_helios    uuid := gen_random_uuid();
  c_vantage   uuid := gen_random_uuid();
  c_apex      uuid := gen_random_uuid();
  c_cardinal  uuid := gen_random_uuid();
  c_solara    uuid := gen_random_uuid();
  c_cascade   uuid := gen_random_uuid();
  c_zenith    uuid := gen_random_uuid();
begin
  insert into public.companies (id, space_id, created_by, name, logo_url, display_order) values
    (c_meridian, p_space_id, p_uid, 'AstraZeneca',          'https://cdn.brandfetch.io/domain/astrazeneca.com',          1),
    (c_helios,   p_space_id, p_uid, 'Bristol-Myers Squibb', 'https://cdn.brandfetch.io/domain/bms.com',                 2),
    (c_vantage,  p_space_id, p_uid, 'Novo Nordisk',         'https://cdn.brandfetch.io/domain/novonordisk.com',         3),
    (c_apex,     p_space_id, p_uid, 'Pfizer',               'https://cdn.brandfetch.io/domain/pfizer.com',              4),
    (c_cardinal, p_space_id, p_uid, 'Merck',                'https://cdn.brandfetch.io/domain/merck.com',               5),
    (c_solara,   p_space_id, p_uid, 'Bayer',                'https://cdn.brandfetch.io/domain/bayer.com',               6),
    (c_cascade,  p_space_id, p_uid, 'Boehringer Ingelheim', 'https://cdn.brandfetch.io/domain/boehringer-ingelheim.com', 7),
    (c_zenith,   p_space_id, p_uid, 'GSK',                  'https://cdn.brandfetch.io/domain/gsk.com',                 8);

  insert into _seed_ids (entity_type, key, id) values
    ('company', 'c_meridian',  c_meridian),
    ('company', 'c_helios',    c_helios),
    ('company', 'c_vantage',   c_vantage),
    ('company', 'c_apex',      c_apex),
    ('company', 'c_cardinal',  c_cardinal),
    ('company', 'c_solara',    c_solara),
    ('company', 'c_cascade',   c_cascade),
    ('company', 'c_zenith',    c_zenith);
end;
$$;

-- =============================================================================
-- 2. replace _seed_demo_events with real company names in text
-- =============================================================================

create or replace function public._seed_demo_events(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  c_meridian  uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_meridian');
  c_helios    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_helios');
  c_vantage   uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_vantage');
  c_apex      uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_apex');
  c_solara    uuid := (select id from _seed_ids where entity_type = 'company' and key = 'c_solara');

  p_zelvox    uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_zelvox');
  p_cardivant uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_cardivant');
  p_oxavance  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_oxavance');
  p_restivon  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_restivon');
  p_ketavora  uuid := (select id from _seed_ids where entity_type = 'product' and key = 'p_ketavora');

  t_pulse_hf       uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_pulse_hf');
  t_echo_hf        uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_echo_hf');
  t_restivon_step  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_restivon_step');
  t_hls_early      uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_hls_early');
  t_lumivex_renal  uuid := (select id from _seed_ids where entity_type = 'trial' and key = 't_lumivex_renal');

  ec_leadership  uuid := 'e0000000-0000-0000-0000-000000000001';
  ec_regulatory  uuid := 'e0000000-0000-0000-0000-000000000002';
  ec_financial   uuid := 'e0000000-0000-0000-0000-000000000003';
  ec_strategic   uuid := 'e0000000-0000-0000-0000-000000000004';
  ec_clinical    uuid := 'e0000000-0000-0000-0000-000000000005';
  ec_commercial  uuid := 'e0000000-0000-0000-0000-000000000006';

  th_leadership  uuid := gen_random_uuid();
  th_supply      uuid := gen_random_uuid();

  ev_fda_guidance     uuid := gen_random_uuid();
  ev_esc_preview      uuid := gen_random_uuid();
  ev_safety_signal    uuid := gen_random_uuid();
  ev_enrollment_pause uuid := gen_random_uuid();
  ev_meridian_q4      uuid := gen_random_uuid();
  ev_meridian_ceo1    uuid := gen_random_uuid();
  ev_meridian_ceo2    uuid := gen_random_uuid();
  ev_meridian_ceo3    uuid := gen_random_uuid();
  ev_supply1          uuid := gen_random_uuid();
  ev_supply2          uuid := gen_random_uuid();
  ev_zelvox_esc       uuid := gen_random_uuid();
  ev_ketavora_payer   uuid := gen_random_uuid();
  ev_helios_patent    uuid := gen_random_uuid();
  ev_pulse_enroll     uuid := gen_random_uuid();
  ev_echo_protocol    uuid := gen_random_uuid();
  ev_restivon_site    uuid := gen_random_uuid();
  ev_solara_ipo       uuid := gen_random_uuid();
  ev_apex_license     uuid := gen_random_uuid();
  ev_renal_guideline  uuid := gen_random_uuid();
  ev_hls_dose         uuid := gen_random_uuid();
begin
  -- Event threads
  insert into public.event_threads (id, space_id, title, created_by) values
    (th_leadership, p_space_id, 'AstraZeneca Leadership Transition',  p_uid),
    (th_supply,     p_space_id, 'Zelvox Supply Chain Update',         p_uid);

  -- Space-level events (industry)
  insert into public.events (id, space_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_fda_guidance,    p_space_id, ec_regulatory, 'FDA publishes updated HF treatment guidance',
      '2025-03-15', 'New guidance emphasizes earlier intervention with SGLT2i and GLP-1 RA in HFpEF patients. Implications for ongoing P3 programs.',
      'high', array['guidance', 'regulatory', 'hf'], p_uid),
    (ev_esc_preview,     p_space_id, ec_clinical,   'ESC 2026 late-breaking sessions announced',
      '2026-02-28', 'Three HF trials selected for late-breaking presentations: PULSE-HF, ECHO-HF, and one undisclosed.',
      'low',  array['conference', 'esc'], p_uid),
    (ev_renal_guideline, p_space_id, ec_clinical,   'KDIGO updates CKD management guidelines',
      '2025-09-10', 'Updated KDIGO guidelines expand recommended use of SGLT2i in CKD regardless of diabetes status.',
      'high', array['guidance', 'ckd', 'kdigo'], p_uid);

  -- Company-level events
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_meridian_q4, p_space_id, c_meridian, ec_financial, 'AstraZeneca Q4 2025 earnings: pipeline update',
      '2025-02-12', 'Zelvox sales up 23% YoY. Management reaffirmed PULSE-HF readout timeline. Raised full-year guidance.',
      'low', array['earnings', 'pipeline'], p_uid);

  -- AstraZeneca leadership thread (3 events)
  insert into public.events (id, space_id, company_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_meridian_ceo1, p_space_id, c_meridian, ec_leadership, th_leadership, 1, 'AstraZeneca CEO announces retirement',
      '2025-06-01', 'Dr. Sarah Chen to step down as CEO effective Q4 2025 after 12-year tenure.',
      'high', array['leadership', 'succession'], p_uid),
    (ev_meridian_ceo2, p_space_id, c_meridian, ec_leadership, th_leadership, 2, 'AstraZeneca names interim CEO',
      '2025-09-15', 'COO James Park appointed interim CEO. Board initiates formal search process.',
      'high', array['leadership', 'succession'], p_uid),
    (ev_meridian_ceo3, p_space_id, c_meridian, ec_leadership, th_leadership, 3, 'AstraZeneca selects permanent CEO',
      '2026-01-20', 'Dr. Maria Rodriguez, former BMS CMO, appointed CEO effective March 1.',
      'high', array['leadership', 'succession'], p_uid);

  -- Other company events
  insert into public.events (id, space_id, company_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_helios_patent, p_space_id, c_helios, ec_strategic, 'BMS secures key HF patent extension',
      '2025-07-20', 'USPTO grants patent term extension for Cardivant composition of matter through 2031.',
      'low', array['patent', 'ip'], p_uid),
    (ev_solara_ipo, p_space_id, c_solara, ec_financial, 'Bayer divests consumer health unit',
      '2025-04-10', 'Raised $3.8B from divestiture. Proceeds to fund RENAL-NOVA P3 and SLR-8820 development.',
      'high', array['divestiture', 'financing'], p_uid),
    (ev_apex_license, p_space_id, c_apex, ec_strategic, 'Pfizer licenses Thyravex ex-US rights to Merck',
      '2025-11-05', '$200M upfront + milestones. Merck gains commercialization rights in EU and Japan.',
      'high', array['licensing', 'partnership'], p_uid);

  -- Product-level events
  insert into public.events (id, space_id, product_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_zelvox_esc, p_space_id, p_zelvox, ec_clinical, 'Zelvox added to ESC HF treatment algorithm',
      '2025-08-30', 'Updated ESC guidelines now recommend Zelvox as first-line in HFrEF alongside standard therapy.',
      'high', array['guidelines', 'esc', 'hf'], p_uid),
    (ev_ketavora_payer, p_space_id, p_ketavora, ec_commercial, 'Major PBM adds Ketavora to preferred formulary',
      '2025-05-18', 'CVS Caremark adds Ketavora to preferred tier for MRA-eligible HF patients.',
      'low', array['payer', 'formulary', 'access'], p_uid);

  -- Zelvox supply chain thread (2 events)
  insert into public.events (id, space_id, product_id, category_id, thread_id, thread_order, title, event_date, description, priority, tags, created_by) values
    (ev_supply1, p_space_id, p_zelvox, ec_commercial, th_supply, 1, 'Zelvox API supply disruption reported',
      '2025-10-01', 'AstraZeneca discloses temporary disruption at primary API manufacturing site. Inventory levels adequate for 90 days.',
      'high', array['supply-chain', 'manufacturing'], p_uid),
    (ev_supply2, p_space_id, p_zelvox, ec_commercial, th_supply, 2, 'Zelvox supply normalized',
      '2025-12-15', 'Manufacturing site back to full capacity. No patient supply interruptions occurred.',
      'low', array['supply-chain', 'manufacturing'], p_uid);

  -- Trial-level events
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_pulse_enroll, p_space_id, t_pulse_hf, ec_clinical, 'PULSE-HF enrollment complete',
      '2025-11-20', 'Target enrollment of 4,500 patients achieved across 320 sites globally.',
      'high', array['enrollment', 'milestone'], p_uid),
    (ev_echo_protocol, p_space_id, t_echo_hf, ec_clinical, 'ECHO-HF protocol amendment approved by FDA',
      '2025-08-05', 'Amendment adds NT-proBNP secondary endpoint per DSMB recommendation. No change to primary.',
      'low', array['protocol', 'amendment'], p_uid),
    (ev_restivon_site, p_space_id, t_restivon_step, ec_clinical, 'RESTIVON-STEP expands to 50 additional sites',
      '2025-07-01', 'Expansion includes 30 sites in EU and 20 in Asia-Pacific to accelerate enrollment.',
      'low', array['enrollment', 'expansion'], p_uid),
    (ev_hls_dose, p_space_id, t_hls_early, ec_clinical, 'HLS-EARLY-HF dose cohort 3 complete',
      '2025-09-20', 'No dose-limiting toxicities at 40mg. Cohort 4 (80mg) enrollment initiating.',
      'low', array['dose-escalation', 'safety'], p_uid);

  -- Safety signal + enrollment pause (linked events)
  insert into public.events (id, space_id, trial_id, category_id, title, event_date, description, priority, tags, created_by) values
    (ev_safety_signal, p_space_id, t_lumivex_renal, ec_clinical, 'RENAL-NOVA DSMB flags hepatic signal',
      '2025-06-15', 'Independent DSMB identified transient ALT elevations in 3.2% of treatment arm. Recommends enhanced monitoring.',
      'high', array['safety', 'dsmb'], p_uid),
    (ev_enrollment_pause, p_space_id, t_lumivex_renal, ec_clinical, 'RENAL-NOVA enrollment temporarily paused',
      '2025-06-20', 'Sponsor pauses enrollment pending hepatic safety review. Existing patients continue on protocol.',
      'high', array['safety', 'enrollment', 'pause'], p_uid);

  -- Event sources
  insert into public.event_sources (id, event_id, url, label) values
    (gen_random_uuid(), ev_fda_guidance,    'https://example.com/fda-hf-guidance-2025',       'FDA Guidance Document'),
    (gen_random_uuid(), ev_meridian_q4,     'https://example.com/astrazeneca-q4-2025',        'Press Release'),
    (gen_random_uuid(), ev_meridian_q4,     'https://example.com/astrazeneca-q4-slides',      'Earnings Slides'),
    (gen_random_uuid(), ev_meridian_ceo1,   'https://example.com/astrazeneca-ceo-retirement', 'Press Release'),
    (gen_random_uuid(), ev_solara_ipo,      'https://example.com/bayer-divestiture',           'SEC Filing'),
    (gen_random_uuid(), ev_apex_license,    'https://example.com/pfizer-merck-license',        'Press Release'),
    (gen_random_uuid(), ev_zelvox_esc,      'https://example.com/esc-2025-guidelines',         'ESC Guidelines'),
    (gen_random_uuid(), ev_safety_signal,   'https://example.com/renal-nova-dsmb',             'Company Statement'),
    (gen_random_uuid(), ev_renal_guideline, 'https://example.com/kdigo-2025-ckd',              'KDIGO Guidelines');

  -- Event links
  insert into public.event_links (source_event_id, target_event_id, created_by) values
    (ev_safety_signal,   ev_enrollment_pause, p_uid),
    (ev_fda_guidance,    ev_zelvox_esc,       p_uid),
    (ev_apex_license,    ev_ketavora_payer,   p_uid),
    (ev_renal_guideline, ev_fda_guidance,     p_uid);
end;
$$;

-- =============================================================================
-- 3. update _seed_demo_notifications with real company names
-- =============================================================================

create or replace function public._seed_demo_notifications(p_space_id uuid, p_uid uuid)
returns void
language plpgsql
security invoker
set search_path = ''
as $$
declare
  m_cardio_data   uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_cardio_data');
  m_heart_filing  uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_heart_filing');
  m_nephro_proj   uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_nephro_proj');
  m_pulse_topline uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_pulse_topline');
  m_echo_interim  uuid := (select id from _seed_ids where entity_type = 'marker' and key = 'm_echo_interim');
begin
  insert into public.marker_notifications (space_id, marker_id, priority, summary, created_by) values
    (p_space_id, m_cardio_data,   'high', 'Zelvox CARDIO-SHIELD results presented at ESC 2019 -- positive primary endpoint.',                    p_uid),
    (p_space_id, m_heart_filing,  'high', 'Cardivant HEART-PRESERVE sNDA filed for HFpEF -- PDUFA action expected Q3 2022.',                     p_uid),
    (p_space_id, m_nephro_proj,   'low',  'Renoquil NEPHRO-CLEAR regulatory filing projection updated to Q1 2023.',                              p_uid),
    (p_space_id, m_pulse_topline, 'high', 'Oxavance PULSE-HF topline readout expected H2 2026 -- potential best-in-class sGC stimulator.',       p_uid),
    (p_space_id, m_echo_interim,  'low',  'Pravicel ECHO-HF interim analysis scheduled for AHA 2026. DSMB pre-specified futility boundary.',     p_uid);
end;
$$;

-- =============================================================================
-- 4. update orchestrator comment
-- =============================================================================

comment on function public.seed_demo_data(uuid) is
  'Seeds a space with comprehensive demo data: 8 real pharma companies (AstraZeneca, '
  'Bristol-Myers Squibb, Novo Nordisk, Pfizer, Merck, Bayer, Boehringer Ingelheim, GSK) '
  'with logo URLs, 20 fictional products across 4 therapeutic areas (HF, CKD, T2D, Obesity), '
  '26 trials covering all development phases (PRECLIN through LAUNCHED), 55+ markers using '
  'all 13 system types, 12 trial notes, 20 events with threads/links/sources, and 5 marker '
  'notifications. Uses modular helper functions (_seed_demo_*) for maintainability. '
  'Idempotent: returns early if the space already has companies.';
