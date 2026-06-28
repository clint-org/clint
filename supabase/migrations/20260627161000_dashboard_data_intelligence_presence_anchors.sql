-- =============================================================================
-- Re-apply anchor-based intelligence presence on top of develop's
-- 20260627150000_dashboard_unspecified_indication_node.sql.
--
-- The 150000 migration redefined get_dashboard_data to delegate trial JSON
-- construction to a new helper _dashboard_trial_obj. That helper restored
-- has_intelligence and intelligence_headline (anchor-based joins were applied
-- in the local-only compatibility fix), but it does NOT emit intelligence_count
-- (count of distinct published anchors per trial) which our
-- 20260627130600_intelligence_feed_and_landscape_multi migration added.
--
-- This migration redefines _dashboard_trial_obj to:
--   1. Keep all of develop's 150000 logic unchanged (unspecified node,
--      ctgov fields, markers, recent_changes, phase_data).
--   2. Add the pi_count lateral (count distinct published anchors per trial).
--   3. Add 'intelligence_count' to the returned jsonb.
--   4. Ensure headline ordering is lead-first (is_lead desc) then
--      most-recent-published (published_at desc nulls last).
--
-- get_dashboard_data is unchanged -- it delegates to the helper.
--
-- No @audit:tier1 markers (not a tier-1 governance RPC).
-- =============================================================================

