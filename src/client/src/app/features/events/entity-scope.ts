import { EntityLevel } from '../../core/models/event.model';

/**
 * A server-side scope applied to the events page when the user arrives via the
 * "See all" link on an entity detail page (trial / asset / company). The
 * `get_events_page_data` RPC rolls scoped levels up hierarchically, so an
 * asset scope returns the asset's own events plus all trial events beneath it.
 */
export interface EntityScope {
  entityLevel: Extract<EntityLevel, 'trial' | 'product' | 'company'>;
  entityId: string;
}

const SCOPABLE_LEVELS: readonly string[] = ['trial', 'product', 'company'];

/**
 * Parse the `entityLevel` / `entityId` query params carried by the "See all"
 * link into a scope, or null when they are absent or not a scopable level.
 */
export function parseEntityScope(
  level: string | null,
  entityId: string | null,
): EntityScope | null {
  if (!entityId || !level || !SCOPABLE_LEVELS.includes(level)) return null;
  return { entityLevel: level as EntityScope['entityLevel'], entityId };
}
