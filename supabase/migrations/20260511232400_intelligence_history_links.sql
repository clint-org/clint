-- =============================================================================
-- intelligence history: include links per version
-- =============================================================================
--
-- The history panel's diff view renders changes against the previous version.
-- Without links per snapshot, the diff can only compare text fields
-- (headline / thesis / watch / implications). Edits that touch only the
-- Linked entities picker render as an empty diff, which reads as "nothing
-- changed" even though the read meaningfully changed.
--
-- This migration extends get_primary_intelligence_history so each version
-- in the returned `versions[]` carries its links array. The shape mirrors
-- what build_intelligence_payload returns for the live record: each link
-- carries entity_type, entity_id, relationship_type, gloss, display_order,
-- and the resolved entity_name from the target table (or null if the
-- target row no longer exists). The frontend uses this to render an added
-- / removed / changed list under the existing diff sections.
--
-- Switching to security definer (with an explicit access gate that mirrors
-- the prior security-invoker filter on primary_intelligence) so the
-- entity_name resolution works for agency-only personas who can author
-- intelligence but lack a space_members row -- same fix shape as
-- 20260505220000_intel_payload_resolve_names_for_agency.

create or replace function public.get_primary_intelligence_history(
  p_space_id    uuid,
  p_entity_type text,
  p_entity_id   uuid
) returns jsonb
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
                or public.has_space_access(p_space_id);
  if not v_can_read then
    return null;
  end if;

  return (
    with rows as (
      select * from public.primary_intelligence p
       where p.space_id    = p_space_id
         and p.entity_type = p_entity_type
         and p.entity_id   = p_entity_id
    ),
    current_row as (
      select * from rows where state = 'published' limit 1
    ),
    draft_row as (
      select * from rows where state = 'draft' order by updated_at desc limit 1
    ),
    versions as (
      select * from rows where state in ('published','archived','withdrawn')
    ),
    versions_with_base as (
      select v.*,
             (
               select v2.id
                 from versions v2
                where v2.version_number < v.version_number
                  and v2.published_at is not null
                  and v2.withdrawn_at is null
                order by v2.version_number desc
                limit 1
             ) as diff_base_id
        from versions v
    ),
    version_links as (
      select
        l.primary_intelligence_id as row_id,
        jsonb_agg(
          jsonb_build_object(
            'entity_type',       l.entity_type,
            'entity_id',         l.entity_id,
            'entity_name', case l.entity_type
              when 'trial'   then (select tr.name  from public.trials    tr where tr.id = l.entity_id)
              when 'marker'  then (select mk.title from public.markers   mk where mk.id = l.entity_id)
              when 'company' then (select co.name  from public.companies co where co.id = l.entity_id)
              when 'product' then (select pr.name  from public.products  pr where pr.id = l.entity_id)
              else null
            end,
            'relationship_type', l.relationship_type,
            'gloss',             l.gloss,
            'display_order',     l.display_order
          )
          order by l.display_order, l.created_at
        ) as links
      from public.primary_intelligence_links l
      join versions_with_base v on v.id = l.primary_intelligence_id
      group by l.primary_intelligence_id
    ),
    events as (
      select created_at as at, 'draft_started'::text as kind, id as row_id,
             null::int as version_number, last_edited_by as by, null::text as note
        from rows
      union all
      select published_at, 'published', id, version_number, published_by, publish_note
        from rows where published_at is not null
      union all
      select archived_at, 'archived', id, version_number, null, null
        from rows where archived_at is not null
      union all
      select withdrawn_at, 'withdrawn', id, version_number, withdrawn_by, withdraw_note
        from rows where withdrawn_at is not null
    )
    select jsonb_build_object(
      'current', (select to_jsonb(c) from current_row c),
      'draft',   (select to_jsonb(d) from draft_row d),
      'versions', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'id',              v.id,
            'version_number',  v.version_number,
            'state',           v.state,
            'headline',        v.headline,
            'thesis_md',       v.thesis_md,
            'watch_md',        v.watch_md,
            'implications_md', v.implications_md,
            'publish_note',    v.publish_note,
            'published_at',    v.published_at,
            'published_by',    v.published_by,
            'archived_at',     v.archived_at,
            'withdrawn_at',    v.withdrawn_at,
            'withdrawn_by',    v.withdrawn_by,
            'withdraw_note',   v.withdraw_note,
            'diff_base_id',    v.diff_base_id,
            'links',           coalesce(vl.links, '[]'::jsonb)
          )
          order by v.version_number desc
        )
          from versions_with_base v
          left join version_links vl on vl.row_id = v.id
        ),
        '[]'::jsonb
      ),
      'events', coalesce(
        (select jsonb_agg(
          jsonb_build_object(
            'at',             e.at,
            'kind',           e.kind,
            'row_id',         e.row_id,
            'version_number', e.version_number,
            'by',             e.by,
            'note',           e.note
          )
          order by
            e.at asc,
            case e.kind
              when 'draft_started' then 0
              when 'published'     then 1
              when 'archived'      then 2
              when 'withdrawn'     then 3
            end
        ) from events e),
        '[]'::jsonb
      )
    )
  );
end;
$$;

revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from public;
revoke execute on function public.get_primary_intelligence_history(uuid, text, uuid) from anon;
grant  execute on function public.get_primary_intelligence_history(uuid, text, uuid) to authenticated;
