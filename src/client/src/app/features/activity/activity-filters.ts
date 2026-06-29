import { EventsPageFilters } from '../../core/models/event.model';

/**
 * The fixed filter set the read-only Activity page issues to
 * `get_events_page_data`: detected changes only (CT.gov registry deltas +
 * analyst-edit deltas), no date window, no category/tag/priority narrowing,
 * newest first. Activity is a passive log, so unlike the legacy Events feed it
 * carries no user-facing filter controls; this is the only query shape it ever
 * sends. Kept pure and exported so it can be unit-tested without Angular DI.
 */
export function buildDetectedFilters(): EventsPageFilters {
  return {
    dateFrom: null,
    dateTo: null,
    entityLevel: null,
    entityId: null,
    categoryNames: [],
    tags: [],
    priority: null,
    sourceType: 'detected',
    search: null,
    sortField: 'feed_ts',
    sortDir: 'desc',
  };
}
