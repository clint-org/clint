-- migration: 20260524121100_fix_events_rpc_structure
-- purpose: rewrite get_events_page_data preserving the original UNION structure
--          (events + markers) with only mechanical renames applied.

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
  if p_category_ids = '{}' then p_category_ids := null; end if;
  if p_tags = '{}' then p_tags := null; end if;

  with unified_feed as (
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
        when ev.asset_id is not null then 'product'
        when ev.company_id is not null then 'company'
        else 'space'
      end as entity_level,
      coalesce(t.name, a.name, co.name, 'Industry') as entity_name,
      coalesce(ev.trial_id, ev.asset_id, ev.company_id) as entity_id,
      coalesce(co.name, co_via_asset.name, co_via_trial.name) as company_name,
      ev.tags,
      ev.thread_id is not null as has_thread,
      ev.thread_id,
      ev.description,
      null::text as source_url,
      ev.created_at
    from public.events ev
    join public.event_categories ec on ec.id = ev.category_id
    left join public.companies co on co.id = ev.company_id
    left join public.assets a on a.id = ev.asset_id
    left join public.companies co_via_asset on a.id is not null and co_via_asset.id = a.company_id
    left join public.trials t on t.id = ev.trial_id
    left join public.assets a_via_trial on t.id is not null and a_via_trial.id = t.asset_id
    left join public.companies co_via_trial on a_via_trial.id is not null and co_via_trial.id = a_via_trial.company_id
    where ev.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'event')
      and (p_date_from is null or ev.event_date >= p_date_from)
      and (p_date_to is null or ev.event_date <= p_date_to)
      and (p_priority is null or ev.priority = p_priority)
      and (p_tags is null or ev.tags && p_tags)
      and (p_category_ids is null or ec.id = any(p_category_ids))
      and (
        p_entity_level is null
        or (p_entity_level = 'space' and ev.company_id is null and ev.asset_id is null and ev.trial_id is null)
        or (p_entity_level = 'company' and (ev.company_id is not null or ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level in ('product', 'asset') and (ev.asset_id is not null or ev.trial_id is not null))
        or (p_entity_level = 'trial' and ev.trial_id is not null)
      )
      and (
        p_entity_id is null
        or ev.company_id = p_entity_id
        or ev.asset_id = p_entity_id
        or ev.trial_id   = p_entity_id
        or (p_entity_level in ('product', 'asset') and a_via_trial.id = p_entity_id)
        or (p_entity_level = 'company' and (co_via_asset.id = p_entity_id or co_via_trial.id = p_entity_id))
      )

    union all

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
    join public.assets a on a.id = t.asset_id
    join public.companies co on co.id = a.company_id
    join public.marker_types mt on mt.id = m.marker_type_id
    join public.marker_categories mc on mc.id = mt.category_id
    where m.space_id = p_space_id
      and (p_source_type is null or p_source_type = 'marker')
      and (p_date_from is null or m.event_date >= p_date_from)
      and (p_date_to is null or m.event_date <= p_date_to)
      and (p_tags is null)
      and (p_priority is null)
      and (p_category_ids is null or mc.id = any(p_category_ids))
      and (p_entity_level is null or p_entity_level = 'trial')
      and (
        p_entity_id is null
        or t.id = p_entity_id
        or a.id = p_entity_id
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

grant execute on function public.get_events_page_data(
  uuid, date, date, text, uuid, uuid[], text[], text, text, int, int
) to anon, authenticated;

-- Fix preview_asset_delete permissions: revoke from anon so tests get 42501
revoke all on function public.preview_asset_delete(uuid) from public, anon;
grant execute on function public.preview_asset_delete(uuid) to authenticated;
revoke all on function public.preview_company_delete(uuid) from public, anon;
grant execute on function public.preview_company_delete(uuid) to authenticated;

-- Fix seed_demo_data to handle missing _seed_demo_therapeutic_areas gracefully
create or replace function public._seed_demo_therapeutic_areas(p_space_id uuid, p_uid uuid)
returns void language plpgsql security invoker set search_path = '' as $$
begin
  perform public._seed_demo_indications(p_space_id, p_uid);
end;
$$;

-- Fix build_intelligence_payload to handle both 'asset' and 'product' entity_type
create or replace function public.build_intelligence_payload(
  p_intelligence_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_space_id uuid;
  v_result   jsonb;
begin
  select pi.space_id into v_space_id
    from public.primary_intelligence pi
    where pi.id = p_intelligence_id;

  if v_space_id is null then return null; end if;
  if not public.has_space_access(v_space_id) then return null; end if;

  with target as (
    select pi.*
    from public.primary_intelligence pi
    where pi.id = p_intelligence_id
  )
  select jsonb_build_object(
    'id', tg.id,
    'space_id', tg.space_id,
    'entity_type', tg.entity_type,
    'entity_id', tg.entity_id,
    'state', tg.state,
    'headline', tg.headline,
    'summary_md', tg.summary_md,
    'body_md', tg.body_md,
    'published_at', tg.published_at,
    'last_edited_by', tg.last_edited_by,
    'created_at', tg.created_at,
    'updated_at', tg.updated_at,
    'entity_name', case tg.entity_type
      when 'company' then (select c.name from public.companies c where c.id = tg.entity_id)
      when 'asset'   then (select a.name from public.assets a where a.id = tg.entity_id)
      when 'product' then (select a.name from public.assets a where a.id = tg.entity_id)
      when 'trial'   then (select t.name from public.trials t where t.id = tg.entity_id)
      else null
    end,
    'company_name', case tg.entity_type
      when 'company' then (select c.name from public.companies c where c.id = tg.entity_id)
      when 'asset'   then (select co.name from public.assets a join public.companies co on co.id = a.company_id where a.id = tg.entity_id)
      when 'product' then (select co.name from public.assets a join public.companies co on co.id = a.company_id where a.id = tg.entity_id)
      when 'trial'   then (select co.name from public.trials t join public.assets a on a.id = t.asset_id join public.companies co on co.id = a.company_id where t.id = tg.entity_id)
      else null
    end,
    'links', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', l.id,
        'entity_type', l.entity_type,
        'entity_id', l.entity_id,
        'entity_name', case l.entity_type
          when 'company' then (select c.name from public.companies c where c.id = l.entity_id)
          when 'asset'   then (select a.name from public.assets a where a.id = l.entity_id)
          when 'product' then (select a.name from public.assets a where a.id = l.entity_id)
          when 'trial'   then (select t.name from public.trials t where t.id = l.entity_id)
          else null
        end
      ) order by l.created_at)
      from public.primary_intelligence_links l
      where l.primary_intelligence_id = tg.id
    ), '[]'::jsonb),
    'contributors', coalesce((
      select jsonb_agg(distinct rev.edited_by::text)
      from public.primary_intelligence_revisions rev
      where rev.primary_intelligence_id = tg.id
    ), '[]'::jsonb),
    'recent_revisions', coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', rev.id, 'edited_by', rev.edited_by,
        'changed_fields', rev.changed_fields, 'created_at', rev.created_at
      ) order by rev.created_at desc)
      from (
        select * from public.primary_intelligence_revisions r2
        where r2.primary_intelligence_id = tg.id
        order by r2.created_at desc limit 5
      ) rev
    ), '[]'::jsonb)
  ) into v_result
  from target tg;

  return v_result;
end;
$$;
