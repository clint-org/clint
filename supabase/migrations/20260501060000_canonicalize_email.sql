-- Gmail dot canonicalization across invite and lookup paths.
--
-- Lands follow-up #13. For @gmail.com and @googlemail.com, periods in the
-- local part are ignored by Google: madala.dodbele@gmail.com and
-- madaladodbele@gmail.com route to the same Google account. The +tag suffix
-- is similarly stripped.
--
-- Symptom that motivated this: an admin types the dotless form into an invite
-- dialog; Google's account picker returns the dotted form on first sign-in;
-- auth.users.email is stored with dots; the invite-claim lookup against the
-- dotless invites.email fails to match; auto-claim silently breaks.
--
-- This migration:
--   1. Adds public.canonicalize_email(text). Lowercases. For gmail.com /
--      googlemail.com, strips dots from the local part and truncates at the
--      first '+'. Other domains: lowercase only (no safe canonicalization
--      without knowing the provider).
--   2. Rewrites every email-storing and email-looking-up site to canonicalize
--      both sides of every comparison: add_tenant_owner, invite_to_space,
--      add_agency_member, lookup_user_by_email, provision_agency,
--      accept_invite (tenant), accept_space_invite, handle_new_user.
--
-- Backfill: existing invite rows still hold the user-typed form. Rather than
-- bulk-rewriting, the new function bodies canonicalize on every comparison,
-- so old rows naturally match incoming canonicalized lookups.

-- =============================================================================
-- 1. canonicalize_email
-- =============================================================================

create or replace function public.canonicalize_email(p_email text)
returns text
language sql
immutable
set search_path = ''
as $$
  with parts as (
    select
      lower(trim(coalesce(p_email, ''))) as raw
  ),
  split as (
    select
      raw,
      split_part(raw, '@', 1) as local_part,
      split_part(raw, '@', 2) as domain
    from parts
  )
  select case
    when raw = '' or position('@' in raw) = 0 then raw
    when domain in ('gmail.com', 'googlemail.com') then
      replace(split_part(local_part, '+', 1), '.', '') || '@' || domain
    else
      raw
  end
  from split;
$$;

comment on function public.canonicalize_email(text) is
  'Returns the canonical form of an email for lookup/dedup. For gmail.com '
  'and googlemail.com, strips dots from the local part and truncates at the '
  'first +tag. For other domains, lowercases only. Used at every email-store '
  'and email-lookup site so that user-typed dotted/+tag variants and the '
  'canonical form Google returns on OAuth always match.';

revoke execute on function public.canonicalize_email(text) from public;
grant  execute on function public.canonicalize_email(text) to authenticated, anon;

-- =============================================================================
-- 2. add_tenant_owner: canonicalize on store and lookup
-- =============================================================================

