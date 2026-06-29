import {
  formatMarkerExtent,
  isApproximate,
} from '../../../core/models/marker-date-precision';
import type { EventFeedItem } from '../../../core/models/intelligence-feed-item.model';
import { formatShortDate } from '../../utils/marker-fields';

/**
 * The date label shown on an event row in the Intelligence feed: the marker
 * extent (fuzzy point, exact day, bounded range, or "onwards") with a leading
 * "~" when the date is approximate, so a projected "~Q3 '26" reads as estimated.
 * Pure so it can be unit-tested without mounting the component.
 */
export function eventFeedDateLabel(item: EventFeedItem): string {
  const label = formatMarkerExtent(
    item.event_date,
    item.date_precision,
    item.end_date,
    item.end_date_precision,
    item.is_ongoing,
    formatShortDate
  );
  return isApproximate(item.date_precision) ? `~${label}` : label;
}
