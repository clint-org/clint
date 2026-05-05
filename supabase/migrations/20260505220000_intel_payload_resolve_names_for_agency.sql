-- migration: 20260505173700_intel_payload_resolve_names_for_agency
-- purpose: build_intelligence_payload returned entity_name = null for agency
--          users who can author intelligence but have no space_members row
--          (the agency-only and agency-owner personas in production: they
--          author for tenants but aren't direct space members). Cause: the
--          function was security invoker, so the per-link
--          (select tr.name from public.trials tr where tr.id = ...) subquery
--          was filtered by trials' RLS, which requires has_space_access -- a
--          gate agency-only personas don't pass.
-- approach: security definer, with an explicit access gate at the top that
--          mirrors the primary_intelligence read RLS (agency member can read
--          either state; space member can read published only). The rest of
--          the body runs without RLS interference, so entity_name resolves
--          for every caller who was already entitled to the read.

create or replace function public.build_intelligence_payload(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid,
  p_state       text,
  p_revisions_limit int default 25
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_can_read boolean;
begin
  -- Mirror the primary_intelligence read policies. Without this gate the
  -- function would widen access (security definer bypasses RLS).
  v_can_read := public.is_agency_member_of_space(p_space_id)
                or (p_state = 'published' and public.has_space_access(p_space_id));
  if not v_can_read then
    return null;
  end if;

  return (
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
                'changed_fields', rev.changed_fields,
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
    from target t
  );
end;
$$;

comment on function public.build_intelligence_payload(uuid, text, uuid, text, int) is
  'Returns the full intelligence read for an entity at a given state. '
  'Security definer: gates access at the top to match primary_intelligence '
  'read RLS, then resolves linked entity_name without RLS interference so '
  'agency authors see names regardless of space_members status.';
