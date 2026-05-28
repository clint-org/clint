interface NewCompanyEntry {
  index: number;
  name: string;
  website: string | null | undefined;
}

interface BrandfetchLogoEntry {
  type?: string;
  theme?: string;
}

interface BrandfetchBrandResponse {
  logos?: BrandfetchLogoEntry[];
}

// Best-to-worst preference order. Symbol is the brand mark on its own,
// icon is the square avatar form, logo is the full wordmark composition.
// Brands often expose only a subset; the Brand API tells us which.
const TYPE_PREFERENCE = ['symbol', 'icon', 'logo'] as const;
type LogoType = (typeof TYPE_PREFERENCE)[number];

const BRAND_API_TIMEOUT_MS = 5_000;

function deriveDomain(name: string, website: string | null | undefined): string | null {
  if (website) {
    let domain = website.trim().toLowerCase();
    try {
      if (domain.includes('://')) domain = new URL(domain).hostname;
      else if (domain.includes('/')) domain = domain.split('/')[0];
    } catch {
      // keep as-is
    }
    // Brandfetch indexes apex domains; www. and other generic web
    // subdomains rarely have their own entries and would 404 the Brand API.
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

// Picks the best Logo Link type that the Brand API confirms exists for
// this brand. Prefers light/no-theme entries. Returns null when none of
// our cascade types are present.
export function pickAvailableType(logos: BrandfetchLogoEntry[]): LogoType | null {
  const usable = logos.filter((l) => l.theme !== 'dark');
  for (const type of TYPE_PREFERENCE) {
    if (usable.some((l) => l.type === type)) return type;
  }
  return null;
}

async function fetchBrandAssets(
  domain: string,
  apiKey: string
): Promise<BrandfetchLogoEntry[] | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), BRAND_API_TIMEOUT_MS);
  try {
    const res = await fetch(`https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal,
    });
    if (!res.ok) return null;
    const data = (await res.json()) as BrandfetchBrandResponse;
    return data.logos ?? [];
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

// Returns a map of company index → type-specific Brandfetch Logo Link URL
// (e.g., https://cdn.brandfetch.io/lilly.com/icon). The frontend appends
// `?c=<clientId>` at render time. Companies without an enrichable domain
// or with no API-confirmed asset are omitted from the map.
export async function enrichCompanyLogos(
  companies: NewCompanyEntry[],
  apiKey: string
): Promise<Record<number, string>> {
  if (companies.length === 0) return {};
  if (!apiKey) return {};

  const results: Record<number, string> = {};
  const probes = companies.map(async (c) => {
    const domain = deriveDomain(c.name, c.website);
    if (!domain) return;
    const logos = await fetchBrandAssets(domain, apiKey);
    if (!logos) return;
    const type = pickAvailableType(logos);
    if (!type) return;
    results[c.index] = `https://cdn.brandfetch.io/${domain}/${type}`;
  });
  await Promise.all(probes);
  return results;
}
