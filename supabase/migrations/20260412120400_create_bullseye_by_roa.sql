-- migration: 20260412120400_create_bullseye_by_roa
-- purpose: create get_bullseye_by_roa() which returns the bullseye dataset
--          scoped to a single route of administration. spokes are companies
--          that have products with this ROA.
-- affected objects: public.get_bullseye_by_roa (function)

create or replace function public.get_bullseye_by_roa(
  p_space_id uuid,
  p_roa_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_scope jsonb;
  v_spokes jsonb;
begin
  select jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation)
  into v_scope
  from public.routes_of_administration r
  where r.id = p_roa_id and r.space_id = p_space_id;

  if v_scope is null then
    return jsonb_build_object(
      'dimension', 'roa', 'scope', null,
      'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
      'spokes', '[]'::jsonb, 'spoke_label', 'Companies'
    );
  end if;

  with product_rollup as (
    select
      p.id as product_id,
      p.name as product_name,
      p.generic_name,
      p.logo_url,
      p.company_id,
      max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) as max_rank
    from public.product_routes_of_administration proa
    join public.products p on p.id = proa.product_id and p.space_id = p_space_id
    join public.trials t on t.product_id = p.id and t.space_id = p_space_id
    join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
    where proa.roa_id = p_roa_id
    group by p.id, p.name, p.generic_name, p.logo_url, p.company_id
    having max(case tp.phase_type
        when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
        when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
        else null
      end) is not null
  ),
  company_rank as (
    select company_id, max(max_rank) as company_max_rank
    from product_rollup
    group by company_id
  )
  select coalesce(jsonb_agg(spoke_obj order by cr.company_max_rank desc, c.name), '[]'::jsonb)
  into v_spokes
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
              when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
              when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
            end,
            'moas', coalesce((
              select jsonb_agg(jsonb_build_object('id', mm.id, 'name', mm.name) order by mm.display_order, mm.name)
              from public.product_mechanisms_of_action pmoa
              join public.mechanisms_of_action mm on mm.id = pmoa.moa_id
              where pmoa.product_id = pr.product_id
            ), '[]'::jsonb),
            'roas', coalesce((
              select jsonb_agg(jsonb_build_object('id', rr.id, 'name', rr.name, 'abbreviation', rr.abbreviation) order by rr.display_order, rr.name)
              from public.product_routes_of_administration proa2
              join public.routes_of_administration rr on rr.id = proa2.roa_id
              where proa2.product_id = pr.product_id
            ), '[]'::jsonb),
            'trials', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', t.id, 'name', t.name, 'identifier', t.identifier,
                  'sample_size', t.sample_size, 'status', t.status,
                  'recruitment_status', t.recruitment_status, 'study_type', t.study_type,
                  'phase', (
                    select tp2.phase_type from public.trial_phases tp2
                    where tp2.trial_id = t.id and tp2.space_id = p_space_id
                    order by case tp2.phase_type
                      when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
                      when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
                      else -1 end desc, tp2.start_date desc limit 1
                  )
                ) order by t.display_order, t.name
              ), '[]'::jsonb)
              from public.trials t
              where t.product_id = pr.product_id and t.space_id = p_space_id
            ),
            'recent_markers', (
              select coalesce(jsonb_agg(
                jsonb_build_object(
                  'id', tmm.id, 'event_date', tmm.event_date,
                  'marker_type_name', mt.name, 'icon', mt.icon,
                  'shape', mt.shape, 'color', mt.color
                ) order by tmm.event_date desc
              ), '[]'::jsonb)
              from (
                select tm.id, tm.event_date, tm.marker_type_id
                from public.trial_markers tm
                join public.trials t2 on t2.id = tm.trial_id
                where t2.product_id = pr.product_id and t2.space_id = p_space_id and tm.space_id = p_space_id
                order by tm.event_date desc limit 3
              ) tmm
              join public.marker_types mt on mt.id = tmm.marker_type_id
            )
          ) as product_obj
        ) as product_lateral
        where pr.company_id = c.id
      )
    ) as spoke_obj
  ) as spoke_lateral
  where c.space_id = p_space_id;

  return jsonb_build_object(
    'dimension', 'roa',
    'scope', v_scope,
    'ring_order', jsonb_build_array('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED'),
    'spokes', coalesce(v_spokes, '[]'::jsonb),
    'spoke_label', 'Companies'
  );
end;
$$;
