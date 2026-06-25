-- migration: 20260624150050_ai_config_token_cap
-- purpose: retarget the AI spend cap from dollars to TOKENS. Tokens come straight
--          from the Anthropic API usage and are authoritative, so a token cap is
--          deterministic and never drifts with price changes. Dollars become a
--          display-only estimate (tokens x catalog price). Also drops the unused
--          per_call_cost_cap_cents. Per-user rate limits (call-frequency) are
--          unchanged.

alter table public.ai_config
  add column if not exists daily_token_cap bigint not null default 1000000;

comment on column public.ai_config.daily_token_cap is
  'Max total tokens (input + output) per tenant per rolling 24h. Deterministic spend cap; enforced in ai_call_preflight.';

alter table public.ai_config drop column if exists daily_cost_cap_cents;
alter table public.ai_config drop column if exists per_call_cost_cap_cents;

-- Recreate the platform-admin write RPC against the new shape: token cap + model
-- (validated against the active catalog), no cost-cents / per-call params.
drop function if exists public.platform_admin_update_ai_config(uuid, text, boolean, text, int, int, int, int);

create or replace function public.platform_admin_update_ai_config(
  p_tenant_id              uuid,
  p_reason                 text,
  p_ai_enabled             boolean default null,
  p_ai_model               text    default null,
  p_daily_token_cap        bigint  default null,
  p_per_user_rate_per_min  int     default null,
  p_per_user_rate_per_hour int     default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- @audit:tier1
declare
  v_uid  uuid := auth.uid();
  v_row  public.ai_config;
  v_diff jsonb := '{}'::jsonb;
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  if p_daily_token_cap is not null and p_daily_token_cap < 0 then
    raise exception 'daily_token_cap must be >= 0' using errcode = '22023';
  end if;
  if p_per_user_rate_per_min is not null and p_per_user_rate_per_min < 1 then
    raise exception 'per_user_rate_per_min must be >= 1' using errcode = '22023';
  end if;
  if p_per_user_rate_per_hour is not null and p_per_user_rate_per_hour < 1 then
    raise exception 'per_user_rate_per_hour must be >= 1' using errcode = '22023';
  end if;
  if p_ai_model is not null and not exists (
    select 1 from public.ai_model_pricing where model_id = p_ai_model and status = 'active'
  ) then
    raise exception 'unknown or inactive model: %', p_ai_model using errcode = '22023';
  end if;

  insert into public.ai_config (tenant_id, updated_by, updated_at)
    values (p_tenant_id, v_uid, now())
    on conflict (tenant_id) do nothing;

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;

  if p_ai_enabled is not null and p_ai_enabled is distinct from v_row.ai_enabled then
    v_diff := v_diff || jsonb_build_object('ai_enabled', jsonb_build_array(v_row.ai_enabled, p_ai_enabled));
  end if;
  if p_ai_model is not null and p_ai_model is distinct from v_row.ai_model then
    v_diff := v_diff || jsonb_build_object('ai_model', jsonb_build_array(v_row.ai_model, p_ai_model));
  end if;
  if p_daily_token_cap is not null and p_daily_token_cap is distinct from v_row.daily_token_cap then
    v_diff := v_diff || jsonb_build_object('daily_token_cap', jsonb_build_array(v_row.daily_token_cap, p_daily_token_cap));
  end if;
  if p_per_user_rate_per_min is not null and p_per_user_rate_per_min is distinct from v_row.per_user_rate_per_min then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_min', jsonb_build_array(v_row.per_user_rate_per_min, p_per_user_rate_per_min));
  end if;
  if p_per_user_rate_per_hour is not null and p_per_user_rate_per_hour is distinct from v_row.per_user_rate_per_hour then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_hour', jsonb_build_array(v_row.per_user_rate_per_hour, p_per_user_rate_per_hour));
  end if;

  update public.ai_config
     set ai_enabled             = coalesce(p_ai_enabled, ai_enabled),
         ai_model               = coalesce(p_ai_model, ai_model),
         daily_token_cap        = coalesce(p_daily_token_cap, daily_token_cap),
         per_user_rate_per_min  = coalesce(p_per_user_rate_per_min, per_user_rate_per_min),
         per_user_rate_per_hour = coalesce(p_per_user_rate_per_hour, per_user_rate_per_hour),
         updated_by             = v_uid,
         updated_at             = now()
   where tenant_id = p_tenant_id;

  perform public.record_audit_event(
    'ai_config_updated', 'rpc', 'ai_config', p_tenant_id, null, p_tenant_id, null,
    jsonb_build_object('reason', p_reason, 'changes', v_diff)
  );

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.platform_admin_update_ai_config(uuid, text, boolean, text, bigint, int, int) from public;
grant execute on function public.platform_admin_update_ai_config(uuid, text, boolean, text, bigint, int, int) to authenticated;

comment on function public.platform_admin_update_ai_config(uuid, text, boolean, text, bigint, int, int) is
  'Tier 1 audited. Platform admin sets a tenant''s AI config (enable, model, daily token cap, rate limits). Patch semantics; requires a reason; writes an audit event.';

-- Recreate the owner-safe read against the token cap. Percentage is token-based;
-- the dollar cost stays out of the owner surface (it is an admin-side estimate).
create or replace function public.get_tenant_ai_status(
  p_tenant_id uuid
) returns jsonb
language plpgsql
security definer
stable
set search_path = public
as $$
declare
  v_cfg         public.ai_config;
  v_is_owner    boolean;
  v_tokens      bigint;
  v_pct         int;
begin
  if not public.has_tenant_access(p_tenant_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_cfg from public.ai_config where tenant_id = p_tenant_id;

  if v_cfg.tenant_id is null then
    return jsonb_build_object('ai_enabled', false, 'daily_usage_pct', null,
      'per_user_rate_per_min', null, 'per_user_rate_per_hour', null);
  end if;

  v_is_owner := public.is_tenant_owner_strict(p_tenant_id) or public.is_platform_admin();

  if not v_is_owner then
    return jsonb_build_object('ai_enabled', v_cfg.ai_enabled, 'daily_usage_pct', null,
      'per_user_rate_per_min', null, 'per_user_rate_per_hour', null);
  end if;

  select coalesce(sum(coalesce(prompt_tokens, 0) + coalesce(completion_tokens, 0)), 0)
    into v_tokens
    from public.ai_calls
   where tenant_id = p_tenant_id
     and created_at > now() - interval '24 hours'
     and outcome not in ('cancelled', 'cost_capped', 'rate_limited');

  if v_cfg.daily_token_cap > 0 then
    v_pct := least(100, greatest(0, round(v_tokens * 100.0 / v_cfg.daily_token_cap)))::int;
  else
    v_pct := case when v_tokens > 0 then 100 else 0 end;
  end if;

  -- Note: daily_token_cap is deliberately NOT returned -- owner sees a percentage.
  return jsonb_build_object(
    'ai_enabled', v_cfg.ai_enabled,
    'daily_usage_pct', v_pct,
    'per_user_rate_per_min', v_cfg.per_user_rate_per_min,
    'per_user_rate_per_hour', v_cfg.per_user_rate_per_hour
  );
end;
$$;

-- smoke test
do $$
declare
  v_tid uuid;
  v_uid uuid;
  v_was_admin boolean;
  v_result jsonb;
begin
  select id into v_tid from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no fixtures, skipping ai_config_token_cap smoke';
    return;
  end if;

  -- column swap landed
  assert exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_config' and column_name = 'daily_token_cap'),
    'daily_token_cap column missing';
  assert not exists (select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'ai_config' and column_name = 'daily_cost_cap_cents'),
    'daily_cost_cap_cents should be dropped';

  v_was_admin := exists (select 1 from public.platform_admins where user_id = v_uid);
  insert into public.platform_admins (user_id) values (v_uid) on conflict do nothing;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  v_result := public.platform_admin_update_ai_config(
    v_tid, 'smoke', p_ai_enabled := true, p_ai_model := 'claude-opus-4-8', p_daily_token_cap := 2000000
  );
  assert (v_result->>'daily_token_cap')::bigint = 2000000,
    format('expected daily_token_cap=2000000, got %s', v_result);
  assert (v_result->>'ai_model') = 'claude-opus-4-8',
    format('expected ai_model set, got %s', v_result);

  -- unknown model rejected
  begin
    perform public.platform_admin_update_ai_config(v_tid, 'smoke', p_ai_model := 'not-a-model');
    raise exception 'expected unknown-model failure';
  exception when sqlstate '22023' then null;
  end;

  delete from public.ai_config where tenant_id = v_tid;
  if not v_was_admin then delete from public.platform_admins where user_id = v_uid; end if;
  raise notice 'smoke: ai_config_token_cap OK';
end$$;

notify pgrst, 'reload schema';
