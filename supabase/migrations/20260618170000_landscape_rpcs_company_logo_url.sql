-- Add company_logo_url to the analytic landscape RPC asset payloads.
--
-- The shared app-company-tile renders the real company logo when given a
-- logoUrl, otherwise a colored initial tile. The bullseye / heatmap surfaces
-- previously passed the ASSET's logo_url (almost always null) so they fell back
-- to initials. The company logo lives on public.companies.logo_url and is joined
-- here additively as `company_logo_url` on each asset object. No other field
-- changes; each function body is the verbatim latest definition with only this
-- additive key appended, preserving language / volatility / security / search_path.
--
-- Sources of the recreated bodies:
--   get_bullseye_data, get_bullseye_assets -> 20260605043037 (latest)
--   get_bullseye_by_company/by_moa/by_roa  -> 20260528130000 (latest)
--   get_positioning_data                   -> 20260605042514 (latest)

-- =============================================================================
-- get_bullseye_data: company logo joined from the company spoke (c.logo_url)
-- =============================================================================
create or replace function public.get_bullseye_data(p_space_id uuid, p_indication_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_indication_ids uuid[];
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
  v_ring_order jsonb := case when public.space_shows_preclinical(p_space_id)
    then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED')
    else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED')
  end;
begin
  select jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
  into v_scope
  from public.indications ind
  where ind.id = p_indication_id and ind.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'indication',
      'scope',       null,
      'ring_order',  v_ring_order,
      'spokes',      '[]'::jsonb,
      'spoke_label', 'Companies'
    );
  end if;

  select array_agg(id) into v_indication_ids
  from public.indications
  where id = p_indication_id or parent_id = p_indication_id;

  with asset_rollup as (
    select
      a.id           as asset_id,
      a.company_id,
      a.name         as asset_name,
      a.generic_name,
      a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
      and ai.indication_id = any(v_indication_ids)
      and ai.development_status is not null
      and (v_show_preclin or ai.development_status <> 'PRECLIN')
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from asset_rollup group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(asset_obj order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar
        cross join lateral (
          select jsonb_build_object(
            'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
            'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
            'company_logo_url', c.logo_url,
            'highest_phase_rank', ar.max_rank,
            'highest_phase', case ar.max_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action amoa join public.mechanisms_of_action m on m.id = amoa.moa_id
              where amoa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration aroa join public.routes_of_administration r on r.id = aroa.roa_id
              where aroa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                  'status', t.status, 'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type, 'phase', t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = ar.asset_id)
                and t.space_id = p_space_id
                and cim.indication_id = any(v_indication_ids)
                and (v_show_preclin or t.phase_type is distinct from 'PRECLIN')
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', rmm.id, 'event_date', rmm.event_date, 'projection', rmm.projection,
                  'marker_type_name', mt.name, 'shape', mt.shape,
                  'color', mt.color, 'category_name', mc.name
                ) order by rmm.event_date desc
              ), '[]'::jsonb)
              from (
                select mk.id, mk.event_date, mk.marker_type_id, mk.projection
                from public.marker_assignments ma
                join public.markers mk on mk.id = ma.marker_id
                join public.trials t2 on t2.id = ma.trial_id
                join public.trial_conditions tc2 on tc2.trial_id = t2.id
                join public.condition_indication_map cim2 on cim2.condition_id = tc2.condition_id
                where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = ar.asset_id)
                  and cim2.indication_id = any(v_indication_ids)
                  and t2.space_id = p_space_id
                  and mk.space_id = p_space_id
                order by mk.event_date desc limit 3
              ) rmm
              join public.marker_types mt on mt.id = rmm.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
            )
          ) as asset_obj
        ) as asset_lateral
        where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension',   'indication',
    'scope',       v_scope,
    'ring_order',  v_ring_order,
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;

