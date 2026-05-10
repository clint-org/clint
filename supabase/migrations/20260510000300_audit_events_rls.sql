-- migration: 20260510000300_audit_events_rls
-- purpose: enable RLS on audit_events with strict-scope owner-only visibility.
--   no INSERT/UPDATE/DELETE policies: those paths are blocked at the GRANT
--   layer and go through SECURITY DEFINER functions owned by audit_writer.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md (RLS section)

alter table public.audit_events enable row level security;

-- SELECT: strict-scope owners + platform admin
create policy "audit_events_select_strict_scope_owners"
  on public.audit_events
  for select
  to authenticated
  using (
    is_platform_admin()
    or (agency_id is not null and is_agency_member(agency_id, array['owner']))
    or (tenant_id  is not null and is_tenant_owner_strict(tenant_id))
    or (space_id   is not null and has_space_access(space_id, array['owner']))
  );

comment on policy "audit_events_select_strict_scope_owners" on public.audit_events is
  'Strict-scope owner visibility: each scope''s owner sees only that scope''s rows. No cascade. Platform admins see all.';
