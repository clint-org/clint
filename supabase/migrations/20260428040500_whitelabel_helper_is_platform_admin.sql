-- migration: 20260428040500_whitelabel_helper_is_platform_admin
-- purpose: rls helper. true if the calling user has a row in
--   platform_admins. platform admins get implicit read across the entire
--   schema for support and provisioning bootstrap.

create or replace function public.is_platform_admin()
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    select 1 from public.platform_admins pa where pa.user_id = auth.uid()
  );
$$;

comment on function public.is_platform_admin() is
  'RLS helper. True if the calling user is a platform admin. SECURITY '
  'DEFINER so it can read platform_admins without exposing that table to '
  'PostgREST.';

revoke execute on function public.is_platform_admin() from public;
revoke execute on function public.is_platform_admin() from anon;
grant  execute on function public.is_platform_admin() to authenticated;
