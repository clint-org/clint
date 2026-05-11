-- migration: 20260510002500_audit_drop_scope_fks
-- purpose: drop foreign key constraints on audit_events.agency_id, tenant_id,
--   space_id. these were over-specified in the original schema and cause
--   INSERT failures during cascade scenarios (e.g., space DELETE cascading to
--   space_members fires the audit trigger which tries to insert an audit row
--   referencing the space mid-delete -- the FK check fails because the spaces
--   row is partway through removal).
--
--   audit logs are forensic point-in-time records. they should preserve the
--   scope UUIDs even after the referenced entity is gone. analytical joins
--   that still want to resolve a current scope can LEFT JOIN; the audit row
--   alone remains valid evidence.
--
--   actor_user_id keeps its FK to auth.users because GDPR redaction
--   (redact_user_pii) is the supported path for clearing user references,
--   and the on-delete-set-null behavior already handles auth.users row
--   deletion.
-- spec: docs/superpowers/specs/2026-05-10-audit-log-design.md

alter table public.audit_events
  drop constraint if exists audit_events_agency_id_fkey,
  drop constraint if exists audit_events_tenant_id_fkey,
  drop constraint if exists audit_events_space_id_fkey;

comment on column public.audit_events.agency_id is
  'Scope: agency context for this event (forensic record). Not a foreign key, intentionally; preserves the UUID after the agency is gone.';
comment on column public.audit_events.tenant_id is
  'Scope: tenant context for this event (forensic record). Not a foreign key, intentionally; preserves the UUID after the tenant is gone.';
comment on column public.audit_events.space_id is
  'Scope: space context for this event (forensic record). Not a foreign key, intentionally; preserves the UUID after the space is gone.';
