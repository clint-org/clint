-- Exclude the PRECLIN phase from every analytic RPC when the space has
-- show_preclinical = false (the default). Each function reads the flag once via
-- public.space_shows_preclinical(p_space_id) and drops preclinical rows from its
-- aggregation, so counts, "highest phase present", rings, density bubbles, and the
-- dashboard stay internally consistent and a client cannot reintroduce PRECLIN by
-- passing a phase param. See 20260603120000_space_show_preclinical_setting.sql and
-- docs/superpowers/specs/2026-06-03-hide-preclinical-phase-design.md.
--
-- Guard idiom: `(v_show_preclin or <col> is distinct from 'PRECLIN')`. The
-- `is distinct from` form preserves NULL development_status / phase rows (a
-- "missing phase" asset is not preclinical and must still appear).

-- ---------------------------------------------------------------------------
-- Landscape index (indication / company / moa / roa dimensions)
-- ---------------------------------------------------------------------------

create or replace function public.get_landscape_index(p_space_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  select coalesce(jsonb_agg(row_obj order by ind.display_order, ind.name), '[]'::jsonb)
  into result
  from public.indications ind
  cross join lateral (
    select jsonb_build_object(
      'entity', jsonb_build_object('id', ind.id, 'name', ind.name, 'abbreviation', ind.abbreviation, 'parent_id', ind.parent_id),
      'product_count', (
        select count(distinct ai.asset_id)
        from public.asset_indications ai
        where ai.indication_id = ind.id and ai.space_id = p_space_id
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ),
      'secondary_count', (
        select count(distinct a.company_id)
        from public.asset_indications ai
        join public.assets a on a.id = ai.asset_id
        where ai.indication_id = ind.id and ai.space_id = p_space_id
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ),
      'secondary_label', 'companies',
      'highest_phase_present', coalesce((
        select max(case ai.development_status
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end)
        from public.asset_indications ai
        where ai.indication_id = ind.id and ai.space_id = p_space_id
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ), -1),
      'products_missing_phase', (
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
$function$;

create or replace function public.get_landscape_index_by_company(p_space_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ), -1)
    ) as row_obj
  ) as row_lateral
  where c.space_id = p_space_id;

  return result;
end;
$function$;

create or replace function public.get_landscape_index_by_moa(p_space_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ), -1)
    ) as row_obj
  ) as row_lateral
  where m.space_id = p_space_id;

  return result;
end;
$function$;

create or replace function public.get_landscape_index_by_roa(p_space_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
          and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
      ), -1)
    ) as row_obj
  ) as row_lateral
  where r.space_id = p_space_id;

  return result;
end;
$function$;

-- ---------------------------------------------------------------------------
-- Bullseye (indication scope) + dimension variants
-- ---------------------------------------------------------------------------

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
              where t.asset_id = ar.asset_id
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
    'ring_order',  v_ring_order,
    'spokes',      coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$function$;


