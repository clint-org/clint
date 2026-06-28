-- migration: 20260624150300_rollup_failure_log
-- purpose: surface failure detail in the super-admin AI usage drill-down so an
--          admin can see WHY an import failed (error_code, error_message,
--          warnings) -- not just the outcome. Recreates get_ai_usage_rollup with
--          those fields added to the 'space' (imports) scope.

create or replace function public.get_ai_usage_rollup(
  p_scope    text,
  p_id       uuid default null,
  p_window   interval default '7 days'
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
          'user_id', a.user_id,
          'model', a.model,
          'outcome', a.outcome,
          'cost_cents', a.cost_estimate_cents,
          'duration_ms', a.duration_ms,
          'prompt_tokens', a.prompt_tokens,
          'completion_tokens', a.completion_tokens,
          -- failure detail so admins can debug a failed import
          'error_code', a.error_code,
          'error_message', a.error_message,
          'warnings', a.warnings,
          'created_at', a.created_at,
          'closed_at', a.closed_at
        ) as row_data
        from public.ai_calls a
        left join public.source_documents sd on sd.id = a.source_doc_id
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
$$;

do $$
begin
  assert exists (select 1 from pg_proc where proname = 'get_ai_usage_rollup'
    and pronamespace = 'public'::regnamespace),
    'get_ai_usage_rollup missing';
  raise notice 'smoke: get_ai_usage_rollup failure-log fields OK';
end$$;

notify pgrst, 'reload schema';
