-- migration: 20260415120000_seed_pharma_tenants
-- purpose: create pharma-themed tenants and pipeline-named spaces for local
--          development. mirrors the production setup where tenants represent
--          real pharma companies and spaces represent drug pipelines.
--          the new seed_demo_data(space_id) orchestrator populates each space
--          with the comprehensive fictional trial dataset on first visit.
-- affected objects: public.tenants, public.spaces, public.tenant_members,
--                   public.space_members, public.handle_new_user (updated)

-- =============================================================================
-- 1. update handle_new_user to create pharma-themed tenants instead of generic
-- =============================================================================

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_bi      uuid := gen_random_uuid();
  v_tenant_azurity uuid := gen_random_uuid();
  v_space_vicadrastat  uuid := gen_random_uuid();
  v_space_survodutide  uuid := gen_random_uuid();
  v_space_sah          uuid := gen_random_uuid();
begin
  -- skip the dummy users the pharma demo seed creates
  if new.email is null or new.email like '%@bi.example.com' or new.email like '%@azurity.example.com' then
    return new;
  end if;

  -- =========================================================================
  -- Tenant 1: Boehringer Ingelheim
  -- =========================================================================
  insert into public.tenants (id, name, slug)
  values (v_tenant_bi, 'Boehringer Ingelheim',
          'boehringer-ingelheim-' || substr(new.id::text, 1, 8));

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_bi, new.id, 'owner');

  -- Space: Vicadrastat Pipeline
  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (v_space_vicadrastat, v_tenant_bi,
          'Vicadrastat Pipeline',
          'Aldosterone synthase inhibitor -- CKD, HF, and cardiac risk reduction',
          new.id);

  insert into public.space_members (space_id, user_id, role)
  values (v_space_vicadrastat, new.id, 'owner');

  -- Space: Survodutide Pipeline
  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (v_space_survodutide, v_tenant_bi,
          'Survodutide Pipeline',
          'Dual GLP-1/glucagon receptor agonist -- obesity and MASH',
          new.id);

  insert into public.space_members (space_id, user_id, role)
  values (v_space_survodutide, new.id, 'owner');

  -- =========================================================================
  -- Tenant 2: Azurity Pharmaceuticals
  -- =========================================================================
  insert into public.tenants (id, name, slug)
  values (v_tenant_azurity, 'Azurity Pharmaceuticals',
          'azurity-' || substr(new.id::text, 1, 8));

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_azurity, new.id, 'owner');

  -- Space: SAH Pipeline
  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (v_space_sah, v_tenant_azurity,
          'SAH Pipeline',
          'Subarachnoid hemorrhage treatment landscape',
          new.id);

  insert into public.space_members (space_id, user_id, role)
  values (v_space_sah, new.id, 'owner');

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Auto-provisions pharma-themed tenants (Boehringer Ingelheim, Azurity Pharmaceuticals) '
  'and pipeline-named spaces for newly created auth.users. Each space gets populated with '
  'demo data via seed_demo_data(space_id) on first visit from the frontend.';

-- =============================================================================
-- 2. back-fill: migrate existing users from generic workspace to pharma tenants
-- =============================================================================

do $$
declare
  u record;
  v_tenant_bi      uuid;
  v_tenant_azurity uuid;
  v_space_vicadrastat  uuid;
  v_space_survodutide  uuid;
  v_space_sah          uuid;
  v_old_tenant_id  uuid;
  v_old_space_id   uuid;
begin
  for u in
    select id, email
    from auth.users
    where email is not null
      and email not like '%@bi.example.com'
      and email not like '%@azurity.example.com'
  loop
    -- check if this user already has a pharma tenant
    if exists (
      select 1 from public.tenant_members tm
      join public.tenants t on t.id = tm.tenant_id
      where tm.user_id = u.id
        and t.name = 'Boehringer Ingelheim'
    ) then
      continue; -- already set up
    end if;

    -- find and remove old generic workspace + default space
    select tm.tenant_id into v_old_tenant_id
    from public.tenant_members tm
    join public.tenants t on t.id = tm.tenant_id
    where tm.user_id = u.id
      and tm.role = 'owner'
      and t.name like '%Workspace'
    limit 1;

    if v_old_tenant_id is not null then
      -- find old default space to clean up its data
      select s.id into v_old_space_id
      from public.spaces s
      where s.tenant_id = v_old_tenant_id
        and s.name = 'Default Space'
      limit 1;

      if v_old_space_id is not null then
        delete from public.space_members where space_id = v_old_space_id;
        delete from public.spaces where id = v_old_space_id;
      end if;

      delete from public.tenant_members where tenant_id = v_old_tenant_id;
      delete from public.tenants where id = v_old_tenant_id;
    end if;

    -- create pharma tenants
    v_tenant_bi := gen_random_uuid();
    v_tenant_azurity := gen_random_uuid();
    v_space_vicadrastat := gen_random_uuid();
    v_space_survodutide := gen_random_uuid();
    v_space_sah := gen_random_uuid();

    -- Boehringer Ingelheim
    insert into public.tenants (id, name, slug)
    values (v_tenant_bi, 'Boehringer Ingelheim',
            'boehringer-ingelheim-' || substr(u.id::text, 1, 8));

    insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_bi, u.id, 'owner');

    insert into public.spaces (id, tenant_id, name, description, created_by)
    values (v_space_vicadrastat, v_tenant_bi,
            'Vicadrastat Pipeline',
            'Aldosterone synthase inhibitor -- CKD, HF, and cardiac risk reduction',
            u.id);

    insert into public.space_members (space_id, user_id, role)
    values (v_space_vicadrastat, u.id, 'owner');

    insert into public.spaces (id, tenant_id, name, description, created_by)
    values (v_space_survodutide, v_tenant_bi,
            'Survodutide Pipeline',
            'Dual GLP-1/glucagon receptor agonist -- obesity and MASH',
            u.id);

    insert into public.space_members (space_id, user_id, role)
    values (v_space_survodutide, u.id, 'owner');

    -- Azurity Pharmaceuticals
    insert into public.tenants (id, name, slug)
    values (v_tenant_azurity, 'Azurity Pharmaceuticals',
            'azurity-' || substr(u.id::text, 1, 8));

    insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant_azurity, u.id, 'owner');

    insert into public.spaces (id, tenant_id, name, description, created_by)
    values (v_space_sah, v_tenant_azurity,
            'SAH Pipeline',
            'Subarachnoid hemorrhage treatment landscape',
            u.id);

    insert into public.space_members (space_id, user_id, role)
    values (v_space_sah, u.id, 'owner');
  end loop;
end;
$$;
