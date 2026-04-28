-- migration: 20260428193905_agency_owner_invite_flow
-- purpose: let super-admins provision an agency with an arbitrary owner email,
--   even if that user has not signed in yet. introduces public.agency_invites
--   to hold pending owner/member invitations keyed on email, and changes
--   public.provision_agency to take p_owner_email instead of p_owner_user_id.
--   when the owner has not yet signed in, the agency is created with a
--   pending agency_invites row. when the user later signs in, the existing
--   handle_new_user() trigger consumes any matching pending invites and
--   inserts the corresponding agency_members rows.
--
-- affected objects:
--   public.agency_invites           (new table + rls policies)
--   public.provision_agency         (signature change: uuid -> text)
--   public.handle_new_user          (body extended to consume invites)

-- =============================================================================
-- 1. agency_invites table
-- =============================================================================

create table public.agency_invites (
  id           uuid primary key default gen_random_uuid(),
  agency_id    uuid not null references public.agencies (id) on delete cascade,
  email        varchar(255) not null,
  role         varchar(20) not null check (role in ('owner', 'member')),
  invited_by   uuid references auth.users (id) on delete set null,
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null default now() + interval '30 days',
  accepted_at  timestamptz,
  accepted_by  uuid references auth.users (id) on delete set null
);

comment on table public.agency_invites is
  'Pending invitations to join an agency, resolved automatically by '
  'handle_new_user() when the invited email signs in. Created by '
  'provision_agency() and provision_agency_member() when the target user '
  'does not yet exist in auth.users.';

-- a single email can have at most one pending invite per agency. duplicates
-- on already-accepted invites are fine (history) so the partial unique index
-- only enforces uniqueness while accepted_at is null.
create unique index idx_agency_invites_unique_pending
  on public.agency_invites (agency_id, lower(email))
  where accepted_at is null;

-- handle_new_user lookup hits this on every signup; lower(email) match.
create index idx_agency_invites_email_lower
  on public.agency_invites (lower(email))
  where accepted_at is null;

create index idx_agency_invites_agency_id
  on public.agency_invites (agency_id);

alter table public.agency_invites enable row level security;

-- super-admins can read all pending invites for support.
create policy "platform admins can view all agency invites"
on public.agency_invites for select to authenticated
using ( public.is_platform_admin() );

-- agency owners can read pending invites for their own agency (e.g. for a
-- future "pending invitations" panel in the admin UI).
create policy "agency owners can view own agency invites"
on public.agency_invites for select to authenticated
using ( public.is_agency_member(agency_id, array['owner']) );

-- inserts and updates happen exclusively via SECURITY DEFINER RPCs; no
-- direct write policies are granted.

-- =============================================================================
-- 2. provision_agency: replace uuid argument with email argument
-- =============================================================================
-- the previous signature took p_owner_user_id uuid and required the caller
-- to look the user up first via lookup_user_by_email. that gate prevented
-- super-admins from provisioning an agency for a partner who had not yet
-- signed in. we now take p_owner_email directly and either insert
-- agency_members (if the user already exists) or write an agency_invites
-- row that handle_new_user() will redeem on the owner's first signup.

drop function if exists public.provision_agency(text, text, text, uuid, text);

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

  -- look up the auth user by email; null when they have not signed in yet.
  select u.id into v_owner_user_id
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
    values (p_name, p_slug, p_subdomain, p_name, coalesce(p_contact_email, 'unknown@unknown.invalid'))
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
  'existing auth.users row, the owner is added directly to agency_members. '
  'Otherwise an agency_invites row is created and handle_new_user() will '
  'promote it to agency_members on the owner''s first signup. SECURITY '
  'DEFINER bypasses RLS for atomic creation. Returns the agency record '
  'with owner_invited boolean indicating which path was taken.';

revoke execute on function public.provision_agency(text, text, text, text, text) from public, anon;
grant  execute on function public.provision_agency(text, text, text, text, text) to authenticated;

-- =============================================================================
-- 3. handle_new_user: consume pending agency invites on first signup
-- =============================================================================
-- replaces the no-op body added in 20260428031938 with a small consumer
-- that scans agency_invites for the new user's email and promotes any
-- non-expired, unaccepted invites to agency_members rows. tenant invites
-- still go through the explicit code-based accept_invite() flow because
-- they are sent to the recipient as a shareable URL; agency-owner invites
-- are out-of-band and we want them to "just work" on first signup.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := lower(coalesce(new.email, ''));
begin
  if v_email = '' then
    return new;
  end if;

  -- promote pending agency invites matching this email. the partial unique
  -- index on (agency_id, lower(email)) where accepted_at is null guarantees
  -- at most one pending invite per agency per email, so insert/update is
  -- well-defined. on conflict on agency_members handles the (impossible
  -- but defensive) case where the user is already a member.
  with promoted as (
    update public.agency_invites
       set accepted_at = now(),
           accepted_by = new.id
     where lower(email) = v_email
       and accepted_at is null
       and expires_at > now()
    returning agency_id, role
  )
  insert into public.agency_members (agency_id, user_id, role)
    select agency_id, new.id, role from promoted
    on conflict (agency_id, user_id) do nothing;

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Trigger fired after auth.users insert. Consumes any pending '
  'agency_invites rows matching the new user''s email and inserts the '
  'corresponding agency_members rows. Tenant invites stay code-based '
  '(see public.accept_invite). Demo workspace provisioning remains '
  'opt-in via public.provision_demo_workspace.';
