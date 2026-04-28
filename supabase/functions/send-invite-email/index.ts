// supabase/functions/send-invite-email/index.ts
//
// Edge Function: send-invite-email
//
// Triggered by a Supabase database webhook on INSERT into public.tenant_invites.
// Reads the tenant's brand fields, composes a branded HTML + plain-text invite
// email, and dispatches it via Resend.
//
// Auth model: shared-secret. The webhook configured in Supabase Dashboard adds
// a `webhook-signature` header whose value must match EMAIL_WEBHOOK_SECRET.
// `verify_jwt = false` for this function (see supabase/config.toml).
//
// Logs: minimal traces only. NEVER log the recipient email or the invite code.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface TenantBrand {
  app_display_name: string;
  logo_url: string | null;
  primary_color: string;
  email_from_name: string | null;
  subdomain: string | null;
  custom_domain: string | null;
}

interface InviteRow {
  id: string;
  tenant_id: string;
  email: string;
  role: string;
  invite_code: string;
  expires_at: string;
}

interface WebhookPayload {
  type?: string;
  table?: string;
  record?: Partial<InviteRow> & Record<string, unknown>;
}

interface ResendResponse {
  id?: string;
  message?: string;
}

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let mismatch = 0;
  for (let i = 0; i < a.length; i++) {
    mismatch |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return mismatch === 0;
}

