import type { ExportColumn } from '../../../shared/export/grid-sheet.util';
import type { Asset } from '../../../core/models/asset.model';

/** Structural slice of the asset list's row model that the export reads. */
export interface AssetExportRow {
  readonly asset: Asset;
  readonly companyName: string;
  readonly trialCount: number;
  readonly moaNames: string;
  readonly roaNames: string;
}

/**
 * Explicit export surface for the assets grid: the visible columns with
 * domain-vocabulary headers. The asset detail surface shows the same data
 * fields (logo, generic, MOA/ROA chips, embedded trial timeline), so no
 * detail-only columns exist; indications are not displayed on either surface
 * and are not loaded with the list rows.
 */
export const ASSET_EXPORT_COLUMNS: ExportColumn<AssetExportRow>[] = [
  { header: 'Asset', value: (r) => r.asset.name, width: 24 },
  { header: 'Generic', value: (r) => r.asset.generic_name ?? '', width: 20 },
  { header: 'Company', value: (r) => r.companyName },
  { header: 'MOA', value: (r) => r.moaNames, width: 26 },
  { header: 'ROA', value: (r) => r.roaNames, width: 16 },
  { header: 'Trials', value: (r) => r.trialCount, width: 8 },
  { header: 'Order', value: (r) => r.asset.display_order, width: 8 },
];
