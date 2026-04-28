-- migration: 20260428040800_whitelabel_rls_agencies
-- purpose: rls for the agencies table.
--   select: any agency member, or platform admin.
--   update: agency owners only, or platform admin.
--   insert: denied directly; provisioning goes through provision_agency
--   rpc (security definer, platform admin only).
--   delete: denied for everyone except platform admin (and even they should
--   prefer suspension over deletion to keep retired_hostnames trail clean).

create policy "agency members can read their agency"
on public.agencies for select to authenticated
using ( public.is_agency_member(id) or public.is_platform_admin() );

create policy "agency owners can update their agency"
on public.agencies for update to authenticated
using       ( public.is_agency_member(id, array['owner']) or public.is_platform_admin() )
with check  ( public.is_agency_member(id, array['owner']) or public.is_platform_admin() );

create policy "platform admins can delete agencies"
on public.agencies for delete to authenticated
using ( public.is_platform_admin() );

-- no insert policy: forces all callers through provision_agency()
