/**
 * Query params that deep-link a single entity-profile event row to the Events
 * page: the entity scope (so the feed matches the profile the row came from)
 * plus `eventId`, which the Events page reads to open that event's detail pane.
 * Kept as a pure function so it is unit-testable without the Angular component
 * (which needs @angular/compiler at runtime and cannot load under the node
 * vitest runner).
 */
export function entityEventRowParams(
  entityLevel: 'trial' | 'product' | 'company',
  entityId: string,
  eventId: string
): { entityLevel: string; entityId: string; eventId: string } {
  return { entityLevel, entityId, eventId };
}
