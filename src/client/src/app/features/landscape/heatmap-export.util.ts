import { RING_ORDER, type HeatmapBubble, type RingPhase } from '../../core/models/landscape.model';
import type { SheetColumn, SheetSpec } from '../../shared/export/xlsx-sheet.util';

/**
 * Two sheets from the heatmap bubbles:
 *  - Matrix: one row per bubble, a column per phase (count), plus a total.
 *  - Cells:  one row per non-empty (bubble, phase) cell -- keeps the data tidy
 *            for pivoting and survives the matrix flattening.
 *
 * countUnit is the active count unit ('assets' | 'trials' | 'companies').
 * The bubble's unit_count already encodes the unit; countUnit is carried in
 * the signature so Task 15 can pass it through without branching on the
 * caller side. It is not used in the body because unit_count already reflects
 * the selected unit and repeating it in every cell would add noise.
 */
export function buildHeatmapSheets(
  bubbles: HeatmapBubble[],
  _countUnit: string
): SheetSpec[] {
  const phases = RING_ORDER as readonly RingPhase[];

  const matrixColumns: SheetColumn[] = [
    { header: 'Group', key: 'label', width: 28 },
    ...phases.map((p) => ({ header: p, key: p, width: 8 })),
    { header: 'Total', key: 'total', width: 10 },
  ];
  const matrixRows = bubbles.map((b) => {
    const row: Record<string, unknown> = { label: b.label, total: b.unit_count };
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

  return [
    { name: 'Matrix', columns: matrixColumns, rows: matrixRows },
    { name: 'Cells', columns: cellsColumns, rows: cellsRows },
  ];
}
