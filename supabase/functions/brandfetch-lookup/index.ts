// supabase/functions/brandfetch-lookup/index.ts
//
// Edge Function: brandfetch-lookup
//
// Called by authenticated users to fetch brand assets (logo, icon, colors)
// from the Brandfetch API given a company domain. Returns a normalized
// result the client can preview and apply to agency or tenant branding.
//
// Auth model: JWT (default verify_jwt = true). Only authenticated users
// can invoke this function.

import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';

interface BrandfetchLogo {
  type: string;
  theme: string;
  formats: Array<{
    src: string;
    format: string;
    width: number | null;
    height: number | null;
  }>;
}

interface BrandfetchColor {
  type: string;
  hex: string;
}

interface BrandfetchResponse {
  name?: string;
  domain?: string;
  logos?: BrandfetchLogo[];
  colors?: BrandfetchColor[];
}

interface BrandResult {
  name: string | null;
  domain: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });

function pickLogoUrl(logos: BrandfetchLogo[], type: string): string | null {
  const match = logos.find((l) => l.type === type && l.theme !== 'dark');
  if (!match || !match.formats.length) return null;
  const svg = match.formats.find((f) => f.format === 'svg');
  if (svg) return svg.src;
  const png = match.formats
    .filter((f) => f.format === 'png')
    .sort((a, b) => (b.width ?? 0) - (a.width ?? 0));
  return png[0]?.src ?? match.formats[0]?.src ?? null;
}

function pickColor(colors: BrandfetchColor[], type: string): string | null {
  const match = colors.find((c) => c.type === type);
  if (!match?.hex) return null;
  const hex = match.hex.startsWith('#') ? match.hex : `#${match.hex}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(hex)) return null;
  return hex.toLowerCase();
}

serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  if (req.method !== 'POST') {
    return json(405, { error: 'method_not_allowed' });
  }

  const apiKey = Deno.env.get('BRANDFETCH_API_KEY') || '';
  if (!apiKey) {
    console.log('brandfetch-lookup: missing BRANDFETCH_API_KEY');
    return json(500, { error: 'server_misconfigured' });
  }

  let domain: string;
  try {
    const body = await req.json();
    domain = typeof body.domain === 'string' ? body.domain.trim().toLowerCase() : '';
  } catch {
    return json(400, { error: 'invalid_json' });
  }

  if (!domain) {
    return json(400, { error: 'domain_required' });
  }

  // Strip protocol and path if the user pasted a full URL
  try {
    if (domain.includes('://')) {
      domain = new URL(domain).hostname;
    } else if (domain.includes('/')) {
      domain = domain.split('/')[0];
    }
  } catch {
    // keep as-is
  }

  const brandfetchUrl = `https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`;
  let bfRes: Response;
  try {
    bfRes = await fetch(brandfetchUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch (e) {
    console.log('brandfetch-lookup: fetch failed', (e as Error).message);
    return json(502, { error: 'brandfetch_unreachable' });
  }

  if (!bfRes.ok) {
    if (bfRes.status === 404) {
      return json(404, { error: 'domain_not_found', domain });
    }
    console.log('brandfetch-lookup: non-2xx', bfRes.status);
    return json(502, { error: 'brandfetch_error', status: bfRes.status });
  }

  let data: BrandfetchResponse;
  try {
    data = (await bfRes.json()) as BrandfetchResponse;
  } catch {
    return json(502, { error: 'brandfetch_invalid_response' });
  }

  const logos = data.logos ?? [];
  const colors = data.colors ?? [];

  const result: BrandResult = {
    name: data.name ?? null,
    domain,
    logo_url: pickLogoUrl(logos, 'logo') ?? pickLogoUrl(logos, 'symbol'),
    favicon_url: pickLogoUrl(logos, 'icon') ?? pickLogoUrl(logos, 'symbol'),
    primary_color: pickColor(colors, 'brand') ?? pickColor(colors, 'dark'),
    accent_color: pickColor(colors, 'accent') ?? pickColor(colors, 'vibrant'),
  };

  return json(200, result);
});
