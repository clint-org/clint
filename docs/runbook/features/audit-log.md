---
surface: Audit Log
spec: docs/superpowers/specs/2026-05-10-audit-log-design.md
---

# Audit Log

A platform-wide tamper-resistant audit trail of Tier 1 admin, security, governance, and membership events. Every privileged RPC writes a row via `record_audit_event()` and is enforced by the `20260510002000_audit_coverage_smoke.sql` migration. Surfaces span tenant-level, agency-level, and super-admin-level views.

The same `audit_events` table is read at four levels:

- **Tenant settings audit log** (`/t/:tenantId/s/:spaceId/settings/audit-log` and `/t/:tenantId/settings/audit-log`): events scoped to the tenant's spaces and members.
- **Agency portal audit log** (`/admin/audit-log`): events across all tenants in the agency.
- **Super-admin audit log** (`/super-admin/audit-log`): platform-wide visibility.
- **CSV export**: each view can export a filtered slice of events to CSV via `export_audit_events_csv`.

The pipeline is enforced by:

- `record_audit_event()` -- canonical writer called by every Tier 1 RPC; carries the `-- @audit:tier1` marker.
- `_audit_trigger_*` family -- BEFORE/AFTER triggers on `tenant_members`, `agency_members`, `space_members`, `tenant_invites`, `space_invites`, `platform_admins`, `retired_hostnames`, and tenant-suspension changes.
- `_audit_trigger_should_skip()` -- shared guard that suppresses recursive trigger fires during cascade operations marked by `member_guard_mark_cascade_start` / `member_guard_mark_cascade_end`.
- `redact_user_pii()` / `jsonb_strip_pii_keys()` -- PII redaction utilities applied at write or export time.

## Capabilities

```yaml
- id: audit-record-event
  summary: Canonical Tier 1 writer that every privileged RPC calls to append a row to audit_events.
  routes: []
  rpcs:
    - record_audit_event
  tables:
    - audit_events
  related: []
  user_facing: false
  role: super-admin
  status: active
- id: audit-tenant-settings
  summary: Tenant-scoped audit log view at tenant settings, filtered to events touching this tenant.
  routes:
    - /t/:tenantId/s/:spaceId/settings/audit-log
    - /t/:tenantId/settings/audit-log
  rpcs:
    - list_audit_events
  tables:
    - audit_events
  related:
    - audit-record-event
  user_facing: true
  role: owner
  status: active
- id: audit-agency-portal
  summary: Agency-portal audit log view across all tenants in the agency.
  routes:
    - /admin/audit-log
  rpcs:
    - list_audit_events
    - export_audit_events_csv
  tables:
    - audit_events
  related:
    - audit-record-event
  user_facing: true
  role: agency
  status: active
- id: audit-super-admin
  summary: Super-admin audit log view with platform-wide visibility.
  routes:
    - /super-admin/audit-log
  rpcs:
    - list_audit_events
    - export_audit_events_csv
  tables:
    - audit_events
  related:
    - audit-record-event
  user_facing: true
  role: super-admin
  status: active
- id: audit-csv-export
  summary: CSV export of a filtered audit-event slice, shared across all three audit log views.
  routes: []
  rpcs:
    - export_audit_events_csv
  tables:
    - audit_events
  related:
    - audit-tenant-settings
    - audit-agency-portal
    - audit-super-admin
  user_facing: true
  role: owner
  status: active
- id: audit-membership-triggers
  summary: BEFORE/AFTER triggers on tenant_members, agency_members, space_members, and platform_admins that emit audit events.
  routes: []
  rpcs:
    - _audit_trigger_tenant_members
    - _audit_trigger_agency_members
    - _audit_trigger_space_members
    - _audit_trigger_platform_admins
    - _audit_trigger_should_skip
  tables:
    - audit_events
    - tenant_members
    - agency_members
    - space_members
    - platform_admins
  related:
    - audit-record-event
  user_facing: false
  role: super-admin
  status: active
- id: audit-invite-triggers
  summary: Triggers on tenant_invites and space_invites that record invite-issued audit rows.
  routes: []
  rpcs:
    - _audit_trigger_tenant_invite_issued
    - _audit_trigger_space_invite_issued
  tables:
    - audit_events
    - tenant_invites
    - space_invites
  related:
    - audit-record-event
  user_facing: false
  role: super-admin
  status: active
- id: audit-tenant-suspension-trigger
  summary: Trigger on tenant suspension changes that records lifecycle events.
  routes: []
  rpcs:
    - _audit_trigger_tenant_suspension
  tables:
    - audit_events
    - tenants
  related:
    - audit-record-event
  user_facing: false
  role: super-admin
  status: active
- id: audit-retired-hostnames-trigger
  summary: Trigger on retired_hostnames changes that records hostname decommission events.
  routes: []
  rpcs:
    - _audit_trigger_retired_hostnames
  tables:
    - audit_events
    - retired_hostnames
  related:
    - audit-record-event
    - super-admin-domains
  user_facing: false
  role: super-admin
  status: active
- id: audit-cascade-guard
  summary: Cascade-marker helpers that suppress recursive trigger fires during multi-row member updates.
  routes: []
  rpcs:
    - member_guard_mark_cascade_start
    - member_guard_mark_cascade_end
    - _audit_trigger_should_skip
  tables: []
  related:
    - audit-membership-triggers
  user_facing: false
  role: super-admin
  status: active
- id: audit-pii-redaction
  summary: PII redaction utilities applied at write or export time on audit payloads.
  routes: []
  rpcs:
    - redact_user_pii
    - jsonb_strip_pii_keys
  tables:
    - audit_events
  related:
    - audit-record-event
  user_facing: false
  role: super-admin
  status: active
```
