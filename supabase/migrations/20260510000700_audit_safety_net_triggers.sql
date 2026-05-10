-- migration: 20260510000700_audit_safety_net_triggers
-- purpose: backstop the RPC-primary capture path. AFTER triggers on the five
--   highest-risk tables emit audit events for any direct write that did not
--   go through an instrumented RPC. dedupe via audit.suppress_trigger GUC
--   set inside record_audit_event.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (Safety-net triggers)
-- NOTE: function ownership stays as default (postgres). See Task 4 migration for rationale.

create or replace function public._audit_trigger_should_skip()
returns boolean
language plpgsql
stable
set search_path = public, pg_temp
as $$
declare
  v_marker text;
begin
  v_marker := nullif(current_setting('audit.suppress_trigger', true), '');
  -- if a record_audit_event call set the GUC in this transaction, the RPC
  -- already emitted the event; the trigger should skip to avoid duplication.
  return v_marker is not null;
end
$$;

-- platform_admins
create or replace function public._audit_trigger_platform_admins()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._audit_trigger_should_skip() then return null; end if;
  if tg_op = 'INSERT' then
    perform public.record_audit_event(
      'platform_admin.granted', 'trigger', 'platform_admin', new.user_id,
      null, null, null, jsonb_build_object('granted_user_id', new.user_id));
  elsif tg_op = 'DELETE' then
    perform public.record_audit_event(
      'platform_admin.revoked', 'trigger', 'platform_admin', old.user_id,
      null, null, null, jsonb_build_object('revoked_user_id', old.user_id));
  end if;
  return null;
end
$$;

create trigger trg_audit_platform_admins
  after insert or delete on public.platform_admins
  for each row execute function public._audit_trigger_platform_admins();

-- tenant_members
create or replace function public._audit_trigger_tenant_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb;
begin
  if public._audit_trigger_should_skip() then return null; end if;
  if tg_op = 'INSERT' then
    v_meta := jsonb_build_object('member_user_id', new.user_id, 'role', new.role);
    perform public.record_audit_event(
      'tenant_member.added', 'trigger', 'tenant_member', new.user_id,
      null, new.tenant_id, null, v_meta);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    v_meta := jsonb_build_object('member_user_id', new.user_id,
                                 'role_was', old.role, 'role_now', new.role);
    perform public.record_audit_event(
      'tenant_member.role_changed', 'trigger', 'tenant_member', new.user_id,
      null, new.tenant_id, null, v_meta);
  elsif tg_op = 'DELETE' then
    v_meta := jsonb_build_object('member_user_id', old.user_id, 'role', old.role);
    perform public.record_audit_event(
      'tenant_member.removed', 'trigger', 'tenant_member', old.user_id,
      null, old.tenant_id, null, v_meta);
  end if;
  return null;
end
$$;

create trigger trg_audit_tenant_members
  after insert or update or delete on public.tenant_members
  for each row execute function public._audit_trigger_tenant_members();

-- agency_members (identical shape)
create or replace function public._audit_trigger_agency_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb;
begin
  if public._audit_trigger_should_skip() then return null; end if;
  if tg_op = 'INSERT' then
    v_meta := jsonb_build_object('member_user_id', new.user_id, 'role', new.role);
    perform public.record_audit_event(
      'agency_member.added', 'trigger', 'agency_member', new.user_id,
      new.agency_id, null, null, v_meta);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    v_meta := jsonb_build_object('member_user_id', new.user_id,
                                 'role_was', old.role, 'role_now', new.role);
    perform public.record_audit_event(
      'agency_member.role_changed', 'trigger', 'agency_member', new.user_id,
      new.agency_id, null, null, v_meta);
  elsif tg_op = 'DELETE' then
    v_meta := jsonb_build_object('member_user_id', old.user_id, 'role', old.role);
    perform public.record_audit_event(
      'agency_member.removed', 'trigger', 'agency_member', old.user_id,
      old.agency_id, null, null, v_meta);
  end if;
  return null;
end
$$;

create trigger trg_audit_agency_members
  after insert or update or delete on public.agency_members
  for each row execute function public._audit_trigger_agency_members();

-- space_members (carries tenant_id too via lookup)
create or replace function public._audit_trigger_space_members()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_meta jsonb;
  v_tenant_id uuid;
  v_space_id uuid;
begin
  if public._audit_trigger_should_skip() then return null; end if;

  if tg_op = 'DELETE' then
    v_space_id := old.space_id;
  else
    v_space_id := new.space_id;
  end if;
  select tenant_id into v_tenant_id from public.spaces where id = v_space_id;

  if tg_op = 'INSERT' then
    v_meta := jsonb_build_object('member_user_id', new.user_id, 'role', new.role);
    perform public.record_audit_event(
      'space_member.added', 'trigger', 'space_member', new.user_id,
      null, v_tenant_id, new.space_id, v_meta);
  elsif tg_op = 'UPDATE' and new.role is distinct from old.role then
    v_meta := jsonb_build_object('member_user_id', new.user_id,
                                 'role_was', old.role, 'role_now', new.role);
    perform public.record_audit_event(
      'space_member.role_changed', 'trigger', 'space_member', new.user_id,
      null, v_tenant_id, new.space_id, v_meta);
  elsif tg_op = 'DELETE' then
    v_meta := jsonb_build_object('member_user_id', old.user_id, 'role', old.role);
    perform public.record_audit_event(
      'space_member.removed', 'trigger', 'space_member', old.user_id,
      null, v_tenant_id, old.space_id, v_meta);
  end if;
  return null;
end
$$;

create trigger trg_audit_space_members
  after insert or update or delete on public.space_members
  for each row execute function public._audit_trigger_space_members();

-- tenants.suspended_at column-level
create or replace function public._audit_trigger_tenant_suspension()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  if public._audit_trigger_should_skip() then return null; end if;
  if old.suspended_at is null and new.suspended_at is not null then
    perform public.record_audit_event(
      'tenant.suspend', 'trigger', 'tenant', new.id,
      new.agency_id, new.id, null,
      jsonb_build_object('suspended_at', new.suspended_at));
  elsif old.suspended_at is not null and new.suspended_at is null then
    perform public.record_audit_event(
      'tenant.unsuspend', 'trigger', 'tenant', new.id,
      new.agency_id, new.id, null, '{}'::jsonb);
  end if;
  return null;
end
$$;

create trigger trg_audit_tenant_suspension
  after update of suspended_at on public.tenants
  for each row when (old.suspended_at is distinct from new.suspended_at)
  execute function public._audit_trigger_tenant_suspension();
