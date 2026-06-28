import { MaterialLink } from '../../../core/models/material.model';

/**
 * Route target for a linked-entity chip: the routerLink `commands` plus
 * optional `queryParams`. Markers carry `{ markerId }` so the trial timeline
 * opens the read-only marker drawer on arrival.
 */
export interface MaterialLinkRoute {
  commands: unknown[];
  queryParams?: Record<string, string> | null;
}

/**
 * Route target for a linked entity, or null when tenant/space context is
 * missing or the link has no navigable page. A marker has no standalone page,
 * so it deep-links to its parent trial's timeline (resolved server-side as the
 * marker's first trial assignment) and opens the read-only marker drawer via
 * the repo-wide ?markerId=<id> convention; a marker with no trial assignment
 * (no trial_id) stays non-clickable.
 */
export function routeForLink(
  link: MaterialLink,
  tenant: string,
  space: string
): MaterialLinkRoute | null {
  if (!tenant || !space) return null;
  const base = ['/t', tenant, 's', space];
  switch (link.entity_type) {
    case 'company':
      return { commands: [...base, 'profiles', 'companies', link.entity_id] };
    case 'product':
      return { commands: [...base, 'profiles', 'assets', link.entity_id] };
    case 'trial':
      return { commands: [...base, 'profiles', 'trials', link.entity_id] };
    case 'space':
      return { commands: base };
    case 'marker':
      return link.trial_id
        ? {
            commands: [...base, 'profiles', 'trials', link.trial_id],
            queryParams: { markerId: link.entity_id },
          }
        : null;
    default:
      return null;
  }
}
