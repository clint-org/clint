---
surface: Whitelabel Brand Resolution
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Whitelabel Brand Resolution

Every request resolves the visitor's identity from the host header before bootstrap, via the anon-callable RPC `get_brand_by_host(p_host)`:

| Host | Kind | Effect |
|---|---|---|
| `pfizer.yourproduct.com` (matches `tenants.subdomain`) | `tenant` | Renders tenant app, branded with that tenant |
| `competitive.pfizer.com` (matches `tenants.custom_domain`) | `tenant` | Same, via sales-led custom domain |
| `zs.yourproduct.com` (matches `agencies.subdomain`) | `agency` | Renders agency portal at `/admin/*` |
| `admin.yourproduct.com` | `super-admin` | Reserved subdomain, super-admin only |
| `yourproduct.com` (apex) | `default` | Marketing landing for unauthenticated visitors; legacy onboarding for direct customers |

`main.ts` synchronously sets `--brand-50..950` CSS vars, swaps the favicon, sets `document.title`, and builds a dynamic PrimeNG preset before bootstrapping Angular. The Tailwind `@theme` block in `styles.css` declares `--color-brand-*` tokens that fall back to the teal scale, so tenants without a brand override render identically to today.

## Capabilities

```yaml
- id: whitelabel-brand-fetch
  summary: Pre-bootstrap anon RPC resolves host header to a brand record (tenant, agency, super-admin, or default).
  routes: []
  rpcs:
    - get_brand_by_host
  tables:
    - tenants
    - agencies
  related: []
  user_facing: false
  role: viewer
  status: active
- id: whitelabel-dynamic-preset
  summary: main.ts sets brand CSS variables, favicon, document.title, and builds a dynamic PrimeNG preset before bootstrap.
  routes: []
  rpcs:
    - get_brand_by_host
  tables: []
  related:
    - whitelabel-brand-fetch
  user_facing: true
  role: viewer
  status: active
- id: whitelabel-host-kinds
  summary: Host header maps to one of four brand kinds (tenant, agency, super-admin, default) driving routing and theming.
  routes: []
  rpcs:
    - get_brand_by_host
  tables:
    - tenants
    - agencies
  related:
    - agency-portal-shell
    - super-admin-shell
    - marketing-landing-page
  user_facing: false
  role: viewer
  status: active
- id: whitelabel-custom-domain
  summary: Sales-led custom domains for tenants resolved via tenants.custom_domain alongside subdomain.
  routes: []
  rpcs:
    - register_custom_domain
    - enforce_custom_domain_unique_across_tables
    - enforce_subdomain_unique_across_tables
    - retire_hostname_on_change
  tables:
    - tenants
    - retired_hostnames
  related:
    - super-admin-domains
  user_facing: false
  role: super-admin
  status: active
- id: whitelabel-tenant-branding
  summary: Tenant owner edits to display name, primary color, logo, contact email apply across all surfaces and exports.
  routes:
    - /t/:tenantId/settings
  rpcs:
    - update_tenant_branding
    - get_tenant_access_settings
    - update_tenant_access
  tables:
    - tenants
  related:
    - whitelabel-dynamic-preset
    - branded-login-page
    - invite-email-rendering
    - pptx-export-branded
  user_facing: true
  role: owner
  status: active
```