-- =============================================================================
-- get_bullseye_assets: company logo joined from the company row (c.logo_url)
-- =============================================================================
create or replace function public.get_bullseye_assets(
  p_space_id       uuid,
  p_indication_ids uuid[]  default null,
  p_company_ids    uuid[]  default null,
  p_moa_ids        uuid[]  default null,
  p_roa_ids        uuid[]  default null,
  p_phases         text[]  default null,
  p_asset_ids      uuid[]  default null
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_result jsonb;
begin
  -- Normalize empty arrays to null (no-filter semantics)
  if p_indication_ids = '{}' then p_indication_ids := null; end if;
  if p_company_ids    = '{}' then p_company_ids    := null; end if;
  if p_moa_ids        = '{}' then p_moa_ids        := null; end if;
  if p_roa_ids        = '{}' then p_roa_ids        := null; end if;
  if p_phases         = '{}' then p_phases         := null; end if;
  if p_asset_ids      = '{}' then p_asset_ids      := null; end if;

  with
  -- Step 1: identify candidate assets passing all scope filters except phase
  candidate_assets as (
    select distinct a.id as asset_id
    from public.assets a
    where a.space_id = p_space_id
      -- company filter
      and (p_company_ids is null or a.company_id = any(p_company_ids))
      -- direct asset filter
      and (p_asset_ids is null or a.id = any(p_asset_ids))
      -- indication filter: asset must have at least one matching indication
      and (p_indication_ids is null or exists (
        select 1 from public.asset_indications ai
        where ai.asset_id = a.id
          and ai.indication_id = any(p_indication_ids)
      ))
      -- moa filter: asset must have at least one matching MOA
      and (p_moa_ids is null or exists (
        select 1 from public.asset_mechanisms_of_action amoa
        where amoa.asset_id = a.id
          and amoa.moa_id = any(p_moa_ids)
      ))
      -- roa filter: asset must have at least one matching ROA
      and (p_roa_ids is null or exists (
        select 1 from public.asset_routes_of_administration aroa
        where aroa.asset_id = a.id
          and aroa.roa_id = any(p_roa_ids)
      ))
  ),

  -- Step 2: compute highest phase rank per candidate asset
  asset_phase as (
    select
      ca.asset_id,
      max(case ai.development_status
        when 'LAUNCHED'  then 6
        when 'APPROVED'  then 5
        when 'P4'        then 4
        when 'P3'        then 3
        when 'P2'        then 2
        when 'P1'        then 1
        when 'PRECLIN'   then 0
        else null
      end) as max_rank
    from candidate_assets ca
    join public.asset_indications ai on ai.asset_id = ca.asset_id
    where ai.development_status is not null
    group by ca.asset_id
    having max(case ai.development_status
      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
      else null
    end) is not null
  ),

  -- Step 3: apply phase filter
  filtered_assets as (
    select ap.asset_id, ap.max_rank
    from asset_phase ap
    where p_phases is null or (
      case ap.max_rank
        when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
        when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
      end
    ) = any(p_phases)
  ),

  -- Step 4: compute intelligence count per asset
  --   counts primary_intelligence records linked to the asset directly
  --   OR to any trial belonging to the asset
  asset_intel as (
    select
      fa.asset_id,
      (
        -- asset-level intelligence
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'asset'
           and pi.entity_id = fa.asset_id
           and pi.space_id = p_space_id)
        +
        -- trial-level intelligence for trials belonging to this asset
        (select count(*)
         from public.primary_intelligence pi
         where pi.entity_type = 'trial'
           and pi.space_id = p_space_id
           and pi.entity_id in (
             select t.id from public.trials t
             where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id) and t.space_id = p_space_id
           ))
      ) as intelligence_count
    from filtered_assets fa
  ),

  -- Step 5: compute recent change activity per asset (14-day window).
  --   recent_changes_count rolls up everything beneath the asset:
  --     - trial_change_events for the asset's trials, plus
  --     - published primary_intelligence about the asset OR its trials.
  asset_activity as (
    select
      fa.asset_id,
      (
        (select count(*)
         from public.trial_change_events e
         join public.trials t on t.id = e.trial_id
         where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
           and t.space_id = p_space_id
           and e.observed_at >= now() - public.recent_change_window())
        +
        (select count(*)
         from public.primary_intelligence pi
         where pi.space_id = p_space_id
           and pi.state = 'published'
           and pi.updated_at >= now() - public.recent_change_window()
           and (
             (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
             or (pi.entity_type = 'trial' and pi.entity_id in (
                   select t2.id from public.trials t2
                   where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select 'intelligence_published'::text as etype, pi.updated_at as ets
          from public.primary_intelligence pi
          where pi.space_id = p_space_id
            and pi.state = 'published'
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
              or (pi.entity_type = 'trial' and pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_type,
      (
        select c.eid
        from (
          select e.observed_at as ets, e.id as eid
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = fa.asset_id)
            and t.space_id = p_space_id
            and e.observed_at >= now() - public.recent_change_window()
          union all
          select pi.updated_at as ets, null::uuid as eid
          from public.primary_intelligence pi
          where pi.space_id = p_space_id
            and pi.state = 'published'
            and pi.updated_at >= now() - public.recent_change_window()
            and (
              (pi.entity_type = 'asset' and pi.entity_id = fa.asset_id)
              or (pi.entity_type = 'trial' and pi.entity_id in (
                    select t2.id from public.trials t2
                    where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = fa.asset_id) and t2.space_id = p_space_id))
            )
        ) c
        order by c.ets desc
        limit 1
      ) as most_recent_change_event_id
    from filtered_assets fa
  )

  -- Step 6: assemble result
  select jsonb_build_object(
    'assets', coalesce((
      select jsonb_agg(asset_obj order by fa.max_rank desc, a.name)
      from filtered_assets fa
      join public.assets a on a.id = fa.asset_id
      join public.companies c on c.id = a.company_id
      left join asset_intel ai_cnt on ai_cnt.asset_id = fa.asset_id
      left join asset_activity aa on aa.asset_id = fa.asset_id
      cross join lateral (
        select jsonb_build_object(
          'id', a.id,
          'name', a.name,
          'generic_name', a.generic_name,
          'logo_url', a.logo_url,
          'company_id', c.id,
          'company_name', c.name,
          'company_logo_url', c.logo_url,
          'highest_phase_rank', fa.max_rank,
          'highest_phase', case fa.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          end,
          'indications', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
              order by ind.display_order, ind.name
            )
            from public.asset_indications ai2
            join public.indications ind on ind.id = ai2.indication_id
            where ai2.asset_id = a.id
          ), '[]'::jsonb),
          'moas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', m.id, 'name', m.name)
              order by m.display_order, m.name
            )
            from public.asset_mechanisms_of_action amoa
            join public.mechanisms_of_action m on m.id = amoa.moa_id
            where amoa.asset_id = a.id
          ), '[]'::jsonb),
          'roas', coalesce((
            select jsonb_agg(
              jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
              order by r.display_order, r.name
            )
            from public.asset_routes_of_administration aroa
            join public.routes_of_administration r on r.id = aroa.roa_id
            where aroa.asset_id = a.id
          ), '[]'::jsonb),
          'trials', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', t.id,
                'name', t.name,
                'acronym', t.acronym,
                'identifier', t.identifier,
                'status', t.status,
                'recruitment_status', t.recruitment_status,
                'study_type', t.study_type,
                'phase', t.phase_type
              ) order by t.display_order, t.name
            )
            from public.trials t
            where exists (select 1 from public.trial_assets ta where ta.trial_id = t.id and ta.asset_id = a.id) and t.space_id = p_space_id
          ), '[]'::jsonb),
          'recent_markers', coalesce((
            select jsonb_agg(marker_obj order by mk_sub.event_date desc)
            from (
              select mk.id, mk.event_date, mk.projection,
                     mt.name as marker_type_name, mt.shape, mt.color,
                     mc.name as category_name
              from public.marker_assignments ma
              join public.markers mk on mk.id = ma.marker_id
              join public.marker_types mt on mt.id = mk.marker_type_id
              left join public.marker_categories mc on mc.id = mt.category_id
              join public.trials t2 on t2.id = ma.trial_id
              where exists (select 1 from public.trial_assets ta where ta.trial_id = t2.id and ta.asset_id = a.id)
                and t2.space_id = p_space_id
                and mk.space_id = p_space_id
              order by mk.event_date desc
              limit 3
            ) mk_sub
            cross join lateral (
              select jsonb_build_object(
                'id', mk_sub.id,
                'event_date', mk_sub.event_date,
                'projection', mk_sub.projection,
                'marker_type_name', mk_sub.marker_type_name,
                'shape', mk_sub.shape,
                'color', mk_sub.color,
                'category_name', mk_sub.category_name
              ) as marker_obj
            ) mk_lateral
          ), '[]'::jsonb),
          'intelligence_count', coalesce(ai_cnt.intelligence_count, 0),
          'recent_changes_count', coalesce(aa.recent_changes_count, 0),
          'most_recent_change_type', aa.most_recent_change_type,
          'most_recent_change_event_id', aa.most_recent_change_event_id,
          'has_recent_activity', coalesce(aa.recent_changes_count, 0) > 0
        ) as asset_obj
      ) as asset_lateral
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

