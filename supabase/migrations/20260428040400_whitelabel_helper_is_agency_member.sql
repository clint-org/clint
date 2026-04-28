-- migration: 20260428040400_whitelabel_helper_is_agency_member
-- purpose: rls helper. mirrors is_tenant_member's shape. returns true if
--   the calling user is a member of the given agency, optionally filtered
--   by role. used by tenant rls (any agency member can read all tenants in
--   their agency; only owners can write) and by agency rls.

create or replace function public.is_agency_member(
  p_agency_id uuid,
  p_roles     text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.agency_members am
    where am.agency_id = p_agency_id
      and am.user_id   = auth.uid()
      and (p_roles is null or am.role = any(p_roles))
  );
$$;

comment on function public.is_agency_member(uuid, text[]) is
  'RLS helper. True if the calling user is a member of p_agency_id with one '
  'of p_roles (or any role when p_roles is null). SECURITY DEFINER so RLS '
  'policies can call it without needing direct read access to agency_members.';

revoke execute on function public.is_agency_member(uuid, text[]) from public;
revoke execute on function public.is_agency_member(uuid, text[]) from anon;
grant  execute on function public.is_agency_member(uuid, text[]) to authenticated;
