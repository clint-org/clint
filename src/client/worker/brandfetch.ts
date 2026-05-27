import { errorResponse } from './errors';

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

export interface BrandResult {
  name: string | null;
  domain: string;
  logo_url: string | null;
  favicon_url: string | null;
  primary_color: string | null;
  accent_color: string | null;
}

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

function cleanDomain(raw: string): string {
  let domain = raw.trim().toLowerCase();
  try {
    if (domain.includes('://')) {
      domain = new URL(domain).hostname;
    } else if (domain.includes('/')) {
      domain = domain.split('/')[0];
    }
  } catch {
    // keep as-is
  }
  return domain;
}

export async function handleBrandfetchLookup(
  request: Request,
  apiKey: string,
  jwtSub: string | null,
  cors: Record<string, string>
): Promise<Response> {
  if (!jwtSub) {
    return errorResponse(401, 'unauthorized', cors);
  }

  if (!apiKey) {
    return errorResponse(500, 'server_misconfigured', cors);
  }

  let body: { domain?: string };
  try {
    body = (await request.json()) as { domain?: string };
  } catch {
    return errorResponse(400, 'invalid_json', cors);
  }

  const domain = typeof body.domain === 'string' ? cleanDomain(body.domain) : '';
  if (!domain) {
    return errorResponse(400, 'domain_required', cors);
  }

  const brandfetchUrl = `https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`;
  let bfRes: Response;
  try {
    bfRes = await fetch(brandfetchUrl, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
  } catch {
    return errorResponse(502, 'brandfetch_unreachable', cors);
  }

  if (!bfRes.ok) {
    if (bfRes.status === 404) {
      return errorResponse(404, 'domain_not_found', cors);
    }
    return errorResponse(502, 'brandfetch_error', cors);
  }

  let data: BrandfetchResponse;
  try {
    data = (await bfRes.json()) as BrandfetchResponse;
  } catch {
    return errorResponse(502, 'brandfetch_invalid_response', cors);
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

  return new Response(JSON.stringify(result), {
    status: 200,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}
