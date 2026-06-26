-- =============================================================================
-- Primary-intelligence presence flags on the landscape read-path RPCs.
--
-- Extends two read RPCs so the timeline and heatmap surfaces can render a
-- "has primary intelligence" presence mark from data already loaded for the
-- grid, without per-row / per-hover RPC calls:
--
--   get_dashboard_data   -> each trial gains has_intelligence (bool) and
--                           intelligence_headline (the published trial PI
--                           headline, or null).
--   get_positioning_data -> each product gains has_intelligence (bool); each
--                           bubble gains intelligence_count (count of assets in
--                           the group that own published PI).
--
-- Owner semantics: a trial owns PI as entity_type='trial'; an asset owns PI as
-- entity_type='product'. Only state='published' counts. Markers are link
-- targets, not owners, and are unaffected here.
--
-- Each function body below is the verbatim latest definition (get_dashboard_data
-- from 20260626120100, get_positioning_data from 20260618170000) with only the
-- additive PI keys/joins layered in -- language / volatility / security /
-- search_path are preserved. See docs/superpowers/specs/2026-06-26-primary-
-- intelligence-on-landscape-surfaces-design.md.
-- =============================================================================

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_asset_ids uuid[] default null,
  p_indication_ids uuid[] default null,
  p_start_year integer default null,
  p_end_year integer default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
