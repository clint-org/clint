-- 07_rpc_emission_provision
-- Asserts provision_agency and provision_tenant emit audit events with
-- source='rpc', correct scope columns, and correct metadata.
--
-- provision_agency requires is_platform_admin(); we bootstrap a platform admin
-- user and impersonate them via request.jwt.claim.sub.
-- provision_tenant requires is_agency_member(agency_id, ['owner']) or platform admin.
--
-- Both RPCs are SECURITY DEFINER so we call them while set to authenticated role.
--
-- Predictable UUID prefix: 07xxxxxx-07xx-07xx-07xx-07xxxxxxxxxx

do $$
declare
  v_pa        uuid := '07070707-0707-0707-0707-070707070701';
  v_ao        uuid := '07070707-0707-0707-0707-070707070702';
  v_result    jsonb;
  v_agency_id uuid;
  v_tenant_id uuid;
  v_seen      int;
  v_action    text;
  v_source    text;
  v_meta      jsonb;
  v_scope_ag  uuid;
  v_scope_t   uuid;
begin
  raise notice '07_rpc_emission_provision: bootstrapping platform admin user';

  insert into auth.users (id, email) values
    (v_pa, 'pa@07prov.test'),
    (v_ao, 'ao@07prov.test');
  insert into public.platform_admins (user_id) values (v_pa);

  -- ----------------------------------------------------------------
  -- Test 1: provision_agency emits agency.provision with source='rpc'
  -- ----------------------------------------------------------------
  raise notice '07_rpc_emission_provision: [1/2] calling provision_agency as platform admin';

  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  -- provision_agency checks is_platform_admin() and inserts into agencies.
  -- The owner email (v_ao) must exist in auth.users for a direct membership insert;
  -- otherwise an invite is created. We use v_ao here so the function adds a member.
  v_result := public.provision_agency(
    'ProvTest07Ag',      -- p_name
    'provtest07-ag',     -- p_slug
    'provtest07-ag',     -- p_subdomain
    'ao@07prov.test',    -- p_owner_email (v_ao exists in auth.users)
    'contact@07prov.test'
  );

  reset role;

  v_agency_id := (v_result ->> 'id')::uuid;
  raise notice '07_rpc_emission_provision: provision_agency returned agency_id %', v_agency_id;

  select count(*) into v_seen from public.audit_events
    where action = 'agency.provision'
      and source = 'rpc'
      and agency_id = v_agency_id;
  if v_seen <> 1 then
    raise exception 'PROVISION FAIL #1: expected 1 agency.provision audit row, got %', v_seen;
  end if;

  -- verify metadata contents
  select metadata into v_meta from public.audit_events
    where action = 'agency.provision' and agency_id = v_agency_id limit 1;

  if v_meta ->> 'subdomain' <> 'provtest07-ag' then
    raise exception 'PROVISION FAIL #2: metadata.subdomain mismatch, got %', v_meta;
  end if;
  if v_meta ->> 'display_name' <> 'ProvTest07Ag' then
    raise exception 'PROVISION FAIL #3: metadata.display_name mismatch, got %', v_meta;
  end if;

  raise notice '07_rpc_emission_provision: agency.provision audit event verified (scope, metadata)';

  -- ----------------------------------------------------------------
  -- Test 2: provision_tenant emits tenant.provision with source='rpc'
  -- ----------------------------------------------------------------
  raise notice '07_rpc_emission_provision: [2/2] calling provision_tenant as platform admin';

  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  v_result := public.provision_tenant(
    v_agency_id,         -- p_agency_id
    'ProvTest07T',       -- p_name
    'provtest07-t',      -- p_subdomain
    '{}'::jsonb          -- p_brand
  );

  reset role;

  v_tenant_id := (v_result ->> 'id')::uuid;
  raise notice '07_rpc_emission_provision: provision_tenant returned tenant_id %', v_tenant_id;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant.provision'
      and source = 'rpc'
      and tenant_id = v_tenant_id
      and agency_id = v_agency_id;
  if v_seen <> 1 then
    raise exception 'PROVISION FAIL #4: expected 1 tenant.provision audit row, got %', v_seen;
  end if;

  -- verify metadata
  select metadata into v_meta from public.audit_events
    where action = 'tenant.provision' and tenant_id = v_tenant_id limit 1;

  if v_meta ->> 'subdomain' <> 'provtest07-t' then
    raise exception 'PROVISION FAIL #5: metadata.subdomain mismatch, got %', v_meta;
  end if;
  if v_meta ->> 'name' <> 'ProvTest07T' then
    raise exception 'PROVISION FAIL #6: metadata.name mismatch, got %', v_meta;
  end if;
  if (v_meta ->> 'agency_id')::uuid <> v_agency_id then
    raise exception 'PROVISION FAIL #7: metadata.agency_id mismatch, got %', v_meta;
  end if;

  raise notice '07_rpc_emission_provision: tenant.provision audit event verified (scope, metadata)';

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '07_rpc_emission_provision: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events
    where action in ('agency.provision','tenant.provision','tenant_member.added','agency_member.added')
      and (agency_id = v_agency_id or tenant_id = v_tenant_id);

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.agency_members where agency_id = v_agency_id;
  delete from public.agency_invites  where agency_id = v_agency_id;
  delete from public.agencies where id = v_agency_id;
  -- The hostname retirement trigger fires on agency/tenant delete and inserts into
  -- retired_hostnames with a 90-day holdback. We delete those entries so this test
  -- can be re-run safely without hitting "subdomain not available".
  delete from public.retired_hostnames where previous_id in (v_agency_id, v_tenant_id);
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_ao);

  raise notice '07_rpc_emission_provision: PASS (provision_agency and provision_tenant emit correct audit events)';
end $$;
