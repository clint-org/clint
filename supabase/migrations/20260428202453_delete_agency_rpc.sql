-- migration: 20260428202453_delete_agency_rpc
-- purpose: super-admin destructive action: delete an agency by id. cascades
--   automatically to agency_members and agency_invites via existing FK
--   constraints. refuses if the agency still has tenants attached
--   (tenants.agency_id is ON DELETE SET NULL by design — we don't want
--   silently orphaned customer data when an agency is removed). does NOT
--   add the subdomain to retired_hostnames; this RPC is a super-admin-only
--   override path for cleanup and re-provisioning, where the 90-day
--   holdback is friction rather than safety. real customer-decommission
--   workflows must go through a separate retire_* RPC if/when one exists.
-- affected objects:
--   public.delete_agency (new function)

create or replace function public.delete_agency(p_agency_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_tenant_count int;
  v_agency_name  text;
  v_subdomain    text;
  v_members      int;
  v_invites      int;
begin
  if auth.uid() is null then
    raise exception 'Must be authenticated' using errcode = '28000';
  end if;
  if not public.is_platform_admin() then
    raise exception 'Platform admin only' using errcode = '42501';
  end if;

  select a.name, a.subdomain into v_agency_name, v_subdomain
    from public.agencies a where a.id = p_agency_id;
  if v_agency_name is null then
    raise exception 'Agency % not found', p_agency_id using errcode = 'P0002';
  end if;

  -- safety gate: refuse if tenants are attached. caller must move or remove
  -- those tenants first. tenants.agency_id is on delete set null, so a blind
  -- cascade would orphan tenants without trace.
  select count(*) into v_tenant_count
    from public.tenants where agency_id = p_agency_id;
  if v_tenant_count > 0 then
    raise exception 'Agency "%" still has % tenant(s); detach or delete them first',
      v_agency_name, v_tenant_count
      using errcode = '23503';
  end if;

  select count(*) into v_members
    from public.agency_members where agency_id = p_agency_id;
  select count(*) into v_invites
    from public.agency_invites where agency_id = p_agency_id;

  -- agency_members and agency_invites have ON DELETE CASCADE; this single
  -- delete removes everything in the agency subtree.
  delete from public.agencies where id = p_agency_id;

  return jsonb_build_object(
    'id',              p_agency_id,
    'name',            v_agency_name,
    'subdomain',       v_subdomain,
    'members_removed', v_members,
    'invites_removed', v_invites
  );
end;
$$;

comment on function public.delete_agency(uuid) is
  'Platform-admin-only destructive RPC. Deletes an agency and cascades to '
  'its agency_members and agency_invites rows. Refuses if any tenants are '
  'still attached. Skips retired_hostnames holdback — this is the super-'
  'admin override path; the subdomain is immediately re-usable.';

revoke execute on function public.delete_agency(uuid) from public, anon;
grant  execute on function public.delete_agency(uuid) to authenticated;
