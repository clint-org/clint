-- migration: 20260428040600_whitelabel_update_is_tenant_member
-- purpose: extend is_tenant_member with two new disjuncts -- agency owner
--   of the parent agency (full access regardless of p_roles) and platform
--   admin (always passes for read-style checks). preserves the existing
--   tenant_members semantics; layers cross-tenant access on top.
-- note: agency members (non-owner) intentionally do NOT pass is_tenant_member,
--   since this helper is used both for read and write checks. write-side
--   semantics for agency members are read-only via has_space_access.

create or replace function public.is_tenant_member(
  p_tenant_id uuid,
  p_roles     text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    -- explicit tenant membership
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
      and (p_roles is null or tm.role = any(p_roles))
  )
  or exists (
    -- agency owner of the tenant's parent agency: full access
    select 1
      from public.tenants t
      join public.agency_members am on am.agency_id = t.agency_id
     where t.id          = p_tenant_id
       and am.user_id    = auth.uid()
       and am.role       = 'owner'
  )
  or public.is_platform_admin();
$$;

comment on function public.is_tenant_member(uuid, text[]) is
  'RLS helper. True if the calling user (a) is an explicit tenant_member '
  'with one of p_roles, (b) is an owner of the tenant''s parent agency, '
  'or (c) is a platform admin. Agency *members* (non-owner) do not pass '
  'this check; their read-only access is granted via has_space_access.';
