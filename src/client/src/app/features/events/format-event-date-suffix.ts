import { FeedItem } from '../../core/models/event.model';

/**
 * Returns a formatted date suffix (e.g. " · May 29, 2026") when the event's
 * business date differs from the day it was logged (feed_ts).
 *
 * For detected rows the catalyst date is already inlined in the summary
 * segments, so this returns an empty string.
 */
export function formatEventDateSuffix(item: FeedItem): string {
  if (item.source_type === 'detected') return '';
  if (!item.event_date || !item.feed_ts) return '';
  const eventDay = item.event_date.slice(0, 10);
  const loggedDay = item.feed_ts.slice(0, 10);
  if (eventDay === loggedDay) return '';
  const parsed = new Date(`${item.event_date}T00:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  const formatted = parsed.toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  return ` · ${formatted}`;
}
