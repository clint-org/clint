---
surface: Branded Invite Emails
spec: docs/superpowers/specs/2026-04-27-whitelabel-design.md
---

# Branded Invite Emails

When `tenantService.inviteMember()` inserts a row into `tenant_invites`, a Supabase database webhook triggers the `send-invite-email` Edge Function (Deno), which:
- Verifies the `webhook-signature` header against `EMAIL_WEBHOOK_SECRET`
- Reads tenant brand fields (`app_display_name`, `logo_url`, `primary_color`, `email_from_name`, `subdomain`/`custom_domain`) via the service-role client
- Composes HTML + plain-text bodies with brand color tinting and the tenant logo
- POSTs to Resend (`https://api.resend.com/emails`) with sender `noreply@yourproduct.com` and per-tenant display name
- The accept URL points at the tenant subdomain or custom domain: `https://{subdomain}.{apex}/onboarding?code={invite_code}`

The existing manual code-sharing flow stays functional — agency owners can copy invite codes from tenant settings if delivery fails.

## Capabilities

```yaml
- id: invite-email-webhook
  summary: Supabase database webhook fires on tenant_invites insert and calls the send-invite-email Edge Function.
  routes: []
  rpcs: []
  tables:
    - tenant_invites
  related:
    - tenant-invites
  user_facing: false
  role: owner
  status: active
- id: invite-email-rendering
  summary: Edge Function composes HTML and plain-text bodies with tenant logo, primary-color tinting, and per-tenant display name.
  routes: []
  rpcs: []
  tables:
    - tenants
    - tenant_invites
  related:
    - whitelabel-tenant-branding
  user_facing: false
  role: owner
  status: active
- id: invite-email-delivery
  summary: POST to Resend with sender noreply at yourproduct.com and accept URL routed to the tenant subdomain or custom domain.
  routes:
    - /onboarding
  rpcs: []
  tables:
    - tenant_invites
  related:
    - tenant-invites
  user_facing: true
  role: viewer
  status: active
- id: invite-email-manual-fallback
  summary: Agency owners can copy invite codes from tenant settings if delivery fails.
  routes:
    - /admin/tenants/:id
  rpcs: []
  tables:
    - tenant_invites
  related:
    - agency-portal-tenants
  user_facing: true
  role: agency
  status: active
```
