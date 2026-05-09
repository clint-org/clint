-- migration: 20260509120200_advisor_sweep_multiple_permissive_policies
-- purpose: clear the 3 `multiple_permissive_policies` warnings reported by
--   the Supabase advisor (Splinter rule 0006). when more than one
--   permissive policy applies to the same (table, role, action) tuple,
--   Postgres OR's them together at the planner stage AND evaluates each
--   policy on every row, multiplying RLS overhead.
--
-- approach:
--   - agency_invites SELECT: two policies merge cleanly into one with OR.
--   - primary_intelligence SELECT: two state-conditional policies merge
--     into one with OR.
--   - material_links: a SELECT-only `view` policy and an ALL-scope `write`
--     policy both applied to SELECT. split the `write` policy into
--     INSERT / UPDATE / DELETE so SELECT has only one applicable policy.
--
-- net semantics: identical access in every case. only the policy count
-- per (table, role, action) drops to 1.

-- =============================================================================
-- agency_invites: merge two SELECT policies
-- =============================================================================
drop policy if exists "agency owners can view own agency invites" on public.agency_invites;
drop policy if exists "platform admins can view all agency invites" on public.agency_invites;

create policy "agency_invites read"
  on public.agency_invites
  for select
  to authenticated
  using (
    public.is_agency_member(agency_id, array['owner'::text])
    or public.is_platform_admin()
  );

-- =============================================================================
-- material_links: split `write` ALL into INSERT / UPDATE / DELETE so the
--   SELECT-only `view` policy is the sole policy applied to reads.
--   `material_links write` was just recreated by 20260509120000 with the
--   (select auth.uid()) wrapper -- we drop that and replace with three
--   targeted policies that keep the wrapper.
-- =============================================================================
drop policy if exists "material_links write" on public.material_links;

create policy "material_links insert"
  on public.material_links
  for insert
  to authenticated
  with check (
    exists (
      select 1
        from public.materials m
       where m.id = material_links.material_id
         and m.uploaded_by = (select auth.uid())
    )
  );

create policy "material_links update"
  on public.material_links
  for update
  to authenticated
  using (
    exists (
      select 1
        from public.materials m
       where m.id = material_links.material_id
         and m.uploaded_by = (select auth.uid())
    )
  )
  with check (
    exists (
      select 1
        from public.materials m
       where m.id = material_links.material_id
         and m.uploaded_by = (select auth.uid())
    )
  );

create policy "material_links delete"
  on public.material_links
  for delete
  to authenticated
  using (
    exists (
      select 1
        from public.materials m
       where m.id = material_links.material_id
         and m.uploaded_by = (select auth.uid())
    )
  );

-- =============================================================================
-- primary_intelligence: merge two state-conditional SELECT policies
-- =============================================================================
drop policy if exists "primary_intelligence drafts readable to agency" on public.primary_intelligence;
drop policy if exists "primary_intelligence published readable in space" on public.primary_intelligence;

create policy "primary_intelligence read"
  on public.primary_intelligence
  for select
  to authenticated
  using (
    (state = 'draft'     and public.is_agency_member_of_space(space_id))
    or
    (state = 'published' and public.has_space_access(space_id))
  );
