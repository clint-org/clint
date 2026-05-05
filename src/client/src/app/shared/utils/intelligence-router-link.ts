import { IntelligenceEntityType } from '../../core/models/primary-intelligence.model';

/**
 * Builds the router-link command array for an intelligence entity.
 * Returns null when tenant or space is missing so callers can render a
 * non-anchor fallback. Engagement (space) is a singleton per space and
 * therefore has no id segment.
 */
export function buildEntityRouterLink(
  tenantId: string | null,
  spaceId: string | null,
  entityType: IntelligenceEntityType,
  entityId: string
): unknown[] | null {
  if (!tenantId || !spaceId) return null;
  const base = ['/t', tenantId, 's', spaceId, 'manage'];
  switch (entityType) {
    case 'trial':   return [...base, 'trials', entityId];
    case 'company': return [...base, 'companies', entityId];
    case 'product': return [...base, 'products', entityId];
    case 'marker':  return [...base, 'markers', entityId];
    case 'space':   return [...base, 'engagement'];
  }
}
