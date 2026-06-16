import type { Company } from '../../../core/models/company.model';
import type { ExportColumn } from '../../../shared/export/grid-sheet.util';

/**
 * Explicit export surface for the companies grid: the visible columns with
 * domain-vocabulary headers, plus the asset count the company detail page
 * shows (assets are loaded with the list rows; no extra fetch).
 */
export const COMPANY_EXPORT_COLUMNS: ExportColumn<Company>[] = [
  { header: 'Company', value: (c) => c.name, width: 28 },
  { header: 'Assets', value: (c) => c.assets?.length ?? 0, width: 9 },
  { header: 'Order', value: (c) => c.display_order, width: 8 },
];
