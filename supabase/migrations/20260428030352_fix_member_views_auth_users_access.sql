-- migration: 20260428030352_fix_member_views_auth_users_access
-- purpose: fix tenant_members_view and space_members_view both failing with
--   `42501 permission denied for table users` for every authenticated caller.
--   The views were created with `security_invoker = true` and join auth.users,
--   but the `authenticated` Postgres role does not have SELECT on auth.users,
--   so the join fails before any rows are returned.
-- approach: run the views as their owner (definer-style) so they can read
--   auth.users, and enforce the same access rule the previous RLS-on-base-table
--   approach gave us by adding an explicit `where` clause that calls the
--   existing is_tenant_member()/has_space_access() SECURITY DEFINER helpers.
--   Those helpers read auth.uid() from the caller's JWT, so per-caller filtering
--   is preserved without any client change.
-- affected objects:
--   public.tenant_members_view (recreated)
--   public.space_members_view  (recreated)

drop view if exists public.tenant_members_view;
drop view if exists public.space_members_view;

create view public.tenant_members_view as
select
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.tenant_members tm
join auth.users u on u.id = tm.user_id
where public.is_tenant_member(tm.tenant_id);

grant select on public.tenant_members_view to authenticated;

create view public.space_members_view as
select
  sm.id,
  sm.space_id,
  sm.user_id,
  sm.role,
  sm.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.space_members sm
join auth.users u on u.id = sm.user_id
where public.has_space_access(sm.space_id);

grant select on public.space_members_view to authenticated;

comment on view public.tenant_members_view is
  'Tenant members joined with their auth.users email/display_name. Runs as '
  'view owner so it can read auth.users; the WHERE clause uses '
  'is_tenant_member() (which reads auth.uid()) so each caller only sees '
  'members of tenants they belong to.';

comment on view public.space_members_view is
  'Space members joined with their auth.users email/display_name. Runs as '
  'view owner so it can read auth.users; the WHERE clause uses '
  'has_space_access() (which reads auth.uid()) so each caller only sees '
  'members of spaces they can access.';
