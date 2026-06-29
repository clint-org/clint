-- Migration A6: repoint get_space_inventory_snapshot, get_ai_call_detail,
-- get_ai_usage_rollup off the dropped marker tables onto the events schema.
--
-- AI functions: delete the redundant sub-key/count for the old entity;
-- the events branch already queries public.events and is kept byte-identical.
--
-- Inventory snapshot: drop v_event_count-for-old-markers and the old v_markers agg,
-- repoint taxonomy to event_types and event_type_categories tables,
-- repoint events list anchor (anchor_type/anchor_id) and category (via event_type_id),
-- update hash concat and output keys accordingly.

-- ============================================================
-- 1. get_ai_call_detail: delete 'markers' sub-key, keep 'events'
-- ============================================================
create or replace function public.get_ai_call_detail(p_ai_call_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'ai_call_id', a.id,
    'tenant_id', a.tenant_id,
    'space_id', a.space_id,
    'model', a.model,
    'feature', a.feature,
    'outcome', a.outcome,
    'prompt_tokens', a.prompt_tokens,
    'completion_tokens', a.completion_tokens,
    'cost_usd', round(coalesce(a.cost_estimate_cents, 0) / 100.0, 4),
    'source_title', sd.source_title,
    'source_kind', sd.source_kind,
    'error_code', a.error_code,
    'error_message', a.error_message,
    'warnings', a.warnings,
    'request', a.request,
    'output', a.output,
    -- the actual rows this import produced (via source_doc_id provenance)
    'created_entities', jsonb_build_object(
      'companies', (
        select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
        from public.companies c where c.source_doc_id = a.source_doc_id),
      'assets', (
        select coalesce(jsonb_agg(jsonb_build_object('id', x.id, 'name', x.name) order by x.name), '[]'::jsonb)
        from public.assets x where x.source_doc_id = a.source_doc_id),
      'trials', (
        select coalesce(jsonb_agg(jsonb_build_object('id', tr.id, 'name', tr.name) order by tr.name), '[]'::jsonb)
        from public.trials tr where tr.source_doc_id = a.source_doc_id),
      'events', (
        select coalesce(jsonb_agg(jsonb_build_object('id', ev.id, 'title', ev.title) order by ev.title), '[]'::jsonb)
        from public.events ev where ev.source_doc_id = a.source_doc_id)
    ),
    'created_at', a.created_at,
    'closed_at', a.closed_at
  )
  into v_result
  from public.ai_calls a
  left join public.source_documents sd on sd.id = a.source_doc_id
  where a.id = p_ai_call_id;

  if v_result is null then
    raise exception 'ai_call not found' using errcode = 'P0002';
  end if;

  return v_result;
end;
$function$;