-- ---------------------------------------------------------------------------
-- Bullseye dimension variants (company / moa / roa)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_bullseye_by_company(p_space_id uuid, p_company_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  select jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null)
  into v_scope
  from public.companies c where c.id = p_company_id and c.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'company', 'scope', null,
      'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
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
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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
                'id', t.id, 'name', t.name, 'acronym', t.acronym, 'identifier', t.identifier,
                'status', t.status, 'recruitment_status', t.recruitment_status,
                'study_type', t.study_type, 'phase', t.phase_type
              ) order by t.display_order, t.name), '[]'::jsonb)
              from public.trials t
              join public.trial_conditions tc on tc.trial_id = t.id
              join public.condition_indication_map cim on cim.condition_id = tc.condition_id
              where t.asset_id = ar.asset_id and t.space_id = p_space_id
                and cim.indication_id = ind.id
                and (v_show_preclin or t.phase_type is distinct from 'PRECLIN')
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
    'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Indications'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_bullseye_by_moa(p_space_id uuid, p_moa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  select jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', m.abbreviation)
  into v_scope
  from public.mechanisms_of_action m where m.id = p_moa_id and m.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'moa', 'scope', null,
      'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
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
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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
    'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$function$;

CREATE OR REPLACE FUNCTION public.get_bullseye_by_roa(p_space_id uuid, p_roa_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_scope  jsonb;
  v_spokes jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'roa', 'scope', null,
      'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
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
    where a.space_id = p_space_id and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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
    'ring_order', case when v_show_preclin then jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED') else jsonb_build_array('P1','P2','P3','P4','APPROVED','LAUNCHED') end,
    'spokes', coalesce(v_spokes, '[]'::jsonb), 'spoke_label', 'Companies'
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- Density (positioning) + bullseye asset list
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_positioning_data(p_space_id uuid, p_grouping text DEFAULT 'moa'::text, p_count_unit text DEFAULT 'products'::text, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[], p_phases text[] DEFAULT NULL::text[], p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_bubbles            jsonb;
  v_latest_event_date  timestamptz;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
           a.company_id, c.name as company_name,
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
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
  ),

  -- roll up to one row per asset with its highest phase and trial count
  asset_highest_phase as (
    select ea.asset_id, ea.asset_name, ea.asset_generic_name,
           ea.company_id, ea.company_name, ea.asset_updated_at,
           max(srm.status_rank) as highest_phase_rank,
           (array_agg(srm.status_name order by srm.status_rank desc))[1] as highest_phase,
           count(distinct t.id) as trial_count
    from eligible_assets ea
    join public.asset_indications ai on ai.asset_id = ea.asset_id
    join status_rank_map srm on srm.status_name = ai.development_status
    left join public.trials t on t.asset_id = ea.asset_id and t.space_id = p_space_id
    where ai.development_status is not null
      and (p_indication_ids is null or ai.indication_id = any(p_indication_ids))
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
    group by ea.asset_id, ea.asset_name, ea.asset_generic_name,
             ea.company_id, ea.company_name, ea.asset_updated_at
  ),

  -- fan out assets into their grouping dimension
  asset_groups as (
    select
      ahp.asset_id, ahp.asset_name, ahp.asset_generic_name,
      ahp.company_id, ahp.company_name, ahp.asset_updated_at,
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
$function$;

CREATE OR REPLACE FUNCTION public.get_bullseye_assets(p_space_id uuid, p_indication_ids uuid[] DEFAULT NULL::uuid[], p_company_ids uuid[] DEFAULT NULL::uuid[], p_moa_ids uuid[] DEFAULT NULL::uuid[], p_roa_ids uuid[] DEFAULT NULL::uuid[], p_phases text[] DEFAULT NULL::text[], p_asset_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  v_result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
      and (v_show_preclin or ai.development_status is distinct from 'PRECLIN')
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
             where t.asset_id = fa.asset_id and t.space_id = p_space_id
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
         where t.asset_id = fa.asset_id
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
                   where t2.asset_id = fa.asset_id and t2.space_id = p_space_id))
           ))
      ) as recent_changes_count,
      (
        select c.etype
        from (
          select e.event_type::text as etype, e.observed_at as ets
          from public.trial_change_events e
          join public.trials t on t.id = e.trial_id
          where t.asset_id = fa.asset_id
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
                    where t2.asset_id = fa.asset_id and t2.space_id = p_space_id))
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
          where t.asset_id = fa.asset_id
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
                    where t2.asset_id = fa.asset_id and t2.space_id = p_space_id))
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
            where t.asset_id = a.id and t.space_id = p_space_id
              and (v_show_preclin or t.phase_type is distinct from 'PRECLIN')
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
              where t2.asset_id = a.id
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
$function$;

-- ---------------------------------------------------------------------------
-- Timeline dashboard
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION public.get_dashboard_data(p_space_id uuid, p_company_ids uuid[] DEFAULT NULL::uuid[], p_asset_ids uuid[] DEFAULT NULL::uuid[], p_indication_ids uuid[] DEFAULT NULL::uuid[], p_start_year integer DEFAULT NULL::integer, p_end_year integer DEFAULT NULL::integer, p_recruitment_statuses text[] DEFAULT NULL::text[], p_study_types text[] DEFAULT NULL::text[], p_phases text[] DEFAULT NULL::text[], p_mechanism_of_action_ids uuid[] DEFAULT NULL::uuid[], p_route_of_administration_ids uuid[] DEFAULT NULL::uuid[])
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE
 SET search_path TO ''
AS $function$
declare
  result jsonb;
  v_show_preclin boolean := public.space_shows_preclinical(p_space_id);
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
                      join public.trial_conditions tc on tc.trial_id = t.id
                      join public.condition_indication_map cim on cim.condition_id = tc.condition_id
                      where t.asset_id = a.id
                        and t.space_id = p_space_id
                        and cim.indication_id = ind.id
                        and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                        and (p_study_types is null or t.study_type = any(p_study_types))
                        and (p_phases is null or t.phase_type = any(p_phases))
                        and (v_show_preclin or t.phase_type is distinct from 'PRECLIN')
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
                        'recent_changes_count', coalesce(recent.recent_changes_count, 0),
                        'most_recent_change_type', recent.most_recent_change_type,
                        'most_recent_change_event_id', recent.most_recent_change_event_id,
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
                              'end_date',           mk.end_date,
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
