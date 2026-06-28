import {
  IntelligenceEntityType,
  IntelligenceLinkEntityType,
} from '../../core/models/primary-intelligence.model';

/**
 * Builds the router-link command array for an intelligence entity.
 * Returns null when tenant or space is missing, or for marker link
 * targets (markers are inline-edited on the trial page and do not have
 * their own detail route — callers should render a non-anchor span).
 * Engagement (space) is a singleton per space and therefore has no id
 * segment.
 */
export function buildEntityRouterLink(
  tenantId: string | null,
  spaceId: string | null,
  entityType: IntelligenceEntityType | IntelligenceLinkEntityType,
  entityId: string
): unknown[] | null {
  if (!tenantId || !spaceId) return null;
  const base = ['/t', tenantId, 's', spaceId, 'profiles'];
  switch (entityType) {
    case 'trial':
      return [...base, 'trials', entityId];
    case 'company':
      return [...base, 'companies', entityId];
    case 'product':
      return [...base, 'assets', entityId];
    case 'marker':
      return null;
    case 'space':
      return [...base, 'engagement'];
  }
}
