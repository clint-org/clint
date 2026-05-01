-- Phase 2 wiring of the engagement landing.
--
-- Two changes:
--
-- 1. get_space_landing_stats now counts published primary_intelligence rows
--    for the intelligence_total stat (was hardcoded to 0 in phase 1, before
--    the primary_intelligence table existed).
--
-- 2. list_draft_intelligence_for_space returns the most recent drafts
--    visible to the caller in a single space. RLS gates draft visibility to
--    agency members only (see policy primary_intelligence_view_drafts in
--    20260501113857_primary_intelligence.sql), so this RPC is naturally
--    agency-only at the row level even though it is callable by any
--    authenticated user.
--
-- read more: docs/specs/engagement-landing/spec.md (Your drafts widget,
-- Latest from Stout, intelligence_total stat).

create or replace function public.get_space_landing_stats(
  p_space_id uuid
) returns jsonb
language sql
security definer
stable
set search_path = ''
as $$
  select case
    when not public.has_space_access(p_space_id) then null
    else jsonb_build_object(
      'active_trials', (
        select count(*)::int
        from public.trials t
        where t.space_id = p_space_id
          and (
            t.recruitment_status is null
            or lower(t.recruitment_status) not in (
              'completed',
              'withdrawn',
              'terminated'
            )
          )
      ),
      'companies', (
        select count(distinct p.company_id)::int
        from public.products p
        where p.space_id = p_space_id
          and p.company_id is not null
      ),
      'programs', (
        select count(*)::int
        from public.products p
        where p.space_id = p_space_id
      ),
      'catalysts_90d', (
        select count(*)::int
        from public.markers m
        where m.space_id = p_space_id
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'intelligence_total', (
        select count(*)::int
        from public.primary_intelligence pi
        where pi.space_id = p_space_id
          and pi.state = 'published'
      )
    )
  end;
$$;

comment on function public.get_space_landing_stats(uuid) is
  'Returns the engagement landing context-strip stats for a space: active_trials, companies, programs, catalysts_90d, intelligence_total. Gated on has_space_access. intelligence_total counts published rows in primary_intelligence.';

-- list_draft_intelligence_for_space
-- Returns the most recently edited draft rows for a space, recency-ordered.
-- RLS on primary_intelligence (policy primary_intelligence_view_drafts)
-- restricts visibility to agency members. Non-agency callers see an empty
-- result without an error.
create or replace function public.list_draft_intelligence_for_space(
  p_space_id uuid,
  p_limit    int default 3
) returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  select coalesce(jsonb_agg(row_data order by updated_at desc), '[]'::jsonb)
  from (
    select
      jsonb_build_object(
        'id', p.id,
        'space_id', p.space_id,
        'entity_type', p.entity_type,
        'entity_id', p.entity_id,
        'state', p.state,
        'headline', p.headline,
        'thesis_md', p.thesis_md,
        'last_edited_by', p.last_edited_by,
        'updated_at', p.updated_at,
        'links', '[]'::jsonb,
        'contributors', (
          select coalesce(jsonb_agg(distinct rev.edited_by::text), '[]'::jsonb)
          from public.primary_intelligence_revisions rev
          where rev.primary_intelligence_id = p.id
        )
      ) as row_data,
      p.updated_at
    from public.primary_intelligence p
    where p.space_id = p_space_id
      and p.state = 'draft'
    order by p.updated_at desc
    limit p_limit
  ) ordered;
$$;

revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from public;
revoke execute on function public.list_draft_intelligence_for_space(uuid, int) from anon;
grant  execute on function public.list_draft_intelligence_for_space(uuid, int) to authenticated;

comment on function public.list_draft_intelligence_for_space(uuid, int) is
  'Returns up to p_limit draft primary_intelligence rows for a space, recency-ordered. RLS gates draft visibility to agency members; non-agency callers see an empty array. Used by the engagement landing drafts widget.';
