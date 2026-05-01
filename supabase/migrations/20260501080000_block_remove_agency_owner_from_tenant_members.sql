-- migration: 20260501080000_block_remove_agency_owner_from_tenant_members
-- purpose: enforce, at the database layer, that a tenant client cannot evict
--   their parent agency from their own tenant via the tenant settings members
--   table. Without this guard, a tenant owner could delete the explicit
--   tenant_members row for an agency owner, but is_tenant_member() has three
--   disjuncts (explicit row OR agency owner of parent OR platform admin), so
--   the agency owner remains a tenant member via the agency-owner disjunct.
--   Net effect from the tenant client's perspective: they "removed" the agency
--   but the agency stayed in. Eviction of an agency from a tenant is a
--   contractual matter and should not be self-serve from tenant settings;
--   if it ever needs to happen, it goes through a platform admin.
--
-- also: surface is_agency_backed on tenant_members_view so the UI can hide
--   row actions for these rows and render a small "via agency" hint.
--
-- affected objects:
--   public.tenant_members_view (recreated; adds is_agency_backed column)
--   public.enforce_tenant_member_guards (replaced; adds the new DELETE clause)

-- 1. Recreate the view with is_agency_backed.
drop view if exists public.tenant_members_view;

create view public.tenant_members_view as
select
  tm.id,
  tm.tenant_id,
  tm.user_id,
  tm.role,
  tm.created_at,
  u.email,
  coalesce(u.raw_user_meta_data->>'full_name', u.email) as display_name,
  exists (
    select 1
    from public.agency_members am
    join public.tenants t on t.id = tm.tenant_id
    where am.user_id = tm.user_id
      and am.agency_id = t.agency_id
      and am.role = 'owner'
  ) as is_agency_backed
from public.tenant_members tm
join auth.users u on u.id = tm.user_id
where public.is_tenant_member(tm.tenant_id);

grant select on public.tenant_members_view to authenticated;

comment on view public.tenant_members_view is
  'Tenant members joined with their auth.users email/display_name. Includes '
  'is_agency_backed: true when the row''s user is also an owner of the '
  'tenant''s parent agency, in which case removing the explicit tenant_members '
  'row leaves them with access via the agency-owner disjunct in '
  'is_tenant_member(). The UI hides remove actions for these rows; the '
  'enforce_tenant_member_guards trigger blocks the DELETE regardless of UI '
  'state. Runs as view owner so it can read auth.users; per-caller filtering '
  'is enforced by the is_tenant_member() call in the WHERE clause.';

-- 2. Replace the self-protection trigger function with the agency-owner clause.
create or replace function public.enforce_tenant_member_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
  parent_agency_id uuid;
begin
  if current_setting('clint.member_guard_cascade', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.user_id = auth.uid() then
      raise exception 'You cannot remove yourself from this tenant. Ask another owner to remove you.'
        using errcode = '42501';
    end if;

    -- Block removal of agency-backed members. The agency-owner disjunct in
    -- is_tenant_member() means deleting the explicit row is cosmetic: the
    -- target user retains tenant access via their agency_members row.
    -- Only a platform admin can override (e.g. transferring a tenant to a
    -- different agency, or detaching a tenant from its agency entirely).
    select agency_id into parent_agency_id
    from public.tenants
    where id = old.tenant_id;
    if parent_agency_id is not null
      and exists (
        select 1
        from public.agency_members am
        where am.agency_id = parent_agency_id
          and am.user_id = old.user_id
          and am.role = 'owner'
      )
      and not public.is_platform_admin()
    then
      raise exception 'Cannot remove an agency owner from this tenant. Tenant access for this user is granted by the parent agency; contact a platform admin if eviction is needed.'
        using errcode = '42501';
    end if;

    if old.role = 'owner' then
      select count(*) into remaining_owners
      from public.tenant_members
      where tenant_id = old.tenant_id
        and role = 'owner'
        and id <> old.id;
      if remaining_owners < 1 then
        raise exception 'Cannot remove the last owner of this tenant. Promote another member first.'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining_owners
    from public.tenant_members
    where tenant_id = old.tenant_id
      and role = 'owner'
      and id <> old.id;
    if remaining_owners < 1 then
      raise exception 'Cannot demote the last owner of this tenant. Promote another member first.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

comment on function public.enforce_tenant_member_guards is
  'Blocks self-removal, last-owner removal/demote, and removal of agency-backed '
  'members (where target user is an agency-owner of the tenant''s parent '
  'agency; only platform admin can override). Bypassed during cascading parent '
  'deletes via clint.member_guard_cascade.';
