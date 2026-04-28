-- migration: 20260428040700_whitelabel_update_has_space_access
-- purpose: extend has_space_access with three new behaviors while preserving
--   the existing tenant-member implicit-space-access fallback added in
--   20260428033206 (tenant 'member' satisfies editor/viewer checks):
--   1. agency owner of the tenant's parent agency: full access regardless
--      of p_roles (equivalent to tenant owner).
--   2. agency member of the tenant's parent agency: viewer-only access
--      (passes only when p_roles is null or includes 'viewer').
--   3. tenant suspension: when tenants.suspended_at is non-null, write checks
--      (where p_roles intersects {owner, editor}) short-circuit to false.
--      reads still work so users can export their data and the ui can show
--      a suspended banner.
--   4. platform admin: read-side bypass.

create or replace function public.has_space_access(
  p_space_id uuid,
  p_roles    text[] default null
)
returns boolean
language plpgsql
security definer
stable
set search_path = ''
as $$
declare
  v_tenant_id  uuid;
  v_agency_id  uuid;
  v_suspended  boolean;
  v_uid        uuid := auth.uid();
  v_is_write   boolean;
begin
  -- look up tenancy and suspension state once
  select s.tenant_id, t.agency_id, (t.suspended_at is not null)
    into v_tenant_id, v_agency_id, v_suspended
    from public.spaces s
    join public.tenants t on t.id = s.tenant_id
   where s.id = p_space_id;

  if v_tenant_id is null then
    return false;
  end if;

  -- write checks against a suspended tenant fail
  v_is_write := p_roles is not null and (
    'owner'  = any(p_roles) or
    'editor' = any(p_roles)
  );
  if v_suspended and v_is_write then
    return false;
  end if;

  -- platform admin: read-side bypass (writes still go through write rpcs)
  if not v_is_write and public.is_platform_admin() then
    return true;
  end if;

  -- explicit space membership; the role on the space_members row is the
  -- authority when present.
  if exists (
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id  = v_uid
      and (p_roles is null or sm.role = any(p_roles))
  ) then
    return true;
  end if;

  -- implicit access via tenant membership (mirrors 20260428033206):
  --   * tenant 'owner' satisfies any role check, including owner-only checks.
  --   * tenant 'member' satisfies any check that allows 'editor' or 'viewer',
  --     i.e. all read and most write paths. Owner-only checks still exclude
  --     tenant members.
  if exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = v_tenant_id
      and tm.user_id   = v_uid
      and (
        p_roles is null
        or tm.role = 'owner'
        or 'editor' = any(p_roles)
        or 'viewer' = any(p_roles)
      )
  ) then
    return true;
  end if;

  -- agency owner of parent agency: full access (mirrors tenant owner).
  if v_agency_id is not null and exists (
    select 1 from public.agency_members am
    where am.agency_id = v_agency_id
      and am.user_id   = v_uid
      and am.role      = 'owner'
  ) then
    return true;
  end if;

  -- agency member of parent agency: viewer-only.
  if v_agency_id is not null
     and (p_roles is null or 'viewer' = any(p_roles))
     and exists (
       select 1 from public.agency_members am
       where am.agency_id = v_agency_id
         and am.user_id   = v_uid
         and am.role      = 'member'
     ) then
    return true;
  end if;

  return false;
end;
$$;

comment on function public.has_space_access(uuid, text[]) is
  'RLS helper. True when the calling user can access the given space at one '
  'of p_roles. Authority cascade: explicit space member > tenant owner '
  '(full) > tenant member (editor/viewer) > agency owner (full) > agency '
  'member (viewer-only) > platform admin (read). Writes against a suspended '
  'tenant always return false. Replaces 20260428033206 in place.';
