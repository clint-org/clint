import ExcelJS from 'exceljs';

export interface XlsxMeta {
  appDisplayName: string;
  /** Brand primary color, hex without '#', for the header row fill. */
  primaryColorHex: string;
}

export interface SheetColumn {
  header: string;
  key: string;
  width?: number;
  /** ExcelJS number format, e.g. 'yyyy-mm-dd' for Date cells. */
  numFmt?: string;
}

export interface SheetSpec {
  name: string;
  columns: SheetColumn[];
  rows: Record<string, unknown>[];
}

/** Parse yyyy-mm-dd into a UTC Date so the cell shows the same calendar day in any timezone. */
export function isoToDate(iso: string): Date {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d));
}

function styleHeaderRow(sheet: ExcelJS.Worksheet, primaryColorHex: string): void {
  const header = sheet.getRow(1);
  const fill: ExcelJS.Fill = {
    type: 'pattern',
    pattern: 'solid',
    fgColor: { argb: `FF${primaryColorHex.toUpperCase()}` },
  };
  header.eachCell((cell) => {
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill;
  });
}

const COL_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Build a multi-sheet workbook from declarative specs. Pure (no DI) so it
 * unit-tests in node; services handle dynamic import + download. Mirrors the
 * conventions in core/services/xlsx-export.util.ts (frozen header, brand fill,
 * autofilter) but is content-agnostic.
 */
export function buildSheetWorkbook(sheets: SheetSpec[], meta: XlsxMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.appDisplayName;

  for (const spec of sheets) {
    const sheet = wb.addWorksheet(spec.name, { views: [{ state: 'frozen', ySplit: 1 }] });
    sheet.columns = spec.columns.map((c) => ({
      header: c.header,
      key: c.key,
      width: c.width ?? 18,
      style: c.numFmt ? { numFmt: c.numFmt } : undefined,
    }));
    for (const row of spec.rows) sheet.addRow(row);
    styleHeaderRow(sheet, meta.primaryColorHex);
    if (spec.columns.length > 0) {
      const lastCol = COL_LETTERS[spec.columns.length - 1] ?? 'Z';
      sheet.autoFilter = `A1:${lastCol}${sheet.rowCount}`;
    }
  }

  return wb;
}
