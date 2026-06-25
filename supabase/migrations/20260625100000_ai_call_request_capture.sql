-- migration: 20260625100000_ai_call_request_capture
-- purpose: capture enough on every ai_call to reproduce/analyze it later --
-- import mode, raw input, the exact prompt, and request params -- in a single
-- extensible jsonb column, plus surface request + (full) output in the
-- super-admin usage drill. See docs/superpowers/specs/2026-06-25-ai-call-capture-design.md
--
-- request shape: { kind, input, prompt, params }. output (existing) now carries
-- the full, untruncated model output (the worker stops capping it at 5000 chars).

-- 1. storage -----------------------------------------------------------------
alter table public.ai_calls
  add column if not exists request jsonb;

comment on column public.ai_calls.request is
  'Full request context for reproducibility/analysis: { kind, input, prompt, params }. Written by the worker at ai_call_open. Platform-admin readable via get_ai_usage_rollup.';

-- 2. ai_call_open: accept and persist the request --------------------------
-- arg-list change (adds p_request), so drop the old signature and recreate.
drop function if exists public.ai_call_open(text, uuid, uuid, uuid, text, text, text);

create or replace function public.ai_call_open(
  p_secret      text,
  p_tenant_id   uuid,
  p_space_id    uuid,
  p_user_id     uuid,
  p_model       text,
  p_feature     text,
  p_input_hash  text  default null,
  p_request     jsonb default null
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_id    uuid;
  v_model text;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  v_model := public.ai_resolve_model(
    coalesce(
      (select ai_model from public.ai_config where tenant_id = p_tenant_id),
      p_model
    )
  );

  insert into public.ai_calls (
    tenant_id, space_id, user_id, provider, model, feature, outcome, input_hash, request
  ) values (
    p_tenant_id, p_space_id, p_user_id, 'anthropic', v_model, p_feature, 'pending', p_input_hash, p_request
  )
  returning id into v_id;

  return v_id;
end;
$$;

revoke execute on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text, jsonb) from public;
grant  execute on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text, jsonb) to anon;

comment on function public.ai_call_open(text, uuid, uuid, uuid, text, text, text, jsonb) is
  'Worker-callable (anon + shared secret). Opens an ai_calls row, resolving the tenant model server-side, and records the request context for reproducibility.';

-- 3. get_ai_usage_rollup: surface request + output in the imports drill ------
-- Reproduced from 20260624180000 with request + output added to the space scope.
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
            'markers',   (select count(*) from public.markers mk   where mk.source_doc_id = a.source_doc_id),
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
$$;

-- 4. get_ai_call_detail: full request + response for ONE call (fetch on expand)
create or replace function public.get_ai_call_detail(
  p_ai_call_id uuid
) returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_result jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'ai_call_id', a.id,
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
$$;

revoke execute on function public.get_ai_call_detail(uuid) from public;
grant  execute on function public.get_ai_call_detail(uuid) to authenticated;

comment on function public.get_ai_call_detail(uuid) is
  'Platform-admin-only full request/response for a single ai_call, fetched when the super-admin expands an import row. Returns the captured request (kind/input) and output (prompt/params/raw).';

do $$
begin
  assert exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_calls' and column_name = 'request'
  ), 'ai_calls.request should exist';
  assert exists (
    select 1 from pg_proc where proname = 'get_ai_call_detail' and pronamespace = 'public'::regnamespace
  ), 'get_ai_call_detail should exist';
  assert exists (
    select 1 from pg_proc where proname = 'ai_call_open' and pronamespace = 'public'::regnamespace
      and pronargs = 8
  ), 'ai_call_open(8-arg with p_request) should exist';
  raise notice 'smoke: ai_call request capture OK';
end$$;

notify pgrst, 'reload schema';
