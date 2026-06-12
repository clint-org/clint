import { inject, Injectable } from '@angular/core';

import { BrandContextService } from '../../core/services/brand-context.service';
import { saveBlob } from '../../core/services/download.util';
import type { ColumnDef } from '../grids/filter-types';
import { buildGridSheet } from './grid-sheet.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

export interface GridExcelRequest<T> {
  /** Worksheet name, e.g. 'Catalysts'. */
  sheetName: string;
  /** Download filename without extension, e.g. 'catalysts'. */
  filename: string;
  columns: ColumnDef<T>[];
  /** Current-view rows (post filter/sort), captured at click time. */
  rows: T[];
}

/** Builds and downloads a single-sheet Excel workbook from a grid's current view. */
@Injectable({ providedIn: 'root' })
export class GridExcelExportService {
  private readonly brand = inject(BrandContextService);

  async export<T>(req: GridExcelRequest<T>): Promise<void> {
    if (req.rows.length === 0) return;
    const { buildSheetWorkbook } = await import('./xlsx-sheet.util');
    const wb = buildSheetWorkbook([buildGridSheet(req.sheetName, req.columns, req.rows)], {
      appDisplayName: this.brand.appDisplayName(),
      primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer as ArrayBuffer], { type: XLSX_MIME }), `${req.filename}.xlsx`);
  }
}
