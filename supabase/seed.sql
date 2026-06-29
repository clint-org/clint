-- seed data for the clinical trial dashboard
-- this file is executed after all migrations on `supabase start` and `supabase db reset`.
--
-- Event model, Stage 4 (lite): a single populated demo space so the timeline
-- renders out of the box. The unified event_type_categories and event_types ship
-- as system rows inside their migrations, so this file only bootstraps a demo
-- tenant/space and a small competitive landscape (one company, one asset, two
-- trials) plus a handful of events authored through the shared create_event RPC.
--
-- Everything here is idempotent: the demo bootstrap rows use fixed UUIDs in the
-- 00000000-...-0000000d range, and the content block short-circuits when the
-- space already has companies, so re-running `supabase db reset` is safe.
-- Integration tests build their own personas/spaces and do not depend on this file.

-- =============================================================================
-- LOCAL DEV demo user, tenant, and space (stable across `supabase db reset`).
-- =============================================================================

-- bootstrap user owns the demo content (created_by FKs into auth.users).
insert into auth.users (id, email, raw_user_meta_data)
values (
  '00000000-0000-0000-0000-00000000000d',
  'demo-bootstrap@clint.local',
  jsonb_build_object('full_name', 'Daniel Reyes')
)
on conflict (id) do update
  set raw_user_meta_data =
    jsonb_set(coalesce(auth.users.raw_user_meta_data, '{}'::jsonb), '{full_name}', '"Daniel Reyes"');

insert into public.tenants (id, name, slug, subdomain, app_display_name)
values (
  '00000000-0000-0000-0000-0000000d0010',
  'Demo Pharma CI',
  'demo-pharma-ci',
  'demo',
  'Demo Pharma CI'
)
on conflict (id) do nothing;

insert into public.spaces (id, tenant_id, name, description, created_by)
values (
  '00000000-0000-0000-0000-0000000d0100',
  '00000000-0000-0000-0000-0000000d0010',
  'Pipeline Demo',
  'Seeded demo space for local UI walkthroughs.',
  '00000000-0000-0000-0000-00000000000d'
)
on conflict (id) do nothing;

insert into public.space_members (space_id, user_id, role)
values ('00000000-0000-0000-0000-0000000d0100', '00000000-0000-0000-0000-00000000000d', 'owner')
on conflict (space_id, user_id) do nothing;

-- =============================================================================
-- Demo competitive landscape + events.
-- Companies/assets/trials are inserted directly as the seeding superuser (RLS is
-- bypassed; created_by supplied explicitly). Events go through the shared
-- create_event RPC, which asserts has_space_access -- so we spoof the demo
-- user's JWT and switch to the authenticated role for those calls only. The
-- whole block is skipped when the space already has companies (idempotent).
-- =============================================================================
do $$
declare
  v_space   uuid := '00000000-0000-0000-0000-0000000d0100';
  v_user    uuid := '00000000-0000-0000-0000-00000000000d';
  v_company uuid := '00000000-0000-0000-0000-0000000d0200';
  v_asset   uuid := '00000000-0000-0000-0000-0000000d0300';
  v_trial1  uuid := '00000000-0000-0000-0000-0000000d0400';  -- SURMOUNT-1
  v_trial2  uuid := '00000000-0000-0000-0000-0000000d0401';  -- SURMOUNT-2
  -- system event_type UUIDs (seeded by migrations)
  et_trial_start  uuid := 'a0000000-0000-0000-0000-000000000011';
  et_topline      uuid := 'a0000000-0000-0000-0000-000000000013';
  et_approval     uuid := 'a0000000-0000-0000-0000-000000000035';
  et_launch       uuid := 'a0000000-0000-0000-0000-000000000036';
  et_distribution uuid := 'a0000000-0000-0000-0000-000000000040';
  et_strategic    uuid := 'a0000000-0000-0000-0000-000000000070';
  et_leadership   uuid := 'a0000000-0000-0000-0000-000000000050';
  et_financial    uuid := 'a0000000-0000-0000-0000-000000000060';
  v_existing int;
