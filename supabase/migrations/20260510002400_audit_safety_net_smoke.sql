-- migration: 20260510002400_audit_safety_net_smoke
-- purpose: assert that a direct table write to tenant_members (which bypasses
--   the RPC path entirely) produces a trigger-sourced audit row. confirms the
--   safety-net design from Task 7.

do $$
declare
  v_agency uuid := '41111111-1111-1111-1111-111111111111';
  v_tenant uuid := '42222222-2222-2222-2222-222222222222';
  v_user uuid := '43333333-3333-3333-3333-333333333333';
  v_pa uuid := '44444444-4444-4444-4444-444444444444';
  v_seen int;
begin
  -- bootstrap
  insert into auth.users (id, email) values
    (v_user, 'u@safety.test'),
    (v_pa, 'pa@safety.test');
  insert into public.platform_admins (user_id) values (v_pa);
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'SafetyAg', 'safety-ag-test', 'safety-ag-test', 'SafetyAg', 'sa@safety.test');
  insert into public.tenants (id, name, slug, subdomain, agency_id)
    values (v_tenant, 'SafetyT', 'safety-t-test', 'safety-t-test', v_agency);

  -- impersonate the platform admin so the safety-net trigger captures auth.uid()
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  -- IMPORTANT: clear the audit.suppress_trigger GUC so the safety-net trigger DOES fire.
  -- if a previous statement in this transaction called record_audit_event, the GUC is set
  -- and the trigger would skip. clear it explicitly.
  perform set_config('audit.suppress_trigger', '', true);

  -- direct INSERT into tenant_members (no RPC). this fires the safety-net trigger.
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');

  select count(*) into v_seen from public.audit_events
    where action = 'tenant_member.added'
      and source = 'trigger'
      and tenant_id = v_tenant
      and metadata ->> 'member_user_id' = v_user::text;
  if v_seen <> 1 then
    raise exception 'SAFETY-NET FAIL #1: expected 1 trigger-sourced tenant_member.added for synthetic user, got %', v_seen;
  end if;

  -- direct DELETE fires the removal trigger
  perform set_config('audit.suppress_trigger', '', true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant and user_id = v_user;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant_member.removed'
      and source = 'trigger'
      and tenant_id = v_tenant
      and metadata ->> 'member_user_id' = v_user::text;
  if v_seen <> 1 then
    raise exception 'SAFETY-NET FAIL #2: expected 1 trigger-sourced tenant_member.removed for synthetic user, got %', v_seen;
  end if;

  -- direct INSERT into platform_admins fires its trigger
  perform set_config('audit.suppress_trigger', '', true);
  insert into public.platform_admins (user_id) values (v_user);

  select count(*) into v_seen from public.audit_events
    where action = 'platform_admin.granted'
      and source = 'trigger'
      and resource_id = v_user;
  if v_seen <> 1 then
    raise exception 'SAFETY-NET FAIL #3: expected 1 trigger-sourced platform_admin.granted for synthetic user, got %', v_seen;
  end if;

  -- cleanup
  delete from public.audit_events where action like 'tenant_member.%' and tenant_id = v_tenant;
  delete from public.audit_events where action like 'platform_admin.%' and resource_id in (v_user, v_pa);
  delete from public.platform_admins where user_id in (v_user, v_pa);
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id in (v_user, v_pa);

  raise notice 'audit safety-net smoke: PASS (3 trigger invariants verified)';
end $$;
