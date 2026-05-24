-- migration: 20260524120000_create_indication_condition_tables
-- purpose: create indications, conditions, condition_indication_map, trial_conditions,
--          and asset_indications tables for the indication model redesign.
-- affected tables: public.indications, public.conditions, public.condition_indication_map,
--                  public.trial_conditions, public.asset_indications
-- notes: asset_indications.asset_id references public.products(id) for now; the rename
--        migration (T3) will update the FK target. RLS enabled on all tables.

-- =============================================================================
-- 1. indications (analyst-created, replaces therapeutic_areas)
-- =============================================================================

create table public.indications (
  id               uuid primary key default gen_random_uuid(),
  parent_id        uuid references public.indications(id) on delete set null,
  space_id         uuid not null references public.spaces(id) on delete cascade,
  name             varchar(255) not null,
  abbreviation     varchar(50),
  display_order    int not null default 0,
  created_by       uuid not null references auth.users(id),
  updated_by       uuid references auth.users(id),
  created_at       timestamptz default now(),
  updated_at       timestamptz default now(),
  unique (space_id, name)
);

create index idx_indications_space_id on public.indications (space_id);
create index idx_indications_parent_id on public.indications (parent_id);

alter table public.indications enable row level security;

create policy "space members can view indications" on public.indications for select to authenticated
  using ( public.has_space_access(space_id) );
create policy "space editors can insert indications" on public.indications for insert to authenticated
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update indications" on public.indications for update to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) )
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete indications" on public.indications for delete to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) );

create trigger trg_indications_set_created_by
  before insert on public.indications
  for each row execute function public._set_created_by();
create trigger trg_indications_set_updated_audit
  before update on public.indications
  for each row execute function public._set_updated_audit();

-- =============================================================================
-- 2. conditions (CT.gov-sourced medical terms)
-- =============================================================================

create table public.conditions (
  id               uuid primary key default gen_random_uuid(),
  space_id         uuid not null references public.spaces(id) on delete cascade,
  name             varchar(500) not null,
  mesh_id          varchar(20),
  source           text not null default 'analyst' check (source in ('ctgov', 'analyst')),
  created_at       timestamptz default now(),
  unique (space_id, name)
);

create unique index idx_conditions_space_mesh_id
  on public.conditions (space_id, mesh_id)
  where mesh_id is not null;

create index idx_conditions_space_id on public.conditions (space_id);

alter table public.conditions enable row level security;

create policy "space members can view conditions" on public.conditions for select to authenticated
  using ( public.has_space_access(space_id) );
create policy "space editors can insert conditions" on public.conditions for insert to authenticated
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update conditions" on public.conditions for update to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) )
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete conditions" on public.conditions for delete to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) );

-- =============================================================================
-- 3. condition_indication_map (analyst assigns conditions to indications)
-- =============================================================================

create table public.condition_indication_map (
  condition_id     uuid not null references public.conditions(id) on delete cascade,
  indication_id    uuid not null references public.indications(id) on delete cascade,
  primary key (condition_id, indication_id)
);

create index idx_cim_indication_id on public.condition_indication_map (indication_id);

alter table public.condition_indication_map enable row level security;

create policy "space members can view condition_indication_map" on public.condition_indication_map for select to authenticated
  using ( exists (
    select 1 from public.conditions c
    where c.id = condition_indication_map.condition_id
      and public.has_space_access(c.space_id)
  ) );
create policy "space editors can insert condition_indication_map" on public.condition_indication_map for insert to authenticated
  with check ( exists (
    select 1 from public.conditions c
    where c.id = condition_indication_map.condition_id
      and public.has_space_access(c.space_id, array['owner', 'editor'])
  ) );
create policy "space editors can delete condition_indication_map" on public.condition_indication_map for delete to authenticated
  using ( exists (
    select 1 from public.conditions c
    where c.id = condition_indication_map.condition_id
      and public.has_space_access(c.space_id, array['owner', 'editor'])
  ) );

-- =============================================================================
-- 4. trial_conditions (from CT.gov, many-to-many)
-- =============================================================================

create table public.trial_conditions (
  trial_id         uuid not null references public.trials(id) on delete cascade,
  condition_id     uuid not null references public.conditions(id) on delete cascade,
  source           text not null default 'analyst' check (source in ('ctgov', 'analyst')),
  primary key (trial_id, condition_id)
);

create index idx_trial_conditions_trial_id on public.trial_conditions (trial_id);
create index idx_trial_conditions_condition_id on public.trial_conditions (condition_id);

alter table public.trial_conditions enable row level security;

create policy "space members can view trial_conditions" on public.trial_conditions for select to authenticated
  using ( exists (
    select 1 from public.trials t
    where t.id = trial_conditions.trial_id
      and public.has_space_access(t.space_id)
  ) );
create policy "space editors can insert trial_conditions" on public.trial_conditions for insert to authenticated
  with check ( exists (
    select 1 from public.trials t
    where t.id = trial_conditions.trial_id
      and public.has_space_access(t.space_id, array['owner', 'editor'])
  ) );
create policy "space editors can delete trial_conditions" on public.trial_conditions for delete to authenticated
  using ( exists (
    select 1 from public.trials t
    where t.id = trial_conditions.trial_id
      and public.has_space_access(t.space_id, array['owner', 'editor'])
  ) );

