-- 05_rls_strict_scope
-- Exercises the 7 RLS invariants from migration 20260510002100_audit_isolation_smoke.sql
-- with verbose narrative output explaining the visibility model at each step.
--
-- Invariant recap (what the policy enforces):
--   1. Tenant owner A sees own tenant row; NOT tenant B's row.
--   2. Tenant owner A does NOT see tenant B's row.
--   3. Agency owner (no tenant membership) sees agency-scoped row.
--   4. Agency owner does NOT see tenant-scoped rows (strict scope: no cascade).
--   5. Space owner sees space-scoped row.
--   6. Space editor sees ZERO audit rows (editor is insufficient; only owner qualifies).
--   7. Platform admin sees all audit_events rows.
--
-- Predictable UUID prefix: 05xxxxxx-05xx-05xx-05xx-05xxxxxxxxxx

do $$
declare
  v_agency        uuid := '05050505-0505-0505-0505-050505050501';
  v_tenant_a      uuid := '05050505-0505-0505-0505-050505050502';
  v_tenant_b      uuid := '05050505-0505-0505-0505-050505050503';
  v_space_a       uuid;
  v_space_b       uuid;
  v_pa            uuid := '05050505-0505-0505-0505-050505050510';
  v_to_a          uuid := '05050505-0505-0505-0505-050505050511';
  v_to_b          uuid := '05050505-0505-0505-0505-050505050512';
  v_ao_only       uuid := '05050505-0505-0505-0505-050505050513';
  v_space_owner_a uuid := '05050505-0505-0505-0505-050505050514';
  v_space_editor_a uuid := '05050505-0505-0505-0505-050505050515';
  v_seen          int;
