-- update get_dashboard_data to support new CT.gov dimension filters

create or replace function public.get_dashboard_data(
  p_space_id uuid,
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null,
  p_recruitment_statuses text[] default null,
  p_study_types text[] default null,
  p_phases text[] default null
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
      ), '[]'::jsonb)
    ) as company_obj
  ) as company_lateral
  where c.space_id = p_space_id
    and (p_company_ids is null or c.id = any(p_company_ids));

  return result;
end;
$$;
