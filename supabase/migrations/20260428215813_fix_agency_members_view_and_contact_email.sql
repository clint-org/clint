-- migration: 20260428215813_fix_agency_members_view_and_contact_email
-- purpose: two related agency-portal data fixes.
--
-- 1. agency_members_view was created with `security_invoker = true` and joins
--    auth.users. The `authenticated` Postgres role has no SELECT on auth.users
--    so every read of the view fails with 42501 permission denied. The agency
--    service silently falls back to raw agency_members (no email/display_name)
--    and the members table renders "--" for name and the user_id under email.
--    Same bug that was fixed for tenant_members_view / space_members_view in
--    20260428030352. Apply the same fix: drop security_invoker, add an inline
--    is_agency_member() WHERE clause so per-caller filtering is preserved
--    without exposing other agencies' members.
--
-- 2. provision_agency wrote the literal string 'unknown@unknown.invalid' into
--    agencies.contact_email whenever the caller didn't supply one (because the
--    column is NOT NULL). That string surfaces verbatim in the branding page.
--    Default to the owner email instead — that's a real address and a sensible
--    contact for the agency. Backfill any existing agencies that still have the
--    placeholder using the owner row from agency_members.
--
-- affected objects:
--   public.agency_members_view (recreated)
--   public.provision_agency    (default for contact_email changes)
--   public.agencies            (one-time backfill of placeholder rows)

-- =============================================================================
-- 1. agency_members_view: read auth.users as owner, gate via is_agency_member
-- =============================================================================

drop view if exists public.agency_members_view;

create view public.agency_members_view as
select
  am.id,
  am.agency_id,
  am.user_id,
  am.role,
  am.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name
from public.agency_members am
join auth.users u on u.id = am.user_id
where public.is_agency_member(am.agency_id) or public.is_platform_admin();

grant select on public.agency_members_view to authenticated;

comment on view public.agency_members_view is
  'Agency members joined with their auth.users email/display_name. Runs as '
  'view owner so it can read auth.users; the WHERE clause uses '
  'is_agency_member() (which reads auth.uid()) so each caller only sees '
  'members of agencies they belong to. Platform admins see all.';

-- =============================================================================
-- 2. provision_agency: default contact_email to owner email
-- =============================================================================

create or replace function public.provision_agency(
  p_name           text,
  p_slug           text,
  p_subdomain      text,
  p_owner_email    text,
  p_contact_email  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id     uuid;
  v_owner_user_id uuid;
  v_email         text := lower(trim(coalesce(p_owner_email, '')));
  v_contact       text := nullif(trim(coalesce(p_contact_email, '')), '');
  v_invited       boolean := false;
  v_result        jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;

  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid owner email' using errcode = 'P0001';
  end if;
  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain
      using errcode = '23505';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,99}$' then
    raise exception 'Invalid slug' using errcode = 'P0001';
  end if;

  select u.id into v_owner_user_id
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
    values (p_name, p_slug, p_subdomain, p_name, coalesce(v_contact, v_email))
    returning id into v_agency_id;

  if v_owner_user_id is not null then
    insert into public.agency_members (agency_id, user_id, role)
      values (v_agency_id, v_owner_user_id, 'owner');
  else
    insert into public.agency_invites (agency_id, email, role, invited_by)
      values (v_agency_id, v_email, 'owner', auth.uid());
    v_invited := true;
  end if;

  select jsonb_build_object(
    'id',               a.id,
    'name',             a.name,
    'slug',             a.slug,
    'subdomain',        a.subdomain,
    'app_display_name', a.app_display_name,
    'created_at',       a.created_at,
    'owner_invited',    v_invited,
    'owner_email',      v_email
  ) into v_result
    from public.agencies a where a.id = v_agency_id;

  return v_result;
end;
$$;

comment on function public.provision_agency(text, text, text, text, text) is
  'Platform-admin-only RPC. Creates an agency. If p_owner_email matches an '
  'existing auth.users row, the owner is added directly to agency_members; '
  'otherwise an agency_invites row is held and handle_new_user() promotes it '
  'on first sign-in. contact_email defaults to the owner email when not '
  'supplied. Returns the agency record with owner_invited boolean.';

revoke execute on function public.provision_agency(text, text, text, text, text) from public, anon;
grant  execute on function public.provision_agency(text, text, text, text, text) to authenticated;

-- =============================================================================
-- 3. backfill: replace 'unknown@unknown.invalid' with the owner's email
-- =============================================================================

update public.agencies a
   set contact_email = u.email
  from public.agency_members am
  join auth.users u on u.id = am.user_id
 where am.agency_id = a.id
   and am.role = 'owner'
   and a.contact_email = 'unknown@unknown.invalid';
