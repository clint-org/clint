-- migration: 20260528130200_update_asset_mechanisms_rpc
-- purpose: atomic replacement of an asset's MOA assignments in a single
--          transaction. Same insert-then-prune shape as
--          update_marker_assignments (20260528100000).
--
-- design:
--   AssetService.setMechanisms() previously did DELETE-then-INSERT against
--   asset_mechanisms_of_action in two PostgREST round-trips. No orphan-
--   cleanup trigger fires today, but a future "assets with no MOA should be
--   archived" rule would silently strand the client path, and the network-
--   drop window already loses analyst input. This RPC closes both.
--
--   Empty p_moa_ids is allowed -- "clear all MOAs" is valid. The existing
--   asset-form passes [] explicitly when the analyst deselects everything.
--
-- not @audit:tier1 -- editorial mutation, not governance.
--
-- callers:
--   - src/client/src/app/core/services/asset.service.ts:setMechanisms()
--
-- related:
--   - 20260411130100_create_product_moa_roa_join_tables.sql (table + RLS)
--   - 20260524120200_rename_products_to_assets.sql          (rename + RLS rewrite)
--   - 20260528100000_update_marker_assignments_rpc.sql      (reference pattern)


-- =============================================================================
-- 1. update_asset_mechanisms
-- =============================================================================

