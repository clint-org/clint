-- trial_assets: many-to-many between trials and assets.
-- Source of truth for the SET of assets a trial tests. trials.asset_id remains
-- a cached pointer to the single is_primary member (maintained by triggers added
-- in the next migration). Mirrors the trial_conditions / marker_assignments M2M
-- pattern: composite PK, both FKs ON DELETE CASCADE, RLS via the parent trial.

create table public.trial_assets (
  trial_id   uuid not null references public.trials(id) on delete cascade,
  asset_id   uuid not null references public.assets(id) on delete cascade,
  is_primary boolean not null default false,
  source     text not null default 'analyst',
  created_at timestamptz not null default now(),
  primary key (trial_id, asset_id)
);

create index idx_trial_assets_trial_id on public.trial_assets(trial_id);
create index idx_trial_assets_asset_id on public.trial_assets(asset_id);

-- At most one primary member per trial.
create unique index uq_trial_assets_one_primary
  on public.trial_assets(trial_id) where is_primary;

alter table public.trial_assets enable row level security;

-- RLS derived from the parent trial's space (same shape as trial_conditions).
create policy "trial_assets_select" on public.trial_assets
  for select using (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

create policy "trial_assets_insert" on public.trial_assets
  for insert with check (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

create policy "trial_assets_delete" on public.trial_assets
  for delete using (
    exists (
      select 1 from public.trials t
      where t.id = trial_assets.trial_id
        and public.has_space_access(t.space_id)
    )
  );

-- Smoke: table exists, partial unique index rejects a second primary.
-- Uses inline fixtures so this block runs during `supabase db reset`
-- (migrations execute before seed.sql; the db is empty at migration time).
do $$
declare
  v_agency_id  uuid := 'aaaaaaaa-1a01-1a01-1a01-aaaaaaaaa101';
  v_tenant_id  uuid := 'aaaaaaaa-1a02-1a02-1a02-aaaaaaaaa102';
  v_owner_id   uuid := 'aaaaaaaa-1a03-1a03-1a03-aaaaaaaaa103';
  v_space_id   uuid := 'aaaaaaaa-1a04-1a04-1a04-aaaaaaaaa104';
  v_company_id uuid := 'aaaaaaaa-1a05-1a05-1a05-aaaaaaaaa105';
  v_asset_a    uuid := 'aaaaaaaa-1a06-1a06-1a06-aaaaaaaaa106';
  v_asset_b    uuid := 'aaaaaaaa-1a07-1a07-1a07-aaaaaaaaa107';
  v_trial      uuid := 'aaaaaaaa-1a08-1a08-1a08-aaaaaaaaa108';
  v_second_allowed boolean := true;
begin
  -- fixtures in FK order
  insert into auth.users (id, email) values (v_owner_id, 'trial-assets-t1-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'TA1', 'ta1', 'ta1', 'TA1', 'ta1@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'TA1', 'ta1-t', 'ta1t', 'TA1');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'TA1 Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space_id, v_owner_id, v_company_id, 'AssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space_id, v_owner_id, v_company_id, 'AssetB');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space_id, v_owner_id, v_asset_a, 'TA1 Trial', 'NCT-TA1-001');

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- assertion 1: first primary insert must succeed
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_a, true, 'smoke');

  -- assertion 2: second primary on same trial must raise unique_violation
  begin
    insert into public.trial_assets (trial_id, asset_id, is_primary, source)
      values (v_trial, v_asset_b, true, 'smoke');
    v_second_allowed := true;
  exception when unique_violation then
    v_second_allowed := false;
  end;

  if v_second_allowed then
    raise exception 'trial_assets smoke FAIL: second primary was allowed';
  end if;

  raise notice 'trial_assets smoke ok: table + partial unique';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.trial_assets where trial_id = v_trial;
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);
end $$;
