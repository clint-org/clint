import { Brand } from './brand.model';

/**
 * Resolve the agency display name for the current brand context, or null when
 * none applies.
 *
 * - agency host: the brand IS the agency, so `app_display_name` is the name.
 * - tenant host: the parent agency descriptor (`agency.name`), populated by
 *   `get_brand_by_host` only when the tenant has an agency.
 * - super-admin / default: no agency in context.
 */
export function resolveAgencyName(brand: Brand): string | null {
  if (brand.kind === 'agency') {
    return brand.app_display_name?.trim() || null;
  }
  if (brand.kind === 'tenant') {
    return brand.agency?.name?.trim() || null;
  }
  return null;
}

/**
 * Formal-surface label for the authored-brief deliverable: the human-written
 * artifact the PI bookmark mark flags. Composes the resolved agency name
 * ("Stout intelligence") or falls back to plain "Intelligence" when no agency
 * resolves (super-admin / default / agency-less tenant).
 *
 * This names the deliverable specifically, NOT the unified `/intelligence`
 * feed (briefs + events), which stays plain "Intelligence". Sentence case;
 * surfaces that render uppercase-tracked eyebrows apply the transform via CSS.
 */
export function resolveIntelligenceLabel(brand: Brand): string {
  const agency = resolveAgencyName(brand);
  return agency ? `${agency} intelligence` : 'Intelligence';
}
