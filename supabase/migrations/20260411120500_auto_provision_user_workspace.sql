-- migration: 20260411120500_auto_provision_user_workspace
-- purpose: auto-create a default tenant and space for new users when they
--          sign up, so they land on a usable workspace without having to
--          go through the manual onboarding flow. Mirrors the production
--          auto-provisioning behavior for local development.
-- affected objects: public.handle_new_user (function),
--                   trigger on_auth_user_created on auth.users,
--                   one-time back-fill over existing auth.users without
--                   a tenant or space.
-- notes: handle_new_user is security definer so it can write to public
--        tables from inside the auth.users insert trigger. The space is
--        created empty; the frontend calls public.seed_demo_data(space_id)
--        on first visit to populate it with the timeline + landscape
--        fixture.

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_id uuid := gen_random_uuid();
  v_space_id uuid := gen_random_uuid();
  v_display_name text;
  v_slug text;
begin
  -- skip the dummy users the pharma demo seed creates
  if new.email is null or new.email like '%@bi.example.com' or new.email like '%@azurity.example.com' then
    return new;
  end if;

  -- derive a friendly display name + slug from the email local part
  v_display_name := split_part(new.email, '@', 1);
  v_slug := regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g')
    || '-' || substr(new.id::text, 1, 8);

  -- default tenant
  insert into public.tenants (id, name, slug)
  values (v_tenant_id, initcap(v_display_name) || '''s Workspace', v_slug);

  insert into public.tenant_members (tenant_id, user_id, role)
  values (v_tenant_id, new.id, 'owner');

  -- default space
  insert into public.spaces (id, tenant_id, name, description, created_by)
  values (v_space_id, v_tenant_id, 'Default Space', 'Auto-provisioned on signup', new.id);

  insert into public.space_members (space_id, user_id, role)
  values (v_space_id, new.id, 'owner');

  return new;
end;
$$;

comment on function public.handle_new_user is
  'Auto-provisions a default tenant and space for newly created auth.users rows so local signups land on a usable workspace without manual onboarding.';

-- wire the trigger
drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ==========================================================================
-- One-time back-fill: any existing user without an owned tenant/space gets
-- one created retroactively. Skips the seeded dummy users.
-- ==========================================================================
do $$
declare
  u record;
  v_tenant_id uuid;
  v_space_id uuid;
  v_tenant_count int;
  v_space_count int;
  v_display_name text;
  v_slug text;
begin
  for u in
    select id, email
    from auth.users
    where email is not null
      and email not like '%@bi.example.com'
      and email not like '%@azurity.example.com'
  loop
    -- does the user own at least one tenant already?
    select count(*) into v_tenant_count
    from public.tenant_members
    where user_id = u.id and role = 'owner';

    if v_tenant_count = 0 then
      v_tenant_id := gen_random_uuid();
      v_display_name := split_part(u.email, '@', 1);
      v_slug := regexp_replace(lower(v_display_name), '[^a-z0-9]+', '-', 'g')
        || '-' || substr(u.id::text, 1, 8);

      insert into public.tenants (id, name, slug)
      values (v_tenant_id, initcap(v_display_name) || '''s Workspace', v_slug);

      insert into public.tenant_members (tenant_id, user_id, role)
      values (v_tenant_id, u.id, 'owner');
    else
      select tm.tenant_id into v_tenant_id
      from public.tenant_members tm
      where tm.user_id = u.id and tm.role = 'owner'
      order by tm.created_at nulls last
      limit 1;
    end if;

    -- does the user own at least one space already?
    select count(*) into v_space_count
    from public.space_members
    where user_id = u.id and role = 'owner';

    if v_space_count = 0 then
      v_space_id := gen_random_uuid();
      insert into public.spaces (id, tenant_id, name, description, created_by)
      values (v_space_id, v_tenant_id, 'Default Space', 'Auto-provisioned', u.id);

      insert into public.space_members (space_id, user_id, role)
      values (v_space_id, u.id, 'owner');
    end if;
  end loop;
end;
$$;
