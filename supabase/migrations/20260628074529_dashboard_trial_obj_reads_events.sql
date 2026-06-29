-- Stage 2a: repoint the dashboard trial JSON from the dropped markers table to
-- trial-anchored events. JSON key stays 'markers' and marker_type_id = event_type_id
-- (system type UUIDs were reused), so the existing frontend renders events unchanged.
CREATE OR REPLACE FUNCTION public._dashboard_trial_obj(p_trial trials, p_space_id uuid, p_start_year integer, p_end_year integer)
 RETURNS jsonb
 LANGUAGE sql
 STABLE
 SET search_path TO ''
AS $function$
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
          'id',                 e.id,
          'marker_type_id',     e.event_type_id,
          'title',              e.title,
          'projection',         e.projection,
          'event_date',         e.event_date,
          'date_precision',     e.date_precision,
          'end_date',           e.end_date,
          'end_date_precision', e.end_date_precision,
          'is_ongoing',         e.is_ongoing,
          'description',        e.description,
          'source_url',         e.source_url,
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
      where e.anchor_type = 'trial' and e.anchor_id = p_trial.id
        and e.space_id = p_space_id
        and (p_start_year is null or extract(year from e.event_date) >= p_start_year)
        and (p_end_year   is null or extract(year from e.event_date) <= p_end_year)
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
$function$;

notify pgrst, 'reload schema';
