-- migration: 20260411120200_create_landscape_index_function
-- purpose: create public.get_landscape_index() which returns one entry per
--          therapeutic area in the caller's space, with product and company
--          counts and the highest development phase present. powers the
--          landscape index grid (the landing page at /landscape).
-- affected objects: public.get_landscape_index (function)
-- notes: security invoker, stable. returns all TAs in the space including
--        TAs with zero qualifying products. a product is "qualifying" if it
--        has at least one non-OBS trial_phases row for a trial in the TA.
--        products_missing_phase counts products with trials in the TA that
--        have no non-OBS phase data (including products whose only phase is
--        OBS) so the UI can surface data-entry gaps.

create or replace function public.get_landscape_index(
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
  select coalesce(jsonb_agg(ta_obj order by ta.name), '[]'::jsonb)
  into result
  from public.therapeutic_areas ta
  cross join lateral (
    with product_rollup as (
      select
        p.id as product_id,
        p.company_id,
        max(case tp.phase_type
          when 'LAUNCHED' then 6
          when 'APPROVED' then 5
          when 'P4'       then 4
          when 'P3'       then 3
          when 'P2'       then 2
          when 'P1'       then 1
          when 'PRECLIN'  then 0
          else null
        end) as max_rank
      from public.products p
      join public.trials t
        on t.product_id = p.id
       and t.space_id = p_space_id
       and t.therapeutic_area_id = ta.id
      left join public.trial_phases tp
        on tp.trial_id = t.id
       and tp.space_id = p_space_id
       and tp.phase_type <> 'OBS'
      where p.space_id = p_space_id
      group by p.id, p.company_id
    )
    select jsonb_build_object(
      'therapeutic_area', jsonb_build_object(
        'id', ta.id,
        'name', ta.name,
        'abbreviation', ta.abbreviation
      ),
      'product_count', (
        select count(*) from product_rollup where max_rank is not null
      ),
      'company_count', (
        select count(distinct company_id) from product_rollup where max_rank is not null
      ),
      'highest_phase_present', (
        select case max(max_rank)
          when 6 then 'LAUNCHED'
          when 5 then 'APPROVED'
          when 4 then 'P4'
          when 3 then 'P3'
          when 2 then 'P2'
          when 1 then 'P1'
          when 0 then 'PRECLIN'
          else null
        end
        from product_rollup
        where max_rank is not null
      ),
      'products_missing_phase', (
        select count(*) from product_rollup where max_rank is null
      )
    ) as ta_obj
  ) as ta_lateral
  where ta.space_id = p_space_id;

  return result;
end;
$$;

comment on function public.get_landscape_index is
  'Returns one entry per therapeutic area in the given space with product/company counts, the highest development phase present, and a count of products missing bullseye-visible phase data. security invoker ensures RLS constrains rows to the caller. Used by the landscape index grid.';
