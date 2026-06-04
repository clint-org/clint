-- When a trial is inserted, create its primary trial_assets row from asset_id.
-- Covers every trial-creation path without changing signatures. AFTER INSERT only.
create or replace function public._trial_assets_bootstrap()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
  values (new.id, new.asset_id, true, 'bootstrap')
  on conflict (trial_id, asset_id) do nothing;
  return new;
end;
$$;

create trigger trg_trial_assets_bootstrap
  after insert on public.trials
  for each row execute function public._trial_assets_bootstrap();

-- Keep trials.asset_id equal to the single is_primary member. One direction only.
-- Auto-promotion happens ONLY on DELETE: if the deleted row left the trial with
-- no primary but other members remain, promote the earliest. We must NOT
-- auto-promote during UPDATE, because set_trial_assets (a later migration)
-- repoints the primary by demoting all rows then promoting the chosen one in two
-- separate statements; after the demote there is transiently no primary, and if
-- this trigger promoted a different row the subsequent promote would create a
-- SECOND primary and violate uq_trial_assets_one_primary. So on UPDATE/INSERT we
-- only sync asset_id, and only when exactly one primary exists.
create or replace function public._trial_assets_sync_primary()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_trial     uuid := coalesce(new.trial_id, old.trial_id);
  v_remaining int;
  v_primaries int;
  v_primary   uuid;
begin
  select count(*) into v_remaining
    from public.trial_assets where trial_id = v_trial;

  if v_remaining = 0 then
    return null;
  end if;

  if tg_op = 'DELETE' then
    if not exists (
      select 1 from public.trial_assets where trial_id = v_trial and is_primary
    ) then
      update public.trial_assets ta
         set is_primary = true
       where ta.trial_id = v_trial
         and ta.asset_id = (
           select t2.asset_id from public.trial_assets t2
            where t2.trial_id = v_trial
            order by t2.created_at, t2.asset_id
            limit 1
         );
      return null;
    end if;
  end if;

  select count(*) into v_primaries
    from public.trial_assets where trial_id = v_trial and is_primary;
  if v_primaries <> 1 then
    return null;
  end if;

  select asset_id into v_primary
    from public.trial_assets
   where trial_id = v_trial and is_primary;

  update public.trials
     set asset_id = v_primary
   where id = v_trial
     and asset_id is distinct from v_primary;

  return null;
end;
$$;

create trigger trg_trial_assets_sync_primary
  after insert or update of is_primary or delete on public.trial_assets
  for each row execute function public._trial_assets_sync_primary();

-- =============================================================================
-- smoke: bootstrap + sync + promotion
-- Uses inline fixtures (NOT seed reads) so the block runs during db reset.
-- UUID prefix bbbb2222-... is unique to this migration.
-- =============================================================================
do $$
declare
  v_agency_id  uuid := 'bbbb2222-2b01-2b01-2b01-bbbb2222b101';
  v_tenant_id  uuid := 'bbbb2222-2b02-2b02-2b02-bbbb2222b102';
  v_owner_id   uuid := 'bbbb2222-2b03-2b03-2b03-bbbb2222b103';
  v_space_id   uuid := 'bbbb2222-2b04-2b04-2b04-bbbb2222b104';
  v_company_id uuid := 'bbbb2222-2b05-2b05-2b05-bbbb2222b105';
  v_asset_a    uuid := 'bbbb2222-2b06-2b06-2b06-bbbb2222b106';
  v_asset_b    uuid := 'bbbb2222-2b07-2b07-2b07-bbbb2222b107';
  v_trial      uuid := 'bbbb2222-2b08-2b08-2b08-bbbb2222b108';
  v_row_count  int;
  v_is_primary boolean;
  v_asset_id   uuid;
begin
  -- fixtures in FK order
  insert into auth.users (id, email) values (v_owner_id, 'trial-assets-t2-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency_id, 'TA2', 'ta2', 'ta2', 'TA2', 'ta2@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant_id, v_agency_id, 'TA2', 'ta2-t', 'ta2t', 'TA2');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant_id, v_owner_id, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space_id, v_tenant_id, 'Primary', v_owner_id);
  insert into public.space_members (space_id, user_id, role) values (v_space_id, v_owner_id, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company_id, v_space_id, v_owner_id, 'TA2 Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space_id, v_owner_id, v_company_id, 'AssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space_id, v_owner_id, v_company_id, 'AssetB');

  -- The bootstrap trigger auto-creates the primary trial_assets row on insert.
  -- Do NOT insert trial_assets manually here.
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space_id, v_owner_id, v_asset_a, 'TA2 Trial', 'NCT-TA2-001');

  perform set_config('request.jwt.claim.sub', v_owner_id::text, true);

  -- ASSERTION 1: BOOTSTRAP
  -- After inserting the trial, exactly 1 row in trial_assets, is_primary on asset_a.
  select count(*) into v_row_count
    from public.trial_assets where trial_id = v_trial;
  if v_row_count <> 1 then
    raise exception 'trial_assets triggers smoke FAIL: bootstrap expected 1 row, got %', v_row_count;
  end if;

  select is_primary into v_is_primary
    from public.trial_assets where trial_id = v_trial and asset_id = v_asset_a;
  if not v_is_primary then
    raise exception 'trial_assets triggers smoke FAIL: bootstrap row is not is_primary for asset_a';
  end if;

  -- ASSERTION 2: SYNC (two-statement demote/promote must not violate unique index)
  -- Add asset_b as a non-primary member.
  insert into public.trial_assets (trial_id, asset_id, is_primary, source)
    values (v_trial, v_asset_b, false, 'smoke');

  -- Repoint primary the way set_trial_assets will: demote all then promote chosen.
  update public.trial_assets set is_primary = false where trial_id = v_trial;
  update public.trial_assets set is_primary = true  where trial_id = v_trial and asset_id = v_asset_b;

  -- trials.asset_id must now equal asset_b.
  select asset_id into v_asset_id from public.trials where id = v_trial;
  if v_asset_id <> v_asset_b then
    raise exception 'trial_assets triggers smoke FAIL: sync expected trials.asset_id=asset_b, got %', v_asset_id;
  end if;

  -- ASSERTION 3: PROMOTION
  -- Delete the current primary (asset_b); trigger should promote asset_a (earliest).
  delete from public.trial_assets where trial_id = v_trial and asset_id = v_asset_b;

  -- asset_a must now be is_primary.
  select is_primary into v_is_primary
    from public.trial_assets where trial_id = v_trial and asset_id = v_asset_a;
  if not v_is_primary then
    raise exception 'trial_assets triggers smoke FAIL: promotion did not set asset_a as is_primary';
  end if;

  -- trials.asset_id must equal asset_a.
  select asset_id into v_asset_id from public.trials where id = v_trial;
  if v_asset_id <> v_asset_a then
    raise exception 'trial_assets triggers smoke FAIL: promotion expected trials.asset_id=asset_a, got %', v_asset_id;
  end if;

  raise notice 'trial_assets triggers smoke ok: bootstrap + sync + promotion';

  -- cleanup
  perform set_config('request.jwt.claim.sub', null, true);
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space_id;
  delete from public.tenant_members where tenant_id = v_tenant_id;
  delete from public.tenants where id = v_tenant_id;
  delete from public.agencies where id = v_agency_id;
  delete from auth.users where id = v_owner_id;
  perform set_config('clint.member_guard_cascade', 'off', true);
end $$;
