-- migration: 20260428041400_whitelabel_rpc_provision_agency
-- purpose: platform-admin-only rpc that creates a new agency record and
--   adds the specified user as the agency's first owner. callable from
--   psql during the bootstrap window (phase 6 of the rollout) before
--   the super-admin ui exists (phase 9).

create or replace function public.provision_agency(
  p_name           text,
  p_slug           text,
  p_subdomain      text,
  p_owner_user_id  uuid,
  p_contact_email  text default null
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_agency_id uuid;
  v_result    jsonb;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;

  if not public.check_subdomain_available(p_subdomain) then
    raise exception 'Subdomain "%" is not available', p_subdomain
      using errcode = '23505';
  end if;
  if p_slug is null or p_slug !~ '^[a-z][a-z0-9-]{1,99}$' then
    raise exception 'Invalid slug' using errcode = 'P0001';
  end if;

  insert into public.agencies (name, slug, subdomain, app_display_name, contact_email)
    values (p_name, p_slug, p_subdomain, p_name, coalesce(p_contact_email, 'unknown@unknown.invalid'))
    returning id into v_agency_id;

  insert into public.agency_members (agency_id, user_id, role)
    values (v_agency_id, p_owner_user_id, 'owner');

  select jsonb_build_object(
    'id', a.id, 'name', a.name, 'slug', a.slug, 'subdomain', a.subdomain,
    'app_display_name', a.app_display_name, 'created_at', a.created_at
  ) into v_result
    from public.agencies a where a.id = v_agency_id;

  return v_result;
end;
$$;

comment on function public.provision_agency(text, text, text, uuid, text) is
  'Platform-admin-only RPC. Creates an agency and adds p_owner_user_id as '
  'the first owner. SECURITY DEFINER bypasses RLS for atomic creation.';

revoke execute on function public.provision_agency(text, text, text, uuid, text) from public, anon;
grant  execute on function public.provision_agency(text, text, text, uuid, text) to authenticated;
