-- migration: 20260524120100_migrate_ta_to_indications
-- purpose: migrate data from therapeutic_areas to indications, create conditions,
--          populate condition_indication_map, trial_conditions, and asset_indications.
-- affected tables: public.indications, public.conditions, public.condition_indication_map,
--                  public.trial_conditions, public.asset_indications
-- notes: does NOT drop therapeutic_areas or trials.therapeutic_area_id yet (T7).

-- =============================================================================
-- 1. copy therapeutic_areas into indications (preserving UUIDs)
-- =============================================================================
insert into public.indications (id, space_id, name, abbreviation, created_by, created_at)
select
  ta.id,
  ta.space_id,
  ta.name,
  ta.abbreviation,
  ta.created_by,
  ta.created_at
from public.therapeutic_areas ta
on conflict (space_id, name) do nothing;

-- =============================================================================
-- 2. create a matching condition for each therapeutic area
-- =============================================================================
insert into public.conditions (id, space_id, name, source, created_at)
select
  gen_random_uuid(),
  ta.space_id,
  ta.name,
  'analyst',
  ta.created_at
from public.therapeutic_areas ta
on conflict (space_id, name) do nothing;

-- =============================================================================
-- 3. map each condition to its corresponding indication
-- =============================================================================
insert into public.condition_indication_map (condition_id, indication_id)
select c.id, i.id
from public.conditions c
join public.indications i on i.space_id = c.space_id and i.name = c.name
on conflict do nothing;

-- =============================================================================
-- 4. for each trial with therapeutic_area_id, create trial_conditions rows
-- =============================================================================
insert into public.trial_conditions (trial_id, condition_id, source)
select
  t.id,
  c.id,
  'analyst'
from public.trials t
join public.therapeutic_areas ta on ta.id = t.therapeutic_area_id
join public.conditions c on c.space_id = ta.space_id and c.name = ta.name
on conflict do nothing;

-- =============================================================================
-- 5. backfill asset_indications from trial data
-- =============================================================================
-- for each distinct (product_id, therapeutic_area_id) pair in trials, compute
-- the max phase_type rank and insert an asset_indications row.

insert into public.asset_indications (
  asset_id, indication_id, space_id,
  development_status, development_status_source,
  created_by
)
select
  sub.product_id,
  sub.indication_id,
  sub.space_id,
  sub.dev_status,
  sub.dev_source,
  sub.created_by
from (
  select
    t.product_id,
    i.id as indication_id,
    t.space_id,
    (
      select case max(
        case pt.phase_type
          when 'LAUNCHED'  then 6
          when 'APPROVED'  then 5
          when 'P4'        then 4
          when 'P3'        then 3
          when 'P2_3'      then 3
          when 'P2'        then 2
          when 'P1_2'      then 1
          when 'P1'        then 1
          when 'PRECLIN'   then 0
          else null
        end)
        when 6 then 'LAUNCHED'
        when 5 then 'APPROVED'
        when 4 then 'P4'
        when 3 then 'P3'
        when 2 then 'P2'
        when 1 then 'P1'
        when 0 then 'PRECLIN'
        else null
      end
      from public.trials pt
      where pt.product_id = t.product_id
        and pt.therapeutic_area_id = t.therapeutic_area_id
    ) as dev_status,
    case
      when exists (
        select 1 from public.trials pt2
        where pt2.product_id = t.product_id
          and pt2.therapeutic_area_id = t.therapeutic_area_id
          and pt2.phase_type in ('APPROVED', 'LAUNCHED')
      ) then 'analyst'
      else 'auto'
    end as dev_source,
    (array_agg(t.created_by))[1] as created_by
  from public.trials t
  join public.indications i on i.id = t.therapeutic_area_id
  group by t.product_id, i.id, t.space_id, t.therapeutic_area_id
) sub
on conflict (asset_id, indication_id) do nothing;

-- =============================================================================
-- smoke tests
-- =============================================================================
do $$
declare
  v_ind_count    int;
  v_ta_count     int;
  v_trial_count  int;
  v_tc_count     int;
  v_pair_count   int;
  v_ai_count     int;
begin
  select count(*) into v_ta_count from public.therapeutic_areas;
  select count(*) into v_ind_count from public.indications;
  assert v_ind_count >= v_ta_count,
    format('indications (%s) should be >= therapeutic_areas (%s)', v_ind_count, v_ta_count);

  select count(*) into v_trial_count
    from public.trials where therapeutic_area_id is not null;
  select count(*) into v_tc_count from public.trial_conditions;
  assert v_tc_count >= v_trial_count,
    format('trial_conditions (%s) should be >= trials with TA (%s)', v_tc_count, v_trial_count);

  select count(distinct (product_id, therapeutic_area_id)) into v_pair_count
    from public.trials where therapeutic_area_id is not null;
  select count(*) into v_ai_count from public.asset_indications;
  assert v_ai_count >= v_pair_count,
    format('asset_indications (%s) should be >= distinct (product,TA) pairs (%s)', v_ai_count, v_pair_count);

  raise notice 'smoke: TA migration passed (% indications, % trial_conditions, % asset_indications)',
    v_ind_count, v_tc_count, v_ai_count;
end;
$$;