-- =============================================================================
-- 5. asset_indications (the "program", carries development_status)
-- =============================================================================

create table public.asset_indications (
  id                         uuid primary key default gen_random_uuid(),
  asset_id                   uuid not null references public.products(id) on delete cascade,
  indication_id              uuid not null references public.indications(id) on delete cascade,
  space_id                   uuid not null references public.spaces(id) on delete cascade,
  development_status         varchar(20) check (
    development_status is null
    or development_status in ('PRECLIN','P1','P2','P3','P4','APPROVED','LAUNCHED')
  ),
  development_status_source  text not null default 'auto'
    check (development_status_source in ('auto', 'analyst')),
  created_by                 uuid not null references auth.users(id),
  updated_by                 uuid references auth.users(id),
  created_at                 timestamptz default now(),
  updated_at                 timestamptz default now(),
  unique (asset_id, indication_id)
);

create index idx_asset_indications_space_id on public.asset_indications (space_id);
create index idx_asset_indications_indication_id on public.asset_indications (indication_id);
create index idx_asset_indications_asset_id on public.asset_indications (asset_id);

alter table public.asset_indications enable row level security;

create policy "space members can view asset_indications" on public.asset_indications for select to authenticated
  using ( public.has_space_access(space_id) );
create policy "space editors can insert asset_indications" on public.asset_indications for insert to authenticated
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can update asset_indications" on public.asset_indications for update to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) )
  with check ( public.has_space_access(space_id, array['owner', 'editor']) );
create policy "space editors can delete asset_indications" on public.asset_indications for delete to authenticated
  using ( public.has_space_access(space_id, array['owner', 'editor']) );

create trigger trg_asset_indications_set_created_by
  before insert on public.asset_indications
  for each row execute function public._set_created_by();
create trigger trg_asset_indications_set_updated_audit
  before update on public.asset_indications
  for each row execute function public._set_updated_audit();

-- =============================================================================
-- smoke tests
-- =============================================================================

do $$
declare
  v_space_id   uuid;
  v_space_id_2 uuid;
  v_user_id    uuid;
  v_company_id uuid;
  v_product_id uuid;
  v_ind_id     uuid;
  v_ind_child  uuid;
  v_cond_id    uuid;
  v_cond_id_2  uuid;
  v_ai_id      uuid;
begin
  -- use existing demo data
  select id into v_space_id from public.spaces limit 1;
  select id into v_user_id from auth.users limit 1;
  select id into v_company_id from public.companies where space_id = v_space_id limit 1;
  select id into v_product_id from public.products where space_id = v_space_id limit 1;

  if v_space_id is null or v_user_id is null or v_product_id is null then
    raise notice 'smoke: skipping (no seed data)';
    return;
  end if;

  -- get a second space for cross-space tests
  select id into v_space_id_2 from public.spaces where id != v_space_id limit 1;

  -- 1. indication with parent_id
  insert into public.indications (space_id, name, created_by)
    values (v_space_id, '__smoke_parent', v_user_id)
    returning id into v_ind_id;

  insert into public.indications (space_id, name, parent_id, created_by)
    values (v_space_id, '__smoke_child', v_ind_id, v_user_id)
    returning id into v_ind_child;

  assert v_ind_child is not null, 'parent_id FK should work';

  -- 2. condition with mesh_id dedup
  insert into public.conditions (space_id, name, mesh_id, source)
    values (v_space_id, '__smoke_cond_1', 'D999999', 'analyst')
    returning id into v_cond_id;

  -- duplicate mesh_id in same space should fail
  begin
    insert into public.conditions (space_id, name, mesh_id, source)
      values (v_space_id, '__smoke_cond_dup', 'D999999', 'analyst');
    raise exception 'should have failed on duplicate mesh_id';
  exception when unique_violation then
    null; -- expected
  end;

  -- same mesh_id in different space should succeed
  if v_space_id_2 is not null then
    insert into public.conditions (space_id, name, mesh_id, source)
      values (v_space_id_2, '__smoke_cond_1_s2', 'D999999', 'analyst')
      returning id into v_cond_id_2;
    delete from public.conditions where id = v_cond_id_2;
  end if;

  -- 3. multiple conditions without mesh_id (partial unique allows nulls)
  insert into public.conditions (space_id, name, source)
    values (v_space_id, '__smoke_no_mesh_1', 'analyst');
  insert into public.conditions (space_id, name, source)
    values (v_space_id, '__smoke_no_mesh_2', 'analyst');

  -- 4. asset_indication with valid development_status
  insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
    values (v_product_id, v_ind_id, v_space_id, 'P3', v_user_id)
    returning id into v_ai_id;
  assert v_ai_id is not null, 'asset_indication with P3 should succeed';

  -- 5. asset_indication with invalid development_status should fail
  begin
    insert into public.asset_indications (asset_id, indication_id, space_id, development_status, created_by)
      values (v_product_id, v_ind_child, v_space_id, 'INVALID', v_user_id);
    raise exception 'should have failed on invalid development_status';
  exception when check_violation then
    null; -- expected
  end;

  -- cleanup
  delete from public.asset_indications where id = v_ai_id;
  delete from public.conditions where name like '__smoke_%';
  delete from public.indications where name like '__smoke_%';

  raise notice 'smoke: all indication/condition table tests passed';
end;
$$;
