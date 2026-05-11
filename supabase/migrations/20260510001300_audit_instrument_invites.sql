-- migration: 20260510001300_audit_instrument_invites
-- purpose: instrument invite RPCs and add safety-net triggers on
--   tenant_invites and space_invites. invites are created via direct INSERT.
-- NOTE: function ownership stays as default (postgres). See Task 4 for rationale.

-- =============================================================================
-- accept_invite -> 'tenant_invite.redeemed'
-- =============================================================================

create or replace function public.accept_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
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

  perform set_config('audit.actor_role', 'tenant_member', true);
  perform set_config('audit.rpc_name', 'accept_invite', true);
  perform public.record_audit_event(
    'tenant_invite.redeemed', 'rpc', 'tenant_invite', v_invite.id,
    null, v_invite.tenant_id, null,
    jsonb_build_object('invite_id', v_invite.id)
  );

  return v_tenant;
end;
$$;

revoke execute on function public.accept_invite(text) from public;
revoke execute on function public.accept_invite(text) from anon;
grant  execute on function public.accept_invite(text) to authenticated;

-- =============================================================================
-- accept_space_invite -> 'space_invite.redeemed'
-- =============================================================================

create or replace function public.accept_space_invite(p_code text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_uid           uuid := auth.uid();
  v_email         text := public.canonicalize_email(auth.jwt() ->> 'email');
  v_invite        record;
  v_space         jsonb;
  v_audit_tenant_id uuid;
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

  select tenant_id into v_audit_tenant_id from public.spaces where id = v_invite.space_id;

  perform set_config('audit.actor_role', 'space_member', true);
  perform set_config('audit.rpc_name', 'accept_space_invite', true);
  perform public.record_audit_event(
    'space_invite.redeemed', 'rpc', 'space_invite', v_invite.id,
    null, v_audit_tenant_id, v_invite.space_id,
    jsonb_build_object('invite_id', v_invite.id)
  );

  return v_space;
end;
$$;

revoke execute on function public.accept_space_invite(text) from public, anon;
grant  execute on function public.accept_space_invite(text) to authenticated;

-- =============================================================================
-- self_join_tenant -> 'tenant.self_join_consumed'
-- =============================================================================

create or replace function public.self_join_tenant(p_subdomain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
-- @audit:tier1
declare
  v_uid       uuid := auth.uid();
  v_email     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email_dom text;
  v_tenant    record;
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' then
    raise notice 'self_join: missing email claim';
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  v_email_dom := split_part(v_email, '@', 2);

  select id, email_domain_allowlist, email_self_join_enabled, suspended_at, name
    into v_tenant
    from public.tenants
   where subdomain = p_subdomain
   limit 1;

  if not found then
    raise notice 'self_join: subdomain not found: %', p_subdomain;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.suspended_at is not null then
    raise notice 'self_join: tenant suspended (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if not coalesce(v_tenant.email_self_join_enabled, false) then
    raise notice 'self_join: disabled (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.email_domain_allowlist is null
     or array_length(v_tenant.email_domain_allowlist, 1) is null then
    raise notice 'self_join: empty allowlist (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  v_allowed := exists (
    select 1 from unnest(v_tenant.email_domain_allowlist) d
    where lower(d) = v_email_dom
  );
  if not v_allowed then
    raise notice 'self_join: email domain not in allowlist (%, %)', v_tenant.id, v_email_dom;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant.id, v_uid, 'member')
    on conflict (tenant_id, user_id) do nothing;

  perform set_config('audit.actor_role', 'tenant_member', true);
  perform set_config('audit.rpc_name', 'self_join_tenant', true);
  perform public.record_audit_event(
    'tenant.self_join_consumed', 'rpc', 'tenant', v_tenant.id,
    null, v_tenant.id, null,
    '{}'::jsonb
  );

  return jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'role', 'member');
end;
$$;

comment on function public.self_join_tenant(text) is
  'Domain-allowlist self-join. Returns the SAME generic error for every '
  'failure mode (missing tenant, disabled, suspended, allowlist mismatch) '
  'to prevent enumeration. Real reason is logged via raise notice for '
  'support diagnostics.';

revoke execute on function public.self_join_tenant(text) from public, anon;
grant  execute on function public.self_join_tenant(text) to authenticated;

-- =============================================================================
-- tenant_invites issuance trigger -> 'tenant_invite.issued'
-- =============================================================================

create or replace function public._audit_trigger_tenant_invite_issued()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._audit_trigger_should_skip() then return null; end if;
  perform public.record_audit_event(
    'tenant_invite.issued', 'trigger', 'tenant_invite', new.id,
    null, new.tenant_id, null,
    jsonb_build_object(
      'invite_id', new.id,
      'role', new.role,
      'expires_at', new.expires_at,
      'invited_email', new.email
    )
  );
  return null;
end;
$$;

drop trigger if exists trg_audit_tenant_invite_issued on public.tenant_invites;
create trigger trg_audit_tenant_invite_issued
  after insert on public.tenant_invites
  for each row execute function public._audit_trigger_tenant_invite_issued();

-- =============================================================================
-- space_invites issuance trigger -> 'space_invite.issued'
-- =============================================================================

create or replace function public._audit_trigger_space_invite_issued()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_tenant_id uuid;
begin
  if public._audit_trigger_should_skip() then return null; end if;
  select tenant_id into v_tenant_id from public.spaces where id = new.space_id;
  perform public.record_audit_event(
    'space_invite.issued', 'trigger', 'space_invite', new.id,
    null, v_tenant_id, new.space_id,
    jsonb_build_object(
      'invite_id', new.id,
      'role', new.role,
      'expires_at', new.expires_at,
      'invited_email', new.email
    )
  );
  return null;
end;
$$;

drop trigger if exists trg_audit_space_invite_issued on public.space_invites;
create trigger trg_audit_space_invite_issued
  after insert on public.space_invites
  for each row execute function public._audit_trigger_space_invite_issued();
