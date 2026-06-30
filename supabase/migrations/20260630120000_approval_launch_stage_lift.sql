-- migration: 20260630120000_approval_launch_stage_lift
-- issue: clint-org/clint#159
-- purpose: lift asset_indications.development_status to APPROVED / LAUNCHED from
--          actual Approval / Launch events, so the bullseye + heatmap + profile
--          phase pill stop pinning approved assets at their trial phase.
--
-- design (see issue #159):
--   - events gain an optional indication_id (single column; multi-indication
--     approval = separate events). approval/launch are intrinsically asset+indication
--     milestones, so only anchor_type='asset' events lift.
--   - event_types gain a data-driven lifts_development_status flag (no hardcoded
--     UUIDs in the trigger); custom space event types may opt in.
--   - the lift gate is projection='actual' AND not no_longer_expected. NO date
--     guard: a trigger fires on writes, not the passage of time, and 'actual'
--     already means it happened. forecasted/anticipated approvals never lift.
--   - the events trigger guarantees the (asset, indication) program row exists
--     before recomputing, so a correctly-tagged approval can never silently miss.
--   - _recompute_asset_indication_status stays the single source of truth via full
--     re-derivation: any qualifying write re-derives greatest(trial_rank, event_rank),
--     so corrections (actual -> forecasted, delete, re-tag) self-heal.
--
-- affected objects:
--   - column public.events.indication_id (+ index)
--   - column public.event_types.lifts_development_status (+ seed of system rows)
--   - function public._recompute_asset_indication_status(uuid)  [extended]
--   - function public._auto_derive_on_event_change()            [new]
--   - trigger trg_auto_derive_on_event on public.events         [new]
--   - one-time backfill of existing actual approval/launch events

-- =============================================================================
-- 1. events.indication_id
-- =============================================================================
alter table public.events
  add column if not exists indication_id uuid references public.indications (id) on delete set null;

create index if not exists idx_events_indication_id on public.events (indication_id);
-- supports the recompute lookup: asset-anchored events for one indication
create index if not exists idx_events_anchor_indication
  on public.events (anchor_id, indication_id)
  where anchor_type = 'asset';

comment on column public.events.indication_id is
  'optional indication this event is attributed to. for Approval/Launch events this is what lifts asset_indications.development_status to APPROVED/LAUNCHED for that indication.';

-- =============================================================================
-- 2. event_types.lifts_development_status (data-driven stage mapping)
-- =============================================================================
alter table public.event_types
  add column if not exists lifts_development_status text
    check (lifts_development_status is null
           or lifts_development_status in ('APPROVED', 'LAUNCHED'));

comment on column public.event_types.lifts_development_status is
  'when set, an actual event of this type (anchored to an asset, tagged with an indication) lifts that asset_indications.development_status to this value. null = no effect.';

-- seed the system Approval / Launch rows
update public.event_types set lifts_development_status = 'APPROVED'
  where id = 'a0000000-0000-0000-0000-000000000035';
update public.event_types set lifts_development_status = 'LAUNCHED'
  where id = 'a0000000-0000-0000-0000-000000000036';

-- =============================================================================
-- 3. extend the recompute to consider actual approval/launch events
--    (based on the LIVE definition: trial->asset linkage is via trial_assets)
-- =============================================================================
create or replace function public._recompute_asset_indication_status(p_asset_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ai         record;
  v_trial_rank int;
  v_event_rank int;
  v_max_rank   int;
  v_new_status text;
begin
  for v_ai in
    select ai.id, ai.indication_id
    from public.asset_indications ai
    where ai.asset_id = p_asset_id
      and ai.development_status_source = 'auto'
  loop
    -- trial-derived rank (caps at P4)
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
    ) into v_trial_rank
    from public.trials t
    join public.trial_assets ta on ta.trial_id = t.id
    join public.trial_conditions tc on tc.trial_id = t.id
    join public.condition_indication_map cim on cim.condition_id = tc.condition_id
    where ta.asset_id = p_asset_id
      and cim.indication_id = v_ai.indication_id
      and t.phase_type is not null;

    -- event-derived rank from actual, still-expected approval/launch milestones
    select max(
      case et.lifts_development_status
        when 'APPROVED' then 5
        when 'LAUNCHED' then 6
        else null
      end
    ) into v_event_rank
    from public.events e
    join public.event_types et on et.id = e.event_type_id
    where e.anchor_type = 'asset'
      and e.anchor_id = p_asset_id
      and e.indication_id = v_ai.indication_id
      and e.projection = 'actual'
      and e.no_longer_expected = false
      and et.lifts_development_status is not null;

    v_max_rank := greatest(coalesce(v_trial_rank, -1), coalesce(v_event_rank, -1));
    if v_max_rank < 0 then
      v_max_rank := null;
    end if;

    v_new_status := case v_max_rank
      when 6 then 'LAUNCHED'
      when 5 then 'APPROVED'
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
-- 4. events trigger: ensure the program row, then recompute
-- =============================================================================
create or replace function public._auto_derive_on_event_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_lifts text;
begin
  -- NEW side (insert/update): ensure the (asset, indication) program row exists
  -- so a status-lifting event always has a target, then recompute the asset.
  if tg_op in ('INSERT', 'UPDATE') then
    if new.anchor_type = 'asset' and new.anchor_id is not null then
      if new.indication_id is not null then
        select et.lifts_development_status into v_lifts
          from public.event_types et where et.id = new.event_type_id;
        if v_lifts is not null then
          insert into public.asset_indications
            (asset_id, indication_id, space_id, development_status_source, created_by)
          select new.anchor_id, new.indication_id, new.space_id, 'auto', new.created_by
          where not exists (
            select 1 from public.asset_indications ai
            where ai.asset_id = new.anchor_id
              and ai.indication_id = new.indication_id
          );
        end if;
      end if;
      perform public._recompute_asset_indication_status(new.anchor_id);
    end if;
  end if;

  -- OLD side (update/delete): recompute the previously-affected asset when it is
  -- no longer the NEW asset (re-anchor) or the row is gone (delete).
  if tg_op in ('UPDATE', 'DELETE') then
    if old.anchor_type = 'asset' and old.anchor_id is not null
       and (tg_op = 'DELETE' or old.anchor_id is distinct from new.anchor_id) then
      perform public._recompute_asset_indication_status(old.anchor_id);
    end if;
  end if;

  return null;
end;
$$;

-- watch only the columns that affect the lift (event_date is NOT watched: the
-- gate is projection-based, not date-based).
create trigger trg_auto_derive_on_event
  after insert or delete or update of
    projection, no_longer_expected, event_type_id, anchor_type, anchor_id, indication_id
  on public.events
  for each row execute function public._auto_derive_on_event_change();

-- =============================================================================
-- 5. one-time backfill of existing actual approval/launch events
--    only auto-tag when the anchored asset has exactly one indication; ambiguous
--    multi-indication assets are left null and surfaced by the UI diagnostic.
--    (the UPDATE fires trg_auto_derive_on_event, which recomputes each asset.)
-- =============================================================================
with single_ind as (
  select asset_id, (array_agg(indication_id))[1] as indication_id
  from public.asset_indications
  group by asset_id
  having count(*) = 1
)
update public.events e
set indication_id = si.indication_id
from public.event_types et, single_ind si
where e.event_type_id = et.id
  and et.lifts_development_status is not null
  and e.anchor_type = 'asset'
  and e.anchor_id = si.asset_id
  and e.indication_id is null
  and e.projection = 'actual'
  and e.no_longer_expected = false;

-- PostgREST: pick up the new events.indication_id column
notify pgrst, 'reload schema';

-- =============================================================================
-- 6. smoke tests (derivation matrix from issue #159)
-- =============================================================================
do $$
declare
  v_space_id   uuid;
  v_user_id    uuid;
  v_company_id uuid;
  v_asset_id   uuid;
  v_fcs_id     uuid;   -- indication: FCS (has trials)
  v_htg_id     uuid;   -- indication: HTG (has trials)
  v_new_id     uuid;   -- indication with no trials/no asset_indication row
  v_cond_fcs   uuid;
  v_cond_htg   uuid;
  v_trial_fcs  uuid;
  v_trial_htg  uuid;
  v_approval_type uuid := 'a0000000-0000-0000-0000-000000000035';
  v_launch_type   uuid := 'a0000000-0000-0000-0000-000000000036';
  v_appr_evt   uuid;
  v_status     text;
  v_status_htg text;
begin
  select s.id into v_space_id from public.spaces s limit 1;
  select u.id into v_user_id from auth.users u limit 1;
  if v_space_id is null or v_user_id is null then
    raise notice 'smoke: skipping approval/launch lift tests (no seed data)';
    return;
  end if;

  select c.id into v_company_id from public.companies c where c.space_id = v_space_id limit 1;
  if v_company_id is null then
    raise notice 'smoke: skipping approval/launch lift tests (no company)';
    return;
  end if;

  -- ---- fixtures -----------------------------------------------------------
  insert into public.assets (space_id, company_id, created_by, name)
    values (v_space_id, v_company_id, v_user_id, '__smoke_lift_asset')
    returning id into v_asset_id;

  insert into public.indications (space_id, name, created_by)
    values (v_space_id, '__smoke_lift_fcs', v_user_id) returning id into v_fcs_id;
  insert into public.indications (space_id, name, created_by)
    values (v_space_id, '__smoke_lift_htg', v_user_id) returning id into v_htg_id;
  insert into public.indications (space_id, name, created_by)
    values (v_space_id, '__smoke_lift_new', v_user_id) returning id into v_new_id;

  insert into public.conditions (space_id, name, source)
    values (v_space_id, '__smoke_lift_cond_fcs', 'analyst') returning id into v_cond_fcs;
  insert into public.conditions (space_id, name, source)
    values (v_space_id, '__smoke_lift_cond_htg', 'analyst') returning id into v_cond_htg;
  insert into public.condition_indication_map (condition_id, indication_id)
    values (v_cond_fcs, v_fcs_id), (v_cond_htg, v_htg_id);

  -- auto-sourced program rows for FCS + HTG (status null until trials)
  insert into public.asset_indications (asset_id, indication_id, space_id, development_status_source, created_by)
    values (v_asset_id, v_fcs_id, v_space_id, 'auto', v_user_id),
           (v_asset_id, v_htg_id, v_space_id, 'auto', v_user_id);

  -- P3 trial on each indication (link via trials.asset_id + trial_assets + trial_conditions)
  insert into public.trials (space_id, created_by, asset_id, name, phase_type)
    values (v_space_id, v_user_id, v_asset_id, '__smoke_lift_trial_fcs', 'P3') returning id into v_trial_fcs;
  insert into public.trial_assets (trial_id, asset_id) values (v_trial_fcs, v_asset_id)
    on conflict (trial_id, asset_id) do nothing;  -- trg_trial_assets_bootstrap may already add it
  insert into public.trial_conditions (trial_id, condition_id, source) values (v_trial_fcs, v_cond_fcs, 'analyst');

  insert into public.trials (space_id, created_by, asset_id, name, phase_type)
    values (v_space_id, v_user_id, v_asset_id, '__smoke_lift_trial_htg', 'P3') returning id into v_trial_htg;
  insert into public.trial_assets (trial_id, asset_id) values (v_trial_htg, v_asset_id)
    on conflict (trial_id, asset_id) do nothing;
  insert into public.trial_conditions (trial_id, condition_id, source) values (v_trial_htg, v_cond_htg, 'analyst');

  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'P3', format('baseline FCS expected P3, got %s', v_status);

  -- ---- 1. actual approval on FCS lifts to APPROVED ------------------------
  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
                             indication_id, projection, created_by)
    values (v_space_id, v_approval_type, '__smoke FCS approval', date '2026-01-01', 'asset', v_asset_id,
            v_fcs_id, 'actual', v_user_id)
    returning id into v_appr_evt;

  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'APPROVED', format('after actual approval expected APPROVED, got %s', v_status);

  -- ---- 2. per-indication isolation: HTG stays P3 --------------------------
  select development_status into v_status_htg from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_htg_id;
  assert v_status_htg = 'P3', format('HTG should stay P3, got %s', v_status_htg);

  -- ---- 3. actual -> forecasted reverts to P3 ------------------------------
  update public.events set projection = 'forecasted' where id = v_appr_evt;
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'P3', format('after actual->forecasted expected P3, got %s', v_status);

  -- ---- 4. forecasted -> actual re-lifts -----------------------------------
  update public.events set projection = 'actual' where id = v_appr_evt;
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'APPROVED', format('after forecasted->actual expected APPROVED, got %s', v_status);

  -- ---- 5. no_longer_expected does not lift --------------------------------
  update public.events set no_longer_expected = true where id = v_appr_evt;
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'P3', format('no_longer_expected approval should not lift, got %s', v_status);
  update public.events set no_longer_expected = false where id = v_appr_evt;

  -- ---- 6. launch lifts to LAUNCHED (jumps past APPROVED) ------------------
  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
                             indication_id, projection, created_by)
    values (v_space_id, v_launch_type, '__smoke FCS launch', date '2026-02-01', 'asset', v_asset_id,
            v_fcs_id, 'actual', v_user_id);
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'LAUNCHED', format('after launch expected LAUNCHED, got %s', v_status);

  -- ---- 7. delete approval+launch -> reverts to P3 -------------------------
  delete from public.events where anchor_id = v_asset_id and anchor_type = 'asset'
    and event_type_id in (v_approval_type, v_launch_type);
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'P3', format('after deleting events expected P3, got %s', v_status);

  -- ---- 8. ensure-row: approval for an indication with NO program row ------
  --        (no trial, no asset_indication) creates the row and lifts it.
  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
                             indication_id, projection, created_by)
    values (v_space_id, v_approval_type, '__smoke new-ind approval', date '2026-03-01', 'asset', v_asset_id,
            v_new_id, 'actual', v_user_id);
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_new_id;
  assert v_status = 'APPROVED', format('ensure-row approval expected APPROVED, got %s', coalesce(v_status, '<no row>'));

  -- ---- 9. analyst override is not clobbered by event changes --------------
  update public.asset_indications
    set development_status = 'P2', development_status_source = 'analyst'
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  insert into public.events (space_id, event_type_id, title, event_date, anchor_type, anchor_id,
                             indication_id, projection, created_by)
    values (v_space_id, v_approval_type, '__smoke analyst-guard approval', date '2026-04-01', 'asset', v_asset_id,
            v_fcs_id, 'actual', v_user_id);
  select development_status into v_status from public.asset_indications
    where asset_id = v_asset_id and indication_id = v_fcs_id;
  assert v_status = 'P2', format('analyst override should stay P2, got %s', v_status);

  -- ---- cleanup ------------------------------------------------------------
  delete from public.events where anchor_id = v_asset_id and anchor_type = 'asset';
  delete from public.trial_conditions where trial_id in (v_trial_fcs, v_trial_htg);
  delete from public.trial_assets where trial_id in (v_trial_fcs, v_trial_htg);
  delete from public.trials where id in (v_trial_fcs, v_trial_htg);
  delete from public.asset_indications where asset_id = v_asset_id;
  delete from public.condition_indication_map where condition_id in (v_cond_fcs, v_cond_htg);
  delete from public.conditions where id in (v_cond_fcs, v_cond_htg);
  delete from public.indications where id in (v_fcs_id, v_htg_id, v_new_id);
  delete from public.assets where id = v_asset_id;

  raise notice 'smoke: approval/launch stage-lift tests passed';
end;
$$;
