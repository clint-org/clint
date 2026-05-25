-- migration: 20260524120400_asset_indication_auto_derive
-- purpose: auto-derive asset_indications.development_status from trial data.
--          fires on trial INSERT/UPDATE/DELETE and trial_conditions INSERT/DELETE.
-- affected objects:
--   - function public._recompute_asset_indication_status(uuid)
--   - function public._auto_derive_asset_indication_status()
--   - function public._auto_derive_on_trial_condition_change()
--   - trigger trg_auto_derive_asset_indication on public.trials
--   - trigger trg_auto_derive_on_trial_condition on public.trial_conditions
--   - function public.reset_asset_indication_status(uuid)

-- =============================================================================
-- 1. shared recomputation function
-- =============================================================================
-- recomputes development_status for all 'auto'-sourced asset_indications
-- for a given asset_id. called by both triggers.

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
    join public.trial_conditions tc on tc.trial_id = t.id
    join public.condition_indication_map cim on cim.condition_id = tc.condition_id
    where t.asset_id = p_asset_id
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

-- =============================================================================
-- 2. trial trigger function
-- =============================================================================
create or replace function public._auto_derive_asset_indication_status()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' then
    perform public._recompute_asset_indication_status(old.asset_id);
  elsif tg_op = 'INSERT' then
    perform public._recompute_asset_indication_status(new.asset_id);
  elsif tg_op = 'UPDATE' then
    if old.asset_id is distinct from new.asset_id
       or old.phase_type is distinct from new.phase_type then
      perform public._recompute_asset_indication_status(new.asset_id);
      if old.asset_id is distinct from new.asset_id then
        perform public._recompute_asset_indication_status(old.asset_id);
      end if;
    end if;
  end if;
  return null;
end;
$$;

create trigger trg_auto_derive_asset_indication
  after insert or update of phase_type, asset_id or delete
  on public.trials
  for each row execute function public._auto_derive_asset_indication_status();

-- =============================================================================
-- 3. trial_conditions trigger function
-- =============================================================================
create or replace function public._auto_derive_on_trial_condition_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_asset_id uuid;
begin
  if tg_op = 'DELETE' then
    select t.asset_id into v_asset_id
      from public.trials t where t.id = old.trial_id;
  else
    select t.asset_id into v_asset_id
      from public.trials t where t.id = new.trial_id;
  end if;

  if v_asset_id is not null then
    perform public._recompute_asset_indication_status(v_asset_id);
  end if;

  return null;
end;
$$;

create trigger trg_auto_derive_on_trial_condition
  after insert or delete
  on public.trial_conditions
  for each row execute function public._auto_derive_on_trial_condition_change();

