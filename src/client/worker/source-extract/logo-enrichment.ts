interface BrandfetchLogo {
  type: string;
  theme: string;
  formats: Array<{ src: string; format: string; width: number | null }>;
}

interface BrandfetchResponse {
  logos?: BrandfetchLogo[];
}

interface NewCompanyEntry {
  index: number;
  name: string;
  website: string | null | undefined;
}

const LOOKUP_TIMEOUT_MS = 5_000;

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

function deriveDomain(name: string, website: string | null | undefined): string | null {
  if (website) {
    let domain = website.trim().toLowerCase();
    try {
      if (domain.includes('://')) domain = new URL(domain).hostname;
      else if (domain.includes('/')) domain = domain.split('/')[0];
    } catch {
      // keep as-is
    }
    if (domain) return domain;
  }

  const cleaned = name
    .toLowerCase()
    .replace(
      /\b(inc\.?|corp\.?|corporation|ltd\.?|limited|plc|s\.?a\.?|ag|gmbh|se|n\.?v\.?|co\.?|company|group|pharma|pharmaceuticals?|therapeutics?|biosciences?|biotechnolog(y|ies)|medicines?|oncology|sciences?)\b/g,
      '',
    )
    .replace(/[^a-z0-9]/g, '')
    .trim();

  if (!cleaned) return null;
  return `${cleaned}.com`;
}

async function fetchLogo(domain: string, apiKey: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LOOKUP_TIMEOUT_MS);
  try {
    const res = await fetch(
      `https://api.brandfetch.io/v2/brands/${encodeURIComponent(domain)}`,
      { headers: { Authorization: `Bearer ${apiKey}` }, signal: controller.signal },
    );
    clearTimeout(timeout);
    if (!res.ok) return null;
    const data = (await res.json()) as BrandfetchResponse;
    const logos = data.logos ?? [];
    return pickLogoUrl(logos, 'logo') ?? pickLogoUrl(logos, 'symbol');
  } catch {
    clearTimeout(timeout);
    return null;
  }
}

export async function enrichCompanyLogos(
  companies: NewCompanyEntry[],
  apiKey: string,
): Promise<Record<number, string>> {
  if (!apiKey || companies.length === 0) return {};

  const results: Record<number, string> = {};
  const lookups = companies
    .map((c) => {
      const domain = deriveDomain(c.name, c.website);
      return domain ? { index: c.index, domain } : null;
    })
    .filter((x): x is { index: number; domain: string } => x !== null);

  await Promise.allSettled(
    lookups.map(async ({ index, domain }) => {
      const url = await fetchLogo(domain, apiKey);
      if (url) results[index] = url;
    }),
  );

  return results;
}
