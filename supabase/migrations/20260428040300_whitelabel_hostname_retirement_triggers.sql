-- migration: 20260428040300_whitelabel_hostname_retirement_triggers
-- purpose: when a tenant or agency's subdomain or custom_domain changes
--   (or the row is deleted), record the old hostname in retired_hostnames
--   so it cannot be re-claimed for at least 90 days. prevents subdomain
--   takeover attacks where an attacker re-provisions a freshly-decommissioned
--   subdomain to inherit residual trust artifacts.

create or replace function public.retire_hostname_on_change()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind varchar(20);
  v_id   uuid;
begin
  v_kind := tg_table_name;
  if v_kind = 'tenants' then
    v_kind := 'tenant';
  elsif v_kind = 'agencies' then
    v_kind := 'agency';
  else
    return null;
  end if;

  if (tg_op = 'UPDATE') then
    v_id := new.id;
    if old.subdomain is not null and (new.subdomain is null or old.subdomain <> new.subdomain) then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.subdomain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    if old.custom_domain is not null and (new.custom_domain is null or old.custom_domain <> new.custom_domain) then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.custom_domain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    return new;
  elsif (tg_op = 'DELETE') then
    v_id := old.id;
    if old.subdomain is not null then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.subdomain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    if old.custom_domain is not null then
      insert into public.retired_hostnames (hostname, previous_kind, previous_id)
        values (old.custom_domain, v_kind, v_id)
        on conflict (hostname) do nothing;
    end if;
    return old;
  end if;
  return null;
end;
$$;

comment on function public.retire_hostname_on_change() is
  'Trigger function. Inserts the old subdomain and/or custom_domain into '
  'retired_hostnames when a tenant or agency row is updated to clear/change '
  'them, or when the row is deleted. on conflict do nothing so a hostname '
  'recycled multiple times keeps the earliest retirement record.';

create trigger retire_hostname_on_tenant_change
  after update or delete on public.tenants
  for each row execute function public.retire_hostname_on_change();

create trigger retire_hostname_on_agency_change
  after update or delete on public.agencies
  for each row execute function public.retire_hostname_on_change();
