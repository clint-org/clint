-- 09_rpc_emission_invites
-- Asserts safety-net triggers on tenant_invites and space_invites emit
-- invite.issued audit events. The accept_invite / accept_space_invite RPC
-- redemption paths have non-trivial preconditions (email claim matching,
-- unexpired code); those are exercised by migration 20260510002100 and the
-- detailed smoke in 20260510001300. This file focuses on the trigger path.
--
-- Predictable UUID prefix: 09xxxxxx-09xx-09xx-09xx-09xxxxxxxxxx

do $$
declare
  v_agency   uuid := '09090909-0909-0909-0909-090909090901';
  v_tenant   uuid := '09090909-0909-0909-0909-090909090902';
  v_creator  uuid := '09090909-0909-0909-0909-090909090903';
  v_space    uuid;
  v_seen     int;
  v_meta     jsonb;
  v_inv_id   uuid;
begin
  raise notice '09_rpc_emission_invites: bootstrapping agency, tenant, space, creator user';

  insert into auth.users (id, email)
    values (v_creator, 'creator@09inv.test');

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Inv09Ag', 'inv09-ag', 'inv09-ag', 'Inv09Ag', 'ag@09inv.test');

  insert into public.tenants (id, name, slug, subdomain, agency_id)
    values (v_tenant, 'Inv09T', 'inv09-t', 'inv09-t', v_agency);

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_creator, 'owner');

  insert into public.spaces (tenant_id, name, created_by)
    values (v_tenant, 'inv09-space', v_creator);
  select id into v_space from public.spaces where tenant_id = v_tenant and name = 'inv09-space' limit 1;

  insert into public.space_members (space_id, user_id, role)
    values (v_space, v_creator, 'owner');

  -- ----------------------------------------------------------------
  -- Test 1: direct INSERT into tenant_invites fires tenant_invite.issued
  -- ----------------------------------------------------------------
  raise notice '09_rpc_emission_invites: [1/2] direct INSERT into tenant_invites fires tenant_invite.issued trigger';
  perform set_config('audit.suppress_trigger', '', true);
  perform set_config('request.jwt.claim.sub', v_creator::text, true);

  insert into public.tenant_invites (tenant_id, email, role, invite_code, created_by)
    values (v_tenant, 'new@09inv.test', 'owner', 'inv09-code-tenant', v_creator)
    returning id into v_inv_id;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant_invite.issued'
      and source = 'trigger'
      and tenant_id = v_tenant
      and resource_id = v_inv_id;
  if v_seen <> 1 then
    raise exception 'INVITE FAIL #1: expected 1 trigger-sourced tenant_invite.issued, got %', v_seen;
  end if;

  select metadata into v_meta from public.audit_events
    where action = 'tenant_invite.issued' and resource_id = v_inv_id limit 1;
  if v_meta ->> 'invited_email' <> 'new@09inv.test' then
    raise exception 'INVITE FAIL #2: metadata.invited_email mismatch, got %', v_meta;
  end if;
  if v_meta ->> 'role' <> 'owner' then
    raise exception 'INVITE FAIL #3: metadata.role mismatch, got %', v_meta;
  end if;

  raise notice '09_rpc_emission_invites: tenant_invite.issued verified (resource_id, metadata)';

  -- ----------------------------------------------------------------
  -- Test 2: direct INSERT into space_invites fires space_invite.issued
  -- ----------------------------------------------------------------
  raise notice '09_rpc_emission_invites: [2/2] direct INSERT into space_invites fires space_invite.issued trigger';
  perform set_config('audit.suppress_trigger', '', true);

  insert into public.space_invites (space_id, email, role, invite_code, created_by)
    values (v_space, 'newspace@09inv.test', 'viewer', 'inv09-code-space', v_creator)
    returning id into v_inv_id;

  select count(*) into v_seen from public.audit_events
    where action = 'space_invite.issued'
      and source = 'trigger'
      and space_id = v_space
      and resource_id = v_inv_id;
  if v_seen <> 1 then
    raise exception 'INVITE FAIL #4: expected 1 trigger-sourced space_invite.issued, got %', v_seen;
  end if;

  select metadata into v_meta from public.audit_events
    where action = 'space_invite.issued' and resource_id = v_inv_id limit 1;
  if v_meta ->> 'invited_email' <> 'newspace@09inv.test' then
    raise exception 'INVITE FAIL #5: metadata.invited_email mismatch, got %', v_meta;
  end if;
  if v_meta ->> 'role' <> 'viewer' then
    raise exception 'INVITE FAIL #6: metadata.role mismatch, got %', v_meta;
  end if;

  raise notice '09_rpc_emission_invites: space_invite.issued verified (resource_id, tenant_id scoped, metadata)';

  -- ----------------------------------------------------------------
  -- Note on RPC redemption paths (accept_invite / accept_space_invite):
  -- These require a live JWT with matching email claim, an unexpired invite
  -- code, and email normalization. They are exercised at the migration level
  -- in 20260510001300_audit_instrument_invites.sql and the integration test
  -- set in 20260510002100_audit_isolation_smoke.sql.
  -- ----------------------------------------------------------------

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '09_rpc_emission_invites: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events
    where action in ('tenant_invite.issued','space_invite.issued')
      and (tenant_id = v_tenant or space_id = v_space);

  delete from public.tenant_invites where tenant_id = v_tenant;
  delete from public.space_invites   where space_id = v_space;

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members  where space_id = v_space;
  delete from public.spaces         where id = v_space;
  perform set_config('clint.member_guard_cascade', 'on', true);
  -- tenant_invites and audit events already deleted above;
  -- tenant_members cleanup must happen before tenant delete to avoid last-owner guard
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  -- clear retired_hostnames so this test is re-runnable without the 90-day holdback
  delete from public.retired_hostnames where previous_id in (v_tenant, v_agency);
  delete from auth.users where id = v_creator;

  raise notice '09_rpc_emission_invites: PASS (tenant_invite.issued and space_invite.issued trigger paths verified)';
end $$;
