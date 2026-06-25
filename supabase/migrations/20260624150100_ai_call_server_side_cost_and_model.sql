-- migration: 20260624150100_ai_call_server_side_cost_and_model
-- purpose: make the model authoritative and cost a model-aware display estimate.
--   1. ai_call_open resolves the model from the tenant's ai_config (falling back
--      to the worker default), validated against the active catalog, so the
--      ai_calls row records the model actually used.
--   2. ai_call_close computes cost_estimate_cents from the row's model + token
--      counts via ai_model_pricing -- a DISPLAY estimate, snapshotted onto the
--      row. Enforcement does not depend on it (the cap is token-based).
--   3. ai_call_preflight enforces the TOKEN cap (deterministic; tokens are
--      authoritative from the API) and returns the resolved model.

-- 1. ai_call_open: resolve + stamp the configured model -----------------------
create or replace function public.ai_call_open(
  p_secret      text,
  p_tenant_id   uuid,
  p_space_id    uuid,
  p_user_id     uuid,
  p_model       text,
  p_feature     text,
  p_input_hash  text default null
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
    tenant_id, space_id, user_id, provider, model, feature, outcome, input_hash
  ) values (
    p_tenant_id, p_space_id, p_user_id, 'anthropic', v_model, p_feature, 'pending', p_input_hash
  )
  returning id into v_id;

  return v_id;
end;
$$;

