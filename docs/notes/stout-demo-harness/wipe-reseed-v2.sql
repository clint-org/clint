-- Full tiered reseed: ADC core + broader field. Keeps space rows/ids.
-- Run -v commit=1 to commit; default rolls back (dry run).
\set ON_ERROR_STOP on
\i docs/notes/stout-demo-harness/seed-nsclc-lib.sql
\i docs/notes/stout-demo-harness/seed-nsclc-field.sql
begin;
do $$
declare
  v_pfizer uuid := 'a87a88ae-1b76-4c6b-85e0-1b53c926d0f2';
  v_presenter uuid := '4fd31044-137c-484b-a8b0-7d0e6a2d51d7';
  v_members uuid[] := array['4fd31044-137c-484b-a8b0-7d0e6a2d51d7','b7714d69-3094-4db5-83e1-1f22e453121b',
                            'b2c3f3e0-b245-428e-9e39-a11bbd6ce921','5af050ef-61df-4ba0-ba72-072594083ba8']::uuid[];
  rec record; v_space uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_presenter::text)::text, true);
  for rec in select * from (values
      -- asof drives the actual/projected split in mk_event. The home page's
      -- upcoming/hero/what-changed all key off REAL today regardless of asof, so
      -- the renewal space's depth (events/intel/materials), not a future asof,
      -- is what reads as "a year in". asof <= today keeps post-today markers
      -- projected so Next-90 shows company/primary/forecasted tier variety.
      ('NSCLC ADC — Pitch'::text, date '2026-06-25', 1),
      ('NSCLC ADC — 3 Months In', date '2026-09-20', 2),
      ('NSCLC ADC — 1 Year In (Renewal)', date '2026-06-28', 3)) as t(name, asof, depth)
  loop
    select id into v_space from public.spaces where tenant_id = v_pfizer and name = rec.name;
    delete from public.materials where space_id = v_space;            -- material_links cascade
    delete from public.events where space_id = v_space;
    delete from public.primary_intelligence_anchors where space_id = v_space;
    delete from public.companies where space_id = v_space;            -- cascades assets/trials/trial_change_events
    perform pg_temp.seed_nsclc_space(v_space, rec.asof, rec.depth);
    perform pg_temp.seed_nsclc_field(v_space, rec.asof, rec.depth);
    perform pg_temp.grant_members(v_space, v_members);
    raise notice 'reseeded % (%)', rec.name, v_space;
  end loop;

  -- Reset the empty Act-1 import space back to truly empty (clears anything a
  -- rehearsal import added). Space row + id are kept so the demo URL stays valid.
  declare v_empty uuid := '5dbea303-160c-43e0-b149-8bf0266b696e';
  begin
    delete from public.materials where space_id = v_empty;
    delete from public.events where space_id = v_empty;
    delete from public.primary_intelligence_anchors where space_id = v_empty;
    delete from public.companies where space_id = v_empty;
    perform pg_temp.grant_members(v_empty, v_members);
    raise notice 'wiped empty import space (%) back to empty', v_empty;
  end;

  -- Pitch-space deliverables (beat 5 opens these). Added here so a reset fully
  -- restores them; ids resolved by name against the freshly reseeded pitch space.
  declare
    v_pitch uuid; a_sv uuid; a_sac uuid; c_pfizer uuid;
  begin
    select id into v_pitch from public.spaces where tenant_id = v_pfizer and name = 'NSCLC ADC — Pitch';
    select id into a_sv from public.assets where space_id = v_pitch and name = 'Sigvotatug vedotin';
    select id into a_sac from public.assets where space_id = v_pitch and name = 'Sacituzumab tirumotecan';
    select id into c_pfizer from public.companies where space_id = v_pitch and name = 'Pfizer';
    perform pg_temp.mk_material(v_pitch, 'ad_hoc',
      'KOL call -- NSCLC ADC sequencing after SigVie-002 (notes)', 'kol-call-nsclc-adc-sequencing-notes.docx',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 142336, now() - interval '2 days',
      jsonb_build_array(jsonb_build_array('product', a_sv::text), jsonb_build_array('company', c_pfizer::text)));
    perform pg_temp.mk_material(v_pitch, 'briefing',
      'Pfizer NSCLC ADC -- Stout pitch', 'pfizer-nsclc-adc-stout-pitch.pptx',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation', 5841920, now() - interval '1 day',
      jsonb_build_array(jsonb_build_array('company', c_pfizer::text), jsonb_build_array('product', a_sv::text), jsonb_build_array('product', a_sac::text)));
    raise notice 'added pitch deliverables (2 materials) to %', v_pitch;
  end;
end $$;
\echo '=== state ==='
select s.name,
  (select count(*) from public.companies c where c.space_id=s.id) companies,
  (select count(*) from public.assets a where a.space_id=s.id) assets,
  (select count(*) from public.trials tr where tr.space_id=s.id) trials,
  (select count(*) from public.events e where e.space_id=s.id) events,
  (select count(*) from public.primary_intelligence pi where pi.space_id=s.id) intel,
  (select count(*) from public.materials m where m.space_id=s.id) materials,
  (select count(*) from public.trial_change_events ce where ce.space_id=s.id) changes
from public.spaces s where s.tenant_id='a87a88ae-1b76-4c6b-85e0-1b53c926d0f2' and s.name like 'NSCLC ADC — %' order by s.name;
\echo '=== year-in projection x precision spread ==='
select e.projection, e.date_precision, count(*)
from public.events e join public.spaces s on s.id=e.space_id
where s.tenant_id='a87a88ae-1b76-4c6b-85e0-1b53c926d0f2' and s.name='NSCLC ADC — 1 Year In (Renewal)'
group by 1,2 order by 1,2;
\echo '=== year-in upcoming window [2026-06-29, 2026-09-27] (browser-today hero candidates) ==='
select e.event_date, et.name, e.projection, e.date_precision, left(e.title,52) title
from public.events e join public.event_types et on et.id=e.event_type_id join public.spaces s on s.id=e.space_id
where s.tenant_id='a87a88ae-1b76-4c6b-85e0-1b53c926d0f2' and s.name='NSCLC ADC — 1 Year In (Renewal)'
  and e.event_date between '2026-06-29' and '2026-09-27'
order by e.event_date limit 14;
\echo '=== year-in ring distribution (bullseye spread) ==='
select ai.development_status, count(distinct ai.asset_id)
from public.asset_indications ai join public.assets a on a.id=ai.asset_id join public.spaces s on s.id=a.space_id
where s.tenant_id='a87a88ae-1b76-4c6b-85e0-1b53c926d0f2' and s.name='NSCLC ADC — 1 Year In (Renewal)'
group by ai.development_status order by 1;
\if :{?commit}
  commit; \echo 'COMMITTED'
\else
  rollback; \echo 'ROLLED BACK (dry run)'
\endif
