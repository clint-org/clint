-- update get_dashboard_data to accept MOA/ROA filters and return MOA/ROA arrays on each product
-- update get_bullseye_data to return MOA/ROA arrays on each product

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null,
  p_mechanism_of_action_ids uuid[] default null,
  p_route_of_administration_ids uuid[] default null
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  -- normalize empty arrays to null so callers passing [] instead of null
  -- for "no filter" do not silently get zero results
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
      'products', coalesce((
        select jsonb_agg(product_obj order by p.display_order)
        from public.products p
        cross join lateral (
          select jsonb_build_object(
            'id', p.id,
            'name', p.name,
            'generic_name', p.generic_name,
            'logo_url', p.logo_url,
            'display_order', p.display_order,
            'mechanisms_of_action', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pm
              join public.mechanisms_of_action m on m.id = pm.moa_id
              where pm.product_id = p.id
            ), '[]'::jsonb),
            'routes_of_administration', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration pr
              join public.routes_of_administration r on r.id = pr.roa_id
              where pr.product_id = p.id
            ), '[]'::jsonb),
            'trials', coalesce((
              select jsonb_agg(trial_obj order by t.display_order)
              from public.trials t
              cross join lateral (
                select jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'notes', t.notes,
                  'display_order', t.display_order,
                  'product_id', t.product_id,
                  'therapeutic_area_id', t.therapeutic_area_id,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', t.phase,
                  'intervention_type', t.intervention_type,
                  'intervention_name', t.intervention_name,
                  'lead_sponsor', t.lead_sponsor,
                  'study_countries', t.study_countries,
                  'fda_designations', t.fda_designations,
                  'has_dmc', t.has_dmc,
                  'start_date', t.start_date,
                  'primary_completion_date', t.primary_completion_date,
                  'ctgov_last_synced_at', t.ctgov_last_synced_at,
                  'therapeutic_area', (
                    select jsonb_build_object('id', ta.id, 'name', ta.name, 'abbreviation', ta.abbreviation)
                    from public.therapeutic_areas ta where ta.id = t.therapeutic_area_id
                  ),
                  'phases', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tp.id, 'trial_id', tp.trial_id,
                        'phase_type', tp.phase_type, 'start_date', tp.start_date,
                        'end_date', tp.end_date, 'color', tp.color, 'label', tp.label
                      )
                      order by tp.start_date
                    )
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                      and (p_start_year is null or extract(year from tp.end_date) >= p_start_year or tp.end_date is null)
                      and (p_end_year is null or extract(year from tp.start_date) <= p_end_year)
                  ), '[]'::jsonb),
                  'markers', coalesce((
                    select jsonb_agg(
                      jsonb_build_object(
                        'id', tm.id, 'trial_id', tm.trial_id,
                        'marker_type_id', tm.marker_type_id,
                        'event_date', tm.event_date, 'end_date', tm.end_date,
                        'tooltip_text', tm.tooltip_text, 'tooltip_image_url', tm.tooltip_image_url,
                        'is_projected', tm.is_projected,
                        'marker_type', (
                          select jsonb_build_object(
                            'id', mt.id, 'name', mt.name, 'icon', mt.icon,
                            'shape', mt.shape, 'fill_style', mt.fill_style,
                            'color', mt.color, 'is_system', mt.is_system,
                            'display_order', mt.display_order
                          )
                          from public.marker_types mt where mt.id = tm.marker_type_id
                        )
                      )
                      order by tm.event_date
                    )
                    from public.trial_markers tm
                    where tm.trial_id = t.id
                      and tm.space_id = p_space_id
                      and (p_start_year is null or extract(year from tm.event_date) >= p_start_year)
                      and (p_end_year is null or extract(year from tm.event_date) <= p_end_year)
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
              where t.product_id = p.id
                and t.space_id = p_space_id
                and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
                and (p_recruitment_statuses is null or t.recruitment_status = any(p_recruitment_statuses))
                and (p_study_types is null or t.study_type = any(p_study_types))
                and (p_phases is null or t.phase = any(p_phases))
            ), '[]'::jsonb)
          ) as product_obj
        ) as product_lateral
        where p.company_id = c.id
          and p.space_id = p_space_id
          and (p_product_ids is null or p.id = any(p_product_ids))
          and (
            p_mechanism_of_action_ids is null
            or exists (
              select 1 from public.product_mechanisms_of_action pm2
              where pm2.product_id = p.id
                and pm2.moa_id = any(p_mechanism_of_action_ids)
            )
          )
          and (
            p_route_of_administration_ids is null
            or exists (
              select 1 from public.product_routes_of_administration pr2
              where pr2.product_id = p.id
                and pr2.roa_id = any(p_route_of_administration_ids)
            )
          )
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$$;

