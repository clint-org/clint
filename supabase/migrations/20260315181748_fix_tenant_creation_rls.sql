-- fix tenant creation RLS: the original policy for tenant_members INSERT
-- required the user to already be a tenant owner, but when creating the
-- first tenant the creator needs to insert themselves as the first member.
--
-- fix: allow a user to insert themselves as a member of a tenant that has
-- no members yet (bootstrapping), OR if they're already an owner.

drop policy if exists "tenant owners can add members" on public.tenant_members;

create policy "users can add tenant members"
on public.tenant_members for insert to authenticated
with check (
  -- case 1: user is adding themselves as the first member (tenant bootstrap)
  (
    user_id = auth.uid()
    and not exists (
      select 1 from public.tenant_members existing
      where existing.tenant_id = tenant_members.tenant_id
    )
  )
  -- case 2: user is a tenant owner adding someone
  or public.is_tenant_member(tenant_id, array['owner'])
);

-- also fix: allow users to read tenants they just created (before member row exists)
-- the current SELECT policy requires is_tenant_member which fails during the
-- create flow. Use a simpler approach: allow SELECT on tenants where the user
-- is referenced in tenant_members.
-- (the existing policy already works, the issue is just the INSERT flow)

-- fix space_members: allow a user to add themselves as the first member of a
-- space they just created
drop policy if exists "space owners and tenant owners can add members" on public.space_members;

create policy "users can add space members"
on public.space_members for insert to authenticated
with check (
  -- case 1: user is adding themselves as first member (space bootstrap)
  (
    user_id = auth.uid()
    and not exists (
      select 1 from public.space_members existing
      where existing.space_id = space_members.space_id
    )
  )
  -- case 2: user is a space owner or tenant owner
  or public.has_space_access(space_id, array['owner'])
);
