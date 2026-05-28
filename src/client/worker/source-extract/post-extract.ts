import { enrichCompanyLogos } from './logo-enrichment';
import type { ExtractionResult, InventorySnapshot } from './types';

interface NewCompanyForEnrichment {
  index: number;
  name: string;
  website: string | null | undefined;
}

// Mutates: sets logo_url on every new-company match in proposals using
// Brandfetch Logo Link URLs derived from the company name. Logs the
// outcome under the given label so wrangler tail shows which import
// path produced which URL.
export function applyLogoEnrichment(proposals: ExtractionResult, label: string): void {
  const newCompanies: NewCompanyForEnrichment[] = proposals.companies
    .map((c, i) =>
      c.match.kind === 'new'
        ? { index: i, name: c.match.name, website: c.match.website }
        : null,
    )
    .filter((x): x is NewCompanyForEnrichment => x !== null);

  const companyLogos = enrichCompanyLogos(newCompanies);
  for (const [idxStr, logoUrl] of Object.entries(companyLogos)) {
    const idx = Number(idxStr);
    const company = proposals.companies[idx];
    if (company?.match.kind === 'new') {
      (company.match as Record<string, unknown>)['logo_url'] = logoUrl;
    }
  }

  console.log(
    `[${label}] proposal companies`,
    JSON.stringify(
      proposals.companies.map((c) => ({
        kind: c.match.kind,
        name: c.match.kind === 'new' ? c.match.name : null,
        existing_id: c.match.kind === 'existing' ? c.match.id : null,
        logo_url:
          c.match.kind === 'new'
            ? ((c.match as Record<string, unknown>)['logo_url'] ?? null)
            : null,
      })),
    ),
  );
}

// Derives the display name for every entity and the resolved_names map
// the review page uses (companies_<i>, assets_<i>, trials_<i> → name).
// Returns companyNames and assetNames separately because the handlers
// also pass them to enrichWithCtgov / prompt-builders.
export function resolveProposalNames(
  proposals: ExtractionResult,
  inventory: InventorySnapshot,
): {
  companyNames: string[];
  assetNames: string[];
  resolvedNames: Record<string, string>;
} {
  const companyNames = proposals.companies.map((c) => {
    const m = c.match;
    return m.kind === 'new'
      ? m.name
      : (inventory.companies.find((ic) => ic.id === m.id)?.name ?? '');
  });

  const assetNames = proposals.assets.map((a) => {
    const m = a.match;
    return m.kind === 'new'
      ? m.name
      : (inventory.assets.find((ia) => ia.id === m.id)?.name ?? '');
  });

  const resolvedNames: Record<string, string> = {};
  companyNames.forEach((n, i) => {
    resolvedNames[`companies_${i}`] = n;
  });
  assetNames.forEach((n, i) => {
    resolvedNames[`assets_${i}`] = n;
  });
  proposals.trials.forEach((t, i) => {
    const m = t.match;
    resolvedNames[`trials_${i}`] =
      m.kind === 'new' ? m.name : (inventory.trials.find((it) => it.id === m.id)?.name ?? t.name);
  });

  return { companyNames, assetNames, resolvedNames };
}
