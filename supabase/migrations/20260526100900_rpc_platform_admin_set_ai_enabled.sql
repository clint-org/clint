-- migration: 20260525100900_rpc_platform_admin_set_ai_enabled
-- purpose: Tier 1 admin RPC to toggle ai_enabled for a tenant. Upserts ai_config
--          and records an audit event.

create or replace function public.platform_admin_set_ai_enabled(
  p_tenant_id uuid,
  p_enabled   boolean,
  p_reason    text
) returns void
language plpgsql
security definer
set search_path = public
as $$
-- @audit:tier1
begin
  if not public.is_platform_admin() then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'reason is required' using errcode = '22023';
  end if;

  insert into public.ai_config (tenant_id, ai_enabled, updated_by, updated_at)
    values (p_tenant_id, p_enabled, auth.uid(), now())
    on conflict (tenant_id) do update
      set ai_enabled = p_enabled,
          updated_by = auth.uid(),
          updated_at = now();

  perform public.record_audit_event(
    'ai_enabled_changed',
    'rpc',
    'ai_config',
    p_tenant_id,
    null,
    p_tenant_id,
    null,
    jsonb_build_object('enabled', p_enabled, 'reason', p_reason)
  );
end;
$$;

revoke execute on function public.platform_admin_set_ai_enabled(uuid, boolean, text) from public;
grant execute on function public.platform_admin_set_ai_enabled(uuid, boolean, text) to authenticated;

comment on function public.platform_admin_set_ai_enabled(uuid, boolean, text) is
  'Tier 1 audited. Platform admin toggles ai_enabled for a tenant. Upserts ai_config and writes audit event.';

-- smoke test
do $$
begin
  assert exists (
    select 1 from pg_proc
     where proname = 'platform_admin_set_ai_enabled'
       and pronamespace = 'public'::regnamespace
  ), 'platform_admin_set_ai_enabled function not found';

  raise notice 'smoke: platform_admin_set_ai_enabled created OK';
end$$;
