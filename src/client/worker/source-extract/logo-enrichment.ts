interface NewCompanyEntry {
  index: number;
  name: string;
  website: string | null | undefined;
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

export function enrichCompanyLogos(
  companies: NewCompanyEntry[],
): Record<number, string> {
  if (companies.length === 0) return {};

  const results: Record<number, string> = {};
  const log: Array<{ name: string; website: string | null | undefined; domain: string | null; logo_url: string | null }> = [];
  for (const c of companies) {
    const domain = deriveDomain(c.name, c.website);
    const logoUrl = domain ? `https://cdn.brandfetch.io/${domain}/logo` : null;
    if (logoUrl) {
      results[c.index] = logoUrl;
    }
    log.push({ name: c.name, website: c.website, domain, logo_url: logoUrl });
  }
  console.log('[enrichCompanyLogos]', JSON.stringify(log));
  return results;
}
