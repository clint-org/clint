-- list_intelligence_feed: exclude structural trial-lifecycle markers from the feed.
--
-- Supersedes the narrower metadata.source='ctgov' filter (20260629170000): the seed
-- marks structural markers source='analyst', so provenance missed ~95% of them. The
-- real noise is the trial-lifecycle scaffolding (Trial Start / Trial End / Primary
-- Completion) -- the system "Clinical" category (id d000...001) that drives the phase
-- bars. These are not curated intelligence; they live on the Timeline (phase
-- derivation) and the Activity log. Real readouts (Topline Data) are the "Data"
-- category and stay; Approval / Regulatory / Commercial / LOE / Corporate stay.
--
-- Only the event-leg WHERE clause changes vs 20260629170000. SECURITY INVOKER + RLS.

create or replace function public.list_intelligence_feed(
  p_space_id   uuid,
  p_kinds      text[]      default null,
  p_categories text[]      default null,
  p_since      timestamptz default null,
  p_query      text        default null,
  p_limit      int         default 25,
  p_offset     int         default 0
)
returns jsonb
language plpgsql
stable
security invoker
set search_path = ''
as $$
declare
  v_result jsonb;
  v_query_pattern text;
  -- system "Clinical" category: Trial Start / Trial End / Primary Completion.
  v_structural_clinical constant uuid := 'd0000000-0000-0000-0000-000000000001';
begin
  v_query_pattern := case
    when p_query is null or length(trim(p_query)) = 0 then null
    else '%' || lower(trim(p_query)) || '%'
  end;

  with brief_rows as (
    select
      p.updated_at as feed_ts,
      jsonb_build_object(
        'kind', 'brief',
        'id', p.id,
        'space_id', p.space_id,
        'feed_ts', p.updated_at,
        'title', p.headline,
        'entity_type', a.entity_type,
        'entity_id', a.entity_id,
        'entity_name', null,
        'anchor_id', p.anchor_id,
        'is_lead', a.is_lead,
        'summary_md', p.summary_md,
        'last_edited_by', p.last_edited_by,
        'state', p.state,
        'links', coalesce((
          select jsonb_agg(jsonb_build_object(
            'entity_type', l.entity_type,
            'entity_id', l.entity_id,
            'relationship_type', l.relationship_type,
            'gloss', l.gloss
          ) order by l.display_order, l.created_at)
          from public.primary_intelligence_links l
          where l.primary_intelligence_id = p.id
        ), '[]'::jsonb),
        'contributors', case
          when p.last_edited_by is null then '[]'::jsonb
          else jsonb_build_array(p.last_edited_by)
        end
      ) as row
    from public.primary_intelligence p
    join public.primary_intelligence_anchors a on a.id = p.anchor_id
    where p.space_id = p_space_id
      and a.space_id = p_space_id
      and p.state = 'published'
      and (p_kinds is null or 'brief' = any(p_kinds))
      and (p_since is null or p.updated_at >= p_since)
      and (
        v_query_pattern is null
        or lower(p.headline) like v_query_pattern
        or lower(p.summary_md) like v_query_pattern
      )
  ),
  event_rows as (
    select
      e.created_at as feed_ts,
      jsonb_build_object(
        'kind', 'event',
        'id', e.id,
        'space_id', e.space_id,
        'feed_ts', e.created_at,
        'title', e.title,
        'entity_type', case e.anchor_type when 'asset' then 'product' else e.anchor_type end,
        'entity_id', e.anchor_id,
        'entity_name', coalesce(co.name, a.name, t.name),
        'event_date', e.event_date,
        'date_precision', e.date_precision,
        'end_date', e.end_date,
        'end_date_precision', e.end_date_precision,
        'is_ongoing', e.is_ongoing,
        'projection', e.projection,
        'is_projected', e.is_projected,
        'significance', coalesce(e.significance, et.default_significance),
        'visibility', e.visibility,
        'no_longer_expected', e.no_longer_expected,
        'category_name', ec.name,
        'marker_shape', et.shape,
        'marker_color', et.color,
        'marker_inner_mark', et.inner_mark,
        'marker_fill_style', et.fill_style,
        'anchor_type', e.anchor_type,
        'description', e.description
      ) as row
    from public.events e
    join public.event_types et on et.id = e.event_type_id
    join public.event_type_categories ec on ec.id = et.category_id
    left join public.companies co on e.anchor_type = 'company' and co.id = e.anchor_id
    left join public.assets a on e.anchor_type = 'asset' and a.id = e.anchor_id
    left join public.trials t on e.anchor_type = 'trial' and t.id = e.anchor_id
    where e.space_id = p_space_id
      and (p_kinds is null or 'event' = any(p_kinds))
      -- curated stream: exclude the structural trial-lifecycle markers (Trial Start /
      -- Trial End / Primary Completion = the system Clinical category) that drive the
      -- phase bars. They live on the Timeline + Activity, not the Intelligence feed.
      and et.category_id <> v_structural_clinical
      and (p_since is null or e.created_at >= p_since)
      and (p_categories is null or ec.name = any(p_categories))
      and (
        v_query_pattern is null
        or lower(e.title) like v_query_pattern
        or lower(coalesce(e.description, '')) like v_query_pattern
      )
  ),
  feed as (
    select feed_ts, row from brief_rows
    union all
    select feed_ts, row from event_rows
  ),
  counted as (
    select count(*)::int as total from feed
  ),
  paged as (
    select feed_ts, row from feed
    order by feed_ts desc
    limit greatest(p_limit, 0)
    offset greatest(p_offset, 0)
  )
  select jsonb_build_object(
    'rows', coalesce((select jsonb_agg(row order by feed_ts desc) from paged), '[]'::jsonb),
    'total', (select total from counted),
    'limit', p_limit,
    'offset', p_offset
  )
  into v_result;

  return v_result;
end;
$$;

revoke execute on function public.list_intelligence_feed(uuid, text[], text[], timestamptz, text, int, int) from public, anon;
grant execute on function public.list_intelligence_feed(uuid, text[], text[], timestamptz, text, int, int) to authenticated;

-- in-migration smoke: remote-safe. Asserts the envelope and that no returned event row
-- is in the structural Clinical category, for a space that has data.
do $$
declare v_space uuid; v_res jsonb; v_bad int;
begin
  select space_id into v_space from public.events limit 1;
  if v_space is null then
    select space_id into v_space from public.primary_intelligence limit 1;
  end if;
  if v_space is not null then
    v_res := public.list_intelligence_feed(v_space, array['event'], null, null, null, 500, 0);
    if v_res is null or not (v_res ? 'rows') then
      raise exception 'list_intelligence_feed smoke failed: bad envelope %', v_res;
    end if;
    select count(*) into v_bad
    from jsonb_array_elements(v_res->'rows') r
    join public.event_types et on et.id = (
      select e.event_type_id from public.events e where e.id = (r->>'id')::uuid)
    where et.category_id = 'd0000000-0000-0000-0000-000000000001';
    if v_bad > 0 then
      raise exception 'list_intelligence_feed smoke failed: % structural Clinical rows leaked', v_bad;
    end if;
  end if;
end $$;

notify pgrst, 'reload schema';
