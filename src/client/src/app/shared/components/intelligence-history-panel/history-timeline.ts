import { IntelligenceHistoryEvent } from '../../../core/models/primary-intelligence.model';

export interface TimelineRow {
  event: IntelligenceHistoryEvent;
  archivedChildren: IntelligenceHistoryEvent[];
}

/**
 * Folds `archived` events under their causing `published` event when the
 * two share an exact timestamp. Other event kinds pass through as
 * top-level rows. Orphan archives (no matching publish at the same `at`)
 * are dropped.
 */
export function foldArchivedEvents(events: readonly IntelligenceHistoryEvent[]): TimelineRow[] {
  const archivedAt = new Map<string, IntelligenceHistoryEvent[]>();
  for (const e of events) {
    if (e.kind === 'archived') {
      const list = archivedAt.get(e.at) ?? [];
      list.push(e);
      archivedAt.set(e.at, list);
    }
  }

  const rows: TimelineRow[] = [];
  for (const e of events) {
    if (e.kind === 'archived') continue;
    const children = e.kind === 'published' ? (archivedAt.get(e.at) ?? []) : [];
    rows.push({ event: e, archivedChildren: children });
  }
  return rows;
}
