-- has_tenant_access: route-guard variant of is_tenant_member that includes
-- "user holds a space_members row for any space in this tenant" as a fourth
-- disjunct.
--
-- Why a separate function:
--   is_tenant_member is used in RLS policies on tenant-level tables (e.g.
--   tenant_members SELECT). Broadening it to include space-only members
--   would let space readers enumerate tenant owners, an info leak. The
--   route-guard variant is intentionally looser: a space-only member should
--   reach /t/:tenantId/s/:spaceId/* for the spaces they belong to.
--
-- Disjuncts (any one is sufficient):
--   1. is_tenant_member(p_tenant_id) returns true (covers explicit
--      tenant_members row, agency-owner of parent agency, platform admin).
--   2. exists a space_members row for auth.uid() on any space whose
--      tenant_id = p_tenant_id (covers pure space-only members).
--
-- Expected use: tenantGuard (route activation only), and the tenant branch
-- of marketingLandingGuard. Not for RLS policies.

create or replace function public.has_tenant_access(
  p_tenant_id uuid
) returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select
    public.is_tenant_member(p_tenant_id)
    or exists (
      select 1
      from public.space_members sm
      join public.spaces s on s.id = sm.space_id
      where s.tenant_id = p_tenant_id
        and sm.user_id = auth.uid()
    );
$$;

revoke execute on function public.has_tenant_access(uuid) from public;
revoke execute on function public.has_tenant_access(uuid) from anon;
grant  execute on function public.has_tenant_access(uuid) to authenticated;

comment on function public.has_tenant_access(uuid) is
  'Route-guard variant of is_tenant_member. Returns true if the caller is a tenant member (explicit, agency-owner of parent, or platform admin) OR holds a space_members row in any space under p_tenant_id. Looser than is_tenant_member by design; use only for route activation, never RLS.';
