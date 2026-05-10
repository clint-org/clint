-- migration: 20260509130050_intelligence_history_rls
-- purpose: extend the SELECT RLS on primary_intelligence so archived and
--   withdrawn rows are visible to anyone with space access. Required for
--   get_primary_intelligence_history to return prior versions; otherwise
--   they're filtered out by RLS for security-invoker readers.
--
-- Note: 20260509120200_advisor_sweep_multiple_permissive_policies merged
-- the original two SELECT policies into a single "primary_intelligence read"
-- policy. We replace that consolidated policy here, keeping a single SELECT
-- policy (avoiding the multiple-permissive-policies advisor warning) while
-- adding archived/withdrawn visibility for space members.

drop policy if exists "primary_intelligence published readable in space"
  on public.primary_intelligence;
drop policy if exists "primary_intelligence drafts readable to agency"
  on public.primary_intelligence;
drop policy if exists "primary_intelligence read"
  on public.primary_intelligence;
drop policy if exists "primary_intelligence non-draft readable in space"
  on public.primary_intelligence;

create policy "primary_intelligence read"
on public.primary_intelligence for select to authenticated
using (
  (state = 'draft' and public.is_agency_member_of_space(space_id))
  or
  (state in ('published','archived','withdrawn') and public.has_space_access(space_id))
);
