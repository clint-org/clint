-- migration: 20260527100000_rpc_tenant_owner_update_ai_config
-- purpose: tenant-owner RPC to toggle ai_enabled and update cost/rate limits.
--          Upserts ai_config so it works whether or not a row already exists.

create or replace function public.tenant_owner_update_ai_config(
  p_tenant_id              uuid,
  p_ai_enabled             boolean       default null,
  p_daily_cost_cap_cents   int           default null,
  p_per_user_rate_per_min  int           default null,
  p_per_user_rate_per_hour int           default null
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
-- @audit:tier1
declare
  v_uid   uuid := auth.uid();
  v_row   public.ai_config;
  v_diff  jsonb := '{}'::jsonb;
begin
  if not exists (
    select 1 from public.tenant_members
     where tenant_id = p_tenant_id
       and user_id   = v_uid
       and role       = 'owner'
  ) then
    raise exception 'forbidden: tenant owner required' using errcode = '42501';
  end if;

  -- upsert with defaults so the first call bootstraps the row
  insert into public.ai_config (tenant_id, updated_by, updated_at)
    values (p_tenant_id, v_uid, now())
    on conflict (tenant_id) do nothing;

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;

  if p_ai_enabled is not null and p_ai_enabled is distinct from v_row.ai_enabled then
    v_diff := v_diff || jsonb_build_object('ai_enabled', jsonb_build_array(v_row.ai_enabled, p_ai_enabled));
  end if;
  if p_daily_cost_cap_cents is not null and p_daily_cost_cap_cents is distinct from v_row.daily_cost_cap_cents then
    v_diff := v_diff || jsonb_build_object('daily_cost_cap_cents', jsonb_build_array(v_row.daily_cost_cap_cents, p_daily_cost_cap_cents));
  end if;
  if p_per_user_rate_per_min is not null and p_per_user_rate_per_min is distinct from v_row.per_user_rate_per_min then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_min', jsonb_build_array(v_row.per_user_rate_per_min, p_per_user_rate_per_min));
  end if;
  if p_per_user_rate_per_hour is not null and p_per_user_rate_per_hour is distinct from v_row.per_user_rate_per_hour then
    v_diff := v_diff || jsonb_build_object('per_user_rate_per_hour', jsonb_build_array(v_row.per_user_rate_per_hour, p_per_user_rate_per_hour));
  end if;

  if v_diff = '{}'::jsonb then
    return to_jsonb(v_row);
  end if;

  update public.ai_config
     set ai_enabled             = coalesce(p_ai_enabled, ai_enabled),
         daily_cost_cap_cents   = coalesce(p_daily_cost_cap_cents, daily_cost_cap_cents),
         per_user_rate_per_min  = coalesce(p_per_user_rate_per_min, per_user_rate_per_min),
         per_user_rate_per_hour = coalesce(p_per_user_rate_per_hour, per_user_rate_per_hour),
         updated_by             = v_uid,
         updated_at             = now()
   where tenant_id = p_tenant_id;

  perform public.record_audit_event(
    'ai_config_updated',
    'rpc',
    'ai_config',
    p_tenant_id,
    null,
    p_tenant_id,
    null,
    v_diff
  );

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;
  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.tenant_owner_update_ai_config(uuid, boolean, int, int, int) from public;
grant execute on function public.tenant_owner_update_ai_config(uuid, boolean, int, int, int) to authenticated;

comment on function public.tenant_owner_update_ai_config(uuid, boolean, int, int, int) is
  'Tenant-owner self-service AI config. Upserts ai_config and records an audit event with the diff.';

-- smoke test
do $$
declare
  v_tid uuid;
  v_uid uuid;
  v_result jsonb;
begin
  select id into v_tid from public.tenants limit 1;
  select id into v_uid from auth.users limit 1;
  if v_tid is null or v_uid is null then
    raise notice 'smoke: no tenants/users, skipping tenant_owner_update_ai_config smoke';
    return;
  end if;

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tid, v_uid, 'owner')
    on conflict do nothing;

  -- set JWT so auth.uid() resolves inside the SECURITY DEFINER
  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  v_result := public.tenant_owner_update_ai_config(v_tid, p_ai_enabled := true);
  assert (v_result->>'ai_enabled')::boolean = true,
    format('expected ai_enabled=true, got %s', v_result);

  v_result := public.tenant_owner_update_ai_config(v_tid, p_ai_enabled := false);
  assert (v_result->>'ai_enabled')::boolean = false,
    format('expected ai_enabled=false, got %s', v_result);

  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: tenant_owner_update_ai_config OK';
end$$;
