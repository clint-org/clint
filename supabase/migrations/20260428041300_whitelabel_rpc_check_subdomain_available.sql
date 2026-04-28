-- migration: 20260428041300_whitelabel_rpc_check_subdomain_available
-- purpose: live availability check used by the agency portal's tenant-
--   provisioning wizard. checks: dns-safe regex, reserved list, in-use in
--   either tenants or agencies, currently in retired_hostnames holdback.
-- callable by authenticated only -- anon shouldn't be probing for
-- available subdomains.

create or replace function public.check_subdomain_available(p_subdomain text)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  reserved text[] := array[
    'www','app','api','admin','auth','mail','support','status','docs','blog',
    'help','cdn','static','assets','noreply','email','smtp'
  ];
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;

  if p_subdomain is null or p_subdomain !~ '^[a-z][a-z0-9-]{1,62}$' then
    return false;
  end if;
  if p_subdomain = any(reserved) then
    return false;
  end if;
  if exists (select 1 from public.tenants  where subdomain = p_subdomain) then return false; end if;
  if exists (select 1 from public.agencies where subdomain = p_subdomain) then return false; end if;
  if exists (
    select 1 from public.retired_hostnames
    where hostname = p_subdomain and released_at > now()
  ) then
    return false;
  end if;
  return true;
end;
$$;

comment on function public.check_subdomain_available(text) is
  'Returns true if p_subdomain matches the DNS regex, is not on the reserved '
  'list, is not in use by any tenant or agency, and is not currently in the '
  'retired_hostnames holdback. Used by the agency portal provisioning wizard.';

revoke execute on function public.check_subdomain_available(text) from public;
revoke execute on function public.check_subdomain_available(text) from anon;
grant  execute on function public.check_subdomain_available(text) to authenticated;
