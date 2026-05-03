-- migration: 20260503030000_list_latest_snapshots_for_space
-- purpose: ship a single-call RPC that returns the latest ct.gov snapshot
--   payload for every trial in a space, used by the trial-list page to
--   render per-space-configurable extra columns (trial_list_columns surface
--   of spaces.ctgov_field_visibility).
--
-- chose a batched RPC over fan-out lazy-load because the trial-list shows
-- every trial in a space at once; one round trip per trial would dominate
-- first paint. distinct on(trial_id) order by ctgov_version desc returns
-- the latest snapshot per trial in a single query.
--
-- See plan: docs/superpowers/plans/2026-05-03-per-space-ctgov-fields-remaining-surfaces.md

create or replace function public.list_latest_snapshots_for_space(p_space_id uuid)
returns table (trial_id uuid, payload jsonb, fetched_at timestamptz)
language sql
security invoker
stable
set search_path to ''
as $$
  select distinct on (s.trial_id)
    s.trial_id,
    s.payload,
    s.fetched_at
  from public.trial_ctgov_snapshots s
  where s.space_id = p_space_id
  order by s.trial_id, s.ctgov_version desc;
$$;

comment on function public.list_latest_snapshots_for_space is
  'Returns the latest ct.gov snapshot payload per trial in a space. Used by the trial-list dynamic columns surface. Security invoker -- RLS on trial_ctgov_snapshots filters to spaces the caller has access to.';

-- =============================================================================
-- Smoke test: bootstrap a hermetic fixture, insert two snapshots for the
-- same trial (versions 1 and 2), call the RPC, assert it returns exactly the
-- latest payload. Tear down via cascade through tenants -> agencies -> auth.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := '88888881-8888-8888-8888-888888888881';
  v_tenant_id  uuid := '88888882-8888-8888-8888-888888888882';
  v_user_id    uuid := '88888883-8888-8888-8888-888888888883';
  v_space_id   uuid := '88888884-8888-8888-8888-888888888884';
  v_company_id uuid := '88888885-8888-8888-8888-888888888885';
  v_product_id uuid := '88888886-8888-8888-8888-888888888886';
  v_ta_id      uuid := '88888887-8888-8888-8888-888888888887';
  v_trial_id   uuid := '88888888-8888-8888-8888-888888888888';
  v_count      int;
  v_payload    jsonb;
begin
  insert into auth.users (id, email)
    values (v_user_id, 'list-snap-smoke@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'List Snap Smoke', 'list-snap-smoke', 'listsnapsmoke', 'LSS', 'lss@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'LSS', 'list-snap-smoke-t', 'lstsmoket', 'LSS');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_user_id);

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_user_id, 'LSS Co');

  insert into public.therapeutic_areas (id, space_id, created_by, name)
    values (v_ta_id, v_space_id, v_user_id, 'LSS TA');

  insert into public.products (id, space_id, created_by, company_id, name)
    values (v_product_id, v_space_id, v_user_id, v_company_id, 'LSS Drug');

  insert into public.trials (id, space_id, created_by, product_id, therapeutic_area_id, name, identifier)
    values (v_trial_id, v_space_id, v_user_id, v_product_id, v_ta_id, 'LSS Trial', 'NCT99998888');

  insert into public.trial_ctgov_snapshots
    (trial_id, space_id, nct_id, ctgov_version, last_update_post_date, payload, fetched_via)
  values
    (v_trial_id, v_space_id, 'NCT99998888', 1, '2026-05-01',
     jsonb_build_object('protocolSection',
       jsonb_build_object('identificationModule',
         jsonb_build_object('nctId', 'NCT99998888'))),
     'smoke'),
    (v_trial_id, v_space_id, 'NCT99998888', 2, '2026-05-02',
     jsonb_build_object('protocolSection',
       jsonb_build_object('identificationModule',
         jsonb_build_object('nctId', 'NCT99998888-LATEST'))),
     'smoke');

  select count(*),
         (array_agg(payload order by fetched_at desc))[1]
    into v_count, v_payload
  from public.list_latest_snapshots_for_space(v_space_id);

  if v_count <> 1 then
    raise exception 'list_latest_snapshots_for_space smoke FAIL: expected 1 row, got %', v_count;
  end if;
  if v_payload->'protocolSection'->'identificationModule'->>'nctId' <> 'NCT99998888-LATEST' then
    raise exception 'list_latest_snapshots_for_space smoke FAIL: expected latest payload, got %', v_payload;
  end if;

  -- cleanup: cascade from tenants -> spaces -> trials -> snapshots, then
  -- agency, then auth.users. follows the same teardown shape as the
  -- 20260502120900 dashboard-change-counts smoke.
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_user_id;

  raise notice 'list_latest_snapshots_for_space smoke test: PASS';
end $$;
