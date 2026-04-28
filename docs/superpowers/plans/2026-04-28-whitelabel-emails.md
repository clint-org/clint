# Whitelabel Unit 7: Branded Invite Emails

**Date:** 2026-04-28
**Branch:** `feature/whitelabel-emails`
**Depends on:** Units 1-6 (schema with brand columns + tenant_invites, agency portal that issues invites)

## Goal

When `tenantService.inviteMember()` inserts a row into `public.tenant_invites`, automatically send a branded HTML + plain-text invite email to the recipient. The email pulls the tenant's brand fields (`app_display_name`, `logo_url`, `primary_color`, `email_from_name`, `subdomain`, `custom_domain`) so the recipient sees the consultancy / customer brand, not the platform brand.

Today, invite codes are shared manually -- this unit closes that gap.

## Architecture

```
tenantService.inviteMember()
  -> INSERT public.tenant_invites
      -> Supabase Database Webhook (configured in Studio)
          -> POST https://<ref>.supabase.co/functions/v1/send-invite-email
              -> verify webhook-signature header == EMAIL_WEBHOOK_SECRET
              -> read tenant brand via service-role client
              -> compose HTML + text bodies (inline styles, brand color)
              -> POST https://api.resend.com/emails
              -> 200 { sent, id } | 502 (Resend error) | 401 | 405
```

The function is the only new server-side surface. The Angular app does not change. RLS does not change. The DB webhook is configured in the remote Supabase Dashboard (database webhooks aren't fully expressible in the local emulator's `config.toml`).

## File structure

```
supabase/functions/send-invite-email/
  index.ts          # Deno-runtime handler: verify, lookup, compose, send
```

No `import_map.json`; URL imports only.

## Required Edge Function env vars

| Var                          | Source                       | Purpose                                                     |
|------------------------------|------------------------------|-------------------------------------------------------------|
| `RESEND_API_KEY`             | `supabase secrets set`       | Bearer token for `https://api.resend.com/emails`            |
| `EMAIL_WEBHOOK_SECRET`       | `supabase secrets set`       | Shared secret matched against the `webhook-signature` header |
| `EMAIL_FROM`                 | `supabase secrets set`       | Sender mailbox; defaults to `noreply@yourproduct.com`        |
| `EMAIL_BASE_URL`             | `supabase secrets set`       | Apex used to build accept-invite URL; defaults to `https://yourproduct.com` |
| `SUPABASE_URL`               | injected by Supabase runtime | Service-role client target                                  |
| `SUPABASE_SERVICE_ROLE_KEY`  | injected by Supabase runtime | Bypasses RLS to read tenant brand row                       |

## User pre-work for plan 7

Before the function will deliver real mail in production:

1. Create a Resend account; verify a sender domain (DKIM + SPF DNS records).
2. Set the function secrets in Supabase:
   ```bash
   supabase secrets set RESEND_API_KEY=re_...
   supabase secrets set EMAIL_WEBHOOK_SECRET=$(openssl rand -hex 32)
   supabase secrets set EMAIL_FROM=noreply@yourproduct.com
   supabase secrets set EMAIL_BASE_URL=https://yourproduct.com
   ```
3. In Supabase Dashboard > Database > Webhooks: create a webhook on the `public.tenant_invites` table for `INSERT` events, pointing at `https://<project-ref>.supabase.co/functions/v1/send-invite-email`. Add HTTP header `webhook-signature: <same value as EMAIL_WEBHOOK_SECRET>`.
4. Deploy the function: `supabase functions deploy send-invite-email`.
5. Test by sending a test invite from the agency portal and checking the Resend dashboard + the recipient inbox.

## Function logic (high level)

1. Reject non-POST with 405.
2. Compare `webhook-signature` header to `EMAIL_WEBHOOK_SECRET` (length-then-equality). Missing or wrong -> 401 `{"error":"unauthorized"}`. No detail leak.
3. Parse JSON body, expect a Supabase database webhook payload: `{ type: "INSERT", table: "tenant_invites", record: { ... } }`.
4. Validate `record.tenant_id|email|role|invite_code|expires_at`. Missing -> 200 `{"skipped":"missing fields"}` (don't error, would trigger pointless retries).
5. Service-role select on `public.tenants` for the brand columns. Tenant gone -> 200 `{"skipped":"tenant gone"}`.
6. Build accept URL. Pragmatic v1: prefer `https://<custom_domain>` if set, else `https://<subdomain>.<EMAIL_BASE_URL host>`, else `EMAIL_BASE_URL` -- always with `?code=<invite_code>`.
7. Render HTML + plain-text bodies (inline styles, brand color for the headline + button).
8. POST to `https://api.resend.com/emails` with `from`, `to`, `subject`, `html`, `text`.
9. Resend non-2xx -> 502 with truncated error message. Supabase will retry; recipient receives at most 2 emails (acceptable for v1).
10. On success -> 200 `{"sent":true,"id":resend.id}`. `console.log` minimal trace -- never log recipient email or invite code.

## Tasks

1. Plan file (this).
2. Create `supabase/functions/send-invite-email/index.ts` with the full handler, type defs, HTML template, and text template.
3. Update `supabase/config.toml` to register `[functions.send-invite-email]` (`enabled = true`, `verify_jwt = false`).
4. Run `cd src/client && npx ng build` as repo-state smoke (no client changes expected).

One commit per task.

## Verification

- `git status` clean after each commit.
- `supabase/functions/send-invite-email/index.ts` is syntactically valid Deno-flavored TS (URL imports only; no `npm install` needed).
- `supabase/config.toml` parses (no runtime check locally; the deploy step does the real check).
- `ng build` succeeds.

## Out of scope

- **Supabase auth-system emails.** Welcome, password reset, magic link, and email-change emails stay generic for v1. They go through Supabase's own SMTP path, not this function. Branding them per-tenant requires templating in `auth.email.template.*` and is deferred.
- **Email open / click tracking.** No pixel, no click-tracking links. Add later if BD asks for it.
- **i18n.** English copy only.
- **Resend webhook ingestion** (delivery / bounce / complaint events). The function is fire-and-forget; we trust Resend's dashboard for delivery state in v1.
- **Local emulator delivery.** Running the webhook locally would require manually wiring an HTTP webhook in `config.toml`, which the local emulator does not support 1:1 with the dashboard. Local invite flows continue to surface the invite code in the UI; the email path is exercised in the remote project.
