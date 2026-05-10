-- migration: 20260510000200_is_tenant_owner_strict
-- purpose: visibility helper for audit_events RLS. unlike is_tenant_member,
--   does NOT cascade from agency-owner or platform-admin. used by the
--   strict-scope visibility model: agency owners do not implicitly see
--   tenant-scoped audit rows.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (RLS section)

create or replace function public.is_tenant_owner_strict(p_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  -- tenant_members.role is constrained to 'owner' (see runbook 09-multi-tenant-model.md).
  -- any row here is by definition an owner row.
  select exists (
    select 1 from public.tenant_members tm
    where tm.tenant_id = p_tenant_id
      and tm.user_id   = auth.uid()
  );
$$;

revoke all on function public.is_tenant_owner_strict(uuid) from public;
grant execute on function public.is_tenant_owner_strict(uuid) to authenticated;
