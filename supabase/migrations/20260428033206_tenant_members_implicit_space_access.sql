-- migration: 20260428033206_tenant_members_implicit_space_access
-- purpose: tenant members joined via accept_invite were not getting access to
--   any spaces in the tenant. They could see space names (the spaces SELECT
--   policy allows any tenant member to see the list) but every data query
--   came back empty because every data RLS policy gates on has_space_access(),
--   and has_space_access() previously only granted access via:
--     1. an explicit space_members row, OR
--     2. tenant_members.role = 'owner'
--   Tenant 'member' role wasn't a path in.
-- approach: extend has_space_access() so any tenant member of the space's
--   tenant satisfies non-admin role checks. Tenant 'owner' continues to
--   satisfy any role (including 'owner'-only admin checks); tenant 'member'
--   satisfies anything that allows 'editor' or 'viewer'. Explicit
--   space_members rows still take precedence and can grant a higher role
--   (e.g. promoting a tenant member to space owner) or a lower one if we
--   add downgrade UI later.
-- affected objects:
--   public.has_space_access (function body replaced)

create or replace function public.has_space_access(
  p_space_id uuid,
  p_roles text[] default null
)
returns boolean
language sql
security definer
stable
set search_path = ''
as $$
  select exists (
    -- explicit space membership; the role on the space_members row is the
    -- authority when present.
    select 1 from public.space_members sm
    where sm.space_id = p_space_id
      and sm.user_id = auth.uid()
      and (p_roles is null or sm.role = any(p_roles))
  ) or exists (
    -- implicit access via tenant membership:
    --   * tenant 'owner' satisfies any role check, including 'owner'-only
    --     admin policies (matches the prior behavior).
    --   * tenant 'member' satisfies any check that allows 'editor' or
    --     'viewer', i.e. all read and most write paths. Owner-only checks
    --     still exclude tenant members.
    select 1 from public.spaces s
    join public.tenant_members tm on tm.tenant_id = s.tenant_id
    where s.id = p_space_id
      and tm.user_id = auth.uid()
      and (
        p_roles is null
        or tm.role = 'owner'
        or 'editor' = any(p_roles)
        or 'viewer' = any(p_roles)
      )
  );
$$;

comment on function public.has_space_access(uuid, text[]) is
  'Returns true if the caller can act on the given space at the requested role '
  'level. An explicit space_members row is the primary authority. As a fallback, '
  'tenant membership grants implicit access: tenant owners satisfy any role '
  'check, tenant members satisfy editor/viewer checks (so they can read and '
  'write data but not admin the space).';