-- =============================================================================
-- 4. reset RPC
-- =============================================================================
create or replace function public.reset_asset_indication_status(p_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ai       record;
  v_max_rank int;
  v_new_status text;
begin
  select ai.*, a.space_id as check_space_id
    into v_ai
    from public.asset_indications ai
    join public.assets a on a.id = ai.asset_id
    where ai.id = p_id;

  if v_ai is null then
    raise exception 'asset_indication not found: %', p_id;
  end if;

  if not public.has_space_access(v_ai.space_id, array['owner', 'editor']) then
    raise exception 'insufficient permissions';
  end if;

  -- set to auto and recompute
  update public.asset_indications
    set development_status_source = 'auto',
        updated_at = now()
    where id = p_id;

  perform public._recompute_asset_indication_status(v_ai.asset_id);
end;
$$;

revoke all on function public.reset_asset_indication_status(uuid) from public;
grant execute on function public.reset_asset_indication_status(uuid) to authenticated;

-- =============================================================================
-- smoke tests
-- =============================================================================
do $$
declare
  v_space_id   uuid;
  v_user_id    uuid;
  v_asset_id   uuid;
  v_ind_id     uuid;
  v_cond_id    uuid;
  v_ai_id      uuid;
  v_trial_1    uuid;
  v_trial_2    uuid;
  v_status     text;
  v_source     text;
  v_had_member boolean;
begin
  select s.id into v_space_id from public.spaces s limit 1;
  select u.id into v_user_id from auth.users u limit 1;

  if v_space_id is null or v_user_id is null then
    raise notice 'smoke: skipping auto-derive tests (no seed data)';
    return;
  end if;

  -- create test fixtures
  insert into public.assets (space_id, company_id, created_by, name)
    select v_space_id, c.id, v_user_id, '__smoke_derive_asset'
    from public.companies c where c.space_id = v_space_id limit 1
    returning id into v_asset_id;

  insert into public.indications (space_id, name, created_by)
    values (v_space_id, '__smoke_derive_ind', v_user_id)
    returning id into v_ind_id;

  insert into public.conditions (space_id, name, source)
    values (v_space_id, '__smoke_derive_cond', 'analyst')
    returning id into v_cond_id;

  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_cond_id, v_ind_id);

  -- create asset_indication with source='auto', status should be null
  insert into public.asset_indications (asset_id, indication_id, space_id,
    development_status_source, created_by)
    values (v_asset_id, v_ind_id, v_space_id, 'auto', v_user_id)
    returning id into v_ai_id;

  select development_status into v_status
    from public.asset_indications where id = v_ai_id;
  assert v_status is null, format('expected null status, got %s', v_status);

  -- insert P2 trial and link via trial_conditions
  insert into public.trials (space_id, created_by, asset_id, therapeutic_area_id, name, phase_type)
    select v_space_id, v_user_id, v_asset_id, ta.id, '__smoke_p2_trial', 'P2'
    from public.therapeutic_areas ta where ta.space_id = v_space_id limit 1
    returning id into v_trial_1;

  insert into public.trial_conditions (trial_id, condition_id, source)
    values (v_trial_1, v_cond_id, 'analyst');

  select development_status into v_status
    from public.asset_indications where id = v_ai_id;
  assert v_status = 'P2', format('expected P2, got %s', v_status);

  -- insert P3 trial, status should bump to P3
  insert into public.trials (space_id, created_by, asset_id, therapeutic_area_id, name, phase_type)
    select v_space_id, v_user_id, v_asset_id, ta.id, '__smoke_p3_trial', 'P3'
    from public.therapeutic_areas ta where ta.space_id = v_space_id limit 1
    returning id into v_trial_2;

  insert into public.trial_conditions (trial_id, condition_id, source)
    values (v_trial_2, v_cond_id, 'analyst');

  select development_status into v_status
    from public.asset_indications where id = v_ai_id;
  assert v_status = 'P3', format('expected P3 after second trial, got %s', v_status);

  -- delete P3 trial, should fall back to P2
  delete from public.trials where id = v_trial_2;

  select development_status into v_status
    from public.asset_indications where id = v_ai_id;
  assert v_status = 'P2', format('expected P2 after P3 delete, got %s', v_status);

  -- set source to analyst with LAUNCHED, insert P1 trial - should NOT change
  update public.asset_indications
    set development_status = 'LAUNCHED',
        development_status_source = 'analyst'
    where id = v_ai_id;

  update public.trials set phase_type = 'P1' where id = v_trial_1;

  select development_status, development_status_source into v_status, v_source
    from public.asset_indications where id = v_ai_id;
  assert v_status = 'LAUNCHED', format('analyst override should stay LAUNCHED, got %s', v_status);
  assert v_source = 'analyst', 'source should stay analyst';

  -- impersonate test user for the RPC (has_space_access checks auth.uid())
  select exists(
    select 1 from public.space_members
    where space_id = v_space_id and user_id = v_user_id
  ) into v_had_member;

  if not v_had_member then
    insert into public.space_members (space_id, user_id, role)
      values (v_space_id, v_user_id, 'owner');
  end if;

  perform set_config('request.jwt.claim.sub', v_user_id::text, true);

  -- reset to auto via RPC
  perform public.reset_asset_indication_status(v_ai_id);

  select development_status, development_status_source into v_status, v_source
    from public.asset_indications where id = v_ai_id;
  assert v_source = 'auto', format('source should be auto after reset, got %s', v_source);
  assert v_status = 'P1', format('expected P1 after reset, got %s', v_status);

  -- cleanup
  perform set_config('request.jwt.claim.sub', '', true);
  if not v_had_member then
    delete from public.space_members
      where space_id = v_space_id and user_id = v_user_id;
  end if;

  delete from public.trials where id = v_trial_1;
  delete from public.asset_indications where id = v_ai_id;
  delete from public.condition_indication_map where condition_id = v_cond_id;
  delete from public.conditions where id = v_cond_id;
  delete from public.indications where id = v_ind_id;
  delete from public.assets where id = v_asset_id;

  raise notice 'smoke: auto-derive trigger tests passed';
end;
$$;
