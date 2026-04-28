-- migration: 20260428042100_whitelabel_rpc_self_join_tenant
-- purpose: domain-allowlist self-join. user lands on a tenant subdomain,
--   authenticates via google/microsoft, and if their email's domain
--   matches the tenant's email_domain_allowlist and self_join is enabled,
--   they're added to tenant_members at member role.
-- security: returns the SAME generic error message for every failure
--   mode -- prevents enumeration of which subdomains exist and which
--   corporate email domains unlock them. logs the actual reason via
--   raise notice for support diagnostics.

create or replace function public.self_join_tenant(p_subdomain text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_uid       uuid := auth.uid();
  v_email     text := lower(coalesce(auth.jwt() ->> 'email', ''));
  v_email_dom text;
  v_tenant    record;
  v_allowed   boolean;
begin
  if v_uid is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if v_email = '' then
    raise notice 'self_join: missing email claim';
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  v_email_dom := split_part(v_email, '@', 2);

  select id, email_domain_allowlist, email_self_join_enabled, suspended_at, name
    into v_tenant
    from public.tenants
   where subdomain = p_subdomain
   limit 1;

  if not found then
    raise notice 'self_join: subdomain not found: %', p_subdomain;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.suspended_at is not null then
    raise notice 'self_join: tenant suspended (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if not coalesce(v_tenant.email_self_join_enabled, false) then
    raise notice 'self_join: disabled (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;
  if v_tenant.email_domain_allowlist is null
     or array_length(v_tenant.email_domain_allowlist, 1) is null then
    raise notice 'self_join: empty allowlist (%)', v_tenant.id;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  v_allowed := exists (
    select 1 from unnest(v_tenant.email_domain_allowlist) d
    where lower(d) = v_email_dom
  );
  if not v_allowed then
    raise notice 'self_join: email domain not in allowlist (%, %)', v_tenant.id, v_email_dom;
    raise exception 'self-join not available for this workspace' using errcode = 'P0001';
  end if;

  -- tenant_members.role is constrained to 'owner' | 'member'; 'member' is the
  -- least-privileged level (still gets implicit editor/viewer space access via
  -- has_space_access). per-space viewer-only restriction is a future feature
  -- (would require space_members rows instead of tenant_members).
  insert into public.tenant_members (tenant_id, user_id, role)
    values (v_tenant.id, v_uid, 'member')
    on conflict (tenant_id, user_id) do nothing;

  return jsonb_build_object('id', v_tenant.id, 'name', v_tenant.name, 'role', 'member');
end;
$$;

comment on function public.self_join_tenant(text) is
  'Domain-allowlist self-join. Returns the SAME generic error for every '
  'failure mode (missing tenant, disabled, suspended, allowlist mismatch) '
  'to prevent enumeration. Real reason is logged via raise notice for '
  'support diagnostics.';

revoke execute on function public.self_join_tenant(text) from public, anon;
grant  execute on function public.self_join_tenant(text) to authenticated;
