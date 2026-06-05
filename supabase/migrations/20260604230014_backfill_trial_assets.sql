-- Backfill: one primary trial_assets row per existing trial, mirroring
-- trials.asset_id. Trials inserted after this migration (and after
-- 20260604225708_trial_assets_triggers.sql) already have a bootstrap row;
-- the on conflict clause makes this idempotent.
--
-- At local db reset time there are zero trials (seed runs after migrations),
-- so the backfill is a no-op in that path. The smoke block below simulates
-- a legacy (pre-trigger) trial to prove the statement works.

-- One primary membership per existing trial, mirroring its current asset_id.
insert into public.trial_assets (trial_id, asset_id, is_primary, source)
select t.id, t.asset_id, true, 'backfill'
  from public.trials t
on conflict (trial_id, asset_id) do nothing;

-- =============================================================================
-- smoke: legacy trial backfill + 1:1 invariant
-- UUID prefix cccc3333-... is unique to this migration.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'cccc3333-3c01-3c01-3c01-cccc3333c101';
  v_tenant_id  uuid := 'cccc3333-3c02-3c02-3c02-cccc3333c102';
  v_owner_id   uuid := 'cccc3333-3c03-3c03-3c03-cccc3333c103';
  v_space_id   uuid := 'cccc3333-3c04-3c04-3c04-cccc3333c104';
  v_company_id uuid := 'cccc3333-3c05-3c05-3c05-cccc3333c105';
  v_asset_a    uuid := 'cccc3333-3c06-3c06-3c06-cccc3333c106';
  v_trial      uuid := 'cccc3333-3c07-3c07-3c07-cccc3333c107';
  v_row_count  int;
  v_asset_id   uuid;
  v_broken_count bigint;
begin
  -- fixtures in FK order
  insert into auth.users (id, email) values (v_owner_id, 'trial-assets-t3-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'TA3', 'ta3', 'ta3', 'TA3', 'ta3@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'TA3', 'ta3-t', 'ta3t', 'TA3');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'TA3 Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name)
    values (v_asset_a, v_space_id, v_owner_id, v_company_id, 'AssetA');
  -- Bootstrap trigger fires here, auto-creating a primary trial_assets row.
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space_id, v_owner_id, v_asset_a, 'TA3 Trial', 'NCT-TA3-001');

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- ASSERTION 1: Simulate a legacy (pre-trigger) trial by deleting the bootstrap row.
  -- trials.asset_id should remain asset_a (sync trigger does not null it when no rows remain).
  delete from public.trial_assets where trial_id = v_trial;

  select count(*) into v_row_count from public.trial_assets where trial_id = v_trial;
  if v_row_count <> 0 then
    raise exception 'backfill smoke FAIL: expected 0 trial_assets rows after simulated legacy delete, got %', v_row_count;
  end if;

  select asset_id into v_asset_id from public.trials where id = v_trial;
  if v_asset_id is distinct from v_asset_a then
    raise exception 'backfill smoke FAIL: trials.asset_id changed after deleting trial_assets; expected asset_a, got %', v_asset_id;
  end if;

  -- ASSERTION 2: Run the backfill statement (exactly as in the migration body).
  -- The trial now looks like a legacy trial: exists but has no trial_assets row.
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  select t.id, t.asset_id, true, 'backfill'
    from public.trials t
  on conflict (trial_id, asset_id) do nothing;

  select count(*) into v_row_count
    from public.trial_assets where trial_id = v_trial;
  if v_row_count <> 1 then
    raise exception 'backfill smoke FAIL: expected 1 trial_assets row after backfill, got %', v_row_count;
  end if;

  if not exists (
    select 1 from public.trial_assets
     where trial_id = v_trial and is_primary and asset_id = v_asset_a
  ) then
    raise exception 'backfill smoke FAIL: backfilled row is not is_primary=true for asset_a';
  end if;

  -- ASSERTION 3: 1:1 invariant -- no trial in the database lacks a matching primary membership.
  select count(*) into v_broken_count
    from public.trials t
    left join public.trial_assets ta
      on ta.trial_id = t.id and ta.is_primary
   where ta.asset_id is null or ta.asset_id <> t.asset_id;

  if v_broken_count <> 0 then
    raise exception 'backfill smoke FAIL: 1:1 invariant violated; % trial(s) missing or mismatched primary', v_broken_count;
  end if;

  raise notice 'backfill smoke ok: legacy trial backfilled; 1:1 primary invariant holds';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);
end$$;
