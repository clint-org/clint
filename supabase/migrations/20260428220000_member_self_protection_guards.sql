-- Member self-protection guards.
--
-- Defense-in-depth at the database layer. The UI hides the role select and
-- "remove" actions for the current user, but a sufficiently motivated client
-- (or a stale tab) could still PATCH/DELETE these tables directly via
-- PostgREST. Two rules apply uniformly to tenant_members, space_members, and
-- agency_members:
--
--   1. You cannot delete your own membership row. Another member must remove
--      you. This prevents accidental self-eviction (the dangerous case is the
--      lone owner deleting themselves and locking the tenant out).
--   2. You cannot leave an entity with zero owners. Both DELETE of the last
--      owner and UPDATE that demotes the last owner from 'owner' are blocked.
--
-- Cascading deletes from the parent tables (tenants, spaces, agencies, and
-- auth.users) MUST still work -- otherwise tenant deletion would deadlock on
-- "cannot remove the last owner". Each parent table gets a statement-level
-- BEFORE/AFTER DELETE trigger pair that flips a transaction-local flag; the
-- member-row guards short-circuit when that flag is on.

-- Helper: flip the cascade flag on/off. set_config(_, _, true) makes the
-- value transaction-local so it cannot leak across commits.
create or replace function public.member_guard_mark_cascade_start()
returns trigger
language plpgsql
as $$
begin
  perform set_config('clint.member_guard_cascade', 'on', true);
  return null;
end;
$$;

create or replace function public.member_guard_mark_cascade_end()
returns trigger
language plpgsql
as $$
begin
  perform set_config('clint.member_guard_cascade', 'off', true);
  return null;
end;
$$;

-- Parent-table cascade markers.
create trigger tenants_member_guard_cascade_start
  before delete on public.tenants
  for each statement execute function public.member_guard_mark_cascade_start();
create trigger tenants_member_guard_cascade_end
  after delete on public.tenants
  for each statement execute function public.member_guard_mark_cascade_end();

create trigger spaces_member_guard_cascade_start
  before delete on public.spaces
  for each statement execute function public.member_guard_mark_cascade_start();
create trigger spaces_member_guard_cascade_end
  after delete on public.spaces
  for each statement execute function public.member_guard_mark_cascade_end();

create trigger agencies_member_guard_cascade_start
  before delete on public.agencies
  for each statement execute function public.member_guard_mark_cascade_start();
create trigger agencies_member_guard_cascade_end
  after delete on public.agencies
  for each statement execute function public.member_guard_mark_cascade_end();

-- auth.users deletion cascades to all three member tables. Permission to add
-- triggers in the auth schema is established by the existing handle_new_user
-- trigger; we follow the same pattern.
create trigger users_member_guard_cascade_start
  before delete on auth.users
  for each statement execute function public.member_guard_mark_cascade_start();
create trigger users_member_guard_cascade_end
  after delete on auth.users
  for each statement execute function public.member_guard_mark_cascade_end();

-- Generic guard. Each member-table trigger wraps this with the right table /
-- entity-id column / entity label. Implemented inline per table (rather than
-- a shared dynamic SQL function) because the table identifier and column name
-- vary, and EXECUTE on user-supplied identifiers is fragile.

-- Tenant members guard.
create or replace function public.enforce_tenant_member_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  if current_setting('clint.member_guard_cascade', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.user_id = auth.uid() then
      raise exception 'You cannot remove yourself from this tenant. Ask another owner to remove you.'
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

create trigger tenant_members_self_protection
  before delete or update on public.tenant_members
  for each row execute function public.enforce_tenant_member_guards();

-- Space members guard.
create or replace function public.enforce_space_member_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  if current_setting('clint.member_guard_cascade', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.user_id = auth.uid() then
      raise exception 'You cannot remove yourself from this space. Ask another owner to remove you.'
        using errcode = '42501';
    end if;
    if old.role = 'owner' then
      select count(*) into remaining_owners
      from public.space_members
      where space_id = old.space_id
        and role = 'owner'
        and id <> old.id;
      if remaining_owners < 1 then
        raise exception 'Cannot remove the last owner of this space. Promote another member first.'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining_owners
    from public.space_members
    where space_id = old.space_id
      and role = 'owner'
      and id <> old.id;
    if remaining_owners < 1 then
      raise exception 'Cannot demote the last owner of this space. Promote another member first.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger space_members_self_protection
  before delete or update on public.space_members
  for each row execute function public.enforce_space_member_guards();

-- Agency members guard.
create or replace function public.enforce_agency_member_guards()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  remaining_owners int;
begin
  if current_setting('clint.member_guard_cascade', true) = 'on' then
    return coalesce(new, old);
  end if;

  if tg_op = 'DELETE' then
    if old.user_id = auth.uid() then
      raise exception 'You cannot remove yourself from this agency. Ask another owner to remove you.'
        using errcode = '42501';
    end if;
    if old.role = 'owner' then
      select count(*) into remaining_owners
      from public.agency_members
      where agency_id = old.agency_id
        and role = 'owner'
        and id <> old.id;
      if remaining_owners < 1 then
        raise exception 'Cannot remove the last owner of this agency. Promote another member first.'
          using errcode = '42501';
      end if;
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.role = 'owner' and new.role <> 'owner' then
    select count(*) into remaining_owners
    from public.agency_members
    where agency_id = old.agency_id
      and role = 'owner'
      and id <> old.id;
    if remaining_owners < 1 then
      raise exception 'Cannot demote the last owner of this agency. Promote another member first.'
        using errcode = '42501';
    end if;
  end if;

  return coalesce(new, old);
end;
$$;

create trigger agency_members_self_protection
  before delete or update on public.agency_members
  for each row execute function public.enforce_agency_member_guards();

comment on function public.enforce_tenant_member_guards is
  'Blocks self-removal and last-owner removal/demote. Bypassed during cascading parent deletes via clint.member_guard_cascade.';
comment on function public.enforce_space_member_guards is
  'Blocks self-removal and last-owner removal/demote. Bypassed during cascading parent deletes via clint.member_guard_cascade.';
comment on function public.enforce_agency_member_guards is
  'Blocks self-removal and last-owner removal/demote. Bypassed during cascading parent deletes via clint.member_guard_cascade.';
