import type { BullseyeData } from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import type { SheetColumn } from '../../shared/export/xlsx-sheet.util';

// eslint-disable-next-line @typescript-eslint/consistent-type-definitions
export type BullseyeExportRow = {
  spoke: string;
  company: string;
  asset: string;
  generic: string;
  phase: string;
  moa: string;
  roa: string;
  indication: string;
};

/**
 * Flatten the bullseye spoke→asset structure into one row per asset occurrence,
 * mirroring what the chart shows (an asset on N spokes yields N rows). MOA/ROA/
 * indication are joined to single cells.
 */
export function buildBullseyeRows(data: BullseyeData): BullseyeExportRow[] {
  const rows: BullseyeExportRow[] = [];
  for (const spoke of data.spokes) {
    for (const a of spoke.products) {
      rows.push({
        spoke: spoke.name,
        company: a.company_name,
        asset: a.name,
        generic: a.generic_name ?? '',
        phase: a.highest_phase ? phaseShortLabel(a.highest_phase) : '',
        moa: a.moas.map((m) => m.name).join(', '),
        roa: a.roas.map((r) => r.abbreviation ?? r.name).join(', '),
        indication: a.indications.map((i) => i.name).join(', '),
      });
    }
  }
  return rows;
}

export const BULLSEYE_EXPORT_COLUMNS: SheetColumn[] = [
  { header: 'Group', key: 'spoke', width: 22 },
  { header: 'Company', key: 'company', width: 22 },
  { header: 'Asset', key: 'asset', width: 22 },
  { header: 'Generic', key: 'generic', width: 20 },
  { header: 'Phase', key: 'phase', width: 10 },
  { header: 'MOA', key: 'moa', width: 26 },
  { header: 'ROA', key: 'roa', width: 12 },
  { header: 'Indication', key: 'indication', width: 26 },
];
