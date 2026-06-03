-- migration: 20260524120800_drop_therapeutic_areas
-- purpose: drop therapeutic_areas table and trials.therapeutic_area_id column.
--          all data has been migrated to indications/conditions (T2) and all
--          RPCs updated to use the new model (T6a/b/c).

-- 1. drop the FK column on trials
alter table public.trials drop column if exists therapeutic_area_id;

-- 2. drop any remaining indexes
drop index if exists idx_trials_therapeutic_area_id;
drop index if exists idx_therapeutic_areas_space_id;

-- 3. drop RLS policies
drop policy if exists "space members can view therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "space editors can insert therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "space editors can update therapeutic_areas" on public.therapeutic_areas;
drop policy if exists "space editors can delete therapeutic_areas" on public.therapeutic_areas;

-- 4. drop the table
drop table if exists public.therapeutic_areas cascade;

-- 5. smoke test
do $$
begin
  assert not exists (
    select 1 from information_schema.tables
    where table_schema = 'public' and table_name = 'therapeutic_areas'
  ), 'therapeutic_areas should not exist';

  assert not exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'trials' and column_name = 'therapeutic_area_id'
  ), 'trials should not have therapeutic_area_id column';

  raise notice 'smoke: therapeutic_areas dropped successfully';
end;
$$;
