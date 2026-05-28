interface NewCompanyEntry {
  index: number;
  name: string;
  website: string | null | undefined;
}

const TYPE_PREFERENCE = ['symbol', 'icon', 'logo'] as const;
type LogoType = (typeof TYPE_PREFERENCE)[number];

// Brandfetch's CDN returns its generic "B" placeholder with HTTP 200 when a
// type doesn't exist for a domain (fallback=404 is ignored on the free
// client ID). The placeholder is a stable webp; this ETag fingerprints it,
// captured 2026-05-28 by HEAD-probing a brand with no registered symbol
// (lilly.com/symbol). When Brandfetch swaps the placeholder, every brand
// will start enriching as "has symbol" and we'll need to refresh this set.
const PLACEHOLDER_ETAGS: ReadonlySet<string> = new Set(['"50d0-2qeW7LHRdpFgBCxSKMv6Q0bjCeY"']);

const PROBE_TIMEOUT_MS = 5_000;

function deriveDomain(name: string, website: string | null | undefined): string | null {
  if (website) {
    let domain = website.trim().toLowerCase();
    try {
      if (domain.includes('://')) domain = new URL(domain).hostname;
      else if (domain.includes('/')) domain = domain.split('/')[0];
    } catch {
      // keep as-is
    }
    if (domain.startsWith('www.')) domain = domain.slice(4);
    if (domain) return domain;
  }

  const cleaned = name
    .toLowerCase()
    .replace(
      /\b(inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|gmbh|se|n\.?v\.?|co\.?|company|group|pharma|pharmaceuticals?|therapeutics?|biosciences?|biotechnolog(y|ies)|medicines?|oncology|sciences?)\b/g,
      ''
    )
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (!cleaned) return null;
  return `${cleaned}.com`;
}

async function probeType(
  domain: string,
  type: LogoType,
  clientId: string,
  referer: string
): Promise<boolean> {
  const url = `https://cdn.brandfetch.io/${domain}/${type}${clientId ? `?c=${clientId}` : ''}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    // Browser-like headers; Brandfetch's CDN gates hotlinking on Referer +
    // Origin. The configured client ID whitelists our apexes; outside that
    // the CDN 302s to the docs page. HEAD requests get a flat 404 from the
    // CDN even for existing assets, so we GET with Range: bytes=0-0 to
    // download a single byte and read the ETag from the 206 response.
    const res = await fetch(url, {
      method: 'GET',
      headers: {
        Referer: referer,
        Origin: referer.replace(/\/$/, ''),
        Accept: 'image/webp,image/*',
        'User-Agent': 'Mozilla/5.0 Chrome/120.0.0.0',
        Range: 'bytes=0-0',
      },
      signal: controller.signal,
    });
    if (res.status !== 200 && res.status !== 206) return false;
    const etag = res.headers.get('etag');
    if (etag && PLACEHOLDER_ETAGS.has(etag)) return false;
    return true;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// Returns a map of company index -> type-specific Brandfetch Logo Link URL
// (e.g., https://cdn.brandfetch.io/lilly.com/icon). The frontend appends
// `?c=<clientId>` at render time. Companies whose domain has no real asset
// for any type are omitted; the UI then renders projected initials.
export async function enrichCompanyLogos(
  companies: NewCompanyEntry[],
  clientId: string,
  referer: string
): Promise<Record<number, string>> {
  if (companies.length === 0) return {};
  if (!clientId || !referer) return {};

  const results: Record<number, string> = {};
  const probes = companies.map(async (c) => {
    const domain = deriveDomain(c.name, c.website);
    if (!domain) return;
    for (const type of TYPE_PREFERENCE) {
      const hit = await probeType(domain, type, clientId, referer);
      if (hit) {
        results[c.index] = `https://cdn.brandfetch.io/${domain}/${type}`;
        return;
      }
    }
  });
  await Promise.all(probes);
  return results;
}
