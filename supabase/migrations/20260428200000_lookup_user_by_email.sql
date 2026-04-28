-- migration: 20260428200000_lookup_user_by_email
-- purpose: secure email -> user_id lookup for agency-add-member and
--   super-admin-provision-agency UX. only platform admins and agency owners
--   can call. returns null when the email isn't registered (do not raise).

create or replace function public.lookup_user_by_email(p_email text)
returns jsonb
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_uid uuid;
  v_display text;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  -- platform admins, OR users who own at least one agency, may call.
  if not (
    public.is_platform_admin()
    or exists (
      select 1 from public.agency_members am
      where am.user_id = auth.uid() and am.role = 'owner'
    )
  ) then
    raise exception 'Insufficient permissions' using errcode = '42501';
  end if;

  if p_email is null or length(trim(p_email)) = 0 then
    return jsonb_build_object('found', false);
  end if;

  select u.id,
         coalesce(
           u.raw_user_meta_data ->> 'full_name',
           u.raw_user_meta_data ->> 'name',
           u.email
         )
    into v_uid, v_display
    from auth.users u
   where lower(u.email) = lower(trim(p_email))
   limit 1;

  if v_uid is null then
    return jsonb_build_object('found', false);
  end if;

  return jsonb_build_object(
    'found', true,
    'user_id', v_uid,
    'display_name', v_display
  );
end;
$$;

comment on function public.lookup_user_by_email(text) is
  'Resolves an email address to a user_id for agency/platform admin UX. '
  'Only platform admins and agency owners can call. Returns {found:false} '
  'when the email is not registered (does not raise) so a UI can offer '
  '"send invite" as an alternative path.';

revoke execute on function public.lookup_user_by_email(text) from public, anon;
grant  execute on function public.lookup_user_by_email(text) to authenticated;
