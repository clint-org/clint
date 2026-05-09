-- migration: 20260509120000_advisor_sweep_auth_uid_initplan
-- purpose: clear all 11 `auth_rls_initplan` warnings reported by the
--   Supabase advisor (Splinter rule 0003). every flagged policy calls
--   auth.uid() directly inside USING / WITH CHECK; Postgres re-evaluates
--   the function once per row instead of once per query. wrapping it as
--   (select auth.uid()) lets the planner cache the value.
--
-- semantics: each policy is dropped and recreated with the same predicate,
--   the same role, the same command, and the same name. the only change
--   is auth.uid() -> (select auth.uid()). source-of-truth for predicates
--   is pg_policies on a fresh `supabase db reset` of this branch.
--
-- affected policies (11):
--   public.ctgov_sync_runs   :: ctgov_sync_runs_select
--   public.material_links    :: material_links write
--   public.materials         :: materials insert / update / delete   (3)
--   public.palette_pinned    :: palette_pinned_owner
--   public.palette_recents   :: palette_recents_owner
--   public.space_invites     :: space owners can read invites
--   public.space_members     :: users can add space members
--   public.tenant_members    :: users can add tenant members
--   public.tenants           :: tenant or agency or platform or space-member reads

-- =============================================================================
-- ctgov_sync_runs
-- =============================================================================
drop policy if exists "ctgov_sync_runs_select" on public.ctgov_sync_runs;
create policy "ctgov_sync_runs_select"
  on public.ctgov_sync_runs
  for select
  to authenticated
  using ((select auth.uid()) is not null);

-- =============================================================================
-- material_links
-- =============================================================================
drop policy if exists "material_links write" on public.material_links;
create policy "material_links write"
  on public.material_links
  for all
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

-- =============================================================================
-- materials (insert / update / delete)
-- =============================================================================
drop policy if exists "materials insert" on public.materials;
create policy "materials insert"
  on public.materials
  for insert
  to authenticated
  with check (
    public.has_space_access(space_id) and uploaded_by = (select auth.uid())
  );

drop policy if exists "materials update" on public.materials;
create policy "materials update"
  on public.materials
  for update
  to authenticated
  using (
    public.has_space_access(space_id) and uploaded_by = (select auth.uid())
  )
  with check (
    public.has_space_access(space_id) and uploaded_by = (select auth.uid())
  );

drop policy if exists "materials delete" on public.materials;
create policy "materials delete"
  on public.materials
  for delete
  to authenticated
  using (
    public.has_space_access(space_id) and uploaded_by = (select auth.uid())
  );

-- =============================================================================
-- palette_pinned / palette_recents (role: public)
-- =============================================================================
drop policy if exists "palette_pinned_owner" on public.palette_pinned;
create policy "palette_pinned_owner"
  on public.palette_pinned
  for all
  to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

drop policy if exists "palette_recents_owner" on public.palette_recents;
create policy "palette_recents_owner"
  on public.palette_recents
  for all
  to public
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

-- =============================================================================
-- space_invites
-- =============================================================================
drop policy if exists "space owners can read invites" on public.space_invites;
create policy "space owners can read invites"
  on public.space_invites
  for select
  to authenticated
  using (
    exists (
      select 1
        from public.space_members sm
       where sm.space_id = space_invites.space_id
         and sm.user_id = (select auth.uid())
         and sm.role = 'owner'
    )
    or public.is_platform_admin()
  );

-- =============================================================================
-- space_members
-- =============================================================================
drop policy if exists "users can add space members" on public.space_members;
create policy "users can add space members"
  on public.space_members
  for insert
  to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and not exists (
        select 1
          from public.space_members existing
         where existing.space_id = space_members.space_id
      )
    )
    or public.has_space_access(space_id, array['owner'::text])
  );

-- =============================================================================
-- tenant_members
-- =============================================================================
drop policy if exists "users can add tenant members" on public.tenant_members;
create policy "users can add tenant members"
  on public.tenant_members
  for insert
  to authenticated
  with check (
    (
      user_id = (select auth.uid())
      and not exists (
        select 1
          from public.tenant_members existing
         where existing.tenant_id = tenant_members.tenant_id
      )
    )
    or public.is_tenant_member(tenant_id, array['owner'::text])
  );

-- =============================================================================
-- tenants
-- =============================================================================
drop policy if exists "tenant or agency or platform or space-member reads" on public.tenants;
create policy "tenant or agency or platform or space-member reads"
  on public.tenants
  for select
  to authenticated
  using (
    public.is_tenant_member(id)
    or (agency_id is not null and public.is_agency_member(agency_id))
    or public.is_platform_admin()
    or exists (
      select 1
        from public.space_members sm
        join public.spaces s on s.id = sm.space_id
       where s.tenant_id = tenants.id
         and sm.user_id = (select auth.uid())
    )
  );
