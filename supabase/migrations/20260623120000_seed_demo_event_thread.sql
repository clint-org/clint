-- migration: 20260623120000_seed_demo_event_thread
--
-- Re-add a seeded example of the event thread feature. The cardiometabolic seed
-- rewrite (20260502130000) dropped all threaded events, leaving no demo data
-- that exercises event_threads / events.thread_order. This threads the two
-- existing Apex (Pfizer) oral-GLP-1 events into a single narrative chain so a
-- freshly provisioned or reset space shows a working thread.
--
-- Only change vs 20260502130000._seed_demo_events: a "Pfizer oral GLP-1 retreat"
-- thread is created and the danuglipron discontinuation -> R&D pivot events are
-- assigned thread_order 1 and 2. thread_order is a small int ordinal, never a
-- timestamp. security invoker is preserved (orchestrator's space-owner gate is
-- the authoritative permission check).

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
end;
$$;
