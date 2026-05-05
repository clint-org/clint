-- migration: 20260505200109_intel_link_names
-- purpose: include resolved entity_name on each primary_intelligence link
--          so the read-only intelligence block can render names instead of
--          UUID prefixes and surface clickable affordances.
-- affected: build_intelligence_payload (replaced)

create or replace function public.build_intelligence_payload(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_state       text,
  p_revisions_limit int default 25
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with target as (
    select * from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.entity_type = p_entity_type
      and p.entity_id = p_entity_id
      and p.state = p_state
    order by p.updated_at desc
    limit 1
  )
  select case when t.id is null then null else
    jsonb_build_object(
      'record', jsonb_build_object(
        'id', t.id,
        'space_id', t.space_id,
        'entity_type', t.entity_type,
        'entity_id', t.entity_id,
        'state', t.state,
        'headline', t.headline,
        'thesis_md', t.thesis_md,
        'watch_md', t.watch_md,
        'implications_md', t.implications_md,
        'last_edited_by', t.last_edited_by,
        'created_at', t.created_at,
        'updated_at', t.updated_at
      ),
      'links', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', l.id,
              'entity_type', l.entity_type,
              'entity_id', l.entity_id,
              'entity_name', case l.entity_type
                when 'trial' then (select tr.name from public.trials tr where tr.id = l.entity_id)
                when 'marker' then (select mk.title from public.markers mk where mk.id = l.entity_id)
                when 'company' then (select co.name from public.companies co where co.id = l.entity_id)
                when 'product' then (select pr.name from public.products pr where pr.id = l.entity_id)
                else null
              end,
              'relationship_type', l.relationship_type,
              'gloss', l.gloss,
              'display_order', l.display_order
            )
            order by l.display_order, l.created_at
          )
          from public.primary_intelligence_links l
          where l.primary_intelligence_id = t.id
        ),
        '[]'::jsonb
      ),
      'contributors', coalesce(
        (
          select jsonb_agg(distinct rev.edited_by)
          from public.primary_intelligence_revisions rev
          where rev.primary_intelligence_id = t.id
        ),
        '[]'::jsonb
      ),
      'recent_revisions', coalesce(
        (
          select jsonb_agg(
            jsonb_build_object(
              'id', rev.id,
              'state', rev.state,
              'headline', rev.headline,
              'change_note', rev.change_note,
              'edited_by', rev.edited_by,
              'edited_at', rev.edited_at
            )
            order by rev.edited_at desc
          )
          from (
            select * from public.primary_intelligence_revisions r
            where r.primary_intelligence_id = t.id
            order by r.edited_at desc
            limit p_revisions_limit
          ) rev
        ),
        '[]'::jsonb
      )
    )
  end
  from target t;
$$;

comment on function public.build_intelligence_payload(uuid, text, uuid, text, int) is
  'Returns the full intelligence read for an entity at a given state. Links '
  'include entity_name resolved per entity_type so callers can render names '
  'and clickable affordances without secondary fetches.';
