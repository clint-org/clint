---
surface: Agency Portal
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Agency Portal

A self-serve portal where consulting firms manage their pharma client tenants. Mounted at `/admin/*` on agency subdomains; gated by `agencyGuard` (kind === `agency`) + `authGuard`.

| Route | Component | Purpose |
|---|---|---|
| `/admin/tenants` | `agency-tenant-list` | Filterable table of all tenants in the agency (logo, name, subdomain, member count, status) |
| `/admin/tenants/new` | `agency-tenant-new` | Provisioning wizard: name, subdomain (debounced live availability), primary color picker, first-user invite |
| `/admin/tenants/:id` | `agency-tenant-detail` | View / edit tenant branding, list members, "Open tenant" cross-host redirect |
| `/admin/members` | `agency-members` | Add agency members (email lookup via `lookup_user_by_email`), change roles, remove |
| `/admin/branding` | `agency-branding` | Edit the agency portal's own brand (display name, primary color, contact email) |

All writes go through SECURITY DEFINER RPCs; agency owners do all writes, agency members get read-only visibility across the agency's tenants.

## Capabilities

```yaml
- id: agency-portal-shell
  summary: Agency portal mounted at /admin/* on agency subdomains, gated by agencyGuard and authGuard.
  routes:
    - /admin
  rpcs:
    - is_agency_member
  tables:
    - agencies
    - agency_members
  related:
    - whitelabel-host-kinds
  user_facing: true
  role: agency
  status: active
- id: agency-portal-tenants
  summary: Filterable table of all tenants in the agency with logo, subdomain, member count, and status.
  routes:
    - /admin/tenants
    - /admin/tenants/:id
  rpcs:
    - update_tenant_branding
    - update_tenant_access
    - get_tenant_access_settings
  tables:
    - tenants
    - tenant_members
  related:
    - tenant-provisioning
  user_facing: true
  role: agency
  status: active
- id: agency-portal-tenant-new
  summary: Tenant provisioning wizard with debounced live subdomain availability and first-user invite.
  routes:
    - /admin/tenants/new
  rpcs:
    - provision_tenant
    - check_subdomain_available
  tables:
    - tenants
    - tenant_invites
  related:
    - tenant-provisioning
  user_facing: true
  role: agency
  status: active
- id: agency-portal-members
  summary: Add agency members by email lookup, change roles, and remove. Agency owners write; members read.
  routes:
    - /admin/members
  rpcs:
    - add_agency_member
    - lookup_user_by_email
    - enforce_agency_member_guards
  tables:
    - agency_members
    - agency_invites
  related: []
  user_facing: true
  role: agency
  status: active
- id: agency-portal-branding
  summary: Edit the agency portal's own brand (display name, primary color, contact email).
  routes:
    - /admin/branding
  rpcs:
    - update_agency_branding
  tables:
    - agencies
  related:
    - whitelabel-tenant-branding
  user_facing: true
  role: agency
  status: active
- id: agency-portal-audit-log
  summary: Agency-portal audit log view.
  routes:
    - /admin/audit-log
  rpcs:
    - list_audit_events
    - export_audit_events_csv
  tables:
    - audit_events
  related:
    - super-admin-audit-log
  user_facing: true
  role: agency
  status: active
```
