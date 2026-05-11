-- 08_rpc_emission_branding
-- Asserts update_tenant_branding emits tenant.branding_updated with
-- metadata.changed_fields listing the submitted fields.
-- Asserts update_agency_branding emits agency.branding_updated similarly.
--
-- Predictable UUID prefix: 08xxxxxx-08xx-08xx-08xx-08xxxxxxxxxx

do $$
declare
  v_pa        uuid := '08080808-0808-0808-0808-080808080801';
  v_ao        uuid := '08080808-0808-0808-0808-080808080802';
  v_agency    uuid := '08080808-0808-0808-0808-080808080803';
  v_tenant    uuid := '08080808-0808-0808-0808-080808080804';
  v_result    jsonb;
  v_seen      int;
  v_meta      jsonb;
  v_fields    jsonb;
begin
  raise notice '08_rpc_emission_branding: bootstrapping synthetic agency and tenant';

  insert into auth.users (id, email) values
    (v_pa, 'pa@08brand.test'),
    (v_ao, 'ao@08brand.test');
  insert into public.platform_admins (user_id) values (v_pa);

  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'Brand08Ag', 'brand08-ag', 'brand08-ag', 'Brand08Ag', 'ag@08brand.test');
  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency, v_ao, 'owner');

  insert into public.tenants (id, name, slug, subdomain, agency_id)
    values (v_tenant, 'Brand08T', 'brand08-t', 'brand08-t', v_agency);
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant, v_pa, 'owner');

  -- ----------------------------------------------------------------
  -- Test 1: update_tenant_branding emits tenant.branding_updated
  -- We change two fields: app_display_name and primary_color.
  -- metadata.changed_fields must list exactly those two fields.
  -- ----------------------------------------------------------------
  raise notice '08_rpc_emission_branding: [1/2] calling update_tenant_branding (app_display_name + primary_color)';

  perform set_config('request.jwt.claim.sub', v_pa::text, true);
  set local role authenticated;

  v_result := public.update_tenant_branding(
    v_tenant,
    jsonb_build_object(
      'app_display_name', 'Brand08TUpdated',
      'primary_color',    '#1a2b3c'
    )
  );

  reset role;

  select count(*) into v_seen from public.audit_events
    where action = 'tenant.branding_updated'
      and source = 'rpc'
      and tenant_id = v_tenant;
  if v_seen <> 1 then
    raise exception 'BRANDING FAIL #1: expected 1 tenant.branding_updated audit row, got %', v_seen;
  end if;

  select metadata into v_meta from public.audit_events
    where action = 'tenant.branding_updated' and tenant_id = v_tenant limit 1;

  v_fields := v_meta -> 'changed_fields';
  if v_fields is null then
    raise exception 'BRANDING FAIL #2: metadata.changed_fields is null, got %', v_meta;
  end if;
  if not (v_fields @> '["app_display_name"]'::jsonb) then
    raise exception 'BRANDING FAIL #3: changed_fields missing app_display_name, got %', v_fields;
  end if;
  if not (v_fields @> '["primary_color"]'::jsonb) then
    raise exception 'BRANDING FAIL #4: changed_fields missing primary_color, got %', v_fields;
  end if;
  -- logo_url was NOT submitted, so it must not appear in changed_fields
  if v_fields @> '["logo_url"]'::jsonb then
    raise exception 'BRANDING FAIL #5: changed_fields incorrectly includes logo_url, got %', v_fields;
  end if;

  raise notice '08_rpc_emission_branding: tenant.branding_updated verified (changed_fields: %)', v_fields;

  -- ----------------------------------------------------------------
  -- Test 2: update_agency_branding emits agency.branding_updated
  -- We change contact_email only.
  -- metadata.changed_fields must list contact_email.
  -- ----------------------------------------------------------------
  raise notice '08_rpc_emission_branding: [2/2] calling update_agency_branding (contact_email)';

  perform set_config('request.jwt.claim.sub', v_ao::text, true);
  set local role authenticated;

  v_result := public.update_agency_branding(
    v_agency,
    jsonb_build_object('contact_email', 'new@08brand.test')
  );

  reset role;

  select count(*) into v_seen from public.audit_events
    where action = 'agency.branding_updated'
      and source = 'rpc'
      and agency_id = v_agency;
  if v_seen <> 1 then
    raise exception 'BRANDING FAIL #6: expected 1 agency.branding_updated audit row, got %', v_seen;
  end if;

  select metadata into v_meta from public.audit_events
    where action = 'agency.branding_updated' and agency_id = v_agency limit 1;

  v_fields := v_meta -> 'changed_fields';
  if not (v_fields @> '["contact_email"]'::jsonb) then
    raise exception 'BRANDING FAIL #7: changed_fields missing contact_email, got %', v_fields;
  end if;
  if v_fields @> '["primary_color"]'::jsonb then
    raise exception 'BRANDING FAIL #8: changed_fields incorrectly includes primary_color, got %', v_fields;
  end if;

  raise notice '08_rpc_emission_branding: agency.branding_updated verified (changed_fields: %)', v_fields;

  -- ----------------------------------------------------------------
  -- cleanup
  -- ----------------------------------------------------------------
  raise notice '08_rpc_emission_branding: cleanup';
  perform set_config('request.jwt.claim.sub', '', true);

  delete from public.audit_events
    where action in ('tenant.branding_updated','agency.branding_updated')
      and (tenant_id = v_tenant or agency_id = v_agency);

  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.agency_members where agency_id = v_agency;
  delete from public.agencies where id = v_agency;
  -- clear retired_hostnames so this test is re-runnable without the 90-day holdback
  delete from public.retired_hostnames where previous_id in (v_tenant, v_agency);
  delete from public.platform_admins where user_id = v_pa;
  delete from auth.users where id in (v_pa, v_ao);

  raise notice '08_rpc_emission_branding: PASS (tenant.branding_updated and agency.branding_updated emit correct changed_fields)';
end $$;