-- ============================================================
-- 2. get_ai_usage_rollup: delete 'markers' count, keep 'events'
-- ============================================================
create or replace function public.get_ai_usage_rollup(p_scope text, p_id uuid default null::uuid, p_window interval default '7 days'::interval)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
declare
  v_result jsonb;
  v_cutoff timestamptz := now() - p_window;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_scope not in ('platform', 'tenant', 'space') then
    raise exception 'invalid scope: %. must be platform, tenant, or space', p_scope
      using errcode = '22023';
  end if;

  if p_scope = 'platform' then
    select coalesce(jsonb_agg(row_data order by row_data->>'tenant_name'), '[]'::jsonb)
      into v_result
      from (
        select jsonb_build_object(
          'tenant_id', t.id,
          'tenant_name', t.name,
          'ai_enabled', coalesce(ac.ai_enabled, false),
          'imports', count(a.id),
          'cost_usd', round(coalesce(sum(a.cost_estimate_cents), 0) / 100.0, 2),
          'success_rate', case when count(a.id) > 0
            then round(count(a.id) filter (where a.outcome = 'success')::numeric / count(a.id), 2)
            else 0 end,
          'p50_latency_ms', percentile_cont(0.5) within group (order by a.duration_ms)
            filter (where a.duration_ms is not null),
          'fail_count', count(a.id) filter (where a.outcome not in ('success', 'pending', 'cancelled'))
        ) as row_data
        from public.tenants t
        left join public.ai_config ac on ac.tenant_id = t.id
        left join public.ai_calls a on a.tenant_id = t.id and a.created_at >= v_cutoff
        group by t.id, t.name, ac.ai_enabled
      ) sub;

  elsif p_scope = 'tenant' then
    select coalesce(jsonb_agg(row_data order by row_data->>'space_name'), '[]'::jsonb)
      into v_result
      from (
        select jsonb_build_object(
          'space_id', s.id,
          'space_name', s.name,
          'imports', count(a.id),
          'cost_usd', round(coalesce(sum(a.cost_estimate_cents), 0) / 100.0, 2),
          'success_rate', case when count(a.id) > 0
            then round(count(a.id) filter (where a.outcome = 'success')::numeric / count(a.id), 2)
            else 0 end,
          'p50_latency_ms', percentile_cont(0.5) within group (order by a.duration_ms)
            filter (where a.duration_ms is not null),
          'fail_count', count(a.id) filter (where a.outcome not in ('success', 'pending', 'cancelled')),
          'entity_count', (
            (select count(*) from public.companies c where c.space_id = s.id)
            + (select count(*) from public.assets aa where aa.space_id = s.id)
            + (select count(*) from public.trials tr where tr.space_id = s.id)
            + (select count(*) from public.indications ind where ind.space_id = s.id)
          ),
          'entity_counts', jsonb_build_object(
            'companies', (select count(*) from public.companies c where c.space_id = s.id),
            'assets', (select count(*) from public.assets aa where aa.space_id = s.id),
            'trials', (select count(*) from public.trials tr where tr.space_id = s.id),
            'indications', (select count(*) from public.indications ind where ind.space_id = s.id)
          )
        ) as row_data
        from public.spaces s
        left join public.ai_calls a on a.space_id = s.id and a.created_at >= v_cutoff
        where s.tenant_id = p_id
        group by s.id, s.name
      ) sub;

  elsif p_scope = 'space' then
    select coalesce(jsonb_agg(row_data order by row_data->>'created_at' desc), '[]'::jsonb)
      into v_result
      from (
        select jsonb_build_object(
          'ai_call_id', a.id,
          'source_title', sd.source_title,
          'source_kind', sd.source_kind,
          'user_email', u.email,
          'model', a.model,
          'outcome', a.outcome,
          'cost_usd', round(coalesce(a.cost_estimate_cents, 0) / 100.0, 4),
          'duration_ms', a.duration_ms,
          'prompt_tokens', a.prompt_tokens,
          'completion_tokens', a.completion_tokens,
          'error_code', a.error_code,
          'error_message', a.error_message,
          'warnings', a.warnings,
          'entity_counts', jsonb_build_object(
            'companies', (select count(*) from public.companies c  where c.source_doc_id  = a.source_doc_id),
            'assets',    (select count(*) from public.assets aa    where aa.source_doc_id = a.source_doc_id),
            'trials',    (select count(*) from public.trials tr    where tr.source_doc_id = a.source_doc_id),
            'events',    (select count(*) from public.events ev    where ev.source_doc_id = a.source_doc_id)
          ),
          -- import mode is light; full request/output is fetched on expand via
          -- get_ai_call_detail (avoids loading large prompts/outputs for the list)
          'import_kind', a.request->>'kind',
          'created_at', a.created_at,
          'closed_at', a.closed_at
        ) as row_data
        from public.ai_calls a
        left join public.source_documents sd on sd.id = a.source_doc_id
        left join auth.users u on u.id = a.user_id
        where a.space_id = p_id
          and a.created_at >= v_cutoff
      ) sub;
  end if;

  return jsonb_build_object(
    'scope', p_scope,
    'window_days', extract(day from p_window)::int,
    'data', v_result
  );
end;
$function$;


-- ============================================================
-- 3. get_space_inventory_snapshot: repoint taxonomy + events list
-- ============================================================
create or replace function public.get_space_inventory_snapshot(p_space_id uuid)
  returns jsonb
  language plpgsql
  stable security definer
  set search_path to 'public'
as $function$
declare
  v_companies              jsonb;
  v_assets                 jsonb;
  v_trials                 jsonb;
  v_indications            jsonb;
  v_event_types            jsonb;
  v_event_type_categories  jsonb;
  v_moas                   jsonb;
  v_roas                   jsonb;
  v_events                 jsonb;
  v_hash                   text;
  v_event_count            int;