create or replace function public._dashboard_trial_obj(
  p_trial public.trials,
  p_space_id uuid,
  p_start_year int,
  p_end_year int
)
returns jsonb
language sql
stable
set search_path = ''
as $$
  select jsonb_build_object(
    'id', p_trial.id,
    'name', p_trial.name,
    'acronym', p_trial.acronym,
    'identifier', p_trial.identifier,
    'status', p_trial.status,
    'display_order', p_trial.display_order,
    'asset_id', p_trial.asset_id,
    'recruitment_status', p_trial.recruitment_status,
    'study_type', p_trial.study_type,
    'phase', p_trial.phase,
    'ctgov_last_synced_at', p_trial.ctgov_last_synced_at,
    'ctgov_withdrawn_at', p_trial.ctgov_withdrawn_at,
    'recent_changes_count', coalesce(recent.recent_changes_count, 0),
    'most_recent_change_type', recent.most_recent_change_type,
    'most_recent_change_event_id', recent.most_recent_change_event_id,
    'has_intelligence', (pi_trial.headline is not null),
    'intelligence_headline', pi_trial.headline,
    'intelligence_count', coalesce(pi_count.cnt, 0),
    'phase_data', case
      when p_trial.phase_type is not null then jsonb_build_object(
        'phase_type', p_trial.phase_type
      )
      else null
    end,
    'markers', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id',                 mk.id,
          'marker_type_id',     mk.marker_type_id,
          'title',              mk.title,
          'projection',         mk.projection,
          'event_date',         mk.event_date,
          'date_precision',     mk.date_precision,
          'end_date',           mk.end_date,
          'end_date_precision', mk.end_date_precision,
          'is_ongoing',         mk.is_ongoing,
          'description',        mk.description,
          'source_url',         mk.source_url,
          'metadata',           mk.metadata,
          'is_projected',       mk.is_projected,
          'no_longer_expected', mk.no_longer_expected,
          'marker_type', (
            select jsonb_build_object(
              'id',            mt.id,
              'name',          mt.name,
              'shape',         mt.shape,
              'fill_style',    mt.fill_style,
              'color',         mt.color,
              'inner_mark',    mt.inner_mark,
              'category_id',   mt.category_id,
              'category_name', mc.name
            )
            from public.marker_types mt
            left join public.marker_categories mc on mc.id = mt.category_id
            where mt.id = mk.marker_type_id
          )
        )
        order by mk.event_date
      )
      from public.marker_assignments ma
      join public.markers mk on mk.id = ma.marker_id
      where ma.trial_id = p_trial.id
        and mk.space_id = p_space_id
        and (p_start_year is null or extract(year from mk.event_date) >= p_start_year)
        and (p_end_year   is null or extract(year from mk.event_date) <= p_end_year)
    ), '[]'::jsonb)
  )
  from (
    select
      count(*)                                  as recent_changes_count,
      (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
      (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
    from (
      select e.event_type::text as etype, e.observed_at as ets, e.id as eid
      from public.trial_change_events e
      where e.trial_id = p_trial.id
        and e.observed_at >= now() - public.recent_change_window()
      union all
      select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
      from public.primary_intelligence pi
      join public.primary_intelligence_anchors a_pi on a_pi.id = pi.anchor_id
      where a_pi.entity_type = 'trial'
        and a_pi.entity_id = p_trial.id
        and pi.space_id = p_space_id
        and pi.state = 'published'
        and pi.updated_at >= now() - public.recent_change_window()
    ) combined
  ) recent
  left join lateral (
    -- lead anchor's published headline first, then most-recent published
    -- across all anchors for this trial (multi-brief support)
    select pi.headline
    from public.primary_intelligence pi
    join public.primary_intelligence_anchors a_pi on a_pi.id = pi.anchor_id
    where a_pi.entity_type = 'trial'
      and a_pi.entity_id   = p_trial.id
      and pi.space_id       = p_space_id
      and pi.state          = 'published'
    order by a_pi.is_lead desc, pi.published_at desc nulls last
    limit 1
  ) pi_trial on true
  left join lateral (
    -- count distinct published anchors for this trial (multi-brief count)
    select count(distinct a_pi.id)::int as cnt
    from public.primary_intelligence_anchors a_pi
    join public.primary_intelligence pi
      on pi.anchor_id = a_pi.id and pi.state = 'published'
    where a_pi.entity_type = 'trial'
      and a_pi.entity_id   = p_trial.id
      and a_pi.space_id    = p_space_id
  ) pi_count on true
$$;

comment on function public._dashboard_trial_obj(public.trials, uuid, int, int) is
  'Per-trial JSON helper for get_dashboard_data. Returns trial fields with anchor-based '
  'intelligence presence: has_intelligence (any published anchor), intelligence_headline '
  '(lead anchor published headline, fallback most-recent published), intelligence_count '
  '(distinct published anchors). Developed in 20260627160000 to add intelligence_count '
  'on top of the unspecified-indication-node helper introduced in 20260627150000.';

notify pgrst, 'reload schema';

-- Smoke test: _dashboard_trial_obj emits intelligence_count correctly when
-- a trial has 2 published anchors; get_dashboard_data propagates the count.
do $$
declare
  v_owner     uuid := 'eeee8888-0001-0001-0001-eeeeeeee0001';
  v_agency    uuid := 'eeee8888-0002-0002-0002-eeeeeeee0002';
  v_tenant    uuid := 'eeee8888-0003-0003-0003-eeeeeeee0003';
  v_space     uuid := 'eeee8888-0004-0004-0004-eeeeeeee0004';
  v_company   uuid := 'eeee8888-0005-0005-0005-eeeeeeee0005';
  v_asset     uuid := 'eeee8888-0006-0006-0006-eeeeeeee0006';
  v_trial_id  uuid;
  v_anchor1   uuid := 'eeee8888-0007-0007-0007-eeeeeeee0007';
  v_anchor2   uuid := 'eeee8888-0008-0008-0008-eeeeeeee0008';
  v_indication uuid;
  v_condition  uuid;
  v_dash      jsonb;
  v_trial_node jsonb;
begin
  insert into auth.users (id, email)
    values (v_owner, 'intel-count-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'IntCount', 'intcount', 'intcount', 'IntCount', 'x@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'IntCount', 'intcount-t', 'intcountt', 'IntCount');
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name)
    values (v_company, v_space, v_owner, 'IntCount Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset, v_space, v_owner, v_company, 'IntCountAsset');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  v_trial_id := public.create_trial(v_space, v_asset, 'FL Trial', 'NCT-IC-001', 'Active', 'P3',
                                    null, null, 'IntCount Obesity', null);

  -- anchor 1: lead, published with 'Lead headline'
  insert into public.primary_intelligence_anchors
    (id, space_id, entity_type, entity_id, is_lead, display_order, created_by)
    values (v_anchor1, v_space, 'trial', v_trial_id, true, 0, v_owner);

  insert into public.primary_intelligence
    (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space, v_anchor1, 'published', 'Lead headline', '', '', v_owner);

  -- anchor 2: non-lead sibling, published with 'Second'
  insert into public.primary_intelligence_anchors
    (id, space_id, entity_type, entity_id, is_lead, display_order, created_by)
    values (v_anchor2, v_space, 'trial', v_trial_id, false, 1, v_owner);

  insert into public.primary_intelligence
    (space_id, anchor_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space, v_anchor2, 'published', 'Second', '', '', v_owner);

  v_dash := public.get_dashboard_data(v_space);
  v_trial_node := jsonb_path_query_first(
    v_dash,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_id)
  );

  if v_trial_node is null then
    raise exception 'intelligence_count smoke FAIL: trial node missing from dashboard';
  end if;
  if (v_trial_node ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'intelligence_count smoke FAIL: has_intelligence not true (got %)',
      v_trial_node ->> 'has_intelligence';
  end if;
  if (v_trial_node ->> 'intelligence_headline') is distinct from 'Lead headline' then
    raise exception 'intelligence_count smoke FAIL: intelligence_headline wrong (got %)',
      v_trial_node ->> 'intelligence_headline';
  end if;
  if (v_trial_node ->> 'intelligence_count')::int <> 2 then
    raise exception 'intelligence_count smoke FAIL: intelligence_count expected 2, got %',
      v_trial_node ->> 'intelligence_count';
  end if;

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.primary_intelligence_anchors where space_id = v_space;
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'intelligence_count smoke test: PASS';
end $$;
