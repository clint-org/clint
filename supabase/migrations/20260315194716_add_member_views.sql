-- views that join membership tables with auth.users to expose email and name
-- these use SECURITY DEFINER to access auth.users (which is not directly queryable)

create or replace view public.tenant_members_view as
select
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.tenant_members tm
join auth.users u on u.id = tm.user_id;

-- grant access
grant select on public.tenant_members_view to authenticated;

create or replace view public.space_members_view as
select
  sm.id,
  sm.space_id,
  sm.user_id,
  sm.role,
  sm.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.space_members sm
join auth.users u on u.id = sm.user_id;

grant select on public.space_members_view to authenticated;

-- enable RLS on the views (they inherit from the base tables via the join,
-- but we need explicit policies on the views themselves)
alter view public.tenant_members_view set (security_invoker = true);
alter view public.space_members_view set (security_invoker = true);
