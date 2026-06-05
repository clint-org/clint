-- Phase 2b: derive asset_indications across ALL assets a trial tests.
--
-- asset_indications(asset, indication) is auto-derived from a trial's conditions.
-- It used to key off trials.asset_id (the single owning asset). With multi-asset
-- trials, a trial's indication must roll up to EVERY asset it tests, so the
-- dashboard / landscape / positioning (which pivot on asset_indications) surface
-- the trial under each asset. We:
--   1. recompute development_status from trials joined via trial_assets,
--   2. add _sync_asset_indications(asset) which also CREATES the auto rows,
--   3. drive create+recompute from trial_assets changes (new trigger) and from
--      trial phase / trial_condition changes (member-asset loops),
--   4. backfill every asset so existing data is consistent.

-- 1. development_status recompute now considers trials linked via membership.
create or replace function public._recompute_asset_indication_status(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ai record;
  v_max_rank int;
  v_new_status text;
begin
  for v_ai in
    select ai.id, ai.indication_id
    from public.asset_indications ai
    where ai.asset_id = p_asset_id
      and ai.development_status_source = 'auto'
  loop
    select max(
      case t.phase_type
        when 'P4'     then 4
        when 'P3'     then 3
        when 'P2_3'   then 3
        when 'P2'     then 2
        when 'P1_2'   then 1
        when 'P1'     then 1
        when 'PRECLIN' then 0
        else null
      end
    ) into v_max_rank
    from public.trials t
    join public.trial_assets ta on ta.trial_id = t.id
    join public.trial_conditions tc on tc.trial_id = t.id
    join public.condition_indication_map cim on cim.condition_id = tc.condition_id
    where ta.asset_id = p_asset_id
      and cim.indication_id = v_ai.indication_id
      and t.phase_type is not null;

    v_new_status := case v_max_rank
      when 4 then 'P4'
      when 3 then 'P3'
      when 2 then 'P2'
      when 1 then 'P1'
      when 0 then 'PRECLIN'
      else null
    end;

    update public.asset_indications
      set development_status = v_new_status,
          updated_at = now()
      where id = v_ai.id
        and development_status is distinct from v_new_status;
  end loop;
end;
$$;

-- 2. Ensure the auto asset_indications rows EXIST for an asset (derived from its
-- member trials' conditions), then recompute their status. Idempotent.
create or replace function public._sync_asset_indications(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_space uuid;
  v_creator uuid;
begin
  select space_id, created_by into v_space, v_creator
    from public.assets where id = p_asset_id;
  if v_space is null then
    return;
  end if;

  insert into public.asset_indications (
    asset_id, indication_id, space_id, development_status_source, created_by
  )
  select distinct p_asset_id, cim.indication_id, v_space, 'auto',
         coalesce(auth.uid(), v_creator)
    from public.trial_assets ta
    join public.trials t on t.id = ta.trial_id
    join public.trial_conditions tc on tc.trial_id = t.id
    join public.condition_indication_map cim on cim.condition_id = tc.condition_id
   where ta.asset_id = p_asset_id
  on conflict (asset_id, indication_id) do nothing;

  perform public._recompute_asset_indication_status(p_asset_id);
end;
$$;

-- 3a. trial_assets drives create+recompute: linking a trial to an asset creates
-- that asset's auto indications; unlinking recomputes the asset's status.
create or replace function public._trial_assets_sync_indications()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public._sync_asset_indications(new.asset_id);
  elsif tg_op = 'DELETE' then
    perform public._recompute_asset_indication_status(old.asset_id);
  end if;
  return null;
end;
$$;

create trigger trg_trial_assets_sync_indications
  after insert or delete on public.trial_assets
  for each row execute function public._trial_assets_sync_indications();

-- 3b. trial phase changes recompute every asset the trial tests. INSERT/DELETE
-- are handled by the trial_assets triggers above (bootstrap row on insert,
-- cascade on delete), so this only needs the phase_type update path.
create or replace function public._auto_derive_asset_indication_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and old.phase_type is distinct from new.phase_type then
    perform public._recompute_asset_indication_status(ta.asset_id)
      from public.trial_assets ta where ta.trial_id = new.id;
  end if;
  return null;
end;
$$;

-- 3c. trial_condition changes recompute development_status for every asset the
-- trial tests. This RECOMPUTES only (never creates rows) so it cannot collide
-- with explicit asset_indications inserts during seeding: the rows themselves are
-- created by create_trial (primary asset) and by the trial_assets INSERT trigger
-- (secondary assets, at link time, by which point the conditions already exist).
create or replace function public._auto_derive_on_trial_condition_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_trial uuid := coalesce(new.trial_id, old.trial_id);
begin
  perform public._recompute_asset_indication_status(ta.asset_id)
    from public.trial_assets ta where ta.trial_id = v_trial;
  return null;
end;
$$;

-- 4. Backfill: re-sync every asset so existing single-asset data is unchanged and
-- any membership added later is consistent.
do $$
declare
  v_asset uuid;
begin
  for v_asset in select id from public.assets loop
    perform public._sync_asset_indications(v_asset);
  end loop;
end $$;

-- Smoke: a two-asset trial created through the real RPCs (create_trial +
-- set_trial_assets) derives its indication onto BOTH assets with status; removing
-- the trial's link to one asset clears that asset's derived status.
do $$
declare
  v_owner   uuid := 'aaaa7777-0001-0001-0001-aaaaaaaa0001';
  v_agency  uuid := 'aaaa7777-0002-0002-0002-aaaaaaaa0002';
  v_tenant  uuid := 'aaaa7777-0003-0003-0003-aaaaaaaa0003';
  v_space   uuid := 'aaaa7777-0004-0004-0004-aaaaaaaa0004';
  v_company uuid := 'aaaa7777-0005-0005-0005-aaaaaaaa0005';
  v_asset_a uuid := 'aaaa7777-0006-0006-0006-aaaaaaaa0006';
  v_asset_b uuid := 'aaaa7777-0007-0007-0007-aaaaaaaa0007';
  v_trial   uuid;
  v_ind     uuid;
  v_status_a text;
  v_status_b text;
begin
  insert into auth.users (id, email) values (v_owner, 'ai-derive-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'AiD', 'aid', 'aid', 'AiD', 'aid@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'AiD', 'aid-t', 'aidt', 'AiD');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'AiD Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space, v_owner, v_company, 'AiDAssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'AiDAssetB');

  perform set_config('request.jwt.claim.sub', v_owner::text, true);

  -- Real flow: create_trial sets up the primary asset's indication, then
  -- set_trial_assets links the second asset and derives its indication.
  v_trial := public.create_trial(
    v_space, v_asset_a, 'AiD Trial', 'NCT-AID-001', 'Active', 'P3', null, null, 'AiD Obesity', null
  );
  perform public.set_trial_assets(v_trial, array[v_asset_a, v_asset_b], v_asset_a);

  select id into v_ind from public.indications where space_id = v_space and name = 'AiD Obesity';

  select development_status into v_status_a
    from public.asset_indications where asset_id = v_asset_a and indication_id = v_ind;
  select development_status into v_status_b
    from public.asset_indications where asset_id = v_asset_b and indication_id = v_ind;
  if v_status_a is distinct from 'P3' then
    raise exception 'ai-derive FAIL: asset_a status %, expected P3', v_status_a;
  end if;
  if v_status_b is distinct from 'P3' then
    raise exception 'ai-derive FAIL: asset_b (secondary) status %, expected P3', v_status_b;
  end if;

  -- Shrink back to just asset_a: asset_b's derived status clears (no trials left).
  perform public.set_trial_assets(v_trial, array[v_asset_a], v_asset_a);
  select development_status into v_status_b
    from public.asset_indications where asset_id = v_asset_b and indication_id = v_ind;
  if v_status_b is not null then
    raise exception 'ai-derive FAIL: asset_b status % after unlink, expected null', v_status_b;
  end if;
  perform set_config('request.jwt.claim.sub', null, true);

  -- cleanup
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'ai-derive smoke ok: indication derives onto both assets; clears on unlink';
end $$;
