-- migration: 20260428042000_whitelabel_rpc_register_custom_domain
-- purpose: platform-admin sets tenants.custom_domain after netlify domain
--   alias is configured. validates basic domain shape and that the domain
--   is not in use anywhere (cross-table) and not in the retired holdback.

create or replace function public.register_custom_domain(
  p_tenant_id     uuid,
  p_custom_domain text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_domain_re text := '^[a-z0-9.-]+\.[a-z]{2,}$';
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;
  if p_custom_domain is null or p_custom_domain !~ v_domain_re then
    raise exception 'Invalid domain' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.tenants  where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (select 1 from public.agencies where custom_domain = p_custom_domain) then
    raise exception 'Domain already in use' using errcode = '23505';
  end if;
  if exists (
    select 1 from public.retired_hostnames
     where hostname = p_custom_domain and released_at > now()
  ) then
    raise exception 'Domain is in retirement holdback' using errcode = 'P0001';
  end if;

  update public.tenants
     set custom_domain = p_custom_domain, updated_at = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'custom_domain', p_custom_domain);
end;
$$;

comment on function public.register_custom_domain(uuid, text) is
  'Sets tenants.custom_domain. Platform admin only -- the corresponding '
  'Netlify domain alias and TLS cert are configured manually before '
  'calling this. Validates uniqueness across both tenants and agencies '
  'and checks the retired_hostnames holdback.';

revoke execute on function public.register_custom_domain(uuid, text) from public, anon;
grant  execute on function public.register_custom_domain(uuid, text) to authenticated;
