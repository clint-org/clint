import { EventPriority, EventsPageFilters } from '../../core/models/event.model';
import type { FilterValue } from '../../shared/grids/filter-types';
import type { EntityScope } from './entity-scope';

/**
 * The server-side query the Events page issues to `get_events_page_data`:
 * the resolved filter set plus offset/limit pagination, scoped to a space.
 */
export interface ServerQuery {
  spaceId: string;
  filters: EventsPageFilters;
  limit: number;
  offset: number;
}

function selectValues(f: FilterValue | undefined): unknown[] {
  return f && f.kind === 'select' ? f.values : [];
}

function dateRange(f: FilterValue | undefined): { from: string | null; to: string | null } {
  if (f && f.kind === 'date') return { from: f.from, to: f.to };
  return { from: null, to: null };
}

/**
 * Pure mapper from the client grid's state (filters/sort/page) + debounced
 * search + entity scope + space id to the server query. Keeping this pure and
 * unit-tested lets the component's reactive effect stay a thin shell. Mirrors
 * the column wiring in events-page.component: source_type/priority are single
 * selects, category_name is a multi-id select, feed_ts is a date range, and
 * the global search collapses empty strings to null.
 */
export function buildServerQuery(
  gridFilters: Record<string, FilterValue>,
  gridSort: { field: string; order: 1 | -1 } | null,
  gridPage: { first: number; rows: number },
  search: string,
  scope: EntityScope | null,
  spaceId: string,
): ServerQuery {
  const sourceVals = selectValues(gridFilters['source_type']);
  const priorityVals = selectValues(gridFilters['priority']);
  const categoryVals = selectValues(gridFilters['category_name']);
  const { from, to } = dateRange(gridFilters['feed_ts']);
  const trimmed = (search ?? '').trim();

  return {
    spaceId,
    filters: {
      dateFrom: from,
      dateTo: to,
      entityLevel: scope?.entityLevel ?? null,
      entityId: scope?.entityId ?? null,
      categoryIds: categoryVals.map((v) => String(v)),
      tags: [],
      priority: (priorityVals[0] as EventPriority | undefined) ?? null,
      sourceType: (sourceVals[0] as EventsPageFilters['sourceType'] | undefined) ?? null,
      search: trimmed === '' ? null : trimmed,
      sortField: gridSort?.field ?? null,
      sortDir: gridSort ? (gridSort.order === -1 ? 'desc' : 'asc') : null,
    },
    limit: gridPage.rows,
    offset: gridPage.first,
  };
}
