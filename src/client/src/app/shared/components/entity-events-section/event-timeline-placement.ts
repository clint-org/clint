import { effectiveVisibility } from '../../../core/models/marker-visibility';
import type { Marker } from '../../../core/models/marker.model';

export type TimelinePlacement = 'timeline' | 'feed';

/**
 * Whether an event renders on the timeline or is feed-only, per the canonical
 * `effectiveVisibility` rule (pinned -> on, hidden -> off, else effective
 * significance must be 'high'). Surfaced as the "Timeline" column in the
 * standardized entity events table.
 */
export function timelinePlacement(m: Marker): TimelinePlacement {
  return effectiveVisibility(m) ? 'timeline' : 'feed';
}

export function timelinePlacementLabel(m: Marker): string {
  return timelinePlacement(m) === 'timeline' ? 'On timeline' : 'Feed only';
}