create or replace function public.update_asset_mechanisms(
  p_asset_id uuid,
  p_moa_ids  uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_moa_id   uuid;
begin
  select space_id into v_space_id from public.assets where id = p_asset_id;

  if v_space_id is null then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- Insert-then-prune. ON CONFLICT against the (asset_id, moa_id) primary key.
  if p_moa_ids is not null then
    foreach v_moa_id in array p_moa_ids loop
      insert into public.asset_mechanisms_of_action (asset_id, moa_id)
        values (p_asset_id, v_moa_id)
        on conflict (asset_id, moa_id) do nothing;
    end loop;
  end if;

  delete from public.asset_mechanisms_of_action
   where asset_id = p_asset_id
     and moa_id <> all(coalesce(p_moa_ids, array[]::uuid[]));
end;
$$;

revoke execute on function public.update_asset_mechanisms(uuid, uuid[]) from public;
grant  execute on function public.update_asset_mechanisms(uuid, uuid[]) to authenticated;

comment on function public.update_asset_mechanisms(uuid, uuid[]) is
  'Atomically replace asset_mechanisms_of_action for an asset in one transaction. Inserts new MOA assignments first (idempotent on the (asset_id, moa_id) primary key), then deletes stale ones. SECURITY DEFINER. Caller must hold owner/editor on the asset''s space; empty p_moa_ids clears all MOAs.';


-- =============================================================================
-- inline smoke tests
-- =============================================================================

do $$
begin

  -- ===========================================================================
  -- case A: asset with one MOA -> swap to a different MOA.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_moa_a   uuid := gen_random_uuid();
    v_moa_b   uuid := gen_random_uuid();
    v_email   text := 'uam-a-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_m       uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uam-a-tenant', 'uam-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uam-a-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uam-a-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uam-a-drug');
    insert into public.mechanisms_of_action (id, space_id, created_by, name)
      values (v_moa_a, v_space, v_user, 'uam-a-moa-a'),
             (v_moa_b, v_space, v_user, 'uam-a-moa-b');
    insert into public.asset_mechanisms_of_action (asset_id, moa_id) values (v_asset, v_moa_a);

    perform public.update_asset_mechanisms(v_asset, array[v_moa_b]);

    select count(*)::int into v_count from public.asset_mechanisms_of_action where asset_id = v_asset;
    if v_count <> 1 then
      raise exception 'update_asset_mechanisms smoke FAIL case A: expected 1 row, got %', v_count;
    end if;
    select moa_id into v_m from public.asset_mechanisms_of_action where asset_id = v_asset;
    if v_m <> v_moa_b then
      raise exception 'update_asset_mechanisms smoke FAIL case A: expected moa_b, got %', v_m;
    end if;

    raise notice 'update_asset_mechanisms smoke ok A: single-MOA swap';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets         where space_id = v_space;
    delete from public.companies      where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case B: asset with [A, B] -> [B, C]. add/remove diff.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_moa_a   uuid := gen_random_uuid();
    v_moa_b   uuid := gen_random_uuid();
    v_moa_c   uuid := gen_random_uuid();
    v_email   text := 'uam-b-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uam-b-tenant', 'uam-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uam-b-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uam-b-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uam-b-drug');
    insert into public.mechanisms_of_action (id, space_id, created_by, name)
      values (v_moa_a, v_space, v_user, 'uam-b-moa-a'),
             (v_moa_b, v_space, v_user, 'uam-b-moa-b'),
             (v_moa_c, v_space, v_user, 'uam-b-moa-c');
    insert into public.asset_mechanisms_of_action (asset_id, moa_id)
      values (v_asset, v_moa_a),
             (v_asset, v_moa_b);

    perform public.update_asset_mechanisms(v_asset, array[v_moa_b, v_moa_c]);

    select count(*)::int into v_count from public.asset_mechanisms_of_action
     where asset_id = v_asset and moa_id in (v_moa_b, v_moa_c);
    if v_count <> 2 then
      raise exception 'update_asset_mechanisms smoke FAIL case B: expected [B, C], got %', v_count;
    end if;
    select count(*)::int into v_count from public.asset_mechanisms_of_action
     where asset_id = v_asset and moa_id = v_moa_a;
    if v_count <> 0 then
      raise exception 'update_asset_mechanisms smoke FAIL case B: A should be pruned';
    end if;

    raise notice 'update_asset_mechanisms smoke ok B: add/remove diff';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets         where space_id = v_space;
    delete from public.companies      where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case C: empty p_moa_ids clears all MOAs.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_moa_a   uuid := gen_random_uuid();
    v_email   text := 'uam-c-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uam-c-tenant', 'uam-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uam-c-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uam-c-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uam-c-drug');
    insert into public.mechanisms_of_action (id, space_id, created_by, name)
      values (v_moa_a, v_space, v_user, 'uam-c-moa-a');
    insert into public.asset_mechanisms_of_action (asset_id, moa_id) values (v_asset, v_moa_a);

    perform public.update_asset_mechanisms(v_asset, array[]::uuid[]);

    select count(*)::int into v_count from public.asset_mechanisms_of_action where asset_id = v_asset;
    if v_count <> 0 then
      raise exception 'update_asset_mechanisms smoke FAIL case C: expected 0 rows, got %', v_count;
    end if;
    select count(*)::int into v_count from public.assets where id = v_asset;
    if v_count <> 1 then
      raise exception 'update_asset_mechanisms smoke FAIL case C: asset dropped after clear-all';
    end if;

    raise notice 'update_asset_mechanisms smoke ok C: empty clears all, asset survives';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets         where space_id = v_space;
    delete from public.companies      where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case D: viewer rejected with 42501.
  -- ===========================================================================
  declare
    v_owner   uuid := gen_random_uuid();
    v_viewer  uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_moa_a   uuid := gen_random_uuid();
    v_moa_b   uuid := gen_random_uuid();
    v_o_email text := 'uam-d-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'uam-d-v-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uam-d-tenant', 'uam-d-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uam-d-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_o_email)::text,
      true
    );
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_owner, 'uam-d-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_owner, v_company, 'uam-d-drug');
    insert into public.mechanisms_of_action (id, space_id, created_by, name)
      values (v_moa_a, v_space, v_owner, 'uam-d-moa-a'),
             (v_moa_b, v_space, v_owner, 'uam-d-moa-b');
    insert into public.asset_mechanisms_of_action (asset_id, moa_id) values (v_asset, v_moa_a);

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    begin
      perform public.update_asset_mechanisms(v_asset, array[v_moa_b]);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'update_asset_mechanisms smoke FAIL case D: expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_asset_mechanisms smoke FAIL case D: viewer should have raised';
    end if;

    select count(*)::int into v_count from public.asset_mechanisms_of_action
     where asset_id = v_asset and moa_id = v_moa_a;
    if v_count <> 1 then
      raise exception 'update_asset_mechanisms smoke FAIL case D: original assignment disturbed';
    end if;

    raise notice 'update_asset_mechanisms smoke ok D: viewer rejected';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets         where space_id = v_space;
    delete from public.companies      where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id in (v_owner, v_viewer);
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  -- ===========================================================================
  -- case E: simulated orphan-cleanup trigger on asset_mechanisms_of_action.
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_asset_old uuid := gen_random_uuid();
    v_asset_rpc uuid := gen_random_uuid();
    v_moa_a     uuid := gen_random_uuid();
    v_moa_b     uuid := gen_random_uuid();
    v_email     text := 'uam-e-' || gen_random_uuid() || '@example.com';
    v_count     int;
    v_caught    boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uam-e-tenant', 'uam-e-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uam-e-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uam-e-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset_old, v_space, v_user, v_company, 'uam-e-old'),
             (v_asset_rpc, v_space, v_user, v_company, 'uam-e-rpc');
    insert into public.mechanisms_of_action (id, space_id, created_by, name)
      values (v_moa_a, v_space, v_user, 'uam-e-moa-a'),
             (v_moa_b, v_space, v_user, 'uam-e-moa-b');
    insert into public.asset_mechanisms_of_action (asset_id, moa_id)
      values (v_asset_old, v_moa_a),
             (v_asset_rpc, v_moa_a);

    create or replace function pg_temp._smoke_orphan_asset_via_moa()
      returns trigger language plpgsql as $fn$
      begin
        delete from public.assets
         where id = OLD.asset_id
           and not exists (
             select 1 from public.asset_mechanisms_of_action where asset_id = OLD.asset_id
           );
        return null;
      end $fn$;
    create trigger _smoke_orphan_asset_moa_trigger
      after delete on public.asset_mechanisms_of_action
      for each row execute function pg_temp._smoke_orphan_asset_via_moa();

    -- OLD pattern: DELETE then INSERT. Trigger orphans v_asset_old.
    delete from public.asset_mechanisms_of_action where asset_id = v_asset_old;
    select count(*)::int into v_count from public.assets where id = v_asset_old;
    if v_count <> 0 then
      raise exception 'update_asset_mechanisms smoke FAIL case E: simulated trigger did not orphan asset_old, count=%', v_count;
    end if;
    begin
      insert into public.asset_mechanisms_of_action (asset_id, moa_id)
        values (v_asset_old, v_moa_b);
      raise exception 'update_asset_mechanisms smoke FAIL case E: INSERT should have failed FK';
    exception when others then
      if sqlstate not in ('42501', '23503', '23514') then
        raise exception 'update_asset_mechanisms smoke FAIL case E: expected RLS/FK failure, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_asset_mechanisms smoke FAIL case E: INSERT did not raise';
    end if;

    perform public.update_asset_mechanisms(v_asset_rpc, array[v_moa_b]);
    select count(*)::int into v_count from public.assets where id = v_asset_rpc;
    if v_count <> 1 then
      raise exception 'update_asset_mechanisms smoke FAIL case E: asset_rpc dropped, count=%', v_count;
    end if;
    select count(*)::int into v_count from public.asset_mechanisms_of_action
     where asset_id = v_asset_rpc and moa_id = v_moa_b;
    if v_count <> 1 then
      raise exception 'update_asset_mechanisms smoke FAIL case E: RPC assignment missing, count=%', v_count;
    end if;

    drop trigger _smoke_orphan_asset_moa_trigger on public.asset_mechanisms_of_action;

    raise notice 'update_asset_mechanisms smoke ok E: simulated-trigger regression contract holds';

    perform set_config('request.jwt.claims', '', true);
    perform set_config('clint.member_guard_cascade', 'on', true);
    delete from public.assets         where space_id = v_space;
    delete from public.companies      where space_id = v_space;
    delete from public.space_members  where space_id = v_space;
    delete from public.tenant_members where tenant_id = v_tenant;
    delete from public.spaces         where id = v_space;
    delete from public.tenants        where id = v_tenant;
    delete from auth.users            where id = v_user;
    perform set_config('clint.member_guard_cascade', 'off', true);
  end;

  raise notice 'update_asset_mechanisms smoke test: PASS';
end $$;
