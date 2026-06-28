import ExcelJS from 'exceljs';

import type { Company } from '../models/company.model';
import {
  buildMarkerTableRows,
  buildTrialExportRows,
  type MarkerStatus,
} from './export-common.util';

export interface XlsxMeta {
  appDisplayName: string;
  /** Brand primary color, hex without '#', for the header row fill. */
  primaryColorHex: string;
}

const STATUS_LABELS: Record<MarkerStatus, string> = {
  Actual: 'Actual',
  Projected: 'Projected',
  NLE: 'No longer expected',
};

/** Parse yyyy-mm-dd into a UTC Date so the cell shows the same calendar day in any timezone. */
function isoToDate(iso: string): Date {
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

/**
 * Build the data-sheets-only workbook (Trials + Markers). Pure so it can be
 * unit-tested in node; the service handles DI, dynamic import, and download.
 */
export function buildXlsxWorkbook(companies: Company[], meta: XlsxMeta): ExcelJS.Workbook {
  const wb = new ExcelJS.Workbook();
  wb.creator = meta.appDisplayName;

  const trials = wb.addWorksheet('Trials', { views: [{ state: 'frozen', ySplit: 1 }] });
  trials.columns = [
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Asset', key: 'asset', width: 20 },
    { header: 'MOA', key: 'moa', width: 26 },
    { header: 'ROA', key: 'roa', width: 12 },
    { header: 'Indication', key: 'indication', width: 22 },
    { header: 'Trial', key: 'trial', width: 22 },
    { header: 'NCT ID', key: 'nctId', width: 14 },
    { header: 'Phase', key: 'phase', width: 10 },
    { header: 'Phase Start', key: 'phaseStart', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
    { header: 'Phase End', key: 'phaseEnd', width: 14, style: { numFmt: 'yyyy-mm-dd' } },
  ];
  for (const r of buildTrialExportRows(companies)) {
    trials.addRow({
      ...r,
      phaseStart: r.phaseStart ? isoToDate(r.phaseStart) : null,
      phaseEnd: r.phaseEnd ? isoToDate(r.phaseEnd) : null,
    });
  }
  styleHeaderRow(trials, meta.primaryColorHex);
  trials.autoFilter = `A1:J${trials.rowCount}`;

  const markers = wb.addWorksheet('Markers', { views: [{ state: 'frozen', ySplit: 1 }] });
  markers.columns = [
    { header: 'Company', key: 'company', width: 24 },
    { header: 'Asset', key: 'asset', width: 20 },
    { header: 'Trial', key: 'trial', width: 22 },
    { header: 'Marker', key: 'marker', width: 20 },
    { header: 'Category', key: 'category', width: 16 },
    // Text, not date cells: a fuzzy marker has no real day, so we emit the
    // period label ("Q4 '26") / "onwards" rather than a false exact date.
    { header: 'Date', key: 'date', width: 14 },
    { header: 'End Date', key: 'endDate', width: 14 },
    { header: 'Status', key: 'status', width: 18 },
    { header: 'Detail', key: 'detail', width: 60 },
  ];
  for (const r of buildMarkerTableRows(companies)) {
    markers.addRow({
      company: r.company,
      asset: r.asset,
      trial: r.trial,
      marker: r.marker,
      category: r.category,
      date: r.startLabel,
      endDate: r.endLabel,
      status: STATUS_LABELS[r.status],
      detail: r.detailFull,
    });
  }
  styleHeaderRow(markers, meta.primaryColorHex);
  markers.autoFilter = `A1:I${markers.rowCount}`;

  return wb;
}
