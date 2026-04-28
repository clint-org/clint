-- migration: 20260428041100_whitelabel_rls_tenants_extend
-- purpose: replace the existing tenants policies with versions that grant:
--   select: any tenant member, agency member of parent agency, platform admin.
--   update: tenant owner, agency owner of parent agency, platform admin.
--   insert: denied directly. provisioning goes through provision_tenant rpc.
--   delete: platform admin only.
-- the previous "authenticated users can create tenants" policy was already
--   dropped in 20260428021559; this just makes sure no equivalent insert policy
--   exists anymore.

drop policy if exists "tenant members can view their tenants" on public.tenants;
drop policy if exists "tenant owners can update their tenants" on public.tenants;
drop policy if exists "tenant owners can delete their tenants" on public.tenants;
drop policy if exists "tenant owners can update tenants" on public.tenants;
drop policy if exists "tenant owners can delete tenants" on public.tenants;
drop policy if exists "authenticated users can create tenants" on public.tenants;

create policy "tenant or agency or platform reads"
on public.tenants for select to authenticated
using (
  public.is_tenant_member(id)
  or (agency_id is not null and public.is_agency_member(agency_id))
  or public.is_platform_admin()
);

create policy "tenant owner or agency owner or platform writes"
on public.tenants for update to authenticated
using (
  public.is_tenant_member(id, array['owner'])
  or (agency_id is not null and public.is_agency_member(agency_id, array['owner']))
  or public.is_platform_admin()
)
with check (
  public.is_tenant_member(id, array['owner'])
  or (agency_id is not null and public.is_agency_member(agency_id, array['owner']))
  or public.is_platform_admin()
);

create policy "platform admins can delete tenants"
on public.tenants for delete to authenticated
using ( public.is_platform_admin() );

-- explicit: no insert policy. clients must call provision_tenant().
