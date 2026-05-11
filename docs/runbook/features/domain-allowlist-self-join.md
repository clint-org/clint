---
surface: Domain-Allowlist Self-Join
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Domain-Allowlist Self-Join

Tenant owners can configure `email_domain_allowlist` (e.g., `pfizer.com`) and toggle `email_self_join_enabled`. When a user signs in to a tenant subdomain whose allowlist matches their email and self-join is enabled, the auth callback calls `self_join_tenant(p_subdomain)` and the user is auto-added at `member` role. UI lives in **Tenant Settings → Access**.

The RPC returns the **same generic error** for every failure mode (missing tenant, self-join off, allowlist mismatch, suspended tenant) to prevent enumeration of which subdomains exist and which corporate emails unlock them.

## Capabilities

```yaml
- id: self-join-tenant
  summary: Auto-add a signed-in user as tenant member when their email domain matches the tenant allowlist.
  routes:
    - /auth/callback
  rpcs:
    - self_join_tenant
    - canonicalize_email
  tables:
    - tenants
    - tenant_members
  related:
    - auth-callback
  user_facing: true
  role: viewer
  status: active
- id: self-join-settings
  summary: Tenant owner UI to configure email_domain_allowlist and toggle email_self_join_enabled.
  routes:
    - /t/:tenantId/settings
  rpcs:
    - get_tenant_access_settings
    - update_tenant_access
  tables:
    - tenants
  related:
    - tenant-settings-general
  user_facing: true
  role: owner
  status: active
- id: self-join-generic-error
  summary: RPC returns identical error for every failure mode to prevent subdomain or corporate-email enumeration.
  routes: []
  rpcs:
    - self_join_tenant
  tables:
    - tenants
  related:
    - self-join-tenant
  user_facing: false
  role: viewer
  status: active
```