begin
  select count(*) into v_existing from public.companies where space_id = v_space;
  if v_existing > 0 then return; end if;

  -- company -> asset -> trials
  insert into public.companies (id, name, space_id, created_by, display_order)
  values (v_company, 'Eli Lilly', v_space, v_user, 1);

  insert into public.assets (id, company_id, name, generic_name, space_id, created_by, display_order)
  values (v_asset, v_company, 'Zepbound', 'tirzepatide', v_space, v_user, 1);

  insert into public.trials (id, asset_id, name, acronym, identifier, status, phase, phase_type, recruitment_status, study_type, space_id, created_by, display_order)
  values
    (v_trial1, v_asset, 'A Study of Tirzepatide in Adults With Obesity', 'SURMOUNT-1', 'NCT04184622', 'Completed',  'Phase 3', 'P3', 'Completed',  'Interventional', v_space, v_user, 1),
    (v_trial2, v_asset, 'A Study of Tirzepatide in Adults With Obesity and Type 2 Diabetes', 'SURMOUNT-2', 'NCT04657003', 'Active', 'Phase 3', 'P3', 'Active, not recruiting', 'Interventional', v_space, v_user, 2);

  -- trial<->asset link (get_dashboard_data surfaces trials through trial_assets).
  -- trg_trial_assets_bootstrap already backfills this from trials.asset_id on
  -- insert; the explicit upsert is a harmless safety net.
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  values
    (v_trial1, v_asset, true, 'analyst'),
    (v_trial2, v_asset, true, 'analyst')
  on conflict (trial_id, asset_id) do nothing;

  -- spoof the demo user's JWT so create_event's has_space_access check passes
  perform set_config(
    'request.jwt.claims',
    json_build_object('sub', v_user, 'role', 'authenticated')::text,
    true
  );
  set local role authenticated;

  -- SURMOUNT-1 (trial-anchored)
  perform public.create_event(v_space, et_trial_start, 'SURMOUNT-1 study initiated', date '2021-01-01', 'trial', v_trial1, 'actual',  'year');
  perform public.create_event(v_space, et_topline,     'SURMOUNT-1 topline results', date '2023-04-01', 'trial', v_trial1, 'actual',  'quarter');
  perform public.create_event(v_space, et_approval,    'Zepbound FDA approval (obesity)', date '2023-11-01', 'trial', v_trial1, 'actual', 'month');

  -- SURMOUNT-2 (trial-anchored)
  perform public.create_event(v_space, et_trial_start, 'SURMOUNT-2 study initiated', date '2022-01-01', 'trial', v_trial2, 'actual', 'year');
  perform public.create_event(v_space, et_topline,     'SURMOUNT-2 topline results', date '2024-01-01', 'trial', v_trial2, 'actual', 'year');

  -- Zepbound (asset-anchored)
  perform public.create_event(v_space, et_distribution, 'Zepbound commercial distribution', date '2024-01-01', 'asset', v_asset, 'actual', 'quarter');
  perform public.create_event(v_space, et_launch,       'Zepbound US launch', date '2024-01-01', 'asset', v_asset, 'actual', 'year');
  perform public.create_event(
    v_space, et_distribution, 'Projected vials to pens switch', date '2026-10-01', 'asset', v_asset,
    'primary',                 -- projection
    'quarter'                  -- date_precision
  );

  -- Eli Lilly (company-anchored). Strategic/Leadership types default to low
  -- significance (feed-only). The manufacturing expansion is pinned, so it
  -- surfaces a glyph on the company band; the leadership change stays feed-only,
  -- exercising effectiveVisibility (pinned -> show, low + unpinned -> hidden).
  perform public.create_event(
    v_space, et_strategic, 'Lilly $9B Indiana API manufacturing expansion', date '2024-04-01', 'company', v_company,
    'actual',                  -- projection
    'month',                   -- date_precision
    null,                      -- end_date
    'exact',                   -- end_date_precision
    false,                     -- is_ongoing
    null,                      -- description
    null,                      -- source_url
    null,                      -- significance (falls to type default 'low')
    'pinned'                   -- visibility: promoted onto the timeline
  );
  perform public.create_event(
    v_space, et_leadership, 'New Chief Commercial Officer named', date '2024-02-01', 'company', v_company,
    'actual',                  -- projection
    'month'                    -- date_precision
  );
  -- Financial (rose hexagon, dot mark): pinned so the dot glyph surfaces on the
  -- company band, completing the corporate glyph set (none/dot/dash) for reference
  -- alongside the leadership (none) and strategic (dash) events above.
  perform public.create_event(
    v_space, et_financial, 'Lilly Q4 incretin revenue tops consensus', date '2024-02-06', 'company', v_company,
    'actual',                  -- projection
    'month',                   -- date_precision
    null,                      -- end_date
    'exact',                   -- end_date_precision
    false,                     -- is_ongoing
    null,                      -- description
    null,                      -- source_url
    null,                      -- significance (falls to type default 'low')
    'pinned'                   -- visibility: promoted onto the timeline
  );

  reset role;
end $$;
