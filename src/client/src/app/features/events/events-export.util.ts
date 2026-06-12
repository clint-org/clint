import type { FeedItem } from '../../core/models/event.model';
import {
  dateCell,
  timestampCell,
  EXPORT_DATE_FMT,
  EXPORT_DATETIME_FMT,
  type ExportColumn,
} from '../../shared/export/grid-sheet.util';

export interface EventDisplayFns {
  /** Title as the row renders it (detected rows show the change summary). */
  title: (item: FeedItem) => string;
  /** Entity label as the row renders it (level badge text). */
  entity: (item: FeedItem) => string;
}

const SOURCE_LABEL: Record<string, string> = {
  analyst: 'Analyst',
  detected: 'Detected',
};

/**
 * Explicit export surface for the events feed: every visible column (logged,
 * source, title, category, entity, priority) plus the detail panel's
 * row-model fields (event date, company/asset/trial, tags, description,
 * source URL).
 *
 * Detail fields that need a per-row fetch are intentionally excluded: the
 * sources list, thread, linked events, and annotation body all load per event
 * via the detail RPC; exporting them would fan out one call per row.
 *
 * Title and entity rendering live on the page (they depend on the change-event
 * summary builder), so the column set is built from those functions to keep
 * the Excel cells identical to the screen.
 */
export function buildEventsExportColumns(display: EventDisplayFns): ExportColumn<FeedItem>[] {
  return [
    {
      header: 'Logged',
      value: (e) => timestampCell(e.feed_ts),
      numFmt: EXPORT_DATETIME_FMT,
      width: 17,
    },
    {
      header: 'Event date',
      value: (e) => dateCell(e.event_date),
      numFmt: EXPORT_DATE_FMT,
      width: 12,
    },
    { header: 'Source', value: (e) => SOURCE_LABEL[e.source_type] ?? e.source_type, width: 10 },
    { header: 'Title', value: display.title, width: 40 },
    { header: 'Category', value: (e) => e.category_name ?? '', width: 14 },
    { header: 'Entity', value: display.entity, width: 24 },
    { header: 'Company', value: (e) => e.company_name ?? '' },
    { header: 'Asset', value: (e) => e.asset_name ?? '' },
    { header: 'Trial', value: (e) => e.trial_name ?? '' },
    { header: 'Priority', value: (e) => (e.priority === 'high' ? 'High' : 'Low'), width: 9 },
    { header: 'Tags', value: (e) => (e.tags ?? []).join(', '), width: 20 },
    { header: 'Description', value: (e) => e.description ?? '', width: 40 },
    { header: 'Source URL', value: (e) => e.source_url ?? '', width: 28 },
  ];
}
