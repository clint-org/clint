-- 06_safety_net_triggers
-- Asserts safety-net triggers on tenant_members, space_members, platform_admins,
-- and tenants fire when a direct table write bypasses the RPC path.
-- Each assertion clears audit.suppress_trigger before the mutation so the trigger fires.
--
-- Note: tenant_members.role has a check constraint allowing only 'owner', so
-- tenant_member.role_changed is exercised via space_members instead (which has
-- owner/editor/viewer). The trigger pattern is identical.
--
-- Predictable UUID prefix: 06xxxxxx-06xx-06xx-06xx-06xxxxxxxxxx

do $$
declare
  v_agency uuid := '06060606-0606-0606-0606-060606060601';
  v_tenant uuid := '06060606-0606-0606-0606-060606060602';
  v_user   uuid := '06060606-0606-0606-0606-060606060603';
  v_pa     uuid := '06060606-0606-0606-0606-060606060604';
  v_space  uuid;
  v_seen   int;
begin
  raise notice '06_safety_net_triggers: bootstrapping synthetic data';

  insert into auth.users (id, email) values
    (v_user, 'u@06safety.test'),
    (v_pa,   'pa@06safety.test');
  insert into public.platform_admins (user_id) values (v_pa);
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'SafetyAg06', 'safety06-ag', 'safety06-ag', 'Safety06Ag', 'ag@06safety.test');
  insert into public.tenants (id, name, slug, subdomain, agency_id)
    values (v_tenant, 'SafetyTenant06', 'safety06-t', 'safety06-t', v_agency);
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_pa, 'owner');

  insert into public.spaces (tenant_id, name, created_by)
    values (v_tenant, 'safety06-space', v_pa);
  select id into v_space from public.spaces where tenant_id = v_tenant and name = 'safety06-space' limit 1;

  -- ----------------------------------------------------------------
  -- Test 1: direct INSERT into tenant_members fires tenant_member.added
  -- The trigger checks audit.suppress_trigger; we clear it explicitly
  -- to ensure no prior record_audit_event call in this session suppresses it.
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: [1/5] direct INSERT into tenant_members fires tenant_member.added';
  perform set_config('audit.suppress_trigger', '', true);
  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  -- v_user is a second owner so v_pa stays as last owner
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_user, 'owner');

  select count(*) into v_seen from public.audit_events
    where action = 'tenant_member.added'
      and source = 'trigger'
      and tenant_id = v_tenant
      and metadata ->> 'member_user_id' = v_user::text;
  if v_seen <> 1 then
    raise exception 'SAFETY FAIL #1: expected 1 trigger-sourced tenant_member.added, got %', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- Test 2: space_members role change fires space_member.role_changed
  -- (tenant_members.role only allows 'owner' via check constraint; the
  -- role_changed trigger branch is exercised via space_members which
  -- supports owner/editor/viewer.)
  -- We add v_pa as space owner (bypassed) then add v_user as owner
  -- (bypassed), so v_user is not the last owner and can be demoted.
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: [2/5] direct UPDATE on space_members.role fires space_member.role_changed';

  -- add v_pa as space owner first (suppress trigger so no audit noise)
  perform set_config('audit.suppress_trigger', 'bypass-setup', true);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_pa, 'owner')
    on conflict (space_id, user_id) do update set role = 'owner';

  -- add v_user as second owner (suppress trigger)
  perform set_config('audit.suppress_trigger', 'bypass-setup', true);
  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_user, 'owner')
    on conflict (space_id, user_id) do update set role = 'owner';

  -- now demote v_user to editor; v_pa remains as last owner so guard allows it
  perform set_config('audit.suppress_trigger', '', true);
  update public.space_members
    set role = 'editor'
    where space_id = v_space and user_id = v_user;

  select count(*) into v_seen from public.audit_events
    where action = 'space_member.role_changed'
      and source = 'trigger'
      and space_id = v_space
      and metadata ->> 'member_user_id' = v_user::text
      and metadata ->> 'role_was' = 'owner'
      and metadata ->> 'role_now' = 'editor';
  if v_seen <> 1 then
    raise exception 'SAFETY FAIL #2: expected 1 trigger-sourced space_member.role_changed, got %', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- Test 3: direct DELETE from tenant_members fires tenant_member.removed
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: [3/5] direct DELETE from tenant_members fires tenant_member.removed';
  perform set_config('audit.suppress_trigger', '', true);
  perform set_config('clint.member_guard_cascade', 'on', true);

  delete from public.tenant_members where tenant_id = v_tenant and user_id = v_user;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant_member.removed'
      and source = 'trigger'
      and tenant_id = v_tenant
      and metadata ->> 'member_user_id' = v_user::text;
  if v_seen <> 1 then
    raise exception 'SAFETY FAIL #3: expected 1 trigger-sourced tenant_member.removed, got %', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- Test 4: direct INSERT into platform_admins fires platform_admin.granted
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: [4/5] direct INSERT into platform_admins fires platform_admin.granted';
  perform set_config('audit.suppress_trigger', '', true);

  insert into public.platform_admins (user_id) values (v_user);

  select count(*) into v_seen from public.audit_events
    where action = 'platform_admin.granted'
      and source = 'trigger'
      and resource_id = v_user;
  if v_seen <> 1 then
    raise exception 'SAFETY FAIL #4: expected 1 trigger-sourced platform_admin.granted, got %', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- Test 5: direct UPDATE of tenants.suspended_at (NULL -> timestamp) fires tenant.suspend
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: [5/5] direct UPDATE on tenants.suspended_at fires tenant.suspend';
  perform set_config('audit.suppress_trigger', '', true);

  update public.tenants
    set suspended_at = now()
    where id = v_tenant;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant.suspend'
      and source = 'trigger'
      and tenant_id = v_tenant;
  if v_seen <> 1 then
    raise exception 'SAFETY FAIL #5: expected 1 trigger-sourced tenant.suspend, got %', v_seen;
  end if;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '06_safety_net_triggers: cleanup (synthetic data)';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events
    where action in ('tenant_member.added','tenant_member.removed','tenant_member.role_changed',
                     'space_member.added','space_member.removed','space_member.role_changed',
                     'platform_admin.granted','platform_admin.revoked','tenant.suspend')
      and (tenant_id = v_tenant or space_id = v_space or resource_id in (v_user, v_pa));

  delete from public.platform_admins where user_id in (v_user, v_pa);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id = v_space;
  delete from public.spaces         where id = v_space;
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  -- clear retired_hostnames so this test is re-runnable without the 90-day holdback
  delete from public.retired_hostnames where previous_id in (v_tenant, v_agency);
  delete from auth.users where id in (v_user, v_pa);

  raise notice '06_safety_net_triggers: PASS (5 trigger invariants: tenant_member add/remove, space_member role_changed, platform_admin grant, tenant suspend)';
end $$;
