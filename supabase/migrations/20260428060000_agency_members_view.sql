-- migration: 20260428060000_agency_members_view
-- purpose: expose joined agency_members + auth.users data (email, display_name)
--   for the agency portal members table. mirrors tenant_members_view
--   pattern using SECURITY INVOKER so RLS on agency_members is honored.

create or replace view public.agency_members_view as
select
  am.id,
  am.agency_id,
  am.user_id,
  am.role,
  am.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.agency_members am
join auth.users u on u.id = am.user_id;

grant select on public.agency_members_view to authenticated;

alter view public.agency_members_view set (security_invoker = true);
