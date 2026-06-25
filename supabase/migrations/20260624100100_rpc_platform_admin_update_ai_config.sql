-- migration: 20260624100100_rpc_platform_admin_update_ai_config
-- purpose: Tier 1 admin RPC giving platform admins full control of a tenant's AI
--          config -- enable flag, model, cost caps, and rate limits. Caps drive
--          Clint's own Anthropic spend, so this is the only write path for them
--          (tenant owners keep just the on/off switch). Patch semantics: null
--          params leave the existing value untouched. Upserts, requires a reason,
--          and records an audit event with the field-level diff.

create or replace function public.platform_admin_update_ai_config(
  p_tenant_id              uuid,
  p_reason                 text,
  p_ai_enabled             boolean default null,
  p_ai_model               text    default null,
  p_daily_cost_cap_cents   int     default null,
  p_per_call_cost_cap_cents int    default null,
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

  if p_daily_cost_cap_cents is not null and p_daily_cost_cap_cents < 0 then
    raise exception 'daily_cost_cap_cents must be >= 0' using errcode = '22023';
  end if;
  if p_per_call_cost_cap_cents is not null and p_per_call_cost_cap_cents < 0 then
    raise exception 'per_call_cost_cap_cents must be >= 0' using errcode = '22023';
  end if;
  if p_per_user_rate_per_min is not null and p_per_user_rate_per_min < 1 then
    raise exception 'per_user_rate_per_min must be >= 1' using errcode = '22023';
  end if;
  if p_per_user_rate_per_hour is not null and p_per_user_rate_per_hour < 1 then
    raise exception 'per_user_rate_per_hour must be >= 1' using errcode = '22023';
  end if;

  -- bootstrap the row with defaults if absent
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
  if p_daily_cost_cap_cents is not null and p_daily_cost_cap_cents is distinct from v_row.daily_cost_cap_cents then
    v_diff := v_diff || jsonb_build_object('daily_cost_cap_cents', jsonb_build_array(v_row.daily_cost_cap_cents, p_daily_cost_cap_cents));
  end if;
  if p_per_call_cost_cap_cents is not null and p_per_call_cost_cap_cents is distinct from v_row.per_call_cost_cap_cents then
    v_diff := v_diff || jsonb_build_object('per_call_cost_cap_cents', jsonb_build_array(v_row.per_call_cost_cap_cents, p_per_call_cost_cap_cents));
  end if;
  if p_per_user_rate_per_min is not null and p_per_user_rate_per_min is distinct from v_row.per_user_rate_per_min then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_min', jsonb_build_array(v_row.per_user_rate_per_min, p_per_user_rate_per_min));
  end if;
  if p_per_user_rate_per_hour is not null and p_per_user_rate_per_hour is distinct from v_row.per_user_rate_per_hour then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_hour', jsonb_build_array(v_row.per_user_rate_per_hour, p_per_user_rate_per_hour));
  end if;

  update public.ai_config
     set ai_enabled              = coalesce(p_ai_enabled, ai_enabled),
         ai_model                = coalesce(p_ai_model, ai_model),
         daily_cost_cap_cents    = coalesce(p_daily_cost_cap_cents, daily_cost_cap_cents),
         per_call_cost_cap_cents = coalesce(p_per_call_cost_cap_cents, per_call_cost_cap_cents),
         per_user_rate_per_min   = coalesce(p_per_user_rate_per_min, per_user_rate_per_min),
         per_user_rate_per_hour  = coalesce(p_per_user_rate_per_hour, per_user_rate_per_hour),
         updated_by              = v_uid,
         updated_at              = now()
   where tenant_id = p_tenant_id;

  -- always audit: a platform admin touched a tenant's AI spend controls, even a
  -- no-op confirms intent. carry the reason alongside any field diff.
  perform public.record_audit_event(
    'ai_config_updated',
    'rpc',
    'ai_config',
    p_tenant_id,
    null,
    p_tenant_id,
    null,
    jsonb_build_object('reason', p_reason, 'changes', v_diff)
  );

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.platform_admin_update_ai_config(uuid, text, boolean, text, int, int, int, int) from public;
grant execute on function public.platform_admin_update_ai_config(uuid, text, boolean, text, int, int, int, int) to authenticated;

comment on function public.platform_admin_update_ai_config(uuid, text, boolean, text, int, int, int, int) is
  'Tier 1 audited. Platform admin sets a tenant''s full AI config (enable, model, cost caps, rate limits). Patch semantics; requires a reason; writes an audit event with the diff.';

-- smoke test
do $$
declare
  v_tid          uuid;
  v_uid          uuid;
  v_result       jsonb;
  v_was_admin    boolean;
begin
  select id into v_tid from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/users, skipping platform_admin_update_ai_config smoke';
    return;
  end if;

  -- grant platform admin to the smoke user for the duration of the test, but
  -- never revoke a pre-existing real grant on cleanup
  v_was_admin := exists (select 1 from public.platform_admins where user_id = v_uid);
  insert into public.platform_admins (user_id)
    values (v_uid)
    on conflict do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  v_result := public.platform_admin_update_ai_config(
    v_tid,
    'smoke test',
    p_ai_enabled := true,
    p_daily_cost_cap_cents := 1234,
    p_per_user_rate_per_min := 9
  );
  assert (v_result->>'ai_enabled')::boolean = true,
    format('expected ai_enabled=true, got %s', v_result);
  assert (v_result->>'daily_cost_cap_cents')::int = 1234,
    format('expected daily_cost_cap_cents=1234, got %s', v_result);
  assert (v_result->>'per_user_rate_per_min')::int = 9,
    format('expected per_user_rate_per_min=9, got %s', v_result);

  -- reason is required
  begin
    perform public.platform_admin_update_ai_config(v_tid, '', p_ai_enabled := false);
    raise exception 'expected reason-required failure';
  exception when sqlstate '22023' then
    null;
  end;

  delete from public.ai_config where tenant_id = v_tid;
  if not v_was_admin then
    delete from public.platform_admins where user_id = v_uid;
  end if;
  raise notice 'smoke: platform_admin_update_ai_config OK';
end$$;

notify pgrst, 'reload schema';
