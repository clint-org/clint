---
surface: Super-Admin Portal
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Super-Admin Portal

The platform owner's UI for provisioning agencies, registering custom domains, and supervising the install. Mounted at `/super-admin/*`; gated by `superAdminGuard` (kind === `super-admin`) + `authGuard`. Non-admins get a 404-equivalent redirect (do not leak existence of the area).

| Route | Component | Purpose |
|---|---|---|
| `/super-admin/agencies` | `super-admin-agencies` | All agencies; "Provision agency" dialog (name, slug, subdomain, owner email, contact email). Owner email need not be a registered user — if no `auth.users` row matches, an `agency_invites` row is held and `handle_new_user` promotes it on first sign-in. Per-row trash action opens a typed-name confirmation dialog and calls `delete_agency` (refused if any tenants are still attached) |
| `/super-admin/tenants` | `super-admin-tenants` | All tenants across all agencies; filter by agency; register custom domain dialog |
| `/super-admin/domains` | `super-admin-domains` | Retired-hostnames hold list (90-day decommissioning window). Per-row "Release" action calls `release_retired_hostname` for super-admin override (use only after a deliberate super-admin delete; real customer decommissions should keep the holdback) |

Bootstrap is `INSERT INTO platform_admins (user_id) VALUES ('<uuid>')` via SQL — there is no UI to add platform admins.

## Capabilities

```yaml
- id: super-admin-shell
  summary: Super-admin portal mounted at /super-admin/*, gated by superAdminGuard with 404-equivalent redirect for non-admins.
  routes:
    - /super-admin
  rpcs:
    - is_platform_admin
  tables:
    - platform_admins
  related:
    - whitelabel-host-kinds
  user_facing: true
  role: super-admin
  status: active
- id: super-admin-agencies
  summary: Provision and delete agencies, with held-invite promotion for first sign-in and tenants-attached refusal on delete.
  routes:
    - /super-admin/agencies
  rpcs:
    - provision_agency
    - delete_agency
    - handle_new_user
    - check_subdomain_available
  tables:
    - agencies
    - agency_invites
    - agency_members
  related:
    - agency-portal-shell
  user_facing: true
  role: super-admin
  status: active
- id: super-admin-tenants
  summary: All tenants across all agencies, filter by agency, register custom domain dialog.
  routes:
    - /super-admin/tenants
  rpcs:
    - register_custom_domain
  tables:
    - tenants
  related:
    - agency-portal-tenants
    - whitelabel-custom-domain
  user_facing: true
  role: super-admin
  status: active
- id: super-admin-domains
  summary: 90-day retired-hostnames hold list with per-row Release action for super-admin overrides.
  routes:
    - /super-admin/domains
  rpcs:
    - release_retired_hostname
    - retire_hostname_on_change
  tables:
    - retired_hostnames
  related:
    - whitelabel-custom-domain
  user_facing: true
  role: super-admin
  status: active
- id: super-admin-audit-log
  summary: Platform-wide audit log view for super-admins.
  routes:
    - /super-admin/audit-log
  rpcs:
    - list_audit_events
    - export_audit_events_csv
    - record_audit_event
  tables:
    - audit_events
  related:
    - agency-portal-audit-log
  user_facing: true
  role: super-admin
  status: active
- id: super-admin-platform-admins
  summary: SQL-only bootstrap of platform_admins; no UI for grants.
  routes: []
  rpcs:
    - is_platform_admin
  tables:
    - platform_admins
  related: []
  user_facing: false
  role: super-admin
  status: active
```
