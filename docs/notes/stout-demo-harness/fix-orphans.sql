-- Remove orphan companies (Kelun-Biotech: no asset; Daiichi Sankyo: asset has no
-- trial) from the 3 seeded NSCLC spaces so home/bullseye/timeline counts agree.
-- Delete the I-DXd asset-anchored event first (polymorphic anchor may not cascade),
-- then the companies (cascades their assets). Set :mode to 'rollback' or 'commit'.
\set ON_ERROR_STOP on
begin;

-- events anchored to Daiichi's assets (the I-DXd strategic dot)
delete from public.events e
using public.spaces s, public.assets a, public.companies c
where e.space_id = s.id
  and s.tenant_id = 'a87a88ae-1b76-4c6b-85e0-1b53c926d0f2'
  and s.name in ('NSCLC ADC — Pitch','NSCLC ADC — 3 Months In','NSCLC ADC — 1 Year In (Renewal)')
  and e.anchor_type = 'asset' and e.anchor_id = a.id
  and a.company_id = c.id and c.name = 'Daiichi Sankyo';

-- orphan companies (cascades Daiichi's now event-free asset)
delete from public.companies c
using public.spaces s
where c.space_id = s.id
  and s.tenant_id = 'a87a88ae-1b76-4c6b-85e0-1b53c926d0f2'
  and s.name in ('NSCLC ADC — Pitch','NSCLC ADC — 3 Months In','NSCLC ADC — 1 Year In (Renewal)')
  and c.name in ('Kelun-Biotech','Daiichi Sankyo');

\echo '=== counts after fix ==='
select s.name,
  (select count(*) from public.companies c where c.space_id = s.id) as companies,
  (select count(*) from public.assets a where a.space_id = s.id) as assets,
  (select count(*) from public.events e where e.space_id = s.id) as events
from public.spaces s
where s.tenant_id = 'a87a88ae-1b76-4c6b-85e0-1b53c926d0f2'
  and s.name like 'NSCLC ADC%'
order by s.name;

\if :{?commit}
  commit;
  \echo 'COMMITTED'
\else
  rollback;
  \echo 'ROLLED BACK (dry run)'
\endif