-- =============================================================================
-- get_bullseye_by_company: company logo via subselect (asset's company)
-- =============================================================================
create or replace function public.get_bullseye_by_company(p_space_id uuid, p_company_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null)
  into v_scope
  from public.companies c where c.id = p_company_id and c.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'company', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Indications'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.name as asset_name, a.generic_name, a.logo_url, a.company_id,
      ai.indication_id,
      case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end as phase_rank
    from public.assets a
    join public.asset_indications ai on ai.asset_id = a.id
    where a.company_id = p_company_id and a.space_id = p_space_id
      and ai.development_status is not null
  ),
  indication_rank as (
    select indication_id, max(phase_rank) as ind_max_rank
    from asset_rollup group by indication_id
  )
  select coalesce(jsonb_agg(spoke_obj order by ir.ind_max_rank desc, ind.name), '[]'::jsonb)
  into v_spokes
  from public.indications ind
  join indication_rank ir on ir.indication_id = ind.id
  cross join lateral (
    select jsonb_build_object(
      'id', ind.id, 'name', ind.name, 'display_order', ind.display_order,
      'highest_phase_rank', ir.ind_max_rank,
      'products', (
        select coalesce(jsonb_agg(
          jsonb_build_object(
            'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
            'logo_url', ar.logo_url, 'company_id', ar.company_id,
            'company_name', (select cc.name from public.companies cc where cc.id = ar.company_id),
            'company_logo_url', (select cc.logo_url from public.companies cc where cc.id = ar.company_id),
            'highest_phase_rank', ar.phase_rank,
            'highest_phase', case ar.phase_rank
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.asset_mechanisms_of_action amoa join public.mechanisms_of_action m on m.id = amoa.moa_id
              where amoa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.asset_routes_of_administration aroa join public.routes_of_administration r on r.id = aroa.roa_id
              where aroa.asset_id = ar.asset_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(jsonb_build_object(
                'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                'status', t.status, 'recruitment_status', t.recruitment_status,
                'study_type', t.study_type, 'phase', t.phase_type
              ) order by t.display_order, t.name), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where t.asset_id = ar.asset_id and t.space_id = p_space_id
                and cim.indication_id = ind.id
            ),
            'recent_markers', '[]'::jsonb
          ) order by ar.phase_rank desc, ar.asset_name
        ), '[]'::jsonb)
        from asset_rollup ar where ar.indication_id = ind.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where ind.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'company', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Indications'
  );
end;
$$;

comment on function public.get_bullseye_by_company(uuid, uuid) is
  'Company-scoped bullseye with indication spokes. Trial payload emits acronym alongside name; the client uses acronym ?? name for the display label. acronym is materialized from CT.gov via _materialize_trial_from_snapshot; see 20260528003300. Asset payload carries company_logo_url for the company tile (see 20260618170000).';

-- =============================================================================
-- get_bullseye_by_moa: company logo joined from the company spoke (c.logo_url)
-- =============================================================================
create or replace function public.get_bullseye_by_moa(p_space_id uuid, p_moa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation)
  into v_scope
  from public.mechanisms_of_action m where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'moa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.company_id, a.name as asset_name, a.generic_name, a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_mechanisms_of_action amoa on amoa.asset_id = a.id and amoa.moa_id = p_moa_id
    left join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank from asset_rollup group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
          'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
          'company_logo_url', c.logo_url,
          'highest_phase_rank', ar.max_rank,
          'highest_phase', case ar.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN' end,
          'moas', '[]'::jsonb, 'roas', '[]'::jsonb,
          'trials', '[]'::jsonb, 'recent_markers', '[]'::jsonb
        ) order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'moa', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$$;

