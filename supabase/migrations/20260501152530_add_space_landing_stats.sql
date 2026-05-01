-- get_space_landing_stats: returns the five header counts for the
-- engagement landing page in a single round trip:
--   active_trials       trials in p_space_id whose recruitment_status is not
--                       a terminal value (completed / withdrawn / terminated).
--                       trials with null recruitment_status are counted active.
--   companies           distinct company_id referenced by products in the space.
--   programs            count of products in the space.
--   catalysts_90d       count of trial_markers in the space whose event_date
--                       falls between today and today + 90 days (inclusive).
--   intelligence_total  always 0 in phase 1 -- the primary_intelligence table
--                       does not exist yet. wired up in phase 2.
--
-- access: gated on has_space_access(p_space_id). returns null when the
-- caller cannot read the space (matches landscape rpc conventions).
--
-- shape: returns jsonb so the frontend gets a single object back without
-- enumerating columns.
--
-- read more: docs/specs/engagement-landing/spec.md

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
        from public.trial_markers m
        where m.space_id = p_space_id
          and m.event_date between current_date and current_date + interval '90 days'
      ),
      'intelligence_total', 0
    )
  end;
$$;

revoke execute on function public.get_space_landing_stats(uuid) from public;
revoke execute on function public.get_space_landing_stats(uuid) from anon;
grant  execute on function public.get_space_landing_stats(uuid) to authenticated;

comment on function public.get_space_landing_stats(uuid) is
  'Returns the engagement landing context-strip stats for a space: active_trials, companies, programs, catalysts_90d, intelligence_total. Gated on has_space_access. intelligence_total is always 0 in phase 1; the primary_intelligence table is not yet shipped.';
