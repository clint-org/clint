-- migration: 20260605215948_replace_member_views_with_rpcs
-- purpose: clear two Supabase advisor ERROR classes that fire against the
--   linked/remote project for the three membership "..._members_view" views:
--     - security_definer_view : the views run as their owner (they were
--       switched off security_invoker in 20260428030352 / 20260428215813 so
--       they could read auth.users, which the `authenticated` role cannot).
--     - auth_users_exposed    : the views select auth.users columns into an
--       API-reachable object in the exposed `public` schema.
--   Both lints are view-specific. Set-returning SECURITY DEFINER functions are
--   not subject to either lint -- this is exactly the pattern the codebase
--   already uses for lookup_user_by_email / accept_invite, which read
--   auth.users the same way without tripping Splinter.
--
-- approach: drop the three views and replace each with a list_*_members(...)
--   SECURITY DEFINER function that returns the identical column shape and keeps
--   the same per-caller gating (the inline is_tenant_member / has_space_access /
--   is_agency_member helper checks the views carried in their WHERE clause).
--   Reading auth.users at query time (vs a denormalized mirror) keeps email /
--   display_name always fresh -- email is mutable here (see canonicalize_email).
--
-- affected objects:
--   public.tenant_members_view  (dropped)  -> public.list_tenant_members(uuid)
--   public.space_members_view   (dropped)  -> public.list_space_members(uuid)
--   public.agency_members_view  (dropped)  -> public.list_agency_members(uuid)
--
-- client: tenant/space/agency services switch .from('..._view') to
--   .rpc('list_..._members', { p_... }). role-access integration test ported.

-- =============================================================================
-- tenant members
-- =============================================================================
drop view if exists public.tenant_members_view;

create or replace function public.list_tenant_members(p_tenant_id uuid)
returns table (
  id               uuid,
  tenant_id        uuid,
  user_id          uuid,
  role             text,
  created_at       timestamptz,
  email            text,
  display_name     text,
  is_agency_backed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    tm.id,
    tm.tenant_id,
    tm.user_id,
    tm.role::text,
    tm.created_at,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'full_name', u.email)::text as display_name,
    exists (
      select 1
      from public.agency_members am
      join public.tenants t on t.id = tm.tenant_id
      where am.user_id = tm.user_id
        and am.agency_id = t.agency_id
        and am.role = 'owner'
    ) as is_agency_backed
  from public.tenant_members tm
  join auth.users u on u.id = tm.user_id
  where tm.tenant_id = p_tenant_id
    and public.is_tenant_member(p_tenant_id);
$$;

comment on function public.list_tenant_members(uuid) is
  'Tenant members joined with their auth.users email/display_name for the given '
  'tenant. SECURITY DEFINER so it can read auth.users; the is_tenant_member() '
  'gate (which reads auth.uid()) restricts results to callers who belong to the '
  'tenant. is_agency_backed is true when the user is also an owner of the '
  'tenant''s parent agency. Replaces tenant_members_view.';

revoke execute on function public.list_tenant_members(uuid) from public, anon;
grant  execute on function public.list_tenant_members(uuid) to authenticated;

-- =============================================================================
-- space members
-- =============================================================================
drop view if exists public.space_members_view;

create or replace function public.list_space_members(p_space_id uuid)
returns table (
  id           uuid,
  space_id     uuid,
  user_id      uuid,
  role         text,
  created_at   timestamptz,
  email        text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    sm.id,
    sm.space_id,
    sm.user_id,
    sm.role::text,
    sm.created_at,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'full_name', u.email)::text as display_name
  from public.space_members sm
  join auth.users u on u.id = sm.user_id
  where sm.space_id = p_space_id
    and public.has_space_access(p_space_id);
$$;

comment on function public.list_space_members(uuid) is
  'Space members joined with their auth.users email/display_name for the given '
  'space. SECURITY DEFINER so it can read auth.users; the has_space_access() '
  'gate (which reads auth.uid()) restricts results to callers who can access '
  'the space. Replaces space_members_view.';

revoke execute on function public.list_space_members(uuid) from public, anon;
grant  execute on function public.list_space_members(uuid) to authenticated;

-- =============================================================================
-- agency members
-- =============================================================================
drop view if exists public.agency_members_view;

create or replace function public.list_agency_members(p_agency_id uuid)
returns table (
  id           uuid,
  agency_id    uuid,
  user_id      uuid,
  role         text,
  created_at   timestamptz,
  email        text,
  display_name text
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    am.id,
    am.agency_id,
    am.user_id,
    am.role::text,
    am.created_at,
    u.email::text,
    coalesce(u.raw_user_meta_data->>'full_name', u.email)::text as display_name
  from public.agency_members am
  join auth.users u on u.id = am.user_id
  where am.agency_id = p_agency_id
    and (public.is_agency_member(p_agency_id) or public.is_platform_admin());
$$;

comment on function public.list_agency_members(uuid) is
  'Agency members joined with their auth.users email/display_name for the given '
  'agency. SECURITY DEFINER so it can read auth.users; the is_agency_member() '
  'gate (which reads auth.uid()) restricts results to callers who belong to the '
  'agency. Platform admins see all. Replaces agency_members_view.';

revoke execute on function public.list_agency_members(uuid) from public, anon;
grant  execute on function public.list_agency_members(uuid) to authenticated;

-- ensure PostgREST picks up the new function signatures immediately
notify pgrst, 'reload schema';
