-- Surface anchor_type on each dashboard event object.
--
-- The unified timeline badges a `primary` projection with the letter `p` on
-- asset/company anchors (a non-registry primary source), while a `primary` on a
-- trial stays badge-less (the CT.gov registry default). The grid reads events
-- through public.get_dashboard_data -> public._dashboard_anchor_events, whose
-- per-event JSON did not include anchor_type, so the resolver could not tell an
-- asset/company primary from a trial primary on the main timeline. Add
-- anchor_type to the event object. The helper already filters on it and is
-- called once per anchor level, so the value is known.
--
-- Body is the live pg_get_functiondef output, unchanged except the one added
-- 'anchor_type' field. Read-only SQL helper; no data change, no new RPC.

CREATE OR REPLACE FUNCTION public._dashboard_anchor_events(p_anchor_type text, p_anchor_id uuid, p_space_id uuid, p_start_year integer, p_end_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
  select coalesce((
    select jsonb_agg(
      jsonb_build_object(
        'id',                 e.id,
        'marker_type_id',     e.event_type_id,
        'title',              e.title,
        'anchor_type',        e.anchor_type,
        'projection',         e.projection,
        'event_date',         e.event_date,
        'date_precision',     e.date_precision,
        'end_date',           e.end_date,
        'end_date_precision', e.end_date_precision,
        'is_ongoing',         e.is_ongoing,
        'description',        e.description,
        'sources', (
          select coalesce(
            jsonb_agg(jsonb_build_object('url', es.url, 'label', es.label)
                      order by es.sort_order, es.created_at),
            '[]'::jsonb)
          from public.event_sources es where es.event_id = e.id
        ),
        'registry_url', case
          when e.anchor_type = 'trial'
            then public.event_registry_url((select t.identifier from public.trials t where t.id = e.anchor_id))
          else null
        end,
        'metadata',           e.metadata,
        'is_projected',       e.is_projected,
        'no_longer_expected', e.no_longer_expected,
        'significance',       e.significance,
        'visibility',         e.visibility,
        'marker_type', (
          select jsonb_build_object(
            'id',                   et.id,
            'name',                 et.name,
            'shape',                et.shape,
            'fill_style',           et.fill_style,
            'color',                et.color,
            'inner_mark',           et.inner_mark,
            'default_significance', et.default_significance,
            'category_id',          et.category_id,
            'category_name',        ec.name
          )
          from public.event_types et
          left join public.event_type_categories ec on ec.id = et.category_id
          where et.id = e.event_type_id
        )
      )
      order by e.event_date
    )
    from public.events e
    where e.anchor_type = p_anchor_type
      and e.anchor_id   = p_anchor_id
      and e.space_id    = p_space_id
      and (p_start_year is null or extract(year from e.event_date) >= p_start_year)
      and (p_end_year   is null or extract(year from e.event_date) <= p_end_year)
  ), '[]'::jsonb)
$function$;

notify pgrst, 'reload schema';
