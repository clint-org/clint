import { BullseyeMarker } from '../../core/models/landscape.model';

/**
 * Max events shown per Recent / Upcoming list. Mirrors the bullseye RPC's
 * `recent_markers` cap so the two lists stay symmetric and compact in the
 * detail panel.
 */
export const BULLSEYE_EVENT_LIST_CAP = 3;

export interface BullseyeEventBuckets {
  /** Past events, most-recent first (descending by event_date). */
  recent: BullseyeMarker[];
  /** Future events (dated today or later), soonest first (ascending). */
  upcoming: BullseyeMarker[];
}

/**
 * Split a focused asset's events into "Recent" (past) and "Upcoming" (future)
 * buckets around the `today` boundary. An event dated today or later is
 * Upcoming; everything earlier is Recent. Recent reads most-recent first so the
 * latest activity sits at the top; Upcoming reads soonest first so the nearest
 * catalyst sits at the top. Each list is capped at `cap`.
 *
 * Pure and date-injectable for testing. Event dates are ISO `YYYY-MM-DD`
 * strings, which sort correctly with plain string comparison.
 */
export function deriveBullseyeEventBuckets(
  events: readonly BullseyeMarker[],
  today: string = new Date().toISOString().slice(0, 10),
  cap: number = BULLSEYE_EVENT_LIST_CAP
): BullseyeEventBuckets {
  const recent: BullseyeMarker[] = [];
  const upcoming: BullseyeMarker[] = [];
  for (const ev of events) {
    if (ev.event_date && ev.event_date >= today) upcoming.push(ev);
    else recent.push(ev);
  }
  recent.sort((a, b) => (a.event_date < b.event_date ? 1 : a.event_date > b.event_date ? -1 : 0));
  upcoming.sort((a, b) => (a.event_date < b.event_date ? -1 : a.event_date > b.event_date ? 1 : 0));
  return { recent: recent.slice(0, cap), upcoming: upcoming.slice(0, cap) };
}
