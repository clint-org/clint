-- Symmetric agency-add-member RPC with held-invite branch.
--
-- Background: add_tenant_owner and invite_to_space both gracefully handle the
-- case where the target email has not yet signed in (writes a held invite row,
-- returns a code or invite id). The agency-add-member surface forced the would-be
-- member to sign in out of band first, then added them via a direct
-- agency_members insert. That is the wrong direction: invites are precisely for
-- people who have not yet signed up.
--
-- The auto-claim half is already in place: handle_new_user (migration 69)
-- consumes pending agency_invites rows on first sign-in and promotes them to
-- agency_members rows. This RPC supplies the missing write-into-agency_invites
-- half so the existing agency members page can pre-issue invites.
--
-- agency_invites does not have a separate invite_code column (unlike
-- tenant_invites and space_invites). The auto-claim mechanism keys off the
-- email + the user's first sign-in, not a code the inviter shares. The return
-- shape reflects that: member_invited true with an invite_id, no code.

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
  v_email text := lower(trim(coalesce(p_email, '')));
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
  -- agency_members.role is constrained to 'owner' only as of migration 75.
  -- Mirror that constraint here so the RPC fails fast with a user-readable
  -- error instead of letting the underlying CHECK violation bubble up.
  if p_role not in ('owner') then
    raise exception 'Invalid role' using errcode = 'P0001';
  end if;
  if not (public.is_agency_member(p_agency_id, array['owner']) or public.is_platform_admin()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  -- Email-domain enforcement: same wording as add_tenant_owner for consistency.
  select email_domain into v_required from public.agencies where id = p_agency_id;
  if v_required is not null
     and split_part(v_email, '@', 2) <> v_required
     and not public.is_platform_admin() then
    raise exception 'Email domain (%) does not match agency domain (%)',
      split_part(v_email, '@', 2), v_required using errcode = 'P0001';
  end if;
  -- Existing-user branch: direct add to agency_members.
  select id into v_user_id from auth.users where lower(email) = v_email limit 1;
  if v_user_id is not null then
    insert into public.agency_members (agency_id, user_id, role)
      values (p_agency_id, v_user_id, p_role)
      on conflict (agency_id, user_id) do nothing;
    return jsonb_build_object('member_invited', false, 'user_id', v_user_id);
  end if;
  -- Held-invite branch with idempotent dedup. The partial unique index on
  -- agency_invites (agency_id, lower(email)) where accepted_at is null also
  -- enforces this at the DB level, but checking first lets us return the
  -- existing invite cleanly instead of raising a unique-violation error.
  select id into v_invite_id
    from public.agency_invites
   where agency_id = p_agency_id
     and lower(email) = v_email
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

revoke execute on function public.add_agency_member(uuid, text, text) from public;
revoke execute on function public.add_agency_member(uuid, text, text) from anon;
grant  execute on function public.add_agency_member(uuid, text, text) to authenticated;

comment on function public.add_agency_member(uuid, text, text) is
  'Add a member to an existing agency by email. Existing users get an immediate '
  'agency_members row; unknown emails get a held agency_invites row that '
  'handle_new_user auto-promotes on first sign-in. Symmetric with '
  'add_tenant_owner for tenants.';
