-- migration: 20260527230000_fix_event_detail_product_refs
-- purpose: update get_event_detail and get_key_catalysts to reference
--          public.assets / asset_id instead of the old public.products /
--          product_id names that were missed during the products->assets
--          rename (20260524120200).
--          Also drop the orphaned _seed_demo_products function.

-- =============================================================================
-- 1. get_event_detail
-- =============================================================================

create or replace function public.get_event_detail(
  p_event_id uuid
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
  select jsonb_build_object(
    'id', ev.id,
    'space_id', ev.space_id,
    'title', ev.title,
    'event_date', ev.event_date,
    'description', ev.description,
    'priority', ev.priority,
    'tags', to_jsonb(ev.tags),
    'thread_id', ev.thread_id,
    'thread_order', ev.thread_order,
    'created_by', ev.created_by,
    'created_at', ev.created_at,
    'updated_at', ev.updated_at,
    'category', jsonb_build_object(
      'id', ec.id,
      'name', ec.name
    ),
    'entity_level', case
      when ev.trial_id is not null then 'trial'
      when ev.asset_id is not null then 'product'
      when ev.company_id is not null then 'company'
      else 'space'
    end,
    'entity_name', coalesce(t.name, a.name, co.name, 'Industry'),
    'entity_id', coalesce(ev.trial_id, ev.asset_id, ev.company_id),
    'company_name', coalesce(
      co.name,
      co_via_asset.name,
      co_via_trial.name
    ),
    'sources', coalesce((
      select jsonb_agg(
        jsonb_build_object('id', es.id, 'url', es.url, 'label', es.label)
        order by es.created_at
      )
      from public.event_sources es
      where es.event_id = ev.id
    ), '[]'::jsonb),
    'thread', case when ev.thread_id is not null then (
      select jsonb_build_object(
        'id', et.id,
        'title', et.title,
        'events', coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', te.id,
              'title', te.title,
              'event_date', te.event_date,
              'thread_order', te.thread_order
            )
            order by te.thread_order
          )
          from public.events te
          where te.thread_id = et.id
        ), '[]'::jsonb)
      )
      from public.event_threads et
      where et.id = ev.thread_id
    ) else null end,
    'linked_events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', le.id,
          'title', le.title,
          'event_date', le.event_date,
          'category_name', lec.name
        )
      )
      from (
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.target_event_id
        where el.source_event_id = ev.id
        union
        select e2.* from public.event_links el
        join public.events e2 on e2.id = el.source_event_id
        where el.target_event_id = ev.id
      ) le
      join public.event_categories lec on lec.id = le.category_id
    ), '[]'::jsonb)
  )
  into result
  from public.events ev
  join public.event_categories ec on ec.id = ev.category_id
  left join public.companies co on co.id = ev.company_id
  left join public.assets a on a.id = ev.asset_id
  left join public.companies co_via_asset on a.id is not null and co_via_asset.id = a.company_id
  left join public.trials t on t.id = ev.trial_id
  left join public.assets a_via_trial on t.id is not null and a_via_trial.id = t.asset_id
  left join public.companies co_via_trial on a_via_trial.id is not null and co_via_trial.id = a_via_trial.company_id
  where ev.id = p_event_id;

  return result;
end;
$$;

-- =============================================================================
-- 2. get_key_catalysts
-- =============================================================================
-- Drop the old signature (p_product_id) and recreate with p_asset_id.
-- JSON keys also renamed: product_name -> asset_name, product_id -> asset_id.

drop function if exists public.get_key_catalysts(uuid, uuid[], uuid, uuid);

create or replace function public.get_key_catalysts(
  p_space_id      uuid,
  p_category_ids  uuid[]   default null,
  p_company_id    uuid     default null,
  p_asset_id      uuid     default null
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
        'asset_name',       a.name,
        'asset_id',         a.id,
        'trial_name',       t.name,
        'trial_acronym',    t.acronym,
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
    left join public.assets a on a.id = t.asset_id
    left join public.companies co on co.id = a.company_id
    where m.space_id = p_space_id
      and m.event_date >= current_date
      and m.no_longer_expected = false
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_company_id is null or co.id = p_company_id)
      and (p_asset_id is null or a.id = p_asset_id)
  ) sub;

  return result;
end;
$$;

-- =============================================================================
-- 3. drop orphaned _seed_demo_products (replaced by _seed_demo_assets)
-- =============================================================================

drop function if exists public._seed_demo_products(uuid, uuid);
