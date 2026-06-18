import { Brand } from '../../../core/models/brand.model';

/**
 * The authoring agency's logo for an intelligence byline, or null when none is
 * set. On a tenant host the agency is the tenant's parent (brand.agency); on an
 * agency host the brand itself is the agency, so its own logo applies. Other
 * brand kinds (default / super-admin) have no agency logo, so the byline falls
 * back to the initials tile.
 */
export function agencyLogoFromBrand(brand: Brand): string | null {
  if (brand.kind === 'tenant') return brand.agency?.logo_url ?? null;
  if (brand.kind === 'agency') return brand.logo_url;
  return null;
}