create or replace function public.get_bullseye_data(
  p_space_id uuid,
  p_therapeutic_area_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_ta jsonb;
  v_companies jsonb;
begin
  select jsonb_build_object(
    'id', ta.id,
    'name', ta.name,
    'abbreviation', ta.abbreviation
  )
  into v_ta
  from public.therapeutic_areas ta
  where ta.id = p_therapeutic_area_id
    and ta.space_id = p_space_id;

  if v_ta is null then
    return jsonb_build_object(
      'therapeutic_area', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'companies', '[]'::jsonb
    );
  end if;

  with product_rollup as (
    select
      p.id            as product_id,
      p.company_id    as company_id,
      p.name          as product_name,
      p.generic_name  as generic_name,
      p.logo_url      as logo_url,
      max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) as max_rank
    from public.products p
    join public.trials t
      on t.product_id = p.id
     and t.space_id = p_space_id
     and t.therapeutic_area_id = p_therapeutic_area_id
    join public.trial_phases tp
      on tp.trial_id = t.id
     and tp.space_id = p_space_id
     and tp.phase_type <> 'OBS'
    where p.space_id = p_space_id
    group by p.id, p.company_id, p.name, p.generic_name, p.logo_url
    having max(case tp.phase_type
        when 'LAUNCHED' then 6
        when 'APPROVED' then 5
        when 'P4'       then 4
        when 'P3'       then 3
        when 'P2'       then 2
        when 'P1'       then 1
        when 'PRECLIN'  then 0
        else null
      end) is not null
  ),
  company_rank as (
    select
      company_id,
      max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(company_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_companies
  from public.companies c
  join company_rank cr on cr.company_id = c.id
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'display_order', c.display_order,
      'highest_phase_rank', cr.company_max_rank,
      'products', (
        select coalesce(jsonb_agg(product_obj order by pr.max_rank desc, pr.product_name), '[]'::jsonb)
        from product_rollup pr
        cross join lateral (
          select jsonb_build_object(
            'id', pr.product_id,
            'name', pr.product_name,
            'generic_name', pr.generic_name,
            'logo_url', pr.logo_url,
            'company_id', pr.company_id,
            'company_name', c.name,
            'highest_phase_rank', pr.max_rank,
            'highest_phase', case pr.max_rank
              when 6 then 'LAUNCHED'
              when 5 then 'APPROVED'
              when 4 then 'P4'
              when 3 then 'P3'
              when 2 then 'P2'
              when 1 then 'P1'
              when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action m on m.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name)
              from public.product_routes_of_administration proa
              join public.routes_of_administration r on r.id = proa.roa_id
              where proa.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id,
                  'name', t.name,
                  'identifier', t.identifier,
                  'sample_size', t.sample_size,
                  'status', t.status,
                  'recruitment_status', t.recruitment_status,
                  'study_type', t.study_type,
                  'phase', (
                    select tp.phase_type
                    from public.trial_phases tp
                    where tp.trial_id = t.id
                      and tp.space_id = p_space_id
                    order by case tp.phase_type
                      when 'LAUNCHED' then 6
                      when 'APPROVED' then 5
                      when 'P4'       then 4
                      when 'P3'       then 3
                      when 'P2'       then 2
                      when 'P1'       then 1
                      when 'PRECLIN'  then 0
                      else -1
                    end desc,
                    tp.start_date desc
                    limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id
                and t.therapeutic_area_id = p_therapeutic_area_id
                and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id,
                  'event_date', tmm.event_date,
                  'marker_type_name', mt.name,
                  'icon', mt.icon,
                  'shape', mt.shape,
                  'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id
                  and t2.therapeutic_area_id = p_therapeutic_area_id
                  and t2.space_id = p_space_id
                  and tm.space_id = p_space_id
                order by tm.event_date desc
                limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'therapeutic_area', v_ta,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'companies', coalesce(v_companies, '[]'::jsonb)
  );
end;
$$;

comment on function public.get_bullseye_data is
  'Returns the full jsonb document needed to render the landscape bullseye for a single therapeutic area: companies with qualifying products, per-product highest phase rollup (with MOAs and ROAs), trial list, and up to three most recent markers. security invoker so RLS applies.';
