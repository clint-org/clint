---
surface: Multi-Tenant Workspaces
spec: docs/specs/tenants-and-spaces/spec.md
---

# Multi-Tenant Workspaces

See [Multi-Tenant Model](09-multi-tenant-model.md) for full details.

- Each **agency** is an optional consulting-firm parent that resells the platform to pharma clients
- Each **tenant** represents an organization (a pharma client of an agency, or a direct customer)
- Each **space** within a tenant is a firewalled engagement scoped to a domain (a therapy area, asset class, client team) — pipelines, catalysts, and portfolio reads all live inside, with their own members and data
- Members can be invited to tenants via invite codes (7-day expiry); branded HTML invite emails are delivered via Resend
- `tenant_members` and `agency_members` are owner-only since migration 75; spaces use owner / editor / viewer (rendered Owner / Contributor / Reader)
- Data isolation is per-space — no implicit cascade from tenant or agency level (firewall introduced in migration 75)

## Capabilities

```yaml
- id: tenant-provisioning
  summary: Owner-or-super-admin tenant creation with subdomain, branding fields, and first-user invite.
  routes:
    - /admin/tenants/new
  rpcs:
    - provision_tenant
    - check_subdomain_available
  tables:
    - tenants
    - tenant_members
    - tenant_invites
  related:
    - agency-portal-tenants
  user_facing: true
  role: agency
  status: active
- id: tenant-membership
  summary: Owner-only tenant_members with implicit space access via has_space_access.
  routes:
    - /t/:tenantId/settings
  rpcs:
    - add_tenant_owner
    - is_tenant_member
    - is_tenant_owner_strict
    - has_tenant_access
    - enforce_tenant_member_guards
  tables:
    - tenant_members
    - tenants
  related: []
  user_facing: true
  role: owner
  status: active
- id: tenant-invites
  summary: Invite codes with 7-day expiry, branded HTML email via Resend, accept_invite RPC promotes the invitee.
  routes:
    - /onboarding
  rpcs:
    - accept_invite
    - canonicalize_email
    - lookup_user_by_email
    - enforce_member_email_domain
  tables:
    - tenant_invites
    - tenant_members
  related:
    - invite-email-webhook
  user_facing: true
  role: viewer
  status: active
- id: space-lifecycle
  summary: Owner-driven create and delete of engagement spaces within a tenant.
  routes:
    - /t/:tenantId/spaces
  rpcs:
    - create_space
    - delete_space
  tables:
    - spaces
  related: []
  user_facing: true
  role: owner
  status: active
- id: space-membership
  summary: Space members with owner, editor, or viewer role and invite codes scoped to a single space.
  routes:
    - /t/:tenantId/s/:spaceId/settings/members
  rpcs:
    - invite_to_space
    - accept_space_invite
    - has_space_access
    - enforce_space_member_guards
  tables:
    - space_members
    - space_invites
  related:
    - in-app-help-roles
  user_facing: true
  role: owner
  status: active
- id: tenant-settings-general
  summary: Tenant-level general settings page for owners.
  routes:
    - /t/:tenantId/s/:spaceId/settings/general
    - /t/:tenantId/settings
  rpcs:
    - update_tenant_branding
  tables:
    - tenants
  related:
    - whitelabel-tenant-branding
  user_facing: true
  role: owner
  status: active
- id: tenant-settings-fields
  summary: Per-space field visibility configuration for the trials grid.
  routes:
    - /t/:tenantId/s/:spaceId/settings/fields
  rpcs:
    - update_space_field_visibility
  tables:
    - spaces
  related: []
  user_facing: true
  role: owner
  status: active
- id: tenant-settings-taxonomies
  summary: Space-scoped taxonomy management surface for therapeutic areas, MOAs, and ROAs.
  routes:
    - /t/:tenantId/s/:spaceId/settings/taxonomies
  rpcs:
    - get_space_tags
  tables:
    - therapeutic_areas
    - mechanisms_of_action
    - routes_of_administration
  related:
    - manage-therapeutic-areas
    - manage-mechanisms-of-action
    - manage-routes-of-administration
  user_facing: true
  role: owner
  status: active
- id: data-isolation-firewall
  summary: Per-space data isolation; no implicit cascade from tenant or agency level (firewall introduced in migration 75).
  routes: []
  rpcs:
    - has_space_access
  tables:
    - space_members
    - spaces
  related: []
  user_facing: false
  role: viewer
  status: active
```
