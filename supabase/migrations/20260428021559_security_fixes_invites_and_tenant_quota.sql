-- migration: 20260428021559_security_fixes_invites_and_tenant_quota
-- purpose: close three findings from the security audit:
--   1. tenant_invites had a permissive `using ( true )` SELECT policy that
--      let any authenticated user read every pending invite (email + code)
--      across the whole installation.
--   2. tenant_invites had no UPDATE policy at all, so the existing
--      `joinByCode` flow's `update accepted_at` silently affected zero rows.
--   3. create_tenant() / direct INSERT on public.tenants had no per-user
--      quota, allowing unbounded tenant creation by any authenticated user.
-- affected objects:
--   public.tenant_invites (rls policies)
--   public.tenants        (rls policies)
--   public.create_tenant  (function body)
--   public.accept_invite  (new function)

-- =============================================================================
-- 1. tenant_invites: replace permissive read policy
-- =============================================================================

-- the broad "anyone can read invites by code" policy is removed entirely.
-- code-based lookup now happens server-side in public.accept_invite() (below),
-- which runs as security definer and validates the invite against the
-- caller's authenticated email. tenant owners retain their existing read
-- policy for the manage UI.
drop policy if exists "anyone can read invites by code" on public.tenant_invites;

-- add the missing UPDATE policy. only tenant owners can mutate invite rows
-- (e.g. to change role on a pending invite). invite acceptance does not go
-- through this policy because accept_invite() is security definer.
drop policy if exists "tenant owners can update invites" on public.tenant_invites;
create policy "tenant owners can update invites"
on public.tenant_invites for update to authenticated
using ( public.is_tenant_member(tenant_id, array['owner']) )
with check ( public.is_tenant_member(tenant_id, array['owner']) );

-- =============================================================================
-- 2. accept_invite RPC
-- =============================================================================
-- atomically validates and consumes an invite code. runs as security definer
-- so callers do not need any direct policy on tenant_invites.

create or replace function public.accept_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_invite record;
  v_tenant jsonb;
begin
  if uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  if v_email = '' then
    raise exception 'Authenticated session has no email' using errcode = '28000';
  end if;

  select i.id, i.tenant_id, i.email, i.role, i.accepted_at, i.expires_at
    into v_invite
  from public.tenant_invites i
  where i.invite_code = p_code;

  if not found then
    raise exception 'Invalid invite code' using errcode = 'P0002';
  end if;

  if v_invite.accepted_at is not null then
    raise exception 'Invite already used' using errcode = 'P0001';
  end if;

  if v_invite.expires_at < now() then
    raise exception 'Invite expired' using errcode = 'P0001';
  end if;

  if lower(v_invite.email) <> v_email then
    raise exception 'Invite was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_invite.tenant_id, uid, v_invite.role)
  on conflict (tenant_id, user_id) do nothing;

  update public.tenant_invites
     set accepted_at = now()
   where id = v_invite.id;

  select jsonb_build_object(
    'id',         t.id,
    'name',       t.name,
    'slug',       t.slug,
    'logo_url',   t.logo_url,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  ) into v_tenant
  from public.tenants t
  where t.id = v_invite.tenant_id;

  return v_tenant;
end;
$$;

comment on function public.accept_invite(text) is
  'Atomically accept a tenant invite by code. Validates code, expiry, '
  'unused state, and that the invite email matches the caller''s '
  'authenticated email; inserts the tenant_members row and marks the invite '
  'consumed. SECURITY DEFINER so callers do not need direct read/update '
  'access to tenant_invites.';

revoke execute on function public.accept_invite(text) from public;
revoke execute on function public.accept_invite(text) from anon;
grant  execute on function public.accept_invite(text) to authenticated;

-- =============================================================================
-- 3. tenant creation: force the SECURITY DEFINER RPC, add a per-user quota
-- =============================================================================
-- direct INSERT on public.tenants is now denied. tenant creation must go
-- through public.create_tenant(), which enforces a quota.
drop policy if exists "authenticated users can create tenants" on public.tenants;

create or replace function public.create_tenant(
  p_name text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_tenant_id uuid;
  result jsonb;
  owned_count int;
begin
  if uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  -- per-user quota: cap how many tenants a single user can own. picked high
  -- enough to never bother legitimate users; low enough to make abuse loud.
  select count(*) into owned_count
    from public.tenant_members
   where user_id = uid
     and role = 'owner';

  if owned_count >= 25 then
    raise exception 'Tenant limit reached (max 25 owned tenants per user)'
      using errcode = '53400';
  end if;

  insert into public.tenants (name, slug)
  values (p_name, p_slug)
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, uid, 'owner');

  select jsonb_build_object(
    'id',         t.id,
    'name',       t.name,
    'slug',       t.slug,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  ) into result
  from public.tenants t
  where t.id = new_tenant_id;

  return result;
end;
$$;

revoke execute on function public.create_tenant(text, text) from public;
revoke execute on function public.create_tenant(text, text) from anon;
grant  execute on function public.create_tenant(text, text) to authenticated;
