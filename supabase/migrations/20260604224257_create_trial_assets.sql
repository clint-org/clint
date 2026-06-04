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
do $$
declare
  v_space   uuid;
  v_company uuid;
  v_asset_a uuid;
  v_asset_b uuid;
  v_trial   uuid;
  v_uid     uuid;
begin
  select id into v_uid from auth.users limit 1;
  if v_uid is null then
    raise notice 'trial_assets smoke skipped: no auth user in local db';
    return;
  end if;

  select id into v_space from public.spaces limit 1;
  select id into v_company from public.companies where space_id = v_space limit 1;
  select id into v_asset_a from public.assets where space_id = v_space limit 1;
  select id into v_asset_b from public.assets where space_id = v_space and id <> v_asset_a limit 1;
  select id into v_trial from public.trials where space_id = v_space limit 1;

  if v_trial is null or v_asset_a is null or v_asset_b is null then
    raise notice 'trial_assets smoke skipped: seed data insufficient';
    return;
  end if;

  -- one primary is fine
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_a, true, 'smoke')
    on conflict (trial_id, asset_id) do update set is_primary = true;

  -- a second primary on the same trial must violate the partial unique index
  begin
    insert into public.trial_assets (trial_id, asset_id, is_primary, source)
      values (v_trial, v_asset_b, true, 'smoke');
    raise exception 'trial_assets smoke FAIL: second primary was allowed';
  exception when unique_violation then
    null; -- expected
  end;

  -- cleanup smoke rows
  delete from public.trial_assets where source = 'smoke';
  raise notice 'trial_assets smoke ok: table + partial unique';
end $$;
