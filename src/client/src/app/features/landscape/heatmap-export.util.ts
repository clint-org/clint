import {
  RING_ORDER,
  type HeatmapAsset,
  type HeatmapBubble,
  type RingPhase,
} from '../../core/models/landscape.model';
import { phaseShortLabel } from '../../core/models/phase-colors';
import type { SheetColumn, SheetSpec } from '../../shared/export/xlsx-sheet.util';
import { buildExportSheet, type ExportColumn } from '../../shared/export/grid-sheet.util';

interface BubbleAssetRow {
  bubble: HeatmapBubble;
  product: HeatmapAsset;
}

const ASSET_COLUMNS: ExportColumn<BubbleAssetRow>[] = [
  { header: 'Group', value: (r) => r.bubble.label, width: 28 },
  { header: 'Asset', value: (r) => r.product.name, width: 24 },
  { header: 'Generic', value: (r) => r.product.generic_name ?? '', width: 20 },
  { header: 'Company', value: (r) => r.product.company_name, width: 22 },
  {
    header: 'Highest phase',
    value: (r) => (r.product.highest_phase ? phaseShortLabel(r.product.highest_phase) : ''),
    width: 13,
  },
  { header: 'Trials', value: (r) => r.product.trial_count, width: 8 },
];

/**
 * Three sheets from the heatmap bubbles:
 *  - Matrix: one row per bubble, the companies count from the detail panel,
 *            a column per phase (count), plus a total.
 *  - Cells:  one row per non-empty (bubble, phase) cell -- keeps the data tidy
 *            for pivoting and survives the matrix flattening.
 *  - Assets: one row per asset in a bubble, mirroring the detail panel's
 *            asset list (already on the bubble row model; no extra fetch).
 *
 * countUnit is the active count unit ('assets' | 'trials' | 'companies').
 * The bubble's unit_count already encodes the unit; countUnit is carried in
 * the signature so callers can pass it through without branching. It is not
 * used in the body because unit_count already reflects the selected unit and
 * repeating it in every cell would add noise.
 */
export function buildHeatmapSheets(
  bubbles: HeatmapBubble[],
  _countUnit: string
): SheetSpec[] {
  const phases = RING_ORDER as readonly RingPhase[];

  const matrixColumns: SheetColumn[] = [
    { header: 'Group', key: 'label', width: 28 },
    { header: 'Companies', key: 'companies', width: 11 },
    ...phases.map((p) => ({ header: p, key: p, width: 8 })),
    { header: 'Total', key: 'total', width: 10 },
  ];
  const matrixRows = bubbles.map((b) => {
    const row: Record<string, unknown> = {
      label: b.label,
      companies: b.competitor_count,
      total: b.unit_count,
    };
    for (const p of phases) row[p] = b.phase_counts[p] ?? 0;
    return row;
  });

  const cellsColumns: SheetColumn[] = [
    { header: 'Group', key: 'label', width: 28 },
    { header: 'Phase', key: 'phase', width: 10 },
    { header: 'Count', key: 'count', width: 10 },
  ];
  const cellsRows: Record<string, unknown>[] = [];
  for (const b of bubbles) {
    for (const p of phases) {
      const count = b.phase_counts[p];
      if (count) cellsRows.push({ label: b.label, phase: p, count });
    }
  }

  const assetRows: BubbleAssetRow[] = bubbles.flatMap((bubble) =>
    (bubble.products ?? []).map((product) => ({ bubble, product }))
  );

  return [
    { name: 'Matrix', columns: matrixColumns, rows: matrixRows },
    { name: 'Cells', columns: cellsColumns, rows: cellsRows },
    buildExportSheet('Assets', ASSET_COLUMNS, assetRows),
  ];
}
