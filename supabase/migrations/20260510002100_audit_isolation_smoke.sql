-- migration: 20260510002100_audit_isolation_smoke
-- purpose: assertion-style test for audit_events RLS. creates synthetic two-tenant /
--   multi-role data, verifies strict-scope owner-only visibility across every actor
--   type, then cleans up. idempotent under supabase db reset.
-- pattern: matches 20260428042300_whitelabel_isolation_smoke_tests.sql

do $$
declare
  v_agency          uuid := '11111111-1111-1111-1111-111111111111';
  v_tenant_a        uuid := '12121212-1212-1212-1212-121212121212';
  v_tenant_b        uuid := '13131313-1313-1313-1313-131313131313';
  v_space_a         uuid;
  v_space_b         uuid;
  v_pa              uuid := '21212121-2121-2121-2121-212121212121';
  v_to_a            uuid := '22222222-2222-2222-2222-222222222222';
  v_to_b            uuid := '23232323-2323-2323-2323-232323232323';
  v_ao_only         uuid := '24242424-2424-2424-2424-242424242424';
  v_space_owner_a   uuid := '25252525-2525-2525-2525-252525252525';
  v_space_editor_a  uuid := '26262626-2626-2626-2626-262626262626';
  v_seen            int;
begin
  -- ----------------------------------------------------------------
  -- bootstrap: users, agency, tenants, spaces, memberships
  -- ----------------------------------------------------------------
  insert into auth.users (id, email) values
    (v_pa,             'pa@audit-iso.test'),
    (v_to_a,           'toa@audit-iso.test'),
    (v_to_b,           'tob@audit-iso.test'),
    (v_ao_only,        'ao@audit-iso.test'),
    (v_space_owner_a,  'soa@audit-iso.test'),
    (v_space_editor_a, 'sea@audit-iso.test');

  insert into public.platform_admins (user_id) values (v_pa);

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Audit Iso Ag', 'audit-iso-ag', 'audit-iso-ag', 'AuditIso', 'iso@audit-iso.test');

  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency, v_ao_only, 'owner');

  insert into public.tenants (id, name, slug, subdomain, agency_id) values
    (v_tenant_a, 'IsoTenantA', 'audit-iso-t-a', 'audit-iso-t-a', v_agency),
    (v_tenant_b, 'IsoTenantB', 'audit-iso-t-b', 'audit-iso-t-b', v_agency);

  insert into public.tenant_members (tenant_id, user_id, role) values
    (v_tenant_a, v_to_a, 'owner'),
    (v_tenant_b, v_to_b, 'owner');

  insert into public.spaces (tenant_id, name, created_by) values
    (v_tenant_a, 'iso-sa', v_to_a),
    (v_tenant_b, 'iso-sb', v_to_b);

  select id into v_space_a from public.spaces where tenant_id = v_tenant_a and name = 'iso-sa' limit 1;
  select id into v_space_b from public.spaces where tenant_id = v_tenant_b and name = 'iso-sb' limit 1;

  insert into public.space_members (space_id, user_id, role) values
    (v_space_a, v_space_owner_a,  'owner'),
    (v_space_a, v_space_editor_a, 'editor');

  -- ----------------------------------------------------------------
  -- seed audit_events with predictable actions so counts are exact.
  -- record_audit_event is SECURITY DEFINER; it reads auth.uid() from
  -- request.jwt.claim.sub, so we set that before each call.
  -- we stay in the postgres (superuser) role during inserts so that
  -- the INSERT path is not gated by RLS. the SELECT assertions below
  -- switch to the authenticated role to activate RLS.
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  -- agency-scoped: visible only to agency owners and platform admins
  perform public.record_audit_event(
    'iso.test.agency', 'system', 'test',
    v_agency,    -- p_resource_id
    v_agency,    -- p_agency_id
    null,        -- p_tenant_id
    null,        -- p_space_id
    '{}'::jsonb
  );

  -- tenant_a-scoped: visible only to tenant_a owners and platform admins
  perform public.record_audit_event(
    'iso.test.tenant_a', 'system', 'test',
    v_tenant_a,  -- p_resource_id
    null,        -- p_agency_id
    v_tenant_a,  -- p_tenant_id
    null,        -- p_space_id
    '{}'::jsonb
  );

  -- tenant_b-scoped: visible only to tenant_b owners and platform admins
  perform public.record_audit_event(
    'iso.test.tenant_b', 'system', 'test',
    v_tenant_b,  -- p_resource_id
    null,        -- p_agency_id
    v_tenant_b,  -- p_tenant_id
    null,        -- p_space_id
    '{}'::jsonb
  );

  -- space_a-scoped: visible only to space_a owners and platform admins
  perform public.record_audit_event(
    'iso.test.space_a', 'system', 'test',
    v_space_a,   -- p_resource_id
    null,        -- p_agency_id
    v_tenant_a,  -- p_tenant_id (required for space rows)
    v_space_a,   -- p_space_id
    '{}'::jsonb
  );

  -- ----------------------------------------------------------------
  -- assertion 1: tenant owner A sees their own tenant row, not B's
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_to_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where action = 'iso.test.tenant_a';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #1: tenant owner A sees % iso.test.tenant_a rows, expected 1', v_seen;
  end if;

  select count(*) into v_seen from public.audit_events
    where action = 'iso.test.tenant_b';
  if v_seen <> 0 then
    raise exception 'RLS FAIL #2: tenant owner A sees % iso.test.tenant_b rows, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- assertion 2: agency owner (no tenant membership) sees agency row,
  -- NOT tenant-scoped rows (strict scope: agency_id-path only)
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_ao_only::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where action = 'iso.test.agency';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #3: agency owner sees % iso.test.agency rows, expected 1', v_seen;
  end if;

  select count(*) into v_seen from public.audit_events
    where action in ('iso.test.tenant_a', 'iso.test.tenant_b');
  if v_seen <> 0 then
    raise exception 'RLS FAIL #4: agency owner without tenant membership sees % tenant rows, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- assertion 3: space owner sees the space-scoped row
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_space_owner_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where action = 'iso.test.space_a';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #5: space owner A sees % iso.test.space_a rows, expected 1', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- assertion 4: space editor sees zero audit rows (editor role is
  -- insufficient; RLS requires owner on the space path)
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_space_editor_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where space_id = v_space_a;
  if v_seen <> 0 then
    raise exception 'RLS FAIL #6: space editor sees % space rows, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- assertion 5: platform admin sees all iso.test.* rows
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where action like 'iso.test.%';
  if v_seen < 4 then
    raise exception 'RLS FAIL #7: platform admin sees % iso.test.* rows, expected >= 4', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- cleanup: delete as superuser (postgres role, after reset role)
  -- so the locked write path does not block test teardown.
  -- delete spaces directly (not space_members first) so the
  -- spaces_member_guard_cascade_start trigger fires and sets
  -- clint.member_guard_cascade = 'on', allowing the FK cascade
  -- on space_members to bypass the last-owner guard.
  -- ----------------------------------------------------------------
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events where action like 'iso.test.%';
  -- cleanup order matters. the last-owner guards on space_members and
  -- tenant_members bypass when clint.member_guard_cascade='on'. the
  -- cascade guard triggers (BEFORE/AFTER STATEMENT on parent tables) set
  -- and reset that GUC around each statement-level delete. to avoid the
  -- AFTER trigger resetting the flag mid-cleanup, we:
  --   1. set the flag, delete space_members explicitly (guard bypassed)
  --   2. delete spaces (empty cascade - AFTER trigger resets flag to 'off', harmless)
  --   3. set the flag again, delete tenant_members explicitly (guard bypassed)
  --   4. delete tenants (empty cascade - guard resets flag to 'off', harmless)
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id in (v_space_a, v_space_b);
  delete from public.spaces         where id in (v_space_a, v_space_b);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenants        where id in (v_tenant_a, v_tenant_b);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.agency_members where agency_id = v_agency;
  delete from public.agencies       where id = v_agency;
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_to_a, v_to_b, v_ao_only, v_space_owner_a, v_space_editor_a);

  raise notice 'audit isolation smoke: PASS (all 7 RLS invariants verified)';
end $$;
