-- migration: 20260413120100_events_rpc_functions
-- purpose: RPC functions for the events page (unified feed, detail, thread, tags)
-- affected functions (created): get_events_page_data, get_event_detail, get_event_thread, get_space_tags

-- ============================================================
-- 1. get_events_page_data - unified chronological feed
-- ============================================================

create or replace function public.get_events_page_data(
  p_space_id      uuid,
  p_date_from     date     default null,
  p_date_to       date     default null,
  p_entity_level  text     default null,
  p_entity_id     uuid     default null,
  p_category_ids  uuid[]   default null,
  p_tags          text[]   default null,
  p_priority      text     default null,
  p_source_type   text     default null,
  p_limit         int      default 50,
  p_offset        int      default 0
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
  if p_tags = '{}' then p_tags := null; end if;

  with unified_feed as (
    -- Events half
    select
      'event'::text as source_type,
      ev.id,
      ev.title,
      ev.event_date,
      ec.name as category_name,
      ec.id as category_id,
      ev.priority,
      case
        when ev.trial_id is not null then 'trial'
        when ev.product_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.name, pr.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.product_id, ev.company_id) as entity_id,
      coalesce(
        co.name,
        co_via_product.name,
        co_via_trial.name
      ) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.products pr on pr.id = ev.product_id
    left join public.companies co_via_product on pr.id is not null and co_via_product.id = pr.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.products pr_via_trial on t.id is not null and pr_via_trial.id = t.product_id
    left join public.companies co_via_trial on pr_via_trial.id is not null and co_via_trial.id = pr_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.product_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and ev.company_id is not null)
        or (p_entity_level = 'product' and ev.product_id is not null)
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        or ev.company_id = p_entity_id
        or ev.product_id = p_entity_id
        or ev.trial_id = p_entity_id
      )

    union all

    -- Markers half
    select
      'marker'::text as source_type,
      m.id,
      m.title,
      m.event_date,
      mc.name as category_name,
      mc.id as category_id,
      null::text as priority,
      'trial'::text as entity_level,
      t.name as entity_name,
      t.id as entity_id,
      co.name as company_name,
      '{}'::text[] as tags,
      false as has_thread,
      null::uuid as thread_id,
      m.description,
      m.source_url,
      m.created_at
    from public.markers m
    join public.marker_assignments ma on ma.marker_id = m.id
    join public.trials t on t.id = ma.trial_id
    join public.products pr on pr.id = t.product_id
    join public.companies co on co.id = pr.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and (p_date_from is null or m.event_date >= p_date_from)
      and (p_date_to is null or m.event_date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (
        p_entity_level is null
        or p_entity_level = 'trial'
      )
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or pr.id = p_entity_id
        or co.id = p_entity_id
      )
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'source_type', uf.source_type,
        'id', uf.id,
        'title', uf.title,
        'event_date', uf.event_date,
        'category_name', uf.category_name,
        'category_id', uf.category_id,
        'priority', uf.priority,
        'entity_level', uf.entity_level,
        'entity_name', uf.entity_name,
        'entity_id', uf.entity_id,
        'company_name', uf.company_name,
        'tags', to_jsonb(uf.tags),
        'has_thread', uf.has_thread,
        'thread_id', uf.thread_id,
        'description', uf.description,
        'source_url', uf.source_url
      )
      order by uf.event_date desc, uf.created_at desc
    ),
    '[]'::jsonb
  )
  into result
  from (
    select * from unified_feed
    order by event_date desc, created_at desc
    limit p_limit offset p_offset
  ) uf;

  return result;
end;
$$;

-- ============================================================
-- 2. get_event_detail
-- ============================================================

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
      when ev.product_id is not null then 'product'
      when ev.company_id is not null then 'company'
      else 'space'
    end,
    'entity_name', coalesce(t.name, pr.name, co.name, 'Industry'),
    'entity_id', coalesce(ev.trial_id, ev.product_id, ev.company_id),
    'company_name', coalesce(
      co.name,
      co_via_product.name,
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
  left join public.products pr on pr.id = ev.product_id
  left join public.companies co_via_product on pr.id is not null and co_via_product.id = pr.company_id
  left join public.trials t on t.id = ev.trial_id
  left join public.products pr_via_trial on t.id is not null and pr_via_trial.id = t.product_id
  left join public.companies co_via_trial on pr_via_trial.id is not null and co_via_trial.id = pr_via_trial.company_id
  where ev.id = p_event_id;

  return result;
end;
$$;

-- ============================================================
-- 3. get_event_thread
-- ============================================================

create or replace function public.get_event_thread(
  p_thread_id uuid
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
    'id', et.id,
    'title', et.title,
    'created_by', et.created_by,
    'created_at', et.created_at,
    'events', coalesce((
      select jsonb_agg(
        jsonb_build_object(
          'id', ev.id,
          'title', ev.title,
          'event_date', ev.event_date,
          'thread_order', ev.thread_order,
          'priority', ev.priority,
          'category_name', ec.name
        )
        order by ev.thread_order
      )
      from public.events ev
      join public.event_categories ec on ec.id = ev.category_id
      where ev.thread_id = et.id
    ), '[]'::jsonb)
  )
  into result
  from public.event_threads et
  where et.id = p_thread_id;

  return result;
end;
$$;

-- ============================================================
-- 4. get_space_tags
-- ============================================================

create or replace function public.get_space_tags(
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
  select coalesce(
    jsonb_agg(distinct tag order by tag),
    '[]'::jsonb
  )
  into result
  from public.events ev,
  lateral unnest(ev.tags) as tag
  where ev.space_id = p_space_id;

  return result;
end;
$$;