begin
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'assets', coalesce((
        select jsonb_agg(asset_obj order by a.display_order)
        from public.assets a
        cross join lateral (
          select jsonb_build_object(
            'id', a.id,
            'name', a.name,
            'generic_name', a.generic_name,
            'logo_url', a.logo_url,
            'display_order', a.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action am
              join public.mechanisms_of_action m on m.id = am.moa_id
              where am.asset_id = a.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration ar
              join public.routes_of_administration r on r.id = ar.roa_id
              where ar.asset_id = a.id
            ), '[]'::jsonb),
            'indications', coalesce((
              select jsonb_agg(indication_obj order by ind.display_order, ind.name)
              from public.asset_indications ai
              join public.indications ind on ind.id = ai.indication_id
              cross join lateral (
                select jsonb_build_object(
                  'id', ind.id,
                  'name', ind.name,
                  'abbreviation', ind.abbreviation,
                  'development_status', ai.development_status,
                  'development_status_source', ai.development_status_source,
                  'trials', coalesce((
                    select jsonb_agg(trial_obj order by t.display_order)
                    from (
                      select distinct on (t.id) t.*
                      from public.trials t
                      join public.trial_assets ta on ta.trial_id = t.id
                      join public.trial_conditions tc on tc.trial_id = t.id
                      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                      where ta.asset_id = a.id
                        and t.space_id = p_space_id
                        and cim.indication_id = ind.id
                        and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                        and (p_study_types is null or t.study_type = any(p_study_types))
                        and (p_phases is null or t.phase_type = any(p_phases))
                      order by t.id
                    ) t
                    left join lateral (
                      with combined as (
                        select e.event_type::text as etype, e.observed_at as ets, e.id as eid
                        from public.trial_change_events e
                        where e.trial_id = t.id
                          and e.observed_at >= now() - public.recent_change_window()
                        union all
                        select 'intelligence_published'::text as etype, pi.updated_at as ets, null::uuid as eid
                        from public.primary_intelligence pi
                        where pi.entity_type = 'trial'
                          and pi.entity_id = t.id
                          and pi.space_id = p_space_id
                          and pi.state = 'published'
                          and pi.updated_at >= now() - public.recent_change_window()
                      )
                      select
                        count(*)                                  as recent_changes_count,
                        (array_agg(etype order by ets desc))[1]   as most_recent_change_type,
                        (array_agg(eid order by ets desc))[1]     as most_recent_change_event_id
                      from combined
                    ) recent on true
                    left join lateral (
                      select pi.headline
                      from public.primary_intelligence pi
                      where pi.entity_type = 'trial'
                        and pi.entity_id   = t.id
                        and pi.space_id    = p_space_id
                        and pi.state       = 'published'
                      order by pi.updated_at desc
                      limit 1
                    ) pi_trial on true
                    cross join lateral (
                      select jsonb_build_object(
                        'id', t.id,
                        'name', t.name,
                        'acronym', t.acronym,
                        'identifier', t.identifier,
                        'status', t.status,
                        'notes', t.notes,
                        'display_order', t.display_order,
                        'asset_id', t.asset_id,
                        'recruitment_status', t.recruitment_status,
                        'study_type', t.study_type,
                        'phase', t.phase,
                        'ctgov_last_synced_at', t.ctgov_last_synced_at,
                        'ctgov_withdrawn_at', t.ctgov_withdrawn_at,
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
                        'most_recent_change_event_id', recent.most_recent_change_event_id,
                        'has_intelligence', (pi_trial.headline is not null),
                        'intelligence_headline', pi_trial.headline,
                        'phase_data', case
                          when t.phase_type is not null then jsonb_build_object(
                            'phase_type',       t.phase_type,
                            'phase_start_date', t.phase_start_date,
                            'phase_end_date',   t.phase_end_date
                          )
                          else null
                        end,
                        'markers', coalesce((
                          select jsonb_agg(
                            jsonb_build_object(
                              'id',                 mk.id,
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
                          where ma.trial_id = t.id
                            and mk.space_id = p_space_id
                            and (p_start_year is null or extract(year from mk.event_date) >= p_start_year)
                            and (p_end_year   is null or extract(year from mk.event_date) <= p_end_year)
                        ), '[]'::jsonb),
                        'trial_notes', coalesce((
                          select jsonb_agg(
                            jsonb_build_object(
                              'id', tn.id, 'content', tn.content,
                              'created_at', tn.created_at, 'updated_at', tn.updated_at
                            )
                            order by tn.created_at
                          )
                          from public.trial_notes tn
                          where tn.trial_id = t.id
                            and tn.space_id = p_space_id
                        ), '[]'::jsonb)
                      ) as trial_obj
                    ) as trial_lateral
                  ), '[]'::jsonb)
                ) as indication_obj
              ) as indication_lateral
              where ai.asset_id = a.id
                and ai.space_id = p_space_id
                and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
            ), '[]'::jsonb)
          ) as asset_obj
        ) as asset_lateral
        where a.company_id = c.id
          and a.space_id = p_space_id
          and (p_asset_ids is null or a.id = any(p_asset_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.asset_mechanisms_of_action am2
              where am2.asset_id = a.id
                and am2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.asset_routes_of_administration ar2
              where ar2.asset_id = a.id
                and ar2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$function$;

comment on function public.get_dashboard_data(uuid, uuid[], uuid[], uuid[], integer, integer, text[], text[], text[], uuid[], uuid[]) is
  'Returns hierarchical dashboard data (companies > assets > indications > trials) with optional filtering. Trial payload emits acronym alongside name (client uses acronym ?? name). Trial payload emits most_recent_change_event_id for feed deep-linking and ctgov_withdrawn_at for the muted-withdrawn treatment. Trial payload also emits has_intelligence (true when the trial owns published primary intelligence) and intelligence_headline (that PI headline, else null) so the timeline renders the PI bookmark + inline headline from grid data; see 20260626150000.';

-- =============================================================================

create or replace function public.get_positioning_data(
  p_space_id                    uuid,
  p_grouping                    text default 'moa',
  p_count_unit                  text default 'products',
  p_company_ids                 uuid[] default null,
  p_asset_ids                   uuid[] default null,
  p_indication_ids              uuid[] default null,
  p_mechanism_of_action_ids     uuid[] default null,
  p_route_of_administration_ids uuid[] default null,
  p_phases                      text[] default null,
  p_recruitment_statuses        text[] default null,
  p_study_types                 text[] default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_bubbles            jsonb;
  v_latest_event_date  timestamptz;
begin
  -- coerce empty arrays to null so the "is null" checks below work
  if p_company_ids = '{}' then p_company_ids := null; end if;
  if p_asset_ids = '{}' then p_asset_ids := null; end if;
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_mechanism_of_action_ids = '{}' then p_mechanism_of_action_ids := null; end if;
  if p_route_of_administration_ids = '{}' then p_route_of_administration_ids := null; end if;
  if p_phases = '{}' then p_phases := null; end if;
  if p_recruitment_statuses = '{}' then p_recruitment_statuses := null; end if;
  if p_study_types = '{}' then p_study_types := null; end if;

  with status_rank_map(status_name, status_rank) as (
    values
      ('PRECLIN'::text, 0), ('P1', 1), ('P2', 2), ('P3', 3),
      ('P4', 4), ('APPROVED', 5), ('LAUNCHED', 6)
  ),

  -- eligible assets after applying all filters
  eligible_assets as (
    select distinct a.id as asset_id, a.name as asset_name,
           a.generic_name as asset_generic_name,
           a.company_id, c.name as company_name, c.logo_url as company_logo_url,
           a.updated_at as asset_updated_at
    from public.assets a
    join public.companies c on c.id = a.company_id
    join public.asset_indications ai on ai.asset_id = a.id
    join status_rank_map srm on srm.status_name = ai.development_status
    where a.space_id = p_space_id
      and ai.development_status is not null
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
      and (p_mechanism_of_action_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action am
        where am.asset_id = a.id and am.moa_id = any(p_mechanism_of_action_ids)
      ))
      and (p_route_of_administration_ids is null or exists (
        select 1 from public.asset_routes_of_administration ar
        where ar.asset_id = a.id and ar.roa_id = any(p_route_of_administration_ids)
      ))
      and (p_phases is null or ai.development_status = any(p_phases))
  ),

  -- roll up to one row per asset with its highest phase and trial count
  asset_highest_phase as (
    select ea.asset_id, ea.asset_name, ea.asset_generic_name,
           ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at,
           max(srm.status_rank) as highest_phase_rank,
           (array_agg(srm.status_name order by srm.status_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count,
           exists (
             select 1 from public.primary_intelligence pi
             where pi.space_id    = p_space_id
               and pi.state       = 'published'
               and pi.entity_type = 'product'
               and pi.entity_id   = ea.asset_id
           ) as has_intelligence
    from eligible_assets ea
    join public.asset_indications ai on ai.asset_id = ea.asset_id
    join status_rank_map srm on srm.status_name = ai.development_status
    left join public.trial_assets ta on ta.asset_id = ea.asset_id
    left join public.trials t on t.id = ta.trial_id and t.space_id = p_space_id
    where ai.development_status is not null
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
    group by ea.asset_id, ea.asset_name, ea.asset_generic_name,
             ea.company_id, ea.company_name, ea.company_logo_url, ea.asset_updated_at
  ),

  -- fan out assets into their grouping dimension
  asset_groups as (
    select
      ahp.asset_id, ahp.asset_name, ahp.asset_generic_name,
      ahp.company_id, ahp.company_name, ahp.company_logo_url, ahp.asset_updated_at,
      ahp.highest_phase_rank, ahp.highest_phase, ahp.trial_count, ahp.has_intelligence,
      case p_grouping
        when 'moa' then m.id::text
        when 'indication' then ind.id::text
        when 'moa+indication' then m.id::text || '|' || ind.id::text
        when 'company' then ahp.company_id::text
        when 'roa' then r.id::text
        else null
      end as group_key,
      case p_grouping
        when 'moa' then m.name
        when 'indication' then ind.name
        when 'moa+indication' then m.name || ' + ' || ind.name
        when 'company' then ahp.company_name
        when 'roa' then r.name
        else null
      end as group_label,
      case p_grouping
        when 'moa' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name)
        when 'indication' then jsonb_build_object('indication_id', ind.id, 'indication_name', ind.name)
        when 'moa+indication' then jsonb_build_object('moa_id', m.id, 'moa_name', m.name, 'indication_id', ind.id, 'indication_name', ind.name)
        when 'company' then jsonb_build_object('company_id', ahp.company_id, 'company_name', ahp.company_name)
        when 'roa' then jsonb_build_object('roa_id', r.id, 'roa_name', r.name)
        else '{}'::jsonb
      end as group_keys
    from asset_highest_phase ahp
    left join public.asset_mechanisms_of_action am
      on am.asset_id = ahp.asset_id and p_grouping in ('moa', 'moa+indication')
    left join public.mechanisms_of_action m
      on m.id = am.moa_id and p_grouping in ('moa', 'moa+indication')
    left join public.asset_indications ai2
      on ai2.asset_id = ahp.asset_id and p_grouping in ('indication', 'moa+indication')
    left join public.indications ind
      on ind.id = ai2.indication_id and p_grouping in ('indication', 'moa+indication')
    left join public.asset_routes_of_administration ar
      on ar.asset_id = ahp.asset_id and p_grouping = 'roa'
    left join public.routes_of_administration r
      on r.id = ar.roa_id and p_grouping = 'roa'
    where
      case p_grouping
        when 'moa' then m.id is not null
        when 'indication' then ind.id is not null
        when 'moa+indication' then m.id is not null and ind.id is not null
        when 'company' then true
        when 'roa' then r.id is not null
        else false
      end
  ),

  -- aggregate each group into a bubble with phase_counts
  bubble_agg as (
    select
      ag.group_key, ag.group_label, ag.group_keys,
      count(distinct ag.company_id) as competitor_count,
      max(ag.highest_phase_rank) as highest_phase_rank,
      (array_agg(ag.highest_phase order by ag.highest_phase_rank desc))[1] as highest_phase,
      count(distinct ag.asset_id) filter (where ag.has_intelligence) as intelligence_count,
      case p_count_unit
        when 'products' then count(distinct ag.asset_id)
        when 'trials' then sum(ag.trial_count)
        when 'companies' then count(distinct ag.company_id)
      end as unit_count,
      jsonb_agg(distinct jsonb_build_object(
        'id', ag.asset_id, 'name', ag.asset_name,
        'generic_name', ag.asset_generic_name,
        'company_id', ag.company_id, 'company_name', ag.company_name,
        'company_logo_url', ag.company_logo_url,
        'highest_phase', ag.highest_phase,
        'highest_phase_rank', ag.highest_phase_rank,
        'trial_count', ag.trial_count,
        'has_intelligence', ag.has_intelligence
      )) as products,
      -- phase_counts: always asset-based, regardless of p_count_unit
      (select jsonb_object_agg(hp, cnt)
       from (
         select ag2.highest_phase as hp, count(distinct ag2.asset_id) as cnt
         from asset_groups ag2
         where ag2.group_key = ag.group_key
         group by ag2.highest_phase
       ) sub
      ) as phase_counts
    from asset_groups ag
    group by ag.group_key, ag.group_label, ag.group_keys
  ),

  -- max updated_at across all assets in the result set
  freshness as (
    select max(ag.asset_updated_at) as latest_event_date
    from asset_groups ag
  )

  select
    coalesce(jsonb_agg(
      jsonb_build_object(
        'label', ba.group_label, 'group_keys', ba.group_keys,
        'competitor_count', ba.competitor_count,
        'highest_phase', ba.highest_phase, 'highest_phase_rank', ba.highest_phase_rank,
        'unit_count', ba.unit_count, 'products', ba.products,
        'intelligence_count', ba.intelligence_count,
        'phase_counts', ba.phase_counts
      ) order by ba.competitor_count desc, ba.highest_phase_rank desc
    ), '[]'::jsonb),
    max(f.latest_event_date)
  into v_bubbles, v_latest_event_date
  from bubble_agg ba
  cross join freshness f;

  return jsonb_build_object(
    'grouping', p_grouping,
    'count_unit', p_count_unit,
    'latest_event_date', v_latest_event_date,
    'bubbles', v_bubbles
  );
end;
$$;

comment on function public.get_positioning_data(uuid, text, text, uuid[], uuid[], uuid[], uuid[], uuid[], text[], text[], text[]) is
  'Heatmap/positioning bubbles grouped by moa | indication | moa+indication | company | roa. Each product carries has_intelligence (true when the asset owns published primary intelligence, entity_type=product); each bubble carries intelligence_count (assets in the group that own PI) so the heatmap renders the PI bookmark flag and the "N of M assets have intelligence" detail line; see 20260626150000.';

-- =============================================================================
-- smoke test: a published trial PI surfaces as has_intelligence + headline on
-- get_dashboard_data, and a published asset PI surfaces as has_intelligence on
-- the product plus intelligence_count>=1 on the bubble from get_positioning_data.
-- Direct calls are viable: both RPCs are STABLE security-invoker with no in-body
-- space-access gate, and this DO block runs as the migration owner. UUID set
-- (c1700000*) is distinct from neighbouring smokes.
-- =============================================================================
do $$
declare
  v_agency_id     uuid := 'c1700000-c170-c170-c170-c17000000001';
  v_tenant_id     uuid := 'c1700000-c170-c170-c170-c17000000002';
  v_owner_id      uuid := 'c1700000-c170-c170-c170-c17000000003';
  v_space_id      uuid := 'c1700000-c170-c170-c170-c17000000004';
  v_company_id    uuid := 'c1700000-c170-c170-c170-c17000000005';
  v_asset_id      uuid := 'c1700000-c170-c170-c170-c17000000006';
  v_indication_id uuid := 'c1700000-c170-c170-c170-c17000000007';
  v_condition_id  uuid := 'c1700000-c170-c170-c170-c17000000008';
  v_trial_id      uuid := 'c1700000-c170-c170-c170-c17000000009';
  v_dash          jsonb;
  v_trial         jsonb;
  v_pos           jsonb;
  v_bubbles       jsonb;
  v_product       jsonb;
begin
  insert into auth.users (id, email) values
    (v_owner_id, 'pi-presence-owner@invalid.local');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'PI Presence', 'pi-presence', 'pipresence', 'PIP', 'pip@y.z');

  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'PIP', 'pi-presence-t', 'pipresencet', 'PIP');

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_id, v_owner_id, 'owner');

  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Primary', v_owner_id);

  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_owner_id, 'owner');

  insert into public.companies (id, space_id, created_by, name)
    values (v_company_id, v_space_id, v_owner_id, 'PIP Pharma');

  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_id, v_space_id, v_owner_id, v_company_id, 'PIP Asset');

  insert into public.indications (id, space_id, created_by, name, abbreviation)
    values (v_indication_id, v_space_id, v_owner_id, 'Obesity', 'OBES');

  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_asset_id, v_indication_id, v_space_id, 'P3', v_owner_id);

  insert into public.conditions (id, space_id, name, source)
    values (v_condition_id, v_space_id, 'Obesity', 'analyst');

  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_condition_id, v_indication_id);

  insert into public.trials (id, space_id, created_by, asset_id, name, identifier, phase_type)
    values (v_trial_id, v_space_id, v_owner_id, v_asset_id, 'PIP_TRIAL', 'NCT-PIP-001', 'P3');

  insert into public.trial_conditions (trial_id, condition_id)
    values (v_trial_id, v_condition_id);

  insert into public.primary_intelligence
    (space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, 'trial', v_trial_id, 'published', 'Trial PI headline', '', '', v_owner_id);

  insert into public.primary_intelligence
    (space_id, entity_type, entity_id, state, headline, summary_md, implications_md, last_edited_by)
    values (v_space_id, 'product', v_asset_id, 'published', 'Asset PI headline', '', '', v_owner_id);

  -- dashboard: the trial carries has_intelligence=true and the PI headline.
  v_dash := public.get_dashboard_data(v_space_id);
  v_trial := jsonb_path_query_first(
    v_dash,
    '$[*].assets[*].indications[*].trials[*] ? (@.id == $tid)',
    jsonb_build_object('tid', v_trial_id)
  );
  if v_trial is null then
    raise exception 'PI presence smoke FAIL: trial node missing in get_dashboard_data';
  end if;
  if (v_trial ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'PI presence smoke FAIL: trial has_intelligence not true (got %)', v_trial ->> 'has_intelligence';
  end if;
  if (v_trial ->> 'intelligence_headline') is distinct from 'Trial PI headline' then
    raise exception 'PI presence smoke FAIL: trial intelligence_headline wrong (got %)', v_trial ->> 'intelligence_headline';
  end if;

  -- positioning: the product carries has_intelligence=true and the bubble counts it.
  v_pos := public.get_positioning_data(v_space_id, 'company', 'products');
  v_bubbles := v_pos -> 'bubbles';
  v_product := jsonb_path_query_first(
    v_bubbles,
    '$[*].products[*] ? (@.id == $aid)',
    jsonb_build_object('aid', v_asset_id)
  );
  if v_product is null then
    raise exception 'PI presence smoke FAIL: asset node missing in get_positioning_data';
  end if;
  if (v_product ->> 'has_intelligence') is distinct from 'true' then
    raise exception 'PI presence smoke FAIL: asset has_intelligence not true (got %)', v_product ->> 'has_intelligence';
  end if;
  if not jsonb_path_exists(v_bubbles, '$[*] ? (@.intelligence_count >= 1)') then
    raise exception 'PI presence smoke FAIL: no bubble reports intelligence_count >= 1';
  end if;

  -- cleanup: set member_guard cascade GUC, then delete parents (children cascade).
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.primary_intelligence where space_id = v_space_id;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;

  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'landscape_primary_intelligence_presence smoke test: PASS';
end$$;

notify pgrst, 'reload schema';
