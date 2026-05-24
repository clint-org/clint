-- migration: 20260524120600_rpcs_bullseye_landscape_index
-- purpose: rewrite bullseye and landscape index RPCs for indication model.
--          scope changes from therapeutic_area to indication, phase rollup
--          reads asset_indications.development_status directly.

-- =============================================================================
-- 1. get_bullseye_data: indication-scoped bullseye
-- =============================================================================

drop function if exists public.get_bullseye_data(uuid, uuid);

create or replace function public.get_bullseye_data(p_space_id uuid, p_indication_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_indication_ids uuid[];
begin
  select jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation)
  into v_scope
  from public.indications ind
  where ind.id = p_indication_id and ind.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension',   'indication',
      'scope',       null,
      'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
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
                  'id', t.id, 'name', t.name, 'identifier', t.identifier,
                  'status', t.status, 'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type, 'phase', t.phase_type
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where t.asset_id = ar.asset_id
                and t.space_id = p_space_id
                and cim.indication_id = any(v_indication_ids)
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', rmm.id, 'event_date', rmm.event_date, 'projection', rmm.projection,
                  'marker_type_name', mt.name, 'icon', mt.icon, 'shape', mt.shape,
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
                where t2.asset_id = ar.asset_id
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
    'ring_order',  jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;

-- =============================================================================
-- 2. get_bullseye_by_company: indication spokes
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
                'id', t.id, 'name', t.name, 'identifier', t.identifier,
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

-- =============================================================================
-- 3. get_bullseye_by_moa: rename products -> assets
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

-- =============================================================================
-- 4. get_bullseye_by_roa: rename products -> assets
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

-- =============================================================================
-- 5. get_landscape_index: indication grouping
-- =============================================================================

create or replace function public.get_landscape_index(p_space_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(row_obj order by ind.display_order, ind.name), '[]'::jsonb)
  into result
  from public.indications ind
  cross join lateral (
    select jsonb_build_object(
      'indication', jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation, 'parent_id', ind.parent_id),
      'product_count', (
        select count(distinct ai.asset_id)
        from public.asset_indications ai
        where ai.indication_id = ind.id and ai.space_id = p_space_id
      ),
      'company_count', (
        select count(distinct a.company_id)
        from public.asset_indications ai
        join public.assets a on a.id = ai.asset_id
        where ai.indication_id = ind.id and ai.space_id = p_space_id
      ),
      'highest_phase_present', coalesce((
        select max(case ai.development_status
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end)
        from public.asset_indications ai
        where ai.indication_id = ind.id and ai.space_id = p_space_id
      ), -1),
      'assets_missing_status', (
        select count(*)
        from public.asset_indications ai
        where ai.indication_id = ind.id and ai.space_id = p_space_id
          and ai.development_status is null
      )
    ) as row_obj
  ) as row_lateral
  where ind.space_id = p_space_id;

  return result;
end;
$$;

-- =============================================================================
-- 6. get_landscape_index_by_company: rename and indication secondary
-- =============================================================================

create or replace function public.get_landscape_index_by_company(p_space_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(row_obj order by c.display_order, c.name), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'entity', jsonb_build_object('id', c.id, 'name', c.name),
      'product_count', (
        select count(*) from public.assets a where a.company_id = c.id and a.space_id = p_space_id
      ),
      'secondary_count', (
        select count(distinct ai.indication_id)
        from public.assets a
        join public.asset_indications ai on ai.asset_id = a.id
        where a.company_id = c.id and a.space_id = p_space_id
      ),
      'secondary_label', 'indications',
      'highest_phase_present', coalesce((
        select max(case ai.development_status
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end)
        from public.assets a
        join public.asset_indications ai on ai.asset_id = a.id
        where a.company_id = c.id and a.space_id = p_space_id
      ), -1)
    ) as row_obj
  ) as row_lateral
  where c.space_id = p_space_id;

  return result;
end;
$$;

-- =============================================================================
-- 7. get_landscape_index_by_moa: rename products -> assets
-- =============================================================================

create or replace function public.get_landscape_index_by_moa(p_space_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(row_obj order by m.display_order, m.name), '[]'::jsonb)
  into result
  from public.mechanisms_of_action m
  cross join lateral (
    select jsonb_build_object(
      'entity', jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation),
      'product_count', (
        select count(distinct amoa.asset_id)
        from public.asset_mechanisms_of_action amoa
        join public.assets a on a.id = amoa.asset_id
        where amoa.moa_id = m.id and a.space_id = p_space_id
      ),
      'secondary_count', (
        select count(distinct a.company_id)
        from public.asset_mechanisms_of_action amoa
        join public.assets a on a.id = amoa.asset_id
        where amoa.moa_id = m.id and a.space_id = p_space_id
      ),
      'secondary_label', 'companies',
      'highest_phase_present', coalesce((
        select max(case ai.development_status
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end)
        from public.asset_mechanisms_of_action amoa
        join public.asset_indications ai on ai.asset_id = amoa.asset_id
        where amoa.moa_id = m.id and ai.space_id = p_space_id
      ), -1)
    ) as row_obj
  ) as row_lateral
  where m.space_id = p_space_id;

  return result;
end;
$$;

-- =============================================================================
-- 8. get_landscape_index_by_roa: rename products -> assets
-- =============================================================================

create or replace function public.get_landscape_index_by_roa(p_space_id uuid)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(row_obj order by r.display_order, r.name), '[]'::jsonb)
  into result
  from public.routes_of_administration r
  cross join lateral (
    select jsonb_build_object(
      'entity', jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation),
      'product_count', (
        select count(distinct aroa.asset_id)
        from public.asset_routes_of_administration aroa
        join public.assets a on a.id = aroa.asset_id
        where aroa.roa_id = r.id and a.space_id = p_space_id
      ),
      'secondary_count', (
        select count(distinct a.company_id)
        from public.asset_routes_of_administration aroa
        join public.assets a on a.id = aroa.asset_id
        where aroa.roa_id = r.id and a.space_id = p_space_id
      ),
      'secondary_label', 'companies',
      'highest_phase_present', coalesce((
        select max(case ai.development_status
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end)
        from public.asset_routes_of_administration aroa
        join public.asset_indications ai on ai.asset_id = aroa.asset_id
        where aroa.roa_id = r.id and ai.space_id = p_space_id
      ), -1)
    ) as row_obj
  ) as row_lateral
  where r.space_id = p_space_id;

  return result;
end;
$$;
