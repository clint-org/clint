import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { BrandContextService } from './brand-context.service';
import { saveBlob } from './download.util';

const XLSX_MIME = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

@Injectable({ providedIn: 'root' })
export class XlsxExportService {
  private brand = inject(BrandContextService);

  async exportDashboard(companies: Company[]): Promise<void> {
    if (companies.length === 0) return;
    // Lazy: pulls ExcelJS into its own chunk, loaded only on first Excel export.
    const { buildXlsxWorkbook } = await import('./xlsx-export.util');
    const wb = buildXlsxWorkbook(companies, {
      appDisplayName: this.brand.appDisplayName(),
      primaryColorHex: (this.brand.primaryColor() || '#0d9488').replace('#', ''),
    });
    const buffer = await wb.xlsx.writeBuffer();
    saveBlob(new Blob([buffer as ArrayBuffer], { type: XLSX_MIME }), 'clinical-trial-dashboard.xlsx');
  }
}
