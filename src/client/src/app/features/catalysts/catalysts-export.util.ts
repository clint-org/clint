import type { FlatCatalyst } from '../../core/models/catalyst.model';
import { type ExportColumn } from '../../shared/export/grid-sheet.util';
import { formatDateShort } from '../../core/services/export-common.util';
import { formatMarkerExtent } from '../../core/models/marker-date-precision';

/** Status pill text as rendered in the table and the marker detail drawer. */
export function catalystStatusLabel(c: FlatCatalyst): string {
  if (c.no_longer_expected) return 'No longer expected';
  return c.is_projected ? 'Projected' : 'Confirmed';
}

/**
 * Explicit export surface for the catalysts grid: every visible column (date,
 * category, title, company/asset, status) plus the marker detail drawer's
 * row-model fields (trial, phase, marker type, description, source URL).
 *
 * Detail fields that need a per-row fetch are intentionally excluded:
 * recruitment status and the CT.gov field overlay (trial snapshot), upcoming
 * markers, related events, materials, and history all load per marker via
 * get_catalyst_detail; exporting them would fan out one RPC per row.
 */
export const CATALYST_EXPORT_COLUMNS: ExportColumn<FlatCatalyst>[] = [
  {
    header: 'Date',
    value: (c) =>
      formatMarkerExtent(
        c.event_date,
        c.date_precision,
        c.end_date,
        c.end_date_precision,
        c.is_ongoing,
        formatDateShort
      ),
    width: 14,
  },
  { header: 'Timeframe', value: (c) => c.time_bucket, width: 14 },
  { header: 'Category', value: (c) => c.category_name, width: 16 },
  { header: 'Catalyst', value: (c) => c.title, width: 36 },
  { header: 'Company', value: (c) => c.company_name ?? '' },
  { header: 'Asset', value: (c) => c.asset_name ?? '' },
  { header: 'Trial', value: (c) => c.trial_acronym ?? c.trial_name ?? '' },
  { header: 'Phase', value: (c) => c.trial_phase ?? '', width: 10 },
  { header: 'Status', value: catalystStatusLabel, width: 16 },
  { header: 'Marker type', value: (c) => c.marker_type_name, width: 18 },
  { header: 'Description', value: (c) => c.description ?? '', width: 40 },
  { header: 'Source URL', value: (c) => c.source_url ?? '', width: 28 },
];
