import type { ColumnDef } from '../grids/filter-types';
import type { SheetSpec } from './xlsx-sheet.util';

/** Resolve a dotted path ('trial.identifier') against a row; returns undefined for null/undefined. */
function resolvePath(row: unknown, path: string): unknown {
  let cur: unknown = row;
  for (const part of path.split('.')) {
    if (cur == null || typeof cur !== 'object') return undefined;
    cur = (cur as Record<string, unknown>)[part];
  }
  return cur;
}

function cellValue<T>(row: T, col: ColumnDef<T>): string | number {
  const raw = col.getValue ? col.getValue(row) : resolvePath(row, col.field);
  if (raw == null) return '';
  if (typeof raw === 'number') return raw;
  return String(raw);
}

/**
 * Map a grid's column defs + current rows into a SheetSpec for buildSheetWorkbook.
 * Synthetic stable keys (c0, c1, …) sidestep duplicate/dotted field names.
 * Values come from each column's getValue or its dotted path, so the sheet
 * mirrors the on-screen columns (current view). Template-only display (chips,
 * logos) collapses to its underlying value/label here.
 */
export function buildGridSheet<T>(
  sheetName: string,
  columns: ColumnDef<T>[],
  rows: T[]
): SheetSpec {
  const keyed = columns.map((col, i) => ({ col, key: `c${i}` }));
  return {
    name: sheetName,
    columns: keyed.map(({ col, key }) => ({ header: col.header, key, width: 22 })),
    rows: rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const { col, key } of keyed) out[key] = cellValue(row, col);
      return out;
    }),
  };
}
