-- create_tenant: atomically creates a tenant and adds the calling user
-- as the first owner. this avoids RLS chicken-and-egg issues where the
-- tenant INSERT succeeds but the subsequent SELECT or member INSERT fails
-- because the membership doesn't exist yet.

create or replace function public.create_tenant(
  p_name text,
  p_slug text
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_tenant_id uuid;
  result jsonb;
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  insert into public.tenants (name, slug)
  values (p_name, p_slug)
  returning id into new_tenant_id;

  insert into public.tenant_members (tenant_id, user_id, role)
  values (new_tenant_id, uid, 'owner');

  select jsonb_build_object(
    'id', t.id,
    'name', t.name,
    'slug', t.slug,
    'created_at', t.created_at,
    'updated_at', t.updated_at
  ) into result
  from public.tenants t
  where t.id = new_tenant_id;

  return result;
end;
$$;

-- create_space: atomically creates a space and adds the calling user
-- as the first owner.

create or replace function public.create_space(
  p_tenant_id uuid,
  p_name text,
  p_description text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  uid uuid := auth.uid();
  new_space_id uuid;
  result jsonb;
begin
  if uid is null then
    raise exception 'Must be authenticated';
  end if;

  -- verify user is a tenant member
  if not exists (
    select 1 from public.tenant_members
    where tenant_id = p_tenant_id and user_id = uid
  ) then
    raise exception 'Not a member of this tenant';
  end if;

  insert into public.spaces (tenant_id, name, description, created_by)
  values (p_tenant_id, p_name, p_description, uid)
  returning id into new_space_id;

  insert into public.space_members (space_id, user_id, role)
  values (new_space_id, uid, 'owner');

  select jsonb_build_object(
    'id', s.id,
    'tenant_id', s.tenant_id,
    'name', s.name,
    'description', s.description,
    'created_by', s.created_by,
    'created_at', s.created_at,
    'updated_at', s.updated_at
  ) into result
  from public.spaces s
  where s.id = new_space_id;

  return result;
end;
$$;
