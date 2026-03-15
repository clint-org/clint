-- migration: 20260315120300_create_dashboard_function
-- purpose: create the get_dashboard_data() function that returns hierarchical
--          json for the clinical trial timeline dashboard.
-- affected objects: public.get_dashboard_data (function)
-- notes: uses security invoker so rls policies apply to the calling user.

create or replace function public.get_dashboard_data(
  p_company_ids uuid[] default null,
  p_product_ids uuid[] default null,
  p_therapeutic_area_ids uuid[] default null,
  p_start_year int default null,
  p_end_year int default null
)
returns jsonb
language plpgsql
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_start_date date;
  v_end_date date;
begin
  -- convert year boundaries to dates for range filtering
  if p_start_year is not null then
    v_start_date := make_date(p_start_year, 1, 1);
  end if;

  if p_end_year is not null then
    v_end_date := make_date(p_end_year, 12, 31);
  end if;

  select coalesce(jsonb_agg(company_obj order by c.display_order, c.name), '[]'::jsonb)
  into v_result
  from public.companies c
  cross join lateral (
    select jsonb_build_object(
      'id', c.id,
      'name', c.name,
      'logo_url', c.logo_url,
      'display_order', c.display_order,
      'products', coalesce(products_agg.products, '[]'::jsonb)
    ) as company_obj
  ) company_json
  cross join lateral (
    select jsonb_agg(product_obj order by p.display_order, p.name) as products
    from public.products p
    cross join lateral (
      select jsonb_build_object(
        'id', p.id,
        'name', p.name,
        'generic_name', p.generic_name,
        'logo_url', p.logo_url,
        'display_order', p.display_order,
        'trials', coalesce(trials_agg.trials, '[]'::jsonb)
      ) as product_obj
    ) product_json
    cross join lateral (
      select jsonb_agg(trial_obj order by t.display_order, t.name) as trials
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
          'therapeutic_area', (
            select jsonb_build_object(
              'id', ta.id,
              'name', ta.name,
              'abbreviation', ta.abbreviation
            )
            from public.therapeutic_areas ta
            where ta.id = t.therapeutic_area_id
          ),
          'phases', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', tp.id,
                'phase_type', tp.phase_type,
                'start_date', tp.start_date,
                'end_date', tp.end_date,
                'color', tp.color,
                'label', tp.label
              )
              order by tp.start_date
            )
            from public.trial_phases tp
            where tp.trial_id = t.id
              and (v_start_date is null or tp.end_date is null or tp.end_date >= v_start_date)
              and (v_end_date is null or tp.start_date <= v_end_date)
          ), '[]'::jsonb),
          'markers', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', tm.id,
                'event_date', tm.event_date,
                'end_date', tm.end_date,
                'tooltip_text', tm.tooltip_text,
                'tooltip_image_url', tm.tooltip_image_url,
                'is_projected', tm.is_projected,
                'marker_type', jsonb_build_object(
                  'id', mt.id,
                  'name', mt.name,
                  'icon', mt.icon,
                  'shape', mt.shape,
                  'fill_style', mt.fill_style,
                  'color', mt.color,
                  'is_system', mt.is_system,
                  'display_order', mt.display_order
                )
              )
              order by tm.event_date
            )
            from public.trial_markers tm
            join public.marker_types mt on mt.id = tm.marker_type_id
            where tm.trial_id = t.id
              and (v_start_date is null or tm.event_date >= v_start_date)
              and (v_end_date is null or tm.event_date <= v_end_date)
          ), '[]'::jsonb),
          'trial_notes', coalesce((
            select jsonb_agg(
              jsonb_build_object(
                'id', tn.id,
                'content', tn.content,
                'created_at', tn.created_at,
                'updated_at', tn.updated_at
              )
              order by tn.created_at
            )
            from public.trial_notes tn
            where tn.trial_id = t.id
          ), '[]'::jsonb)
        ) as trial_obj
      ) trial_json
      where t.product_id = p.id
        and (p_therapeutic_area_ids is null or t.therapeutic_area_id = any(p_therapeutic_area_ids))
    ) trials_agg
    where p.company_id = c.id
      and (p_product_ids is null or p.id = any(p_product_ids))
  ) products_agg
  where (p_company_ids is null or c.id = any(p_company_ids));

  return v_result;
end;
$$;

comment on function public.get_dashboard_data is 'Returns hierarchical dashboard data (companies > products > trials) with optional filtering by company, product, therapeutic area, and date range. Uses security invoker so rls policies apply.';
