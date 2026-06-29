-- migration: 20260629190000_event_detail_upcoming_recent_markers
-- purpose: populate the upcoming_markers / recent_markers context lists on
--          get_event_detail. The event-model rewrite left these as empty `[]`
--          stubs, so the marker detail pane's "Upcoming events" section never
--          rendered even though the template was built for it. This restores
--          the program-context lists, mirroring the bullseye entity drawer's
--          symmetric Upcoming/Recent split.
--
-- scope: the lists follow the clicked event's narrowest meaningful anchor,
--        which is already inside a focus-scoped space:
--          - trial- or asset-anchored event  -> the parent ASSET (all its
--            trials' events roll up, so a trial milestone shows the whole
--            program's road ahead, not just that one trial)
--          - company-anchored event           -> that COMPANY
--          - space/industry event             -> the SPACE
--        upcoming = future events (event_date >= today), soonest first;
--        recent   = past events, most-recent first. Each capped at 5, hidden
--        events excluded, the clicked event itself excluded.
--
-- security: SECURITY INVOKER (unchanged) so the context lists are filtered by
--           the caller's RLS exactly like the main row.

create or replace function public.get_event_detail(
  p_event_id uuid
)
returns jsonb
language plpgsql
stable
set search_path = ''
as $$
declare
  v_event jsonb;
  v_asset_id uuid;
  v_company_id uuid;
  v_space_id uuid;
  v_upcoming jsonb;
  v_recent jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              e.id,
      'event_id',              e.id,
      'space_id',               e.space_id,
      'source_doc_id',          e.source_doc_id,
      'title',                  e.title,
      'event_date',             e.event_date,
      'date_precision',         e.date_precision,
      'end_date',               e.end_date,
      'end_date_precision',     e.end_date_precision,
      'is_ongoing',             e.is_ongoing,
      'category_name',          ec.name,
      'category_id',            et.category_id,
      'event_type_id',          e.event_type_id,
      'marker_type_name',       et.name,
      'marker_type_color',      et.color,
      'marker_type_shape',      et.shape,
      'marker_type_inner_mark', et.inner_mark,
      'anchor_type',            e.anchor_type,
      'anchor_id',              e.anchor_id,
      'projection',             e.projection,
      'significance',           e.significance,
      'visibility',             e.visibility,
      'no_longer_expected',     e.no_longer_expected,
      'company_name',           co.name,
      'company_id',             co.id,
      'company_logo_url',       co.logo_url,
      'asset_name',             a.name,
      'asset_id',               a.id,
      'trial_name',             t.name,
      'trial_acronym',          t.acronym,
      'trial_id',               t.id,
      'trial_phase',            t.phase,
      'recruitment_status',     t.recruitment_status,
      'description',            e.description,
      'sources', (
        select coalesce(
          jsonb_agg(jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label)
                    order by es.sort_order, es.created_at),
          '[]'::jsonb)
        from public.event_sources es where es.event_id = e.id
      ),
      'registry_url', case
        when e.anchor_type = 'trial' then public.event_registry_url(t.identifier)
        else null
      end,
      'metadata',               e.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at,
      'created_at',             e.created_at,
      'updated_at',             e.updated_at
    ),
    -- Resolved scope anchors for the upcoming/recent context lists.
    a.id,
    co.id,
    e.space_id
  into v_event, v_asset_id, v_company_id, v_space_id
  from public.events e
  join public.event_types et on et.id = e.event_type_id
  join public.event_type_categories ec on ec.id = et.category_id
  left join public.trials t
    on e.anchor_type = 'trial' and t.id = e.anchor_id
  left join public.assets a
    on a.id = coalesce(t.asset_id,
                       case when e.anchor_type = 'asset' then e.anchor_id end)
  left join public.companies co
    on co.id = coalesce(a.company_id,
                        case when e.anchor_type = 'company' then e.anchor_id end)
  where e.id = p_event_id;

  if v_event is null then
    return null;
  end if;

  -- Upcoming: future events sharing the clicked event's anchor, soonest first.
  select coalesce(jsonb_agg(s.row order by s.event_date asc), '[]'::jsonb)
  into v_upcoming
  from (
    select
      jsonb_build_object(
        'marker_id',              e2.id,
        'title',                  e2.title,
        'event_date',             e2.event_date,
        'marker_type_name',       et2.name,
        'marker_type_color',      et2.color,
        'marker_type_shape',      et2.shape,
        'marker_type_inner_mark', et2.inner_mark,
        'is_projected',           (e2.projection is distinct from 'actual'),
        'projection',             e2.projection,
        'no_longer_expected',     e2.no_longer_expected
      ) as row,
      e2.event_date
    from public.events e2
    join public.event_types et2 on et2.id = e2.event_type_id
    left join public.trials t2 on e2.anchor_type = 'trial' and t2.id = e2.anchor_id
    left join public.assets a2
      on a2.id = coalesce(t2.asset_id,
                          case when e2.anchor_type = 'asset' then e2.anchor_id end)
    where e2.id <> p_event_id
      and e2.event_date >= current_date
      and coalesce(e2.visibility, '') <> 'hidden'
      and case
            when v_asset_id is not null then
              coalesce(t2.asset_id,
                       case when e2.anchor_type = 'asset' then e2.anchor_id end) = v_asset_id
            when v_company_id is not null then
              coalesce(a2.company_id,
                       case when e2.anchor_type = 'company' then e2.anchor_id end) = v_company_id
            else e2.space_id = v_space_id
          end
    order by e2.event_date asc
    limit 5
  ) s;

  -- Recent: past events sharing the same anchor, most-recent first.
  select coalesce(jsonb_agg(s.row order by s.event_date desc), '[]'::jsonb)
  into v_recent
  from (
    select
      jsonb_build_object(
        'marker_id',              e2.id,
        'title',                  e2.title,
        'event_date',             e2.event_date,
        'marker_type_name',       et2.name,
        'marker_type_color',      et2.color,
        'marker_type_shape',      et2.shape,
        'marker_type_inner_mark', et2.inner_mark,
        'is_projected',           (e2.projection is distinct from 'actual'),
        'projection',             e2.projection,
        'no_longer_expected',     e2.no_longer_expected
      ) as row,
      e2.event_date
    from public.events e2
    join public.event_types et2 on et2.id = e2.event_type_id
    left join public.trials t2 on e2.anchor_type = 'trial' and t2.id = e2.anchor_id
    left join public.assets a2
      on a2.id = coalesce(t2.asset_id,
                          case when e2.anchor_type = 'asset' then e2.anchor_id end)
    where e2.id <> p_event_id
      and e2.event_date < current_date
      and coalesce(e2.visibility, '') <> 'hidden'
      and case
            when v_asset_id is not null then
              coalesce(t2.asset_id,
                       case when e2.anchor_type = 'asset' then e2.anchor_id end) = v_asset_id
            when v_company_id is not null then
              coalesce(a2.company_id,
                       case when e2.anchor_type = 'company' then e2.anchor_id end) = v_company_id
            else e2.space_id = v_space_id
          end
    order by e2.event_date desc
    limit 5
  ) s;

  return jsonb_build_object(
    'catalyst',         v_event,
    'upcoming_markers', v_upcoming,
    'recent_markers',   v_recent,
    'related_events',   '[]'::jsonb
  );
end;
$$;

notify pgrst, 'reload schema';
