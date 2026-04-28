-- migration: 20260428041900_whitelabel_rpc_update_agency_branding
-- purpose: agency-owner-or-platform-admin updates to agency branding.
--   subdomain / custom_domain / plan_tier / max_tenants are NOT editable
--   here (sensitive admin fields).

create or replace function public.update_agency_branding(
  p_agency_id uuid,
  p_branding  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_color_re  text := '^#[0-9a-fA-F]{6}$';
  v_brand_keys text[] := array[
    'app_display_name','logo_url','favicon_url','primary_color',
    'accent_color','contact_email'
  ];
  k text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not (public.is_agency_member(p_agency_id, array['owner']) or public.is_platform_admin()) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;
  for k in select jsonb_object_keys(p_branding) loop
    if not (k = any(v_brand_keys)) then
      raise exception 'Unknown branding field: %', k using errcode = 'P0001';
    end if;
  end loop;
  if p_branding ? 'primary_color' and (p_branding ->> 'primary_color') !~ v_color_re then
    raise exception 'primary_color must be #rrggbb' using errcode = 'P0001';
  end if;
  if p_branding ? 'accent_color' and (p_branding ->> 'accent_color') is not null
     and (p_branding ->> 'accent_color') !~ v_color_re then
    raise exception 'accent_color must be #rrggbb' using errcode = 'P0001';
  end if;

  update public.agencies
     set app_display_name = coalesce(p_branding ->> 'app_display_name', app_display_name),
         logo_url         = coalesce(p_branding ->> 'logo_url',         logo_url),
         favicon_url      = coalesce(p_branding ->> 'favicon_url',      favicon_url),
         primary_color    = coalesce(p_branding ->> 'primary_color',    primary_color),
         accent_color     = coalesce(p_branding ->> 'accent_color',     accent_color),
         contact_email    = coalesce(p_branding ->> 'contact_email',    contact_email),
         updated_at       = now()
   where id = p_agency_id;

  return jsonb_build_object('id', p_agency_id, 'updated', true);
end;
$$;

comment on function public.update_agency_branding(uuid, jsonb) is
  'Updates branding fields on an agency. Whitelist of allowed keys.';

revoke execute on function public.update_agency_branding(uuid, jsonb) from public, anon;
grant  execute on function public.update_agency_branding(uuid, jsonb) to authenticated;