comment on function public.get_bullseye_by_moa(uuid, uuid) is
  'MOA-scoped bullseye. Asset payload emits an empty trials array (intentional, see 20260524120600). Acronym surfacing is therefore a no-op for this RPC today, but the comment is added for consistency: when trials are eventually attached here they will carry acronym alongside name per 20260528003300. Asset payload carries company_logo_url for the company tile (see 20260618170000).';

-- =============================================================================
-- get_bullseye_by_roa: company logo joined from the company spoke (c.logo_url)
-- =============================================================================
create or replace function public.get_bullseye_by_roa(p_space_id uuid, p_roa_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'roa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with asset_rollup as (
    select
      a.id as asset_id, a.company_id, a.name as asset_name, a.generic_name, a.logo_url,
      max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.assets a
    join public.asset_routes_of_administration aroa on aroa.asset_id = a.id and aroa.roa_id = p_roa_id
    left join public.asset_indications ai on ai.asset_id = a.id
    where a.space_id = p_space_id
    group by a.id, a.company_id, a.name, a.generic_name, a.logo_url
    having max(case ai.development_status
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank from asset_rollup group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id, 'name', c.name, 'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(jsonb_build_object(
          'id', ar.asset_id, 'name', ar.asset_name, 'generic_name', ar.generic_name,
          'logo_url', ar.logo_url, 'company_id', ar.company_id, 'company_name', c.name,
          'company_logo_url', c.logo_url,
          'highest_phase_rank', ar.max_rank,
          'highest_phase', case ar.max_rank
            when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
            when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN' end,
          'moas', '[]'::jsonb, 'roas', '[]'::jsonb,
          'trials', '[]'::jsonb, 'recent_markers', '[]'::jsonb
        ) order by ar.max_rank desc, ar.asset_name), '[]'::jsonb)
        from asset_rollup ar where ar.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'roa', 'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$$;

comment on function public.get_bullseye_by_roa(uuid, uuid) is
  'ROA-scoped bullseye. Asset payload emits an empty trials array (intentional, see 20260524120600). Acronym surfacing is therefore a no-op for this RPC today, but the comment is added for consistency: when trials are eventually attached here they will carry acronym alongside name per 20260528003300. Asset payload carries company_logo_url for the company tile (see 20260618170000).';

-- =============================================================================
-- get_positioning_data: thread c.logo_url through the CTEs into each product
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
           count(distinct t.id) as trial_count
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
      ahp.highest_phase_rank, ahp.highest_phase, ahp.trial_count,
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
        'trial_count', ag.trial_count
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

notify pgrst, 'reload schema';
