-- migration: 20260428040200_whitelabel_cross_table_host_uniqueness
-- purpose: per-table unique constraints on tenants.subdomain and
--   agencies.subdomain don't prevent a tenant subdomain colliding with an
--   agency subdomain (or any subdomain colliding with a custom_domain).
--   the host resolver (get_brand_by_host) needs unambiguous host -> entity
--   mapping. enforce cross-table uniqueness via two before-insert-or-update
--   triggers on each table.
-- raises 23505 (unique_violation) on collision so the api surfaces a clean
--   conflict rather than a generic exception.

create or replace function public.enforce_subdomain_unique_across_tables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  collides boolean;
begin
  if new.subdomain is null then
    return new;
  end if;

  if tg_table_name = 'tenants' then
    select exists (select 1 from public.agencies a where a.subdomain = new.subdomain)
      into collides;
  elsif tg_table_name = 'agencies' then
    select exists (select 1 from public.tenants t where t.subdomain = new.subdomain)
      into collides;
  else
    return new;
  end if;

  if collides then
    raise exception 'subdomain "%" is already in use', new.subdomain
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.enforce_subdomain_unique_across_tables() is
  'Trigger function. Prevents tenants.subdomain from colliding with '
  'agencies.subdomain and vice versa. Required because a single per-table '
  'unique constraint cannot enforce cross-table uniqueness.';

create or replace function public.enforce_custom_domain_unique_across_tables()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  collides boolean;
begin
  if new.custom_domain is null then
    return new;
  end if;

  if tg_table_name = 'tenants' then
    select exists (select 1 from public.agencies a where a.custom_domain = new.custom_domain)
      into collides;
  elsif tg_table_name = 'agencies' then
    select exists (select 1 from public.tenants t where t.custom_domain = new.custom_domain)
      into collides;
  else
    return new;
  end if;

  if collides then
    raise exception 'custom_domain "%" is already in use', new.custom_domain
      using errcode = '23505';
  end if;

  return new;
end;
$$;

comment on function public.enforce_custom_domain_unique_across_tables() is
  'Trigger function. Prevents tenants.custom_domain from colliding with '
  'agencies.custom_domain and vice versa.';

create trigger enforce_subdomain_unique_tenants
  before insert or update of subdomain on public.tenants
  for each row execute function public.enforce_subdomain_unique_across_tables();

create trigger enforce_subdomain_unique_agencies
  before insert or update of subdomain on public.agencies
  for each row execute function public.enforce_subdomain_unique_across_tables();

create trigger enforce_custom_domain_unique_tenants
  before insert or update of custom_domain on public.tenants
  for each row execute function public.enforce_custom_domain_unique_across_tables();

create trigger enforce_custom_domain_unique_agencies
  before insert or update of custom_domain on public.agencies
  for each row execute function public.enforce_custom_domain_unique_across_tables();
