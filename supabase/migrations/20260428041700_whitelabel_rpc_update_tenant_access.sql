-- migration: 20260428041700_whitelabel_rpc_update_tenant_access
-- purpose: separate from update_tenant_branding so access changes are auditable
--   independently. only tenant owner / agency owner / platform admin.
-- accepts jsonb with: email_domain_allowlist (text[]), email_self_join_enabled (bool).

create or replace function public.update_tenant_access(
  p_tenant_id uuid,
  p_settings  jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id  uuid;
  v_allowlist  text[];
  v_domain_re  text := '^[a-z0-9.-]+\.[a-z]{2,}$';
  d text;
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

  if p_settings ? 'email_domain_allowlist' then
    v_allowlist := coalesce(
      array(select jsonb_array_elements_text(p_settings -> 'email_domain_allowlist')),
      '{}'::text[]
    );
    foreach d in array v_allowlist loop
      if d !~ v_domain_re then
        raise exception 'Invalid domain in allowlist: %', d using errcode = 'P0001';
      end if;
    end loop;
  end if;

  update public.tenants
     set email_domain_allowlist  = coalesce(v_allowlist, email_domain_allowlist),
         email_self_join_enabled = coalesce((p_settings ->> 'email_self_join_enabled')::boolean, email_self_join_enabled),
         updated_at              = now()
   where id = p_tenant_id;

  return jsonb_build_object('id', p_tenant_id, 'updated', true);
end;
$$;

comment on function public.update_tenant_access(uuid, jsonb) is
  'Updates email_domain_allowlist and email_self_join_enabled. Validates '
  'each domain matches the simple domain regex. Separate from branding '
  'so access changes are auditable independently.';

revoke execute on function public.update_tenant_access(uuid, jsonb) from public, anon;
grant  execute on function public.update_tenant_access(uuid, jsonb) to authenticated;
