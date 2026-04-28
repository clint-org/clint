-- migration: 20260428031938_disable_auto_provision_add_demo_rpc
-- purpose: stop auto-provisioning Boehringer Ingelheim + Azurity tenants on
--   every new signup. Replaces handle_new_user() with a no-op (the trigger
--   stays wired up so we can re-introduce signup-time work later without a
--   schema change). Adds provision_demo_workspace() RPC that callers can
--   invoke explicitly when they want the demo orgs created.
-- affected objects:
--   public.handle_new_user      (body replaced with no-op)
--   public.provision_demo_workspace (new function)

-- =============================================================================
-- 1. neuter handle_new_user
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- no-op: tenant/space provisioning is now opt-in via
  -- public.provision_demo_workspace(). Callers that want a workspace on
  -- signup must navigate to the dedicated provisioning route after auth.
  return new;
end;
$$;

comment on function public.handle_new_user is
  'No-op trigger function. Tenant/space provisioning is opt-in via '
  'provision_demo_workspace(). The trigger stays attached so reintroducing '
  'signup-time work later does not require touching auth schema.';

-- =============================================================================
-- 2. provision_demo_workspace RPC
-- =============================================================================
-- creates the same Boehringer Ingelheim + Azurity demo setup the old
-- handle_new_user trigger used to create on signup, but only when the
-- authenticated caller invokes it. Idempotent: skips if the caller already
-- owns a Boehringer Ingelheim tenant.

create or replace function public.provision_demo_workspace()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid              uuid := auth.uid();
  v_tenant_bi      uuid;
  v_tenant_azurity uuid;
  v_space_vicadrastat uuid;
  v_space_survodutide uuid;
  v_space_sah         uuid;
  v_existing_bi    uuid;
begin
  if uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  -- idempotency: if the caller already owns a BI tenant, return it instead
  -- of creating a duplicate.
  select t.id into v_existing_bi
    from public.tenants t
    join public.tenant_members tm on tm.tenant_id = t.id
   where tm.user_id = uid
     and tm.role = 'owner'
     and t.name = 'Boehringer Ingelheim'
   limit 1;

  if v_existing_bi is not null then
    return jsonb_build_object('tenant_id', v_existing_bi, 'created', false);
  end if;

  v_tenant_bi         := gen_random_uuid();
  v_tenant_azurity    := gen_random_uuid();
  v_space_vicadrastat := gen_random_uuid();
  v_space_survodutide := gen_random_uuid();
  v_space_sah         := gen_random_uuid();

  -- Tenant 1: Boehringer Ingelheim
  insert into public.tenants (id, name, slug)
  values (
    v_tenant_bi,
    'Boehringer Ingelheim',
    'boehringer-ingelheim-' || substr(uid::text, 1, 8)
  );

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_bi, uid, 'owner');

  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (
    v_space_vicadrastat, v_tenant_bi,
    'Vicadrastat Pipeline',
    'Aldosterone synthase inhibitor -- CKD, HF, and cardiac risk reduction',
    uid
  );

  insert into public.space_members (space_id, user_id, role)
  values (v_space_vicadrastat, uid, 'owner');

  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (
    v_space_survodutide, v_tenant_bi,
    'Survodutide Pipeline',
    'Dual GLP-1/glucagon receptor agonist -- obesity and MASH',
    uid
  );

  insert into public.space_members (space_id, user_id, role)
  values (v_space_survodutide, uid, 'owner');

  -- Tenant 2: Azurity Pharmaceuticals
  insert into public.tenants (id, name, slug)
  values (
    v_tenant_azurity,
    'Azurity Pharmaceuticals',
    'azurity-' || substr(uid::text, 1, 8)
  );

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_azurity, uid, 'owner');

  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (
    v_space_sah, v_tenant_azurity,
    'SAH Pipeline',
    'Subarachnoid hemorrhage treatment landscape',
    uid
  );

  insert into public.space_members (space_id, user_id, role)
  values (v_space_sah, uid, 'owner');

  return jsonb_build_object('tenant_id', v_tenant_bi, 'created', true);
end;
$$;

comment on function public.provision_demo_workspace is
  'Opt-in: creates the Boehringer Ingelheim + Azurity demo tenants and '
  'pipeline spaces (Vicadrastat, Survodutide, SAH) for the calling user. '
  'Idempotent — returns the existing BI tenant if the caller already owns one.';

revoke execute on function public.provision_demo_workspace() from public;
revoke execute on function public.provision_demo_workspace() from anon;
grant  execute on function public.provision_demo_workspace() to authenticated;
