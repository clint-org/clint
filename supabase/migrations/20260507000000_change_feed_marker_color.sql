-- =============================================================================
-- migration: add marker_color to activity-feed RPCs
--
-- The what-changed widget and activity page render rows whose color reflects
-- the existing marker / phase taxonomies (see
-- docs/superpowers/specs/2026-05-02-trial-change-feed-design.md and the deck
-- src/client/public/internal/what-changed-row-options.html, treatment C5).
-- For marker_* events, color = marker_types.color. The RPCs already join
-- markers and marker_changes to resolve marker_title; this migration adds the
-- color resolution alongside, with the same deleted-marker fallback through
-- marker_changes so historical events keep their hue.
--
-- Phase colors stay client-side (PHASE_COLORS in phase-colors.ts) -- they
-- derive from payload.to and don't need a DB join.
-- =============================================================================

create or replace function public.get_activity_feed(
  p_space_id              uuid,
  p_filters               jsonb       default '{}'::jsonb,
  p_cursor_observed_at    timestamptz default null,
  p_cursor_id             uuid        default null,
  p_limit                 int         default 50
) returns setof jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_event_types  text[];
  v_sources      text[];
  v_trial_ids    uuid[];
  v_date_range   text;
  v_whitelist    text;
  v_since        timestamptz;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_event_types := case
    when p_filters ? 'event_types'
      then array(select jsonb_array_elements_text(p_filters -> 'event_types'))
    else null
  end;
  v_sources := case
    when p_filters ? 'sources'
      then array(select jsonb_array_elements_text(p_filters -> 'sources'))
    else null
  end;
  v_trial_ids := case
    when p_filters ? 'trial_ids'
      then array(select (jsonb_array_elements_text(p_filters -> 'trial_ids'))::uuid)
    else null
  end;
  v_date_range := p_filters ->> 'date_range';
  v_whitelist  := p_filters ->> 'whitelist';

  v_since := case v_date_range
    when '7d'  then now() - interval '7 days'
    when '30d' then now() - interval '30 days'
    when 'all' then null
    else null
  end;

  return query
    select jsonb_build_object(
      'id',               e.id,
      'trial_id',         e.trial_id,
      'space_id',         e.space_id,
      'event_type',       e.event_type,
      'source',           e.source,
      'payload',          e.payload,
      'occurred_at',      e.occurred_at,
      'observed_at',      e.observed_at,
      'marker_id',        e.marker_id,
      'trial_name',       t.name,
      'trial_identifier', t.identifier,
      'marker_title',     coalesce(
        m.title,
        case
          when mc.change_type in ('created', 'updated')
            then mc.new_values ->> 'title'
          when mc.change_type = 'deleted'
            then mc.old_values ->> 'title'
          else null
        end
      ),
      'marker_color', mt.color
    )
      from public.trial_change_events e
      join public.trials t on t.id = e.trial_id
      left join public.markers m on m.id = e.marker_id
      left join public.marker_changes mc on mc.id = e.derived_from_marker_change_id
      left join public.marker_types mt on mt.id = coalesce(
        m.marker_type_id,
        case
          when mc.change_type in ('created', 'updated')
            then nullif(mc.new_values ->> 'marker_type_id', '')::uuid
          when mc.change_type = 'deleted'
            then nullif(mc.old_values ->> 'marker_type_id', '')::uuid
          else null
        end
      )
     where e.space_id = p_space_id
       and (
         p_cursor_observed_at is null
         or e.observed_at < p_cursor_observed_at
         or (e.observed_at = p_cursor_observed_at and (p_cursor_id is null or e.id < p_cursor_id))
       )
       and (v_event_types is null or e.event_type = any(v_event_types))
       and (v_sources is null or e.source = any(v_sources))
       and (v_trial_ids is null or e.trial_id = any(v_trial_ids))
       and (v_since is null or e.observed_at >= v_since)
       and (
         v_whitelist is null
         or (
           v_whitelist = 'high_signal'
           and (
             (e.event_type = 'date_moved' and (e.payload ->> 'days_diff')::int > 90)
             or e.event_type = 'phase_transitioned'
             or (e.event_type = 'status_changed'
                 and (e.payload ->> 'to') in ('COMPLETED', 'TERMINATED', 'WITHDRAWN', 'SUSPENDED'))
             or e.event_type = 'sponsor_changed'
             or e.event_type = 'trial_withdrawn'
           )
         )
       )
     order by e.observed_at desc, e.id desc
     limit p_limit + 1;
end;
$$;

comment on function public.get_activity_feed(uuid, jsonb, timestamptz, uuid, int) is
  'Paged unified change feed for one space. Returns event rows joined to trial name+identifier, marker title, and marker_color (from marker_types.color, with marker_changes fallback for deleted markers). SECURITY INVOKER; raises 42501 if caller lacks has_space_access.';

create or replace function public.get_trial_activity(
  p_trial_id uuid,
  p_limit    int default 25
) returns setof jsonb
language plpgsql
security invoker
stable
set search_path = public
as $$
declare
  v_space_id uuid;
begin
  select space_id into v_space_id
    from public.trials
   where id = p_trial_id;

  if v_space_id is null then
    raise exception 'trial not found' using errcode = '02000';
  end if;

  if not public.has_space_access(v_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  return query
    select jsonb_build_object(
      'id',               e.id,
      'trial_id',         e.trial_id,
      'space_id',         e.space_id,
      'event_type',       e.event_type,
      'source',           e.source,
      'payload',          e.payload,
      'occurred_at',      e.occurred_at,
      'observed_at',      e.observed_at,
      'marker_id',        e.marker_id,
      'trial_name',       t.name,
      'trial_identifier', t.identifier,
      'marker_title',     coalesce(
        m.title,
        case
          when mc.change_type in ('created', 'updated')
            then mc.new_values ->> 'title'
          when mc.change_type = 'deleted'
            then mc.old_values ->> 'title'
          else null
        end
      ),
      'marker_color', mt.color
    )
      from public.trial_change_events e
      join public.trials t on t.id = e.trial_id
      left join public.markers m on m.id = e.marker_id
      left join public.marker_changes mc on mc.id = e.derived_from_marker_change_id
      left join public.marker_types mt on mt.id = coalesce(
        m.marker_type_id,
        case
          when mc.change_type in ('created', 'updated')
            then nullif(mc.new_values ->> 'marker_type_id', '')::uuid
          when mc.change_type = 'deleted'
            then nullif(mc.old_values ->> 'marker_type_id', '')::uuid
          else null
        end
      )
     where e.trial_id = p_trial_id
     order by e.observed_at desc, e.id desc
     limit p_limit;
end;
$$;

comment on function public.get_trial_activity(uuid, int) is
  'Recent change events for one trial; same row shape as get_activity_feed. Includes marker_color from marker_types.color (with marker_changes fallback for deleted markers). SECURITY INVOKER; raises 02000 if trial not found, 42501 if caller lacks has_space_access on the trial''s space.';
