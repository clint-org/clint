-- migration: 20260414120000_key_catalysts_rpc
-- purpose: RPC functions for the Key Catalysts page
-- affected functions (created): get_key_catalysts, get_catalyst_detail

-- ============================================================
-- 1. get_key_catalysts - forward-looking chronological feed
-- ============================================================

create or replace function public.get_key_catalysts(
  p_space_id      uuid,
  p_category_ids  uuid[]   default null,
  p_company_id    uuid     default null,
  p_product_id    uuid     default null
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
  -- normalize empty arrays to null
  if p_category_ids = '{}' then p_category_ids := null; end if;

  select coalesce(jsonb_agg(row_data order by event_date asc, title asc), '[]'::jsonb)
  into result
  from (
    select
      jsonb_build_object(
        'marker_id',        m.id,
        'title',            m.title,
        'event_date',       m.event_date,
        'end_date',         m.end_date,
        'category_name',    mc.name,
        'category_id',      mc.id,
        'marker_type_name', mt.name,
        'marker_type_icon', mt.icon,
        'marker_type_color', mt.color,
        'marker_type_shape', mt.shape,
        'is_projected',     m.is_projected,
        'company_name',     co.name,
        'company_id',       co.id,
        'product_name',     pr.name,
        'product_id',       pr.id,
        'trial_name',       t.name,
        'trial_id',         t.id,
        'trial_phase',      t.phase,
        'description',      m.description,
        'source_url',       m.source_url
      ) as row_data,
      m.event_date,
      m.title
    from public.markers m
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    left join lateral (
      select ma_inner.trial_id
      from public.marker_assignments ma_inner
      where ma_inner.marker_id = m.id
      limit 1
    ) ma on true
    left join public.trials t on t.id = ma.trial_id
    left join public.products pr on pr.id = t.product_id
    left join public.companies co on co.id = pr.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_product_id is null or pr.id = p_product_id)
  ) sub;

  return result;
end;
$$;


-- ============================================================
-- 2. get_catalyst_detail - enriched single-catalyst view
-- ============================================================

create or replace function public.get_catalyst_detail(
  p_marker_id uuid
)
returns jsonb
language plpgsql
security invoker
stable
set search_path = ''
as $$
declare
  v_catalyst   jsonb;
  v_trial_id   uuid;
  v_product_id uuid;
  v_company_id uuid;
  v_upcoming   jsonb;
  v_related    jsonb;
begin
  -- Fetch main catalyst data
  select
    jsonb_build_object(
      'marker_id',          m.id,
      'title',              m.title,
      'event_date',         m.event_date,
      'end_date',           m.end_date,
      'category_name',      mc.name,
      'category_id',        mc.id,
      'marker_type_name',   mt.name,
      'marker_type_icon',   mt.icon,
      'marker_type_color',  mt.color,
      'marker_type_shape',  mt.shape,
      'is_projected',       m.is_projected,
      'company_name',       co.name,
      'company_id',         co.id,
      'product_name',       pr.name,
      'product_id',         pr.id,
      'trial_name',         t.name,
      'trial_id',           t.id,
      'trial_phase',        t.phase,
      'recruitment_status', t.recruitment_status,
      'description',        m.description,
      'source_url',         m.source_url
    ),
    t.id,
    pr.id,
    co.id
  into v_catalyst, v_trial_id, v_product_id, v_company_id
  from public.markers m
  join public.marker_types mt on mt.id = m.marker_type_id
  join public.marker_categories mc on mc.id = mt.category_id
  left join lateral (
    select ma_inner.trial_id
    from public.marker_assignments ma_inner
    where ma_inner.marker_id = m.id
    limit 1
  ) ma on true
  left join public.trials t on t.id = ma.trial_id
  left join public.products pr on pr.id = t.product_id
  left join public.companies co on co.id = pr.company_id
  where m.id = p_marker_id;

  if v_catalyst is null then
    return null;
  end if;

  -- Upcoming markers for the same trial (next 5, excluding current)
  if v_trial_id is not null then
    select coalesce(jsonb_agg(jsonb_build_object(
      'marker_id',        sub.id,
      'title',            sub.title,
      'event_date',       sub.event_date,
      'marker_type_name', sub.mt_name,
      'is_projected',     sub.is_projected
    )), '[]'::jsonb)
    into v_upcoming
    from (
      select m2.id, m2.title, m2.event_date, mt2.name as mt_name, m2.is_projected
      from public.markers m2
      join public.marker_types mt2 on mt2.id = m2.marker_type_id
      join public.marker_assignments ma2 on ma2.marker_id = m2.id
      where ma2.trial_id = v_trial_id
        and m2.event_date >= current_date
        and m2.id != p_marker_id
        and m2.no_longer_expected = false
      order by m2.event_date asc
      limit 5
    ) sub;
  else
    v_upcoming := '[]'::jsonb;
  end if;

  -- Related events for the same trial/product/company (last 10)
  select coalesce(jsonb_agg(jsonb_build_object(
    'event_id',      sub.id,
    'title',         sub.title,
    'event_date',    sub.event_date,
    'category_name', sub.cat_name
  )), '[]'::jsonb)
  into v_related
  from (
    select e.id, e.title, e.event_date, ec.name as cat_name
    from public.events e
    join public.event_categories ec on ec.id = e.category_id
    where (
      (v_trial_id   is not null and e.trial_id   = v_trial_id)
      or (v_product_id is not null and e.product_id = v_product_id)
      or (v_company_id is not null and e.company_id = v_company_id)
    )
    order by e.event_date desc
    limit 10
  ) sub;

  return jsonb_build_object(
    'catalyst',         v_catalyst,
    'upcoming_markers', v_upcoming,
    'related_events',   v_related
  );
end;
$$;