begin
  if not public.has_space_access(p_space_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select coalesce(jsonb_agg(jsonb_build_object('id', c.id, 'name', c.name) order by c.name), '[]'::jsonb)
    into v_companies
    from public.companies c where c.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'name', a.name, 'company_id', a.company_id,
    'generic_name', a.generic_name) order by a.name), '[]'::jsonb)
    into v_assets
    from public.assets a where a.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
    'identifier', t.identifier, 'asset_id', t.asset_id, 'phase_type', t.phase_type) order by t.name), '[]'::jsonb)
    into v_trials
    from public.trials t where t.space_id = p_space_id;

  select coalesce(jsonb_agg(jsonb_build_object('id', i.id, 'name', i.name) order by i.name), '[]'::jsonb)
    into v_indications
    from public.indications i where i.space_id = p_space_id;

  -- taxonomy: event types (renamed from the old catalog table)
  select coalesce(jsonb_agg(
    jsonb_build_object('id', et.id, 'name', et.name) order by et.display_order
  ), '[]'::jsonb)
    into v_event_types
    from public.event_types et
   where (et.space_id = p_space_id or (et.space_id is null and et.is_system))
     and et.display_order >= 0;

  -- taxonomy: event type categories (replaces event_categories)
  select coalesce(jsonb_agg(
    jsonb_build_object('id', ec.id, 'name', ec.name) order by ec.display_order
  ), '[]'::jsonb)
    into v_event_type_categories
    from public.event_type_categories ec
   where ec.space_id = p_space_id or (ec.space_id is null and ec.is_system);

  select coalesce(jsonb_agg(
    jsonb_build_object('id', m.id, 'name', m.name) order by m.display_order, m.name
  ), '[]'::jsonb)
    into v_moas
    from public.mechanisms_of_action m
   where m.space_id = p_space_id;

  select coalesce(jsonb_agg(
    jsonb_build_object('id', r.id, 'name', r.name, 'abbreviation', r.abbreviation) order by r.display_order, r.name
  ), '[]'::jsonb)
    into v_roas
    from public.routes_of_administration r
   where r.space_id = p_space_id;

  -- events scoped to the space; cap at 1000 rows.
  select count(*)
    into v_event_count
    from public.events e
   where e.space_id = p_space_id;

  if v_event_count > 1000 then
    raise notice 'inventory_snapshot: events truncated (% rows, cap 1000) for space %', v_event_count, p_space_id;
  end if;

  select coalesce(jsonb_agg(row_data order by (row_data->>'event_date') desc nulls last, (row_data->>'id')), '[]'::jsonb)
    into v_events
    from (
      select jsonb_build_object(
        'id', e.id,
        'anchor', jsonb_build_object('level', e.anchor_type, 'id', e.anchor_id),
        'category', (
          select ec2.name
            from public.event_type_categories ec2
            join public.event_types et on et.category_id = ec2.id
           where et.id = e.event_type_id
        ),
        'title', e.title,
        'event_date', e.event_date
      ) as row_data
        from public.events e
       where e.space_id = p_space_id
       order by e.event_date desc nulls last, e.id
       limit 1000
    ) sub;

  v_hash := md5(
    v_companies::text || v_assets::text || v_trials::text || v_indications::text
    || v_event_types::text || v_event_type_categories::text || v_moas::text || v_roas::text
    || v_events::text
  );

  return jsonb_build_object(
    'companies', v_companies,
    'assets', v_assets,
    'trials', v_trials,
    'indications', v_indications,
    'event_types', v_event_types,
    'event_type_categories', v_event_type_categories,
    'mechanisms_of_action', v_moas,
    'routes_of_administration', v_roas,
    'events', v_events,
    'hash', v_hash
  );
end;
$function$;


-- ============================================================
-- In-file smoke: data-conditional, prod-safe.
-- has_space_access and is_platform_admin both require auth.uid();
-- query the underlying tables directly to verify schema correctness.
-- ============================================================
do $$
declare
  v_demo_space uuid := '00000000-0000-0000-0000-0000000d0100';
  v_et_count   int;
  v_etc_count  int;
  v_ev_count   int;
  v_sample     jsonb;
begin
  -- guard: skip if demo space is absent (prod-safe)
  if not exists (select 1 from public.spaces where id = v_demo_space) then
    raise notice 'A6 smoke: demo space absent, skipping (prod-safe)';
    return;
  end if;

  -- verify event_types table is queryable with is_system + display_order filter
  select count(*) into v_et_count
    from public.event_types et
   where (et.space_id = v_demo_space or (et.space_id is null and et.is_system))
     and et.display_order >= 0;

  raise notice 'A6 smoke: event_types count for demo space = %', v_et_count;

  -- verify event_type_categories table is queryable with is_system filter
  select count(*) into v_etc_count
    from public.event_type_categories ec
   where ec.space_id = v_demo_space or (ec.space_id is null and ec.is_system);

  raise notice 'A6 smoke: event_type_categories count for demo space = %', v_etc_count;

  -- verify events table is queryable with anchor_type/anchor_id + event_type_id
  select count(*) into v_ev_count
    from public.events e
   where e.space_id = v_demo_space;

  raise notice 'A6 smoke: events count for demo space = %', v_ev_count;

  -- verify the events list sub-query shape (anchor + category via event_type_id) compiles and runs
  select jsonb_agg(row_data order by (row_data->>'event_date') desc nulls last, (row_data->>'id'))
    into v_sample
    from (
      select jsonb_build_object(
        'id', e.id,
        'anchor', jsonb_build_object('level', e.anchor_type, 'id', e.anchor_id),
        'category', (
          select ec2.name
            from public.event_type_categories ec2
            join public.event_types et on et.category_id = ec2.id
           where et.id = e.event_type_id
        ),
        'title', e.title,
        'event_date', e.event_date
      ) as row_data
        from public.events e
       where e.space_id = v_demo_space
       order by e.event_date desc nulls last, e.id
       limit 5
    ) sub;

  if v_ev_count > 0 and v_sample is null then
    raise exception 'A6 smoke FAIL: events list sub-query returned null for demo space with % events', v_ev_count;
  end if;

  raise notice 'A6 smoke OK: events list sample = %', v_sample;

  -- verify AI entity_counts sub-query shape (events, no markers)
  -- just exercise the count sub-query against source_doc_id column
  perform count(*) from public.events ev where ev.source_doc_id is null limit 1;
  raise notice 'A6 smoke OK: events.source_doc_id column accessible';

end;
$$;

notify pgrst, 'reload schema';
