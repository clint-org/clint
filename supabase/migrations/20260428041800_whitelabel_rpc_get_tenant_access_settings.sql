-- migration: 20260428041800_whitelabel_rpc_get_tenant_access_settings
-- purpose: authenticated read of allowlist + self_join settings for a tenant.
--   used by tenant-settings ui to show current values. distinct from
--   get_brand_by_host because that one is anon-callable and intentionally
--   hides allowlist contents.

create or replace function public.get_tenant_access_settings(p_tenant_id uuid)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'email_domain_allowlist',  coalesce(t.email_domain_allowlist, array[]::text[]),
    'email_self_join_enabled', t.email_self_join_enabled
  ) into v_result
    from public.tenants t where t.id = p_tenant_id;
  return v_result;
end;
$$;

comment on function public.get_tenant_access_settings(uuid) is
  'Returns allowlist and self_join settings for tenant settings UI. Gated '
  'to tenant owner / agency owner / platform admin.';

revoke execute on function public.get_tenant_access_settings(uuid) from public, anon;
grant  execute on function public.get_tenant_access_settings(uuid) to authenticated;