begin
  raise notice '05_rls_strict_scope: bootstrapping users, agency, tenants, spaces, memberships';

  insert into auth.users (id, email) values
    (v_pa,             'pa@05rls.test'),
    (v_to_a,           'toa@05rls.test'),
    (v_to_b,           'tob@05rls.test'),
    (v_ao_only,        'ao@05rls.test'),
    (v_space_owner_a,  'soa@05rls.test'),
    (v_space_editor_a, 'sea@05rls.test');

  insert into public.platform_admins (user_id) values (v_pa);

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'RLS05Ag', 'rls05-ag', 'rls05-ag', 'RLS05Ag', 'ag@05rls.test');

  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency, v_ao_only, 'owner');

  insert into public.tenants (id, name, slug, subdomain, agency_id) values
    (v_tenant_a, 'RLS05TenantA', 'rls05-ta', 'rls05-ta', v_agency),
    (v_tenant_b, 'RLS05TenantB', 'rls05-tb', 'rls05-tb', v_agency);

  insert into public.tenant_members (tenant_id, user_id, role) values
    (v_tenant_a, v_to_a, 'owner'),
    (v_tenant_b, v_to_b, 'owner');

  insert into public.spaces (tenant_id, name, created_by) values
    (v_tenant_a, 'rls05-sa', v_to_a),
    (v_tenant_b, 'rls05-sb', v_to_b);

  select id into v_space_a from public.spaces where tenant_id = v_tenant_a and name = 'rls05-sa' limit 1;
  select id into v_space_b from public.spaces where tenant_id = v_tenant_b and name = 'rls05-sb' limit 1;

  insert into public.space_members (space_id, user_id, role) values
    (v_space_a, v_space_owner_a,  'owner'),
    (v_space_a, v_space_editor_a, 'editor');

  raise notice '05_rls_strict_scope: seeding 4 audit events at different scopes';
  perform set_config('request.jwt.claim.sub', v_pa::text, true);

  -- agency-scoped row: visible to agency owner + platform admin
  perform public.record_audit_event(
    '05rls.test.agency', 'system', 'test', v_agency,
    v_agency, null, null, '{}'::jsonb
  );
  -- tenant_a-scoped row: visible to tenant owner A + platform admin
  perform public.record_audit_event(
    '05rls.test.tenant_a', 'system', 'test', v_tenant_a,
    null, v_tenant_a, null, '{}'::jsonb
  );
  -- tenant_b-scoped row: visible to tenant owner B + platform admin
  perform public.record_audit_event(
    '05rls.test.tenant_b', 'system', 'test', v_tenant_b,
    null, v_tenant_b, null, '{}'::jsonb
  );
  -- space_a-scoped row: visible to space owner A + platform admin
  perform public.record_audit_event(
    '05rls.test.space_a', 'system', 'test', v_space_a,
    null, v_tenant_a, v_space_a, '{}'::jsonb
  );

  -- ----------------------------------------------------------------
  -- Invariant 1: tenant owner A sees their own tenant row
  -- The policy grants SELECT when tenant_id matches and
  -- is_tenant_owner_strict() returns true for the caller.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 1] tenant owner A sees their own tenant-scoped row';
  perform set_config('request.jwt.claim.sub', v_to_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where action = '05rls.test.tenant_a';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #1: tenant owner A sees % rows for 05rls.test.tenant_a, expected 1', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 2: tenant owner A does NOT see tenant B's row
  -- Strict scope means is_tenant_owner_strict(tenant_b_id) returns
  -- false for tenant owner A because they have no row in tenant_members
  -- for tenant B.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 2] tenant owner A cannot see tenant B row (strict scope, no cross-tenant cascade)';
  perform set_config('request.jwt.claim.sub', v_to_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where action = '05rls.test.tenant_b';
  if v_seen <> 0 then
    raise exception 'RLS FAIL #2: tenant owner A sees % rows for 05rls.test.tenant_b, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 3: agency owner (no tenant membership) sees agency-scoped row
  -- Agency owner qualifies via is_agency_member(agency_id, ['owner']).
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 3] agency owner sees agency-scoped row';
  perform set_config('request.jwt.claim.sub', v_ao_only::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where action = '05rls.test.agency';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #3: agency owner sees % rows for 05rls.test.agency, expected 1', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 4: agency owner without tenant membership does NOT see tenant rows
  -- This is the "strict" in strict-scope: unlike is_tenant_member (which cascades
  -- from agency-owner), is_tenant_owner_strict only checks tenant_members directly.
  -- An agency owner who is not also in tenant_members gets zero tenant rows.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 4] agency owner without tenant membership sees zero tenant rows (no cascade)';
  perform set_config('request.jwt.claim.sub', v_ao_only::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events
    where action in ('05rls.test.tenant_a', '05rls.test.tenant_b');
  if v_seen <> 0 then
    raise exception 'RLS FAIL #4: agency owner sees % tenant rows without tenant_members entry, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 5: space owner sees the space-scoped row
  -- has_space_access(space_id, ['owner']) returns true for the space owner.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 5] space owner sees space-scoped row';
  perform set_config('request.jwt.claim.sub', v_space_owner_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where action = '05rls.test.space_a';
  if v_seen <> 1 then
    raise exception 'RLS FAIL #5: space owner A sees % rows for 05rls.test.space_a, expected 1', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 6: space editor sees zero audit rows
  -- The RLS policy requires has_space_access(space_id, ['owner']).
  -- editor role is insufficient: the policy enforces owner-only on the space path.
  -- This is a deliberate design decision: editors run the space, but only owners
  -- have governance visibility.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 6] space editor sees zero audit rows (editor role is insufficient, owner required)';
  perform set_config('request.jwt.claim.sub', v_space_editor_a::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where space_id = v_space_a;
  if v_seen <> 0 then
    raise exception 'RLS FAIL #6: space editor sees % space-scoped rows, expected 0', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- Invariant 7: platform admin sees all 05rls.test.* rows
  -- is_platform_admin() returns true; the policy OR-chain short-circuits.
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: [invariant 7] platform admin sees all 05rls.test.* rows (unrestricted scope)';
  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  select count(*) into v_seen from public.audit_events where action like '05rls.test.%';
  if v_seen < 4 then
    raise exception 'RLS FAIL #7: platform admin sees % rows for 05rls.test.*, expected >= 4', v_seen;
  end if;

  reset role;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '05_rls_strict_scope: cleanup (synthetic data)';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events where action like '05rls.test.%';

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id in (v_space_a, v_space_b);
  delete from public.spaces         where id in (v_space_a, v_space_b);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id in (v_tenant_a, v_tenant_b);
  delete from public.tenants        where id in (v_tenant_a, v_tenant_b);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.agency_members where agency_id = v_agency;
  delete from public.agencies       where id = v_agency;
  -- clear retired_hostnames entries so this test is re-runnable without the 90-day holdback
  delete from public.retired_hostnames where previous_id in (v_agency, v_tenant_a, v_tenant_b);
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_to_a, v_to_b, v_ao_only, v_space_owner_a, v_space_editor_a);

  raise notice '05_rls_strict_scope: PASS (all 7 visibility invariants verified)';
end $$;
