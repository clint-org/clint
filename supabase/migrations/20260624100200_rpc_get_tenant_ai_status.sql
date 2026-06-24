-- migration: 20260624100200_rpc_get_tenant_ai_status
-- purpose: owner-safe read path for a tenant's AI status. Two reasons it exists:
--   1. ai_config's RLS is platform-admin-only (cost caps are Clint's concern),
--      so space members can no longer read the table directly. This RPC returns
--      ai_enabled to ANY user with access to the tenant -- fixing the bug where
--      space editors/viewers were wrongly told "AI import is not enabled".
--   2. Tenant owners get a usage *percentage* (like a usage meter) instead of the
--      raw cost cap in cents, which stays hidden from them. Rate limits are
--      non-cost, so owners see those values.
-- Daily usage % is computed over the same rolling 24h window as ai_call_preflight.

create or replace function public.get_tenant_ai_status(
  p_tenant_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cfg        public.ai_config;
  v_is_owner   boolean;
  v_daily_cost numeric;
  v_pct        int;
begin
  if not public.has_tenant_access(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_cfg from public.ai_config where tenant_id = p_tenant_id;

  -- No row yet => AI is off. Surface that to everyone with tenant access; the
  -- owner-only fields stay null.
  if v_cfg.tenant_id is null then
    return jsonb_build_object(
      'ai_enabled', false,
      'daily_usage_pct', null,
      'per_user_rate_per_min', null,
      'per_user_rate_per_hour', null
    );
  end if;

  v_is_owner := public.is_tenant_owner_strict(p_tenant_id) or public.is_platform_admin();

  -- Non-owner members only learn whether AI is on (drives import guard + landing).
  if not v_is_owner then
    return jsonb_build_object(
      'ai_enabled', v_cfg.ai_enabled,
      'daily_usage_pct', null,
      'per_user_rate_per_min', null,
      'per_user_rate_per_hour', null
    );
  end if;

  select coalesce(sum(cost_estimate_cents), 0) into v_daily_cost
    from public.ai_calls
   where tenant_id = p_tenant_id
     and created_at > now() - interval '24 hours'
     and outcome not in ('cancelled', 'cost_capped', 'rate_limited');

  if v_cfg.daily_cost_cap_cents > 0 then
    v_pct := least(100, greatest(0, round(v_daily_cost * 100.0 / v_cfg.daily_cost_cap_cents)))::int;
  else
    -- cap of 0 means no spend is allowed; treat any usage as fully consumed
    v_pct := case when v_daily_cost > 0 then 100 else 0 end;
  end if;

  -- Note: daily_cost_cap_cents is deliberately NOT returned -- owners see a
  -- percentage, never the dollar cap.
  return jsonb_build_object(
    'ai_enabled', v_cfg.ai_enabled,
    'daily_usage_pct', v_pct,
    'per_user_rate_per_min', v_cfg.per_user_rate_per_min,
    'per_user_rate_per_hour', v_cfg.per_user_rate_per_hour
  );
end;
$$;

revoke execute on function public.get_tenant_ai_status(uuid) from public;
grant execute on function public.get_tenant_ai_status(uuid) to authenticated;

comment on function public.get_tenant_ai_status(uuid) is
  'Owner-safe AI status read. Returns ai_enabled to any tenant accessor; adds daily_usage_pct + rate limits for tenant owners/platform admins. Never exposes the cost cap in cents.';

-- smoke test
do $$
declare
  v_tid    uuid;
  v_uid    uuid;
  v_result jsonb;
begin
  select id into v_tid from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/users, skipping get_tenant_ai_status smoke';
    return;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tid, v_uid, 'owner')
    on conflict do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  -- no config row yet => disabled, no cost leaked
  v_result := public.get_tenant_ai_status(v_tid);
  assert (v_result->>'ai_enabled')::boolean = false,
    format('expected ai_enabled=false with no row, got %s', v_result);
  assert not (v_result ? 'daily_cost_cap_cents'),
    'cost cap must never appear in get_tenant_ai_status output';

  insert into public.ai_config (tenant_id, ai_enabled, daily_cost_cap_cents)
    values (v_tid, true, 1000)
    on conflict (tenant_id) do update set ai_enabled = true, daily_cost_cap_cents = 1000;

  -- owner sees enabled + a percentage (0% with no calls) but never the cap
  v_result := public.get_tenant_ai_status(v_tid);
  assert (v_result->>'ai_enabled')::boolean = true,
    format('expected ai_enabled=true, got %s', v_result);
  assert (v_result->>'daily_usage_pct')::int = 0,
    format('expected daily_usage_pct=0, got %s', v_result);
  assert not (v_result ? 'daily_cost_cap_cents'),
    'cost cap must never appear in get_tenant_ai_status output';

  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: get_tenant_ai_status OK';
end$$;

notify pgrst, 'reload schema';
