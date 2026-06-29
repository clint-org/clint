/**
 * Resolve the event id a deep link asks the Future Events page to open.
 *
 * Prefers the current `?eventId=` query param and falls back to the legacy
 * `?markerId=` param, so links minted before the Event-model rename (palette
 * results, activity-feed rows, engagement-landing cards) keep resolving for one
 * release. `eventId` wins when both are present. Returns null when neither is.
 *
 * Pure (takes the minimal `get(name)` shape of Angular's ParamMap) so it can be
 * unit-tested without instantiating the component.
 */
export function resolveDeepLinkEventId(params: {
  get(name: string): string | null;
}): string | null {
  return params.get('eventId') ?? params.get('markerId');
}