create or replace function public.add_tenant_owner(
  p_tenant_id uuid,
  p_email text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.canonicalize_email(p_email);
  v_agency_id uuid;
  v_required text;
  v_user_id uuid;
  v_invite_code text;
  v_invite_id uuid;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001';
  end if;
  if not public.is_tenant_member(p_tenant_id, array['owner']) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if v_agency_id is not null then
    select email_domain into v_required from public.agencies where id = v_agency_id;
    if v_required is not null
       and split_part(v_email, '@', 2) <> v_required
       and not public.is_platform_admin() then
      raise exception 'Email domain (%) does not match agency domain (%)',
        split_part(v_email, '@', 2), v_required using errcode = 'P0001';
    end if;
  end if;
  -- Existing-user lookup via canonical comparison so a Gmail user typed in any
  -- variant (with/without dots, with/without +tag) resolves to the same row.
  select id into v_user_id
    from auth.users
   where public.canonicalize_email(email) = v_email
   limit 1;
  if v_user_id is not null then
    insert into public.tenant_members (tenant_id, user_id, role)
      values (p_tenant_id, v_user_id, 'owner')
      on conflict (tenant_id, user_id) do nothing;
    return jsonb_build_object('owner_invited', false, 'user_id', v_user_id);
  end if;
  -- Idempotent dedup also keys on the canonical form.
  select id, invite_code into v_invite_id, v_invite_code
    from public.tenant_invites
   where tenant_id = p_tenant_id
     and public.canonicalize_email(email) = v_email
     and role = 'owner'
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;
  if v_invite_id is null then
    v_invite_code := replace(gen_random_uuid()::text, '-', '');
    insert into public.tenant_invites (tenant_id, email, role, invite_code, created_by, expires_at)
      values (p_tenant_id, v_email, 'owner', v_invite_code, v_uid, now() + interval '7 days')
      returning id into v_invite_id;
  end if;
  return jsonb_build_object(
    'owner_invited', true,
    'invite_id', v_invite_id,
    'invite_code', v_invite_code,
    'email', v_email
  );
end;
$$;

-- =============================================================================
-- 3. invite_to_space: canonicalize on store and lookup
-- =============================================================================

create or replace function public.invite_to_space(
  p_space_id uuid,
  p_email text,
  p_role text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.canonicalize_email(p_email);
  v_user_id uuid;
  v_invite_id uuid;
  v_invite_code text;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001';
  end if;
  if p_role not in ('owner', 'editor', 'viewer') then
    raise exception 'Invalid role' using errcode = 'P0001';
  end if;
  if not exists (
    select 1 from public.space_members sm
     where sm.space_id = p_space_id
       and sm.user_id = v_uid
       and sm.role = 'owner'
  ) and not public.is_platform_admin() then
    raise exception 'Only space owners can invite' using errcode = '42501';
  end if;
  select id into v_user_id
    from auth.users
   where public.canonicalize_email(email) = v_email
   limit 1;
  if v_user_id is not null then
    insert into public.space_members (space_id, user_id, role)
      values (p_space_id, v_user_id, p_role)
      on conflict (space_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('invited', false, 'user_id', v_user_id);
  end if;
  select id, invite_code into v_invite_id, v_invite_code
    from public.space_invites
   where space_id = p_space_id
     and public.canonicalize_email(email) = v_email
     and role = p_role
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;
  if v_invite_id is null then
    v_invite_code := replace(gen_random_uuid()::text, '-', '');
    insert into public.space_invites (space_id, email, role, invite_code, created_by)
      values (p_space_id, v_email, p_role, v_invite_code, v_uid)
      returning id into v_invite_id;
  end if;
  return jsonb_build_object(
    'invited', true,
    'invite_id', v_invite_id,
    'invite_code', v_invite_code,
    'email', v_email
  );
end;
$$;

-- =============================================================================
-- 4. add_agency_member: canonicalize on store and lookup
-- =============================================================================

create or replace function public.add_agency_member(
  p_agency_id uuid,
  p_email text,
  p_role text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_email text := public.canonicalize_email(p_email);
  v_required text;
  v_user_id uuid;
  v_invite_id uuid;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' or v_email !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then
    raise exception 'Invalid email' using errcode = 'P0001';
  end if;
  if p_role not in ('owner') then
    raise exception 'Invalid role' using errcode = 'P0001';
  end if;
  if not (public.is_agency_member(p_agency_id, array['owner']) or public.is_platform_admin()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  select email_domain into v_required from public.agencies where id = p_agency_id;
  if v_required is not null
     and split_part(v_email, '@', 2) <> v_required
     and not public.is_platform_admin() then
    raise exception 'Email domain (%) does not match agency domain (%)',
      split_part(v_email, '@', 2), v_required using errcode = 'P0001';
  end if;
  select id into v_user_id
    from auth.users
   where public.canonicalize_email(email) = v_email
   limit 1;
  if v_user_id is not null then
    insert into public.agency_members (agency_id, user_id, role)
      values (p_agency_id, v_user_id, p_role)
      on conflict (agency_id, user_id) do nothing;
    return jsonb_build_object('member_invited', false, 'user_id', v_user_id);
  end if;
  select id into v_invite_id
    from public.agency_invites
   where agency_id = p_agency_id
     and public.canonicalize_email(email) = v_email
     and role = p_role
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;
  if v_invite_id is null then
    insert into public.agency_invites (agency_id, email, role, invited_by, expires_at)
      values (p_agency_id, v_email, p_role, v_uid, now() + interval '7 days')
      returning id into v_invite_id;
  end if;
  return jsonb_build_object(
    'member_invited', true,
    'invite_id', v_invite_id,
    'email', v_email
  );
end;
$$;

-- =============================================================================
-- 5. lookup_user_by_email: canonicalize the comparison
-- =============================================================================

create or replace function public.lookup_user_by_email(p_email text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_display text;
  v_canonical text := public.canonicalize_email(p_email);
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not (
    public.is_platform_admin()
    or exists (
      select 1 from public.agency_members am
      where am.user_id = auth.uid() and am.role = 'owner'
    )
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  if v_canonical = '' then
    return jsonb_build_object('found', false);
  end if;

  select u.id,
         coalesce(
           u.raw_user_meta_data ->> 'full_name',
           u.raw_user_meta_data ->> 'name',
           u.email
         )
    into v_uid, v_display
    from auth.users u
   where public.canonicalize_email(u.email) = v_canonical
   limit 1;

  if v_uid is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'user_id', v_uid,
    'display_name', v_display
  );
end;
$$;

-- =============================================================================
-- 6. provision_agency: canonicalize the owner email
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
  v_email         text := public.canonicalize_email(p_owner_email);
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
   where public.canonicalize_email(u.email) = v_email
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

-- =============================================================================
-- 7. accept_invite (tenant): canonicalize JWT email comparison
-- =============================================================================

create or replace function public.accept_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid     uuid := auth.uid();
  v_email text := public.canonicalize_email(auth.jwt() ->> 'email');
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
  if public.canonicalize_email(v_invite.email) <> v_email then
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

-- =============================================================================
-- 8. accept_space_invite: canonicalize JWT email comparison
-- =============================================================================

create or replace function public.accept_space_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid    uuid := auth.uid();
  v_email  text := public.canonicalize_email(auth.jwt() ->> 'email');
  v_invite record;
  v_space  jsonb;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' then
    raise exception 'Authenticated session has no email' using errcode = '28000';
  end if;

  select i.id, i.space_id, i.email, i.role, i.accepted_at, i.expires_at
    into v_invite
    from public.space_invites i
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
  if public.canonicalize_email(v_invite.email) <> v_email then
    raise exception 'Invite was sent to a different email address' using errcode = '42501';
  end if;

  insert into public.space_members (space_id, user_id, role)
    values (v_invite.space_id, v_uid, v_invite.role)
    on conflict (space_id, user_id) do update set role = excluded.role;

  update public.space_invites
     set accepted_at = now(), accepted_by = v_uid
   where id = v_invite.id;

  select jsonb_build_object(
    'id',         s.id,
    'tenant_id',  s.tenant_id,
    'name',       s.name,
    'description', s.description,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  ) into v_space
    from public.spaces s
   where s.id = v_invite.space_id;

  return v_space;
end;
$$;

-- =============================================================================
-- 9. handle_new_user: canonicalize the auto-claim lookup
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email text := public.canonicalize_email(new.email);
begin
  if v_email = '' then
    return new;
  end if;

  -- Promote pending agency invites matching this email's canonical form.
  -- Compares both sides via canonicalize_email so an invite typed with dots
  -- still matches a user who signed in with the dotless form (or vice versa).
  with promoted as (
    update public.agency_invites
       set accepted_at = now(),
           accepted_by = new.id
     where public.canonicalize_email(email) = v_email
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
