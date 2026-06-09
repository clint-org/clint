-- Phase 2a: multi-asset-aware delete semantics.
--
-- Before this, trials.asset_id had ON DELETE CASCADE, so deleting an asset
-- deleted every trial whose PRIMARY was that asset, even if the trial also
-- tested other assets. With multi-asset trials that is wrong. We make
-- trials.asset_id non-cascading (checked at statement end) and let trial_assets
-- drive deletion: removing an asset cascades its trial_assets rows, and the sync
-- trigger then either repoints the primary (trial keeps other assets) or deletes
-- the trial (its last asset is gone). By statement end no trial references the
-- deleted asset, so the NO ACTION check passes.

-- DEFERRABLE INITIALLY DEFERRED so the referential check runs at transaction end,
-- AFTER the trial_assets cascade and the sync trigger have repointed the primary
-- or deleted the orphaned trial. A non-deferred check can fire mid-statement,
-- before the trigger settles, and spuriously see a trial still pointing at the
-- asset being deleted.
alter table public.trials drop constraint trials_product_id_fkey;
alter table public.trials add constraint trials_asset_id_fkey
  foreign key (asset_id) references public.assets(id)
  on delete no action deferrable initially deferred;

-- Extend the sync trigger: when a trial's LAST asset membership is removed,
-- delete the now-orphaned trial (preserves the invariant that every trial has at
-- least one asset). The delete is a no-op when the trial row is itself already
-- being deleted (its trial_assets rows cascade and re-enter this trigger).
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
    if tg_op = 'DELETE' then
      delete from public.trials where id = v_trial;
    end if;
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

-- Smoke: a multi-asset trial survives deletion of a non-primary asset, repoints
-- when its primary asset is deleted, and is removed only when its last asset goes.
do $$
declare
  v_owner   uuid := 'eeee6666-0001-0001-0001-eeeeeeee0001';
  v_agency  uuid := 'eeee6666-0002-0002-0002-eeeeeeee0002';
  v_tenant  uuid := 'eeee6666-0003-0003-0003-eeeeeeee0003';
  v_space   uuid := 'eeee6666-0004-0004-0004-eeeeeeee0004';
  v_company uuid := 'eeee6666-0005-0005-0005-eeeeeeee0005';
  v_asset_a uuid := 'eeee6666-0006-0006-0006-eeeeeeee0006';
  v_asset_b uuid := 'eeee6666-0007-0007-0007-eeeeeeee0007';
  v_trial   uuid := 'eeee6666-0008-0008-0008-eeeeeeee0008';
  v_count   int;
  v_aid     uuid;
begin
  insert into auth.users (id, email) values (v_owner, 'trial-del-smoke@invalid.local');
  insert into public.agencies (id, name, slug, subdomain, app_display_name, contact_email)
    values (v_agency, 'DelSmoke', 'delsmoke', 'delsmoke', 'DelSmoke', 'del@y.z');
  insert into public.tenants (id, agency_id, name, slug, subdomain, app_display_name)
    values (v_tenant, v_agency, 'DelSmoke', 'delsmoke-t', 'delsmoket', 'DelSmoke');
  insert into public.tenant_members (tenant_id, user_id, role) values (v_tenant, v_owner, 'owner');
  insert into public.spaces (id, tenant_id, name, created_by) values (v_space, v_tenant, 'Primary', v_owner);
  insert into public.space_members (space_id, user_id, role) values (v_space, v_owner, 'owner');
  insert into public.companies (id, space_id, created_by, name) values (v_company, v_space, v_owner, 'Del Pharma');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_a, v_space, v_owner, v_company, 'DelAssetA');
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'DelAssetB');
  insert into public.trials (id, space_id, created_by, asset_id, name, identifier)
    values (v_trial, v_space, v_owner, v_asset_a, 'Del Trial', 'NCT-DEL-001');
  -- make it a two-asset trial, primary = asset_a (bootstrap created the a row)
  insert into public.trial_assets (trial_id, asset_id, is_primary, source) values (v_trial, v_asset_b, false, 'smoke');

  -- delete the NON-primary asset_b: trial survives, primary unchanged (a)
  delete from public.assets where id = v_asset_b;
  select count(*) into v_count from public.trials where id = v_trial;
  if v_count <> 1 then raise exception 'delete-semantics FAIL: trial deleted when a non-primary asset was removed'; end if;
  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_a then raise exception 'delete-semantics FAIL: primary changed unexpectedly'; end if;
  select count(*) into v_count from public.trial_assets where trial_id = v_trial;
  if v_count <> 1 then raise exception 'delete-semantics FAIL: expected 1 membership after removing b, got %', v_count; end if;

  -- re-add b and make it primary, then delete the PRIMARY asset_a: survives, repoints to b
  insert into public.assets (id, space_id, created_by, company_id, name) values (v_asset_b, v_space, v_owner, v_company, 'DelAssetB2');
  insert into public.trial_assets (trial_id, asset_id, is_primary, source) values (v_trial, v_asset_b, false, 'smoke');
  update public.trial_assets set is_primary = false where trial_id = v_trial;
  update public.trial_assets set is_primary = true where trial_id = v_trial and asset_id = v_asset_b;
  delete from public.assets where id = v_asset_a;
  select count(*) into v_count from public.trials where id = v_trial;
  if v_count <> 1 then raise exception 'delete-semantics FAIL: trial deleted when the primary asset was removed but another remained'; end if;
  select asset_id into v_aid from public.trials where id = v_trial;
  if v_aid <> v_asset_b then raise exception 'delete-semantics FAIL: primary did not repoint to b after deleting a (got %)', v_aid; end if;

  -- delete the LAST asset_b: trial is removed
  delete from public.assets where id = v_asset_b;
  select count(*) into v_count from public.trials where id = v_trial;
  if v_count <> 0 then raise exception 'delete-semantics FAIL: trial survived removal of its last asset'; end if;

  -- cleanup
  perform set_config('clint.member_guard_cascade', 'on', true);
  delete from public.space_members where space_id = v_space;
  delete from public.tenant_members where tenant_id = v_tenant;
  delete from public.tenants where id = v_tenant;
  delete from public.agencies where id = v_agency;
  delete from auth.users where id = v_owner;
  perform set_config('clint.member_guard_cascade', 'off', true);

  raise notice 'delete-semantics smoke ok: non-primary survives, primary repoints, last-asset removes trial';
end $$;
