-- migration: 20260525100600_rpc_ai_call_preflight
-- purpose: worker-callable read-only RPC. checks ai_enabled, daily cost cap,
--          per-user rate limits. returns {allowed, reason, remaining_*}.

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
  v_cfg             record;
  v_daily_cost      numeric;
  v_rate_min        int;
  v_rate_hour       int;
begin
  perform public._verify_extract_source_worker_secret(p_secret);

  select * into v_cfg from public.ai_config where tenant_id = p_tenant_id;

  if v_cfg is null then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'ai_disabled',
      'remaining_today_cents', 0,
      'remaining_rate_min', 0,
      'remaining_rate_hour', 0
    );
  end if;

  if not v_cfg.ai_enabled then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'ai_disabled',
      'remaining_today_cents', v_cfg.daily_cost_cap_cents,
      'remaining_rate_min', v_cfg.per_user_rate_per_min,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select coalesce(sum(cost_estimate_cents), 0) into v_daily_cost
    from public.ai_calls
   where tenant_id = p_tenant_id
     and created_at > now() - interval '24 hours'
     and outcome not in ('cancelled', 'cost_capped', 'rate_limited');

  if v_daily_cost >= v_cfg.daily_cost_cap_cents then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'daily_cost_cap',
      'remaining_today_cents', 0,
      'remaining_rate_min', v_cfg.per_user_rate_per_min,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select count(*) into v_rate_min
    from public.ai_calls
   where user_id = p_user_id
     and tenant_id = p_tenant_id
     and created_at > now() - interval '1 minute';

  if v_rate_min >= v_cfg.per_user_rate_per_min then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited_minute',
      'remaining_today_cents', (v_cfg.daily_cost_cap_cents - v_daily_cost)::int,
      'remaining_rate_min', 0,
      'remaining_rate_hour', v_cfg.per_user_rate_per_hour
    );
  end if;

  select count(*) into v_rate_hour
    from public.ai_calls
   where user_id = p_user_id
     and tenant_id = p_tenant_id
     and created_at > now() - interval '1 hour';

  if v_rate_hour >= v_cfg.per_user_rate_per_hour then
    return jsonb_build_object(
      'allowed', false,
      'reason', 'rate_limited_hour',
      'remaining_today_cents', (v_cfg.daily_cost_cap_cents - v_daily_cost)::int,
      'remaining_rate_min', (v_cfg.per_user_rate_per_min - v_rate_min),
      'remaining_rate_hour', 0
    );
  end if;

  return jsonb_build_object(
    'allowed', true,
    'reason', null,
    'remaining_today_cents', (v_cfg.daily_cost_cap_cents - v_daily_cost)::int,
    'remaining_rate_min', (v_cfg.per_user_rate_per_min - v_rate_min),
    'remaining_rate_hour', (v_cfg.per_user_rate_per_hour - v_rate_hour)
  );
end;
$$;

revoke execute on function public.ai_call_preflight(text, uuid, uuid) from public;
grant execute on function public.ai_call_preflight(text, uuid, uuid) to anon;

comment on function public.ai_call_preflight(text, uuid, uuid) is
  'Worker-callable. Read-only check: ai_enabled, daily cost cap, per-user rate limits. Returns {allowed, reason, remaining_*}.';

-- smoke test (reads actual vault value so it works on both local and remote)
do $$
declare
  v_secret text;
  v_tid    uuid;
  v_uid    uuid;
  v_result jsonb;
begin
  select decrypted_secret into v_secret
    from vault.decrypted_secrets
   where name = 'extract_source_worker_secret';
  if v_secret is null then
    raise notice 'smoke: no extract_source_worker_secret in vault, skipping ai_call_preflight smoke';
    return;
  end if;

  select id into v_tid from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/users, skipping ai_call_preflight smoke';
    return;
  end if;

  v_result := public.ai_call_preflight(
    v_secret, v_tid, v_uid
  );
  assert (v_result->>'allowed')::boolean = false,
    format('expected not allowed (no ai_config row), got %s', v_result);

  insert into public.ai_config (tenant_id, ai_enabled)
    values (v_tid, true)
    on conflict (tenant_id) do update set ai_enabled = true;

  v_result := public.ai_call_preflight(
    v_secret, v_tid, v_uid
  );
  assert (v_result->>'allowed')::boolean = true,
    format('expected allowed, got %s', v_result);

  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: ai_call_preflight OK';
end$$;
