import { isoToDate, type SheetSpec } from './xlsx-sheet.util';

/** ExcelJS number format for calendar-day cells produced by dateCell(). */
export const EXPORT_DATE_FMT = 'yyyy-mm-dd';

/** ExcelJS number format for timestamp cells (e.g. feed "logged" times). */
export const EXPORT_DATETIME_FMT = 'yyyy-mm-dd hh:mm';

/**
 * Explicit export column: every grid declares its export surface as a list of
 * these rather than reusing its on-screen filter ColumnDefs, so the workbook
 * carries the full visible row PLUS the fields the row's detail pane shows
 * (when they are already on the loaded row model). Dates are returned as JS
 * Date so Excel gets real date cells; pair with EXPORT_DATE_FMT.
 */
export interface ExportColumn<T> {
  header: string;
  value: (row: T) => string | number | Date | null | undefined;
  width?: number;
  /** ExcelJS number format, required for Date-valued columns. */
  numFmt?: string;
}

/** yyyy-mm-dd (or full ISO timestamp) to a UTC calendar-day Date cell; '' when absent. */
export function dateCell(iso: string | null | undefined): Date | '' {
  if (!iso) return '';
  return isoToDate(iso.slice(0, 10));
}

/** ISO timestamp to a Date cell preserving time of day; '' when absent. */
export function timestampCell(iso: string | null | undefined): Date | '' {
  if (!iso) return '';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : d;
}

/**
 * Map explicit export columns + current-view rows into a SheetSpec for
 * buildSheetWorkbook. Synthetic stable keys (c0, c1, ...) sidestep duplicate
 * header names; null/undefined collapse to empty cells.
 */
export function buildExportSheet<T>(
  sheetName: string,
  columns: ExportColumn<T>[],
  rows: T[]
): SheetSpec {
  const keyed = columns.map((col, i) => ({ col, key: `c${i}` }));
  return {
    name: sheetName,
    columns: keyed.map(({ col, key }) => ({
      header: col.header,
      key,
      width: col.width ?? 22,
      numFmt: col.numFmt,
    })),
    rows: rows.map((row) => {
      const out: Record<string, unknown> = {};
      for (const { col, key } of keyed) out[key] = col.value(row) ?? '';
      return out;
    }),
  };
}
