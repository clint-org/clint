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

/**
 * The "and everything beneath it" suffix for a scope's filter chip, naming the
 * descendant levels the hierarchical rollup includes. A trial has nothing
 * beneath it, so its suffix is empty.
 */
export function scopeRollupSuffix(level: EntityScope['entityLevel']): string {
  switch (level) {
    case 'company':
      return ' + assets & trials';
    case 'product':
      return ' + trials';
    case 'trial':
      return '';
  }
}

/**
 * The filter-chip label for an entity scope: the entity's display name plus the
 * rollup suffix (e.g. `Eli Lilly + assets & trials`). When the name is not yet
 * known (e.g. a scoped view with no matching events), falls back to the
 * level noun so the chip still reads sensibly ("this company and everything
 * beneath it").
 */
export function scopeChipLabel(level: EntityScope['entityLevel'], name: string | null): string {
  if (name && name.trim().length > 0) {
    return `${name}${scopeRollupSuffix(level)}`;
  }
  const noun = level === 'product' ? 'asset' : level;
  return `this ${noun} and everything beneath it`;
}
