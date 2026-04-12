-- migration: 20260412120100_create_landscape_index_by_dimension
-- purpose: create index RPCs for company, moa, and roa dimensions.
--          each returns the same shape as get_landscape_index but scoped
--          to the relevant dimension.
-- affected objects: public.get_landscape_index_by_company,
--                   public.get_landscape_index_by_moa,
--                   public.get_landscape_index_by_roa (functions)

-- ============================================================================
-- Index by Company
-- ============================================================================
create or replace function public.get_landscape_index_by_company(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by c.name), '[]'::jsonb)
  into result
  from public.companies c
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        t.therapeutic_area_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.products p
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where p.space_id = p_space_id
        and p.company_id = c.id
      group by p.id, t.therapeutic_area_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', c.id, 'name', c.name, 'abbreviation', null),
      'product_count', (select count(distinct product_id) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct therapeutic_area_id) from product_rollup where max_rank is not null),
      'secondary_label', 'therapeutic areas',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(distinct product_id) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where c.space_id = p_space_id;

  return result;
end;
$$;

-- ============================================================================
-- Index by MOA
-- ============================================================================
create or replace function public.get_landscape_index_by_moa(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by m.display_order, m.name), '[]'::jsonb)
  into result
  from public.mechanisms_of_action m
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.product_mechanisms_of_action pmoa
      join public.products p on p.id = pmoa.product_id and p.space_id = p_space_id
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where pmoa.moa_id = m.id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', m.id, 'name', m.name, 'abbreviation', null),
      'product_count', (select count(*) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct company_id) from product_rollup where max_rank is not null),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(*) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where m.space_id = p_space_id;

  return result;
end;
$$;

-- ============================================================================
-- Index by ROA
-- ============================================================================
create or replace function public.get_landscape_index_by_roa(
  p_space_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  result jsonb;
begin
  select coalesce(jsonb_agg(entry_obj order by r.display_order, r.name), '[]'::jsonb)
  into result
  from public.routes_of_administration r
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6 when 'APPROVED' then 5 when 'P4' then 4
          when 'P3' then 3 when 'P2' then 2 when 'P1' then 1 when 'PRECLIN' then 0
          else null
        end) as max_rank
      from public.product_routes_of_administration proa
      join public.products p on p.id = proa.product_id and p.space_id = p_space_id
      join public.trials t on t.product_id = p.id and t.space_id = p_space_id
      left join public.trial_phases tp on tp.trial_id = t.id and tp.space_id = p_space_id and tp.phase_type <> 'OBS'
      where proa.roa_id = r.id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'entity', jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation),
      'product_count', (select count(*) from product_rollup where max_rank is not null),
      'secondary_count', (select count(distinct company_id) from product_rollup where max_rank is not null),
      'secondary_label', 'companies',
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED' when 5 then 'APPROVED' when 4 then 'P4'
          when 3 then 'P3' when 2 then 'P2' when 1 then 'P1' when 0 then 'PRECLIN'
          else null
        end from product_rollup where max_rank is not null
      ),
      'products_missing_phase', (select count(*) from product_rollup where max_rank is null)
    ) as entry_obj
  ) as entry_lateral
  where r.space_id = p_space_id;

  return result;
end;
$$;
