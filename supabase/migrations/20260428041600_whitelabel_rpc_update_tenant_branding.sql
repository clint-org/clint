-- migration: 20260428041600_whitelabel_rpc_update_tenant_branding
-- purpose: tenant-owner-or-agency-owner-or-platform-admin rpc to update
--   only branding fields. domain settings (subdomain, custom_domain),
--   access settings (allowlist, self_join), and admin-only fields
--   (agency_id, suspended_at) are explicitly excluded.

create or replace function public.update_tenant_branding(
  p_tenant_id uuid,
  p_branding  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_color_re  text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'accent_color','email_from_name'
  ];
  k text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  -- reject unknown keys (defensive against drift between client and rpc)
  for k in select jsonb_object_keys(p_branding) loop
    if not (k = any(v_brand_keys)) then
      raise exception 'Unknown branding field: %', k using errcode = 'P0001';
    end if;
  end loop;

  select agency_id into v_agency_id from public.tenants where id = p_tenant_id;
  if not (
    public.is_tenant_member(p_tenant_id, array['owner'])
    or (v_agency_id is not null and public.is_agency_member(v_agency_id, array['owner']))
    or public.is_platform_admin()
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  -- color validation (when provided)
  if p_branding ? 'primary_color' and (p_branding ->> 'primary_color') !~ v_color_re then
    raise exception 'primary_color must be #rrggbb' using errcode = 'P0001';
  end if;
  if p_branding ? 'accent_color' and (p_branding ->> 'accent_color') is not null
     and (p_branding ->> 'accent_color') !~ v_color_re then
    raise exception 'accent_color must be #rrggbb' using errcode = 'P0001';
  end if;

  update public.tenants
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         accent_color     = coalesce(p_branding ->> 'accent_color',     accent_color),
         email_from_name  = coalesce(p_branding ->> 'email_from_name',  email_from_name),
         updated_at       = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

comment on function public.update_tenant_branding(uuid, jsonb) is
  'Updates branding fields on a tenant. Whitelist of allowed keys; rejects '
  'unknown keys with P0001. Sensitive fields (subdomain, custom_domain, '
  'agency_id, suspended_at) are not editable here.';

revoke execute on function public.update_tenant_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_branding(uuid, jsonb) to authenticated;
