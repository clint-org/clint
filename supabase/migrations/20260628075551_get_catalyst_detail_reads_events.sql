-- Repoint get_catalyst_detail at the new events model.
--
-- The old markers / marker_assignments / marker_types / marker_categories
-- tables were dropped in favour of events + event_types + event_type_categories.
-- This rewrite preserves the RPC's return shape (the keys catalyst.service.ts ->
-- CatalystDetail reads) but sources every field from the new model:
--   marker_id              = events.id (the param is now an event id)
--   marker_type_*          = event_types.{name,color,shape,inner_mark}
--   category_name/id       = event_type_categories.name / event_types.category_id
-- The trial / asset / company are resolved from the event's anchor
-- (anchor_type / anchor_id). When anchor_type = 'trial' we walk
-- trials.asset_id -> assets -> companies; for an 'asset' anchor we start at
-- assets; for a 'company' anchor we start at companies; for a 'space' anchor
-- all three are null.
--
-- upcoming_markers and related_events: the prior implementation read these
-- from marker_assignments / the old events.trial_id|asset_id|company_id columns,
-- none of which survive in the new model (events are anchored, not multi-joined).
-- Until those feeds are rebuilt on the events model they return empty arrays.

create or replace function public.get_catalyst_detail(p_marker_id uuid)
returns jsonb
language plpgsql
stable
set search_path to ''
as $function$
declare
  v_catalyst jsonb;
begin
  select
    jsonb_build_object(
      'marker_id',              e.id,
      'source_doc_id',          e.source_doc_id,
      'title',                  e.title,
      'event_date',             e.event_date,
      'date_precision',         e.date_precision,
      'end_date',               e.end_date,
      'end_date_precision',     e.end_date_precision,
      'is_ongoing',             e.is_ongoing,
      'category_name',          ec.name,
      'category_id',            et.category_id,
      'marker_type_name',       et.name,
      'marker_type_color',      et.color,
      'marker_type_shape',      et.shape,
      'marker_type_inner_mark', et.inner_mark,
      'is_projected',           e.is_projected,
      'projection',             e.projection,
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
      'source_url',             e.source_url,
      'metadata',               e.metadata,
      'ctgov_last_synced_at',   t.ctgov_last_synced_at
    )
  into v_catalyst
  from public.events e
  join public.event_types et on et.id = e.event_type_id
  join public.event_type_categories ec on ec.id = et.category_id
  -- Trial anchor: events.anchor_id is the trial id.
  left join public.trials t
    on e.anchor_type = 'trial' and t.id = e.anchor_id
  -- Asset: either the trial's asset, or a direct asset anchor.
  left join public.assets a
    on a.id = coalesce(t.asset_id,
                       case when e.anchor_type = 'asset' then e.anchor_id end)
  -- Company: either the asset's company, or a direct company anchor.
  left join public.companies co
    on co.id = coalesce(a.company_id,
                        case when e.anchor_type = 'company' then e.anchor_id end)
  where e.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  -- upcoming_markers / related_events feeds are not yet rebuilt on the events
  -- model; return empty arrays so the detail panel renders without them.
  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', '[]'::jsonb,
    'related_events',   '[]'::jsonb
  );
end;
$function$;

notify pgrst, 'reload schema';
