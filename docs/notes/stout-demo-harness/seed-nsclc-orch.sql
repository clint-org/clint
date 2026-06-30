-- Orchestration body (no txn control, no \i). Assumes lib already \i'd and
-- enclosed in a transaction by the caller (prod = commit, dryrun = rollback).
do $$
declare
  v_presenter uuid := '4fd31044-137c-484b-a8b0-7d0e6a2d51d7';  -- aadityamadala@gmail.com
  v_bi        uuid := 'c747dd15-a176-4edb-acb2-8c716ea1fd4b';  -- Boehringer Ingelheim
  v_pfizer    uuid := 'a87a88ae-1b76-4c6b-85e0-1b53c926d0f2';  -- Pfizer
  v_members   uuid[] := array[
    '4fd31044-137c-484b-a8b0-7d0e6a2d51d7',  -- aadityamadala
    'b7714d69-3094-4db5-83e1-1f22e453121b',  -- aadi529
    'b2c3f3e0-b245-428e-9e39-a11bbd6ce921',  -- samantha.dodbele (Sam)
    '5af050ef-61df-4ba0-ba72-072594083ba8'   -- aadimadala
  ]::uuid[];
  v_space uuid;
begin
  perform set_config('request.jwt.claims', json_build_object('sub', v_presenter::text)::text, true);

  insert into public.tenant_members(tenant_id, user_id, role)
  values (v_bi, v_presenter, 'owner') on conflict do nothing;

  -- S0: Boehringer Ingelheim, standard obesity demo
  v_space := pg_temp.ensure_space(v_bi, 'Obesity Competitive Landscape');
  if (select count(*) from public.companies where space_id = v_space) = 0 then
    perform public.seed_demo_data(v_space);
  end if;
  perform pg_temp.grant_members(v_space, v_members);
  raise notice 'S0 obesity (BI) = %', v_space;

  -- Pfizer: empty live-import canvas (Act 1)
  v_space := pg_temp.ensure_space(v_pfizer, 'NSCLC ADC — New Space');
  perform pg_temp.grant_members(v_space, v_members);
  raise notice 'empty NSCLC = %', v_space;

  -- Pfizer: pitch baseline
  v_space := pg_temp.ensure_space(v_pfizer, 'NSCLC ADC — Pitch');
  perform pg_temp.seed_nsclc_space(v_space, date '2026-06-25', 1);
  perform pg_temp.grant_members(v_space, v_members);
  raise notice 'pitch = %', v_space;

  -- Pfizer: 3 months in
  v_space := pg_temp.ensure_space(v_pfizer, 'NSCLC ADC — 3 Months In');
  perform pg_temp.seed_nsclc_space(v_space, date '2026-09-20', 2);
  perform pg_temp.grant_members(v_space, v_members);
  raise notice '3-months = %', v_space;

  -- Pfizer: 1 year in (renewal)
  v_space := pg_temp.ensure_space(v_pfizer, 'NSCLC ADC — 1 Year In (Renewal)');
  perform pg_temp.seed_nsclc_space(v_space, date '2027-06-20', 3);
  perform pg_temp.grant_members(v_space, v_members);
  raise notice '1-year = %', v_space;
end $$;

\echo '=== demo spaces (counts) ==='
select t.subdomain, s.name,
  (select count(*) from public.companies c where c.space_id = s.id) as companies,
  (select count(*) from public.assets a where a.space_id = s.id) as assets,
  (select count(*) from public.trials tr where tr.space_id = s.id) as trials,
  (select count(*) from public.events e where e.space_id = s.id) as events,
  (select count(*) from public.primary_intelligence pi where pi.space_id = s.id) as intel,
  (select count(*) from public.space_members sm where sm.space_id = s.id) as members
from public.spaces s
join public.tenants t on t.id = s.tenant_id
where t.subdomain in ('bi','pfizer')
order by t.subdomain, s.name;