-- 2. ai_call_close: compute the cost estimate server-side ---------------------
create or replace function public.ai_call_close(
  p_secret            text,
  p_ai_call_id        uuid,
  p_outcome           text,
  p_prompt_tokens     int     default null,
  p_completion_tokens int     default null,
  p_cost_cents        numeric default null,  -- ignored; cost is computed server-side
  p_duration_ms       int     default null,
  p_output            jsonb   default null,
  p_warnings          jsonb   default null,
  p_error_code        text    default null,
  p_error_message     text    default null
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_current_outcome text;
  v_model           text;
  v_cost            numeric;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  select outcome, model into v_current_outcome, v_model
    from public.ai_calls where id = p_ai_call_id;

  if v_current_outcome is null then
    raise exception 'ai_call % not found', p_ai_call_id using errcode = 'P0002';
  end if;
  if v_current_outcome <> 'pending' then
    raise exception 'ai_call % already closed with outcome %', p_ai_call_id, v_current_outcome
      using errcode = '22023';
  end if;

  -- Display estimate: tokens x the row's model price, snapshotted here so a later
  -- catalog price change does not rewrite this row.
  v_cost := coalesce(
    public.ai_estimate_cost_cents(v_model, p_prompt_tokens, p_completion_tokens), 0
  );

  update public.ai_calls
     set outcome             = p_outcome,
         prompt_tokens       = p_prompt_tokens,
         completion_tokens   = p_completion_tokens,
         cost_estimate_cents = v_cost,
         duration_ms         = p_duration_ms,
         output              = p_output,
         warnings            = p_warnings,
         error_code          = p_error_code,
         error_message       = p_error_message,
         closed_at           = now()
   where id = p_ai_call_id;
end;
$$;

-- 3. ai_call_preflight: enforce the TOKEN cap, return the resolved model -------
create or replace function public.ai_call_preflight(
  p_secret     text,
  p_tenant_id  uuid,
  p_user_id    uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cfg          record;
  v_daily_tokens bigint;
  v_rate_min     int;
  v_rate_hour    int;
  v_model        text;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  select * into v_cfg from public.ai_config where tenant_id = p_tenant_id;

  v_model := public.ai_resolve_model(
    coalesce(case when v_cfg is null then null else v_cfg.ai_model end, 'claude-sonnet-4-6')
  );

  if v_cfg is null then
    return jsonb_build_object(
      'allowed', false, 'reason', 'ai_disabled', 'model', v_model,
      'remaining_today_tokens', 0, 'remaining_rate_min', 0, 'remaining_rate_hour', 0
    );
  end if;

  if not v_cfg.ai_enabled then
    return jsonb_build_object(
      'allowed', false, 'reason', 'ai_disabled', 'model', v_model,
      'remaining_today_tokens', v_cfg.daily_token_cap,
      'remaining_rate_min', v_cfg.per_user_rate_per_min,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0)
    into v_daily_tokens
    from public.ai_calls
   where tenant_id = p_tenant_id
     and created_at > now() - interval '24 hours'
     and outcome not in ('cancelled', 'cost_capped', 'rate_limited');

  if v_daily_tokens >= v_cfg.daily_token_cap then
    return jsonb_build_object(
      'allowed', false, 'reason', 'daily_token_cap', 'model', v_model,
      'remaining_today_tokens', 0,
      'remaining_rate_min', v_cfg.per_user_rate_per_min,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select count(*) into v_rate_min
    from public.ai_calls
   where user_id = p_user_id and tenant_id = p_tenant_id
     and created_at > now() - interval '1 minute';

  if v_rate_min >= v_cfg.per_user_rate_per_min then
    return jsonb_build_object(
      'allowed', false, 'reason', 'rate_limited_minute', 'model', v_model,
      'remaining_today_tokens', (v_cfg.daily_token_cap - v_daily_tokens),
      'remaining_rate_min', 0,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select count(*) into v_rate_hour
    from public.ai_calls
   where user_id = p_user_id and tenant_id = p_tenant_id
     and created_at > now() - interval '1 hour';

  if v_rate_hour >= v_cfg.per_user_rate_per_hour then
    return jsonb_build_object(
      'allowed', false, 'reason', 'rate_limited_hour', 'model', v_model,
      'remaining_today_tokens', (v_cfg.daily_token_cap - v_daily_tokens),
      'remaining_rate_min', (v_cfg.per_user_rate_per_min - v_rate_min),
      'remaining_rate_hour', 0
    );
  end if;

  return jsonb_build_object(
    'allowed', true, 'reason', null, 'model', v_model,
    'remaining_today_tokens', (v_cfg.daily_token_cap - v_daily_tokens),
    'remaining_rate_min', (v_cfg.per_user_rate_per_min - v_rate_min),
    'remaining_rate_hour', (v_cfg.per_user_rate_per_hour - v_rate_hour)
  );
end;
$$;

-- smoke test: model resolution + server-side cost estimate + token cap --------
do $$
declare
  v_secret text; v_tid uuid; v_sid uuid; v_uid uuid; v_id uuid;
  v_cost numeric; v_model text; v_pf jsonb;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets where name = 'extract_source_worker_secret';
  select t.id, s.id into v_tid, v_sid
    from public.tenants t join public.spaces s on s.tenant_id = t.id limit 1;
  select id into v_uid from auth.users limit 1;
  if v_secret is null or v_tid is null or v_uid is null then
    raise notice 'smoke: missing fixtures, skipping server-side cost smoke';
    return;
  end if;

  insert into public.ai_config (tenant_id, ai_enabled, ai_model, daily_token_cap)
    values (v_tid, true, 'claude-opus-4-8', 1000000)
    on conflict (tenant_id) do update set ai_enabled = true, ai_model = 'claude-opus-4-8', daily_token_cap = 1000000;

  v_id := public.ai_call_open(v_secret, v_tid, v_sid, v_uid, 'claude-sonnet-4-6', 'source_extract');
  select model into v_model from public.ai_calls where id = v_id;
  assert v_model = 'claude-opus-4-8',
    format('ai_call_open should stamp configured model, got %s', v_model);

  perform public.ai_call_close(v_secret, v_id, 'success',
    p_prompt_tokens := 1000, p_completion_tokens := 500, p_cost_cents := 999, p_duration_ms := 1000);
  select cost_estimate_cents into v_cost from public.ai_calls where id = v_id;
  -- Opus: 1000/1e6*500 + 500/1e6*2500 = 1.75 cents (worker-supplied 999 ignored)
  assert v_cost = 1.7500, format('expected cost 1.7500, got %s', v_cost);

  v_pf := public.ai_call_preflight(v_secret, v_tid, v_uid);
  assert v_pf->>'model' = 'claude-opus-4-8',
    format('preflight should return configured model, got %s', v_pf->>'model');
  assert (v_pf->>'allowed')::boolean = true,
    format('expected allowed under token cap, got %s', v_pf);

  -- Drop the cap below today's tokens -> token cap trips
  update public.ai_config set daily_token_cap = 100 where tenant_id = v_tid;
  v_pf := public.ai_call_preflight(v_secret, v_tid, v_uid);
  assert (v_pf->>'allowed')::boolean = false and v_pf->>'reason' = 'daily_token_cap',
    format('expected daily_token_cap denial, got %s', v_pf);

  delete from public.ai_calls where id = v_id;
  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: ai_call server-side cost + token cap OK';
end$$;

notify pgrst, 'reload schema';
