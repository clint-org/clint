import { inject, Injectable } from '@angular/core';

import { BrandContextService } from '../../core/services/brand-context.service';
import { saveBlob } from '../../core/services/download.util';
import type { SheetSpec } from './xlsx-sheet.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** Builds and downloads an Excel workbook from pre-built SheetSpecs (viz exports). */
@Injectable({ providedIn: 'root' })
export class SheetExcelExportService {
  private readonly brand = inject(BrandContextService);

  async export(sheets: SheetSpec[], filename: string): Promise<void> {
    if (sheets.length === 0 || sheets.every((s) => s.rows.length === 0)) return;
    const { buildSheetWorkbook } = await import('./xlsx-sheet.util');
    const wb = buildSheetWorkbook(sheets, {
      appDisplayName: this.brand.appDisplayName(),
      primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer as ArrayBuffer], { type: XLSX_MIME }), `${filename}.xlsx`);
  }
}
