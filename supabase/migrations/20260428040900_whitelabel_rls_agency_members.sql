-- migration: 20260428040900_whitelabel_rls_agency_members
-- purpose: rls for agency_members.
--   select: fellow members of the same agency, or platform admin.
--   insert/update/delete: agency owners (of that agency), or platform admin.

create policy "agency members can read fellow members"
on public.agency_members for select to authenticated
using ( public.is_agency_member(agency_id) or public.is_platform_admin() );

create policy "agency owners can add members"
on public.agency_members for insert to authenticated
with check ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );

create policy "agency owners can update members"
on public.agency_members for update to authenticated
using      ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() )
with check ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );

create policy "agency owners can remove members"
on public.agency_members for delete to authenticated
using ( public.is_agency_member(agency_id, array['owner']) or public.is_platform_admin() );
