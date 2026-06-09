-- Tests the inventory counts returned by get_space_landing_stats, specifically
-- that `trials` counts ALL trials (matching the Manage > Trials page and the
-- sibling companies/assets totals) while `active_trials` excludes terminal
-- statuses. Wrapped in a transaction so it rolls back cleanly.

begin;

set local row_security = off;

do $$
declare
  v_space_id   uuid := gen_random_uuid();
  v_tenant_id  uuid := gen_random_uuid();
  v_user_id    uuid := gen_random_uuid();
  v_company_id uuid := gen_random_uuid();
  v_asset_id   uuid := gen_random_uuid();
  v_result jsonb;
begin
  insert into auth.users (id, email)
    values (v_user_id, 'test-inventory-counts@example.com');
  perform set_config('request.jwt.claims',
    json_build_object('sub', v_user_id)::text, true);

  insert into public.tenants (id, name, slug)
    values (v_tenant_id, 'Test Tenant',
            'test-inventory-' || substr(v_space_id::text, 1, 8));
  insert into public.spaces (id, tenant_id, name, created_by)
    values (v_space_id, v_tenant_id, 'Test Space', v_user_id);
  insert into public.space_members (space_id, user_id, role)
    values (v_space_id, v_user_id, 'owner');
  insert into public.companies (id, space_id, name, created_by)
    values (v_company_id, v_space_id, 'Test Co', v_user_id);
  insert into public.assets (id, space_id, company_id, name, created_by)
    values (v_asset_id, v_space_id, v_company_id, 'Test Asset', v_user_id);

  -- Four trials: 2 active (recruiting / null), 1 completed, 1 terminated.
  -- active_trials should count 2; trials (total) should count 4.
  insert into public.trials (id, space_id, asset_id, name, phase, recruitment_status, created_by)
  values
    (gen_random_uuid(), v_space_id, v_asset_id, 'Active recruiting', 'Phase 3', 'recruiting', v_user_id),
    (gen_random_uuid(), v_space_id, v_asset_id, 'Active no-status',  'Phase 2', null,         v_user_id),
    (gen_random_uuid(), v_space_id, v_asset_id, 'Completed',         'Phase 3', 'completed',  v_user_id),
    (gen_random_uuid(), v_space_id, v_asset_id, 'Terminated',        'Phase 1', 'terminated', v_user_id);

  v_result := public.get_space_landing_stats(v_space_id);
  raise notice 'result: %', v_result;

  assert (v_result ->> 'active_trials')::int = 2,
    format('expected active_trials = 2, got %s', v_result ->> 'active_trials');
  assert (v_result ->> 'trials')::int = 4,
    format('expected trials (total) = 4, got %s', v_result ->> 'trials');
  assert (v_result ->> 'companies')::int = 1,
    format('expected companies = 1, got %s', v_result ->> 'companies');
  assert (v_result ->> 'programs')::int = 1,
    format('expected programs = 1, got %s', v_result ->> 'programs');

  raise notice 'all inventory-count assertions passed';
end;
$$;

rollback;