function escape(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function buildAcceptUrl(tenant: TenantBrand, inviteCode: string, baseUrl: string): string {
  // Pragmatic v1:
  //   - Prefer custom_domain if set
  //   - Else <subdomain>.<apex from EMAIL_BASE_URL>
  //   - Else fall back to EMAIL_BASE_URL itself
  const code = encodeURIComponent(inviteCode);
  if (tenant.custom_domain) {
    return `https://${tenant.custom_domain}/onboarding?code=${code}`;
  }
  if (tenant.subdomain) {
    let apexHost = '';
    try {
      apexHost = new URL(baseUrl).host;
    } catch {
      apexHost = '';
    }
    if (apexHost) {
      return `https://${tenant.subdomain}.${apexHost}/onboarding?code=${code}`;
    }
  }
  // Last-ditch fallback: query-string code on the apex.
  const trimmed = baseUrl.replace(/\/+$/, '');
  return `${trimmed}/onboarding?code=${code}`;
}

function buildHtmlBody(tenant: TenantBrand, invite: InviteRow, acceptUrl: string): string {
  const primary = tenant.primary_color || '#0d9488';
  const logo = tenant.logo_url
    ? `<img src="${escape(tenant.logo_url)}" alt="${escape(tenant.app_display_name)}" style="max-height: 48px; max-width: 240px; margin-bottom: 24px;" />`
    : '';
  const expiresIso = invite.expires_at;
  return `<!doctype html>
<html><body style="margin:0; padding:0; background-color:#f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
  <table cellpadding="0" cellspacing="0" border="0" width="100%" style="background-color:#f8fafc; padding: 32px 0;">
    <tr><td align="center">
      <table cellpadding="0" cellspacing="0" border="0" width="540" style="background-color:#ffffff; border:1px solid #e2e8f0;">
        <tr><td style="padding: 40px 48px;">
          ${logo}
          <h1 style="margin:0; color:${primary}; font-size:18px; font-weight:600;">You're invited to ${escape(tenant.app_display_name)}</h1>
          <p style="margin: 16px 0 0; color:#334155; font-size:14px; line-height:1.6;">
            You have been invited as a <strong>${escape(invite.role)}</strong>. Click the button below to accept and create your account.
          </p>
          <p style="margin: 32px 0;">
            <a href="${escape(acceptUrl)}" style="background-color:${primary}; color:#ffffff; text-decoration:none; padding:12px 24px; font-size:14px; font-weight:500; display:inline-block;">Accept invite</a>
          </p>
          <p style="margin: 16px 0 0; color:#64748b; font-size:12px;">
            Or paste this code: <code style="background-color:#f1f5f9; padding:2px 6px;">${escape(invite.invite_code)}</code>
          </p>
          <p style="margin: 16px 0 0; color:#64748b; font-size:12px;">
            This invite expires on ${escape(new Date(expiresIso).toUTCString())}.
          </p>
        </td></tr>
      </table>
      <p style="margin-top: 16px; color:#94a3b8; font-size:11px; font-family: -apple-system, BlinkMacSystemFont, sans-serif;">
        Sent by ${escape(tenant.app_display_name)}
      </p>
    </td></tr>
  </table>
</body></html>`;
}

function buildTextBody(tenant: TenantBrand, invite: InviteRow, acceptUrl: string): string {
  return `You're invited to ${tenant.app_display_name}

You have been invited as a ${invite.role}.

Accept the invite by visiting: ${acceptUrl}

Or paste this code into the join screen: ${invite.invite_code}

This invite expires on ${new Date(invite.expires_at).toUTCString()}.

— ${tenant.app_display_name}
`;
}

serve(async (req: Request) => {
  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const expectedSecret = Deno.env.get('EMAIL_WEBHOOK_SECRET') || '';
  const presentedSecret = req.headers.get('webhook-signature') || '';
  if (!expectedSecret || !presentedSecret || !constantTimeEqual(expectedSecret, presentedSecret)) {
    return json(401, { error: 'unauthorized' });
  }

  let payload: WebhookPayload;
  try {
    payload = (await req.json()) as WebhookPayload;
  } catch {
    return json(200, { skipped: 'invalid json' });
  }

  const record = payload.record ?? {};
  const tenantId = typeof record.tenant_id === 'string' ? record.tenant_id : '';
  const email = typeof record.email === 'string' ? record.email : '';
  const role = typeof record.role === 'string' ? record.role : '';
  const inviteCode = typeof record.invite_code === 'string' ? record.invite_code : '';
  const expiresAt = typeof record.expires_at === 'string' ? record.expires_at : '';
  const inviteId = typeof record.id === 'string' ? record.id : '';

  if (!tenantId || !email || !role || !inviteCode || !expiresAt) {
    return json(200, { skipped: 'missing fields' });
  }

  const invite: InviteRow = {
    id: inviteId,
    tenant_id: tenantId,
    email,
    role,
    invite_code: inviteCode,
    expires_at: expiresAt,
  };

  const supabaseUrl = Deno.env.get('SUPABASE_URL') || '';
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') || '';
  if (!supabaseUrl || !serviceRoleKey) {
    console.log('send-invite-email: missing supabase env');
    return json(500, { error: 'server_misconfigured' });
  }

  const client = createClient(supabaseUrl, serviceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const { data: tenant, error: tenantErr } = await client
    .from('tenants')
    .select('app_display_name, logo_url, primary_color, email_from_name, subdomain, custom_domain')
    .eq('id', tenantId)
    .single();

  if (tenantErr || !tenant) {
    console.log('send-invite-email: tenant lookup failed', tenantErr?.code ?? 'no_row');
    return json(200, { skipped: 'tenant gone' });
  }

  const brand: TenantBrand = {
    app_display_name: tenant.app_display_name ?? 'your team',
    logo_url: tenant.logo_url ?? null,
    primary_color: tenant.primary_color ?? '#0d9488',
    email_from_name: tenant.email_from_name ?? null,
    subdomain: tenant.subdomain ?? null,
    custom_domain: tenant.custom_domain ?? null,
  };

  const baseUrl = Deno.env.get('EMAIL_BASE_URL') || 'https://yourproduct.com';
  const fromAddress = Deno.env.get('EMAIL_FROM') || 'noreply@yourproduct.com';
  const resendApiKey = Deno.env.get('RESEND_API_KEY') || '';
  if (!resendApiKey) {
    console.log('send-invite-email: missing RESEND_API_KEY');
    return json(500, { error: 'server_misconfigured' });
  }

  const acceptUrl = buildAcceptUrl(brand, invite.invite_code, baseUrl);
  const html = buildHtmlBody(brand, invite, acceptUrl);
  const text = buildTextBody(brand, invite, acceptUrl);
  const fromName = brand.email_from_name || brand.app_display_name;

  const resendRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${resendApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: `${fromName} <${fromAddress}>`,
      to: invite.email,
      subject: `You're invited to ${brand.app_display_name}`,
      html,
      text,
    }),
  });

  if (!resendRes.ok) {
    const errBody = await resendRes.text();
    console.log('send-invite-email: resend non-2xx', resendRes.status, errBody.slice(0, 200));
    return json(502, { error: 'resend_failed', status: resendRes.status });
  }

  let body: ResendResponse = {};
  try {
    body = (await resendRes.json()) as ResendResponse;
  } catch {
    // ignore -- Resend returned 2xx without parseable body
  }

  console.log('send-invite-email: sent', { tenant_id: tenantId, invite_id: inviteId, resend_id: body.id });
  return json(200, { sent: true, id: body.id ?? null });
});
