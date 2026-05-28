-- migration: 20260528130300_update_asset_routes_rpc
-- purpose: atomic replacement of an asset's ROA assignments in a single
--          transaction. Sibling RPC to update_asset_mechanisms
--          (20260528130200). Same insert-then-prune shape as
--          update_marker_assignments (20260528100000).
--
-- design: see update_asset_mechanisms_rpc for the full design rationale.
--         ROAs are independent of MOAs; the client switches each via its
--         own RPC call wrapped in Promise.all.
--
-- not @audit:tier1 -- editorial mutation, not governance.
--
-- callers:
--   - src/client/src/app/core/services/asset.service.ts:setRoutes()
--
-- related:
--   - 20260411130100_create_product_moa_roa_join_tables.sql (table + RLS)
--   - 20260524120200_rename_products_to_assets.sql          (rename + RLS rewrite)
--   - 20260528130200_update_asset_mechanisms_rpc.sql        (sibling RPC)


-- =============================================================================
-- 1. update_asset_routes
-- =============================================================================

create or replace function public.update_asset_routes(
  p_asset_id uuid,
  p_roa_ids  uuid[]
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_space_id uuid;
  v_roa_id   uuid;
begin
  select space_id into v_space_id from public.assets where id = p_asset_id;

  if v_space_id is null then
    raise exception 'asset not found' using errcode = 'P0002';
  end if;

  if not public.has_space_access(v_space_id, array['owner', 'editor']) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_roa_ids is not null then
    foreach v_roa_id in array p_roa_ids loop
      insert into public.asset_routes_of_administration (asset_id, roa_id)
        values (p_asset_id, v_roa_id)
        on conflict (asset_id, roa_id) do nothing;
    end loop;
  end if;

  delete from public.asset_routes_of_administration
   where asset_id = p_asset_id
     and roa_id <> all(coalesce(p_roa_ids, array[]::uuid[]));
end;
$$;

revoke execute on function public.update_asset_routes(uuid, uuid[]) from public;
grant  execute on function public.update_asset_routes(uuid, uuid[]) to authenticated;

comment on function public.update_asset_routes(uuid, uuid[]) is
  'Atomically replace asset_routes_of_administration for an asset in one transaction. Inserts new ROA assignments first (idempotent on the (asset_id, roa_id) primary key), then deletes stale ones. SECURITY DEFINER. Caller must hold owner/editor on the asset''s space; empty p_roa_ids clears all ROAs.';


-- =============================================================================
-- inline smoke tests
-- =============================================================================

do $$
begin

  -- ===========================================================================
  -- case A: asset with one ROA -> swap.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_roa_a   uuid := gen_random_uuid();
    v_roa_b   uuid := gen_random_uuid();
    v_email   text := 'uar-a-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_r       uuid;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uar-a-tenant', 'uar-a-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uar-a-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uar-a-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uar-a-drug');
    insert into public.routes_of_administration (id, space_id, created_by, name)
      values (v_roa_a, v_space, v_user, 'uar-a-roa-a'),
             (v_roa_b, v_space, v_user, 'uar-a-roa-b');
    insert into public.asset_routes_of_administration (asset_id, roa_id) values (v_asset, v_roa_a);

    perform public.update_asset_routes(v_asset, array[v_roa_b]);

    select count(*)::int into v_count from public.asset_routes_of_administration where asset_id = v_asset;
    if v_count <> 1 then
      raise exception 'update_asset_routes smoke FAIL case A: expected 1 row, got %', v_count;
    end if;
    select roa_id into v_r from public.asset_routes_of_administration where asset_id = v_asset;
    if v_r <> v_roa_b then
      raise exception 'update_asset_routes smoke FAIL case A: expected roa_b, got %', v_r;
    end if;

    raise notice 'update_asset_routes smoke ok A: single-ROA swap';

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
    v_roa_a   uuid := gen_random_uuid();
    v_roa_b   uuid := gen_random_uuid();
    v_roa_c   uuid := gen_random_uuid();
    v_email   text := 'uar-b-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uar-b-tenant', 'uar-b-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uar-b-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uar-b-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uar-b-drug');
    insert into public.routes_of_administration (id, space_id, created_by, name)
      values (v_roa_a, v_space, v_user, 'uar-b-roa-a'),
             (v_roa_b, v_space, v_user, 'uar-b-roa-b'),
             (v_roa_c, v_space, v_user, 'uar-b-roa-c');
    insert into public.asset_routes_of_administration (asset_id, roa_id)
      values (v_asset, v_roa_a),
             (v_asset, v_roa_b);

    perform public.update_asset_routes(v_asset, array[v_roa_b, v_roa_c]);

    select count(*)::int into v_count from public.asset_routes_of_administration
     where asset_id = v_asset and roa_id in (v_roa_b, v_roa_c);
    if v_count <> 2 then
      raise exception 'update_asset_routes smoke FAIL case B: expected [B, C], got %', v_count;
    end if;
    select count(*)::int into v_count from public.asset_routes_of_administration
     where asset_id = v_asset and roa_id = v_roa_a;
    if v_count <> 0 then
      raise exception 'update_asset_routes smoke FAIL case B: A should be pruned';
    end if;

    raise notice 'update_asset_routes smoke ok B: add/remove diff';

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
  -- case C: empty p_roa_ids clears all ROAs.
  -- ===========================================================================
  declare
    v_user    uuid := gen_random_uuid();
    v_tenant  uuid := gen_random_uuid();
    v_space   uuid := gen_random_uuid();
    v_company uuid := gen_random_uuid();
    v_asset   uuid := gen_random_uuid();
    v_roa_a   uuid := gen_random_uuid();
    v_email   text := 'uar-c-' || gen_random_uuid() || '@example.com';
    v_count   int;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uar-c-tenant', 'uar-c-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uar-c-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uar-c-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_user, v_company, 'uar-c-drug');
    insert into public.routes_of_administration (id, space_id, created_by, name)
      values (v_roa_a, v_space, v_user, 'uar-c-roa-a');
    insert into public.asset_routes_of_administration (asset_id, roa_id) values (v_asset, v_roa_a);

    perform public.update_asset_routes(v_asset, array[]::uuid[]);

    select count(*)::int into v_count from public.asset_routes_of_administration where asset_id = v_asset;
    if v_count <> 0 then
      raise exception 'update_asset_routes smoke FAIL case C: expected 0 rows, got %', v_count;
    end if;
    select count(*)::int into v_count from public.assets where id = v_asset;
    if v_count <> 1 then
      raise exception 'update_asset_routes smoke FAIL case C: asset dropped';
    end if;

    raise notice 'update_asset_routes smoke ok C: empty clears all, asset survives';

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
    v_roa_a   uuid := gen_random_uuid();
    v_roa_b   uuid := gen_random_uuid();
    v_o_email text := 'uar-d-o-' || gen_random_uuid() || '@example.com';
    v_v_email text := 'uar-d-v-' || gen_random_uuid() || '@example.com';
    v_count   int;
    v_caught  boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_owner,  v_o_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated'),
             (v_viewer, v_v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uar-d-tenant', 'uar-d-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uar-d-space', v_owner);
    insert into public.space_members (space_id, user_id, role)
      values (v_space, v_owner,  'owner'),
             (v_space, v_viewer, 'viewer');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_owner::text, 'role', 'authenticated', 'email', v_o_email)::text,
      true
    );
    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_owner, 'uar-d-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset, v_space, v_owner, v_company, 'uar-d-drug');
    insert into public.routes_of_administration (id, space_id, created_by, name)
      values (v_roa_a, v_space, v_owner, 'uar-d-roa-a'),
             (v_roa_b, v_space, v_owner, 'uar-d-roa-b');
    insert into public.asset_routes_of_administration (asset_id, roa_id) values (v_asset, v_roa_a);

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_viewer::text, 'role', 'authenticated', 'email', v_v_email)::text,
      true
    );

    begin
      perform public.update_asset_routes(v_asset, array[v_roa_b]);
    exception when others then
      if sqlstate <> '42501' then
        raise exception 'update_asset_routes smoke FAIL case D: expected 42501, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_asset_routes smoke FAIL case D: viewer should have raised';
    end if;

    select count(*)::int into v_count from public.asset_routes_of_administration
     where asset_id = v_asset and roa_id = v_roa_a;
    if v_count <> 1 then
      raise exception 'update_asset_routes smoke FAIL case D: original assignment disturbed';
    end if;

    raise notice 'update_asset_routes smoke ok D: viewer rejected';

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
  -- case E: simulated orphan-cleanup trigger on asset_routes_of_administration.
  -- ===========================================================================
  declare
    v_user      uuid := gen_random_uuid();
    v_tenant    uuid := gen_random_uuid();
    v_space     uuid := gen_random_uuid();
    v_company   uuid := gen_random_uuid();
    v_asset_old uuid := gen_random_uuid();
    v_asset_rpc uuid := gen_random_uuid();
    v_roa_a     uuid := gen_random_uuid();
    v_roa_b     uuid := gen_random_uuid();
    v_email     text := 'uar-e-' || gen_random_uuid() || '@example.com';
    v_count     int;
    v_caught    boolean := false;
  begin
    insert into auth.users (id, email, instance_id, aud, role)
      values (v_user, v_email, '00000000-0000-0000-0000-000000000000', 'authenticated', 'authenticated');
    insert into public.tenants (id, name, slug)
      values (v_tenant, 'uar-e-tenant', 'uar-e-' || left(v_tenant::text, 8));
    insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_user, 'owner');
    insert into public.spaces (id, tenant_id, name, created_by)
      values (v_space, v_tenant, 'uar-e-space', v_user);
    insert into public.space_members (space_id, user_id, role) values (v_space, v_user, 'owner');

    perform set_config(
      'request.jwt.claims',
      json_build_object('sub', v_user::text, 'role', 'authenticated', 'email', v_email)::text,
      true
    );

    insert into public.companies (id, space_id, created_by, name)
      values (v_company, v_space, v_user, 'uar-e-co');
    insert into public.assets (id, space_id, created_by, company_id, name)
      values (v_asset_old, v_space, v_user, v_company, 'uar-e-old'),
             (v_asset_rpc, v_space, v_user, v_company, 'uar-e-rpc');
    insert into public.routes_of_administration (id, space_id, created_by, name)
      values (v_roa_a, v_space, v_user, 'uar-e-roa-a'),
             (v_roa_b, v_space, v_user, 'uar-e-roa-b');
    insert into public.asset_routes_of_administration (asset_id, roa_id)
      values (v_asset_old, v_roa_a),
             (v_asset_rpc, v_roa_a);

    create or replace function pg_temp._smoke_orphan_asset_via_roa()
      returns trigger language plpgsql as $fn$
      begin
        delete from public.assets
         where id = OLD.asset_id
           and not exists (
             select 1 from public.asset_routes_of_administration where asset_id = OLD.asset_id
           );
        return null;
      end $fn$;
    create trigger _smoke_orphan_asset_roa_trigger
      after delete on public.asset_routes_of_administration
      for each row execute function pg_temp._smoke_orphan_asset_via_roa();

    delete from public.asset_routes_of_administration where asset_id = v_asset_old;
    select count(*)::int into v_count from public.assets where id = v_asset_old;
    if v_count <> 0 then
      raise exception 'update_asset_routes smoke FAIL case E: simulated trigger did not orphan asset_old, count=%', v_count;
    end if;
    begin
      insert into public.asset_routes_of_administration (asset_id, roa_id)
        values (v_asset_old, v_roa_b);
      raise exception 'update_asset_routes smoke FAIL case E: INSERT should have failed FK';
    exception when others then
      if sqlstate not in ('42501', '23503', '23514') then
        raise exception 'update_asset_routes smoke FAIL case E: expected RLS/FK failure, got % (%)', sqlstate, sqlerrm;
      end if;
      v_caught := true;
    end;
    if not v_caught then
      raise exception 'update_asset_routes smoke FAIL case E: INSERT did not raise';
    end if;

    perform public.update_asset_routes(v_asset_rpc, array[v_roa_b]);
    select count(*)::int into v_count from public.assets where id = v_asset_rpc;
    if v_count <> 1 then
      raise exception 'update_asset_routes smoke FAIL case E: asset_rpc dropped, count=%', v_count;
    end if;
    select count(*)::int into v_count from public.asset_routes_of_administration
     where asset_id = v_asset_rpc and roa_id = v_roa_b;
    if v_count <> 1 then
      raise exception 'update_asset_routes smoke FAIL case E: RPC assignment missing, count=%', v_count;
    end if;

    drop trigger _smoke_orphan_asset_roa_trigger on public.asset_routes_of_administration;

    raise notice 'update_asset_routes smoke ok E: simulated-trigger regression contract holds';

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

  raise notice 'update_asset_routes smoke test: PASS';
end $$;
