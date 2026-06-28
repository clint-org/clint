-- migration: 20260624100000_rpc_tenant_owner_update_ai_config_enabled_only
-- purpose: Cost caps and rate limits drive Clint's own Anthropic spend, so they
--          are no longer a tenant-owner lever -- they move to platform admins
--          (see platform_admin_update_ai_config). The tenant owner keeps only the
--          opt-in on/off switch. Drop the 5-arg signature and recreate the RPC
--          taking just (tenant_id, ai_enabled).

drop function if exists public.tenant_owner_update_ai_config(uuid, boolean, int, int, int);

create or replace function public.tenant_owner_update_ai_config(
  p_tenant_id  uuid,
  p_ai_enabled boolean
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
  if not exists (
    select 1 from public.tenant_members
     where tenant_id = p_tenant_id
       and user_id   = v_uid
       and role       = 'owner'
  ) then
    raise exception 'forbidden: tenant owner required' using errcode = '42501';
  end if;

  if p_ai_enabled is null then
    raise exception 'p_ai_enabled is required' using errcode = '22023';
  end if;

  -- upsert with defaults so the first call bootstraps the row
  insert into public.ai_config (tenant_id, updated_by, updated_at)
    values (p_tenant_id, v_uid, now())
    on conflict (tenant_id) do nothing;

  select * into v_row from public.ai_config where tenant_id = p_tenant_id;

  if p_ai_enabled is distinct from v_row.ai_enabled then
    v_diff := jsonb_build_object('ai_enabled', jsonb_build_array(v_row.ai_enabled, p_ai_enabled));

    update public.ai_config
       set ai_enabled = p_ai_enabled,
           updated_by = v_uid,
           updated_at = now()
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
  end if;

  return to_jsonb(v_row);
end;
$$;

revoke execute on function public.tenant_owner_update_ai_config(uuid, boolean) from public;
grant execute on function public.tenant_owner_update_ai_config(uuid, boolean) to authenticated;

comment on function public.tenant_owner_update_ai_config(uuid, boolean) is
  'Tenant-owner self-service AI on/off switch. Upserts ai_config and records an audit event with the diff. Caps/rate limits are platform-admin-only (see platform_admin_update_ai_config).';

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
    raise notice 'smoke: no tenants/users, skipping tenant_owner_update_ai_config smoke';
    return;
  end if;

  -- the old 5-arg overload must be gone
  assert not exists (
    select 1 from pg_proc
     where proname = 'tenant_owner_update_ai_config'
       and pronamespace = 'public'::regnamespace
       and pronargs = 5
  ), 'old 5-arg tenant_owner_update_ai_config still present';

  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tid, v_uid, 'owner')
    on conflict do nothing;

  perform set_config('request.jwt.claims', jsonb_build_object('sub', v_uid)::text, true);

  v_result := public.tenant_owner_update_ai_config(v_tid, true);
  assert (v_result->>'ai_enabled')::boolean = true,
    format('expected ai_enabled=true, got %s', v_result);

  v_result := public.tenant_owner_update_ai_config(v_tid, false);
  assert (v_result->>'ai_enabled')::boolean = false,
    format('expected ai_enabled=false, got %s', v_result);

  delete from public.ai_config where tenant_id = v_tid;
  raise notice 'smoke: tenant_owner_update_ai_config (enabled-only) OK';
end$$;

notify pgrst, 'reload schema';
