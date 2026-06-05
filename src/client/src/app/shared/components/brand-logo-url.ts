// Pure Brandfetch Logo Link URL helpers, kept free of Angular imports so they
// can be unit-tested in the Node environment (see brand-logo-url.spec.ts).

const CDN_HOST = 'cdn.brandfetch.io';

// Brandfetch Logo Link asset types, in the worker's discovery-preference order.
// The enrichment step embeds the discovered type in the stored URL; older rows
// may be bare (cdn.brandfetch.io/<domain>) and default to `icon`.
const LOGO_TYPES: readonly string[] = ['symbol', 'icon', 'logo'];

// Resolves any stored logo URL to a render-ready src. For Brandfetch Logo Link
// URLs this (a) appends the client id required for hotlinking and (b) adds the
// `/fallback/lettermark` path segment so the CDN returns the brand's first
// letter when no real asset exists, instead of its generic "B" placeholder.
// Non-Brandfetch URLs pass through untouched; null/empty yields null so the
// component renders its projected fallback.
export function resolveBrandLogoSrc(
  raw: string | null | undefined,
  clientId: string | undefined
): string | null {
  if (!raw) return null;
  if (!raw.includes(CDN_HOST)) return raw;
  const parsed = parseBrandfetchUrl(raw);
  if (!parsed) return raw;
  const base = `https://${CDN_HOST}/${parsed.domain}/${parsed.type}/fallback/lettermark`;
  return clientId ? `${base}?c=${clientId}` : base;
}

// Pulls the brand domain and asset type out of a stored Brandfetch URL,
// tolerating the legacy `/domain/<domain>` seed shape and any existing query
// string or `/fallback/...` segment. Returns null if no domain is present.
function parseBrandfetchUrl(url: string): { domain: string; type: string } | null {
  const path = url.split('?')[0].split(`${CDN_HOST}/`)[1];
  if (!path) return null;
  let segments = path.split('/').filter(Boolean);
  if (segments[0] === 'domain') segments = segments.slice(1);
  const domain = segments[0];
  if (!domain) return null;
  const type = segments.slice(1).find((s) => LOGO_TYPES.includes(s)) ?? 'icon';
  return { domain, type };
}
