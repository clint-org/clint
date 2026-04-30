-- Make add_tenant_owner and invite_to_space idempotent for held-invite branches.
--
-- Previously, calling these RPCs N times for the same (tenant/space, email, role)
-- where the email had no auth.users row would INSERT N rows into the *_invites
-- table, leaving N valid codes floating around. Each click silently minted a new
-- credential — and even after the invitee redeems one, the rest stayed valid
-- until expiry, an obvious leak surface.
--
-- New behavior: before INSERT, look up an existing unaccepted, unexpired invite
-- for the same (tenant_id/space_id, email, role). If one exists, return its
-- invite_code instead of creating a new row. The user-visible result is that
-- "Add owner" and "Invite to space" become target-state operations — clicking
-- twice for the same email returns the same code, matching the GitHub /
-- Linear / Google Workspace mental model.
--
-- Existing-user branches (where auth.users already has a row for the email)
-- already use ON CONFLICT DO NOTHING / DO UPDATE on tenant_members /
-- space_members and don't need changes.

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
  v_email text := lower(trim(coalesce(p_email, '')));
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
  -- is_tenant_member already covers tenant owner + agency owner + platform admin
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
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    insert into public.tenant_members (tenant_id, user_id, role)
      values (p_tenant_id, v_user_id, 'owner')
      on conflict (tenant_id, user_id) do nothing;
    return jsonb_build_object('owner_invited', false, 'user_id', v_user_id);
  end if;
  -- Idempotent dedup: return any existing valid held invite for this (tenant, email, owner role).
  select id, invite_code into v_invite_id, v_invite_code
    from public.tenant_invites
   where tenant_id = p_tenant_id
     and email = v_email
     and role = 'owner'
     and accepted_at is null
     and expires_at > now()
   order by created_at desc
   limit 1;
  if v_invite_id is null then
    -- 32-char hex code via uuid (no pgcrypto dependency).
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
  v_email text := lower(trim(coalesce(p_email, '')));
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
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    insert into public.space_members (space_id, user_id, role)
      values (p_space_id, v_user_id, p_role)
      on conflict (space_id, user_id) do update set role = excluded.role;
    return jsonb_build_object('invited', false, 'user_id', v_user_id);
  end if;
  -- Idempotent dedup: return any existing valid held invite for this (space, email, role).
  select id, invite_code into v_invite_id, v_invite_code
    from public.space_invites
   where space_id = p_space_id
     and email = v_email
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

-- Cleanup: remove the two stale Pfizer/aadimadala invites generated during the
-- 2026-04-30 test pass before this fix landed. Keep the one referenced in the
-- test plan (72a871bd...).
delete from public.tenant_invites
 where email = 'aadimadala@gmail.com'
   and invite_code <> '72a871bd3b2b46a8bb60ea1ef44cba83'
   and accepted_at is null;
