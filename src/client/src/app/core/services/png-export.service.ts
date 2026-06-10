import { inject, Injectable } from '@angular/core';

import { Company } from '../models/company.model';
import { BrandContextService } from './brand-context.service';
import { buildLegendGroups, type ExportOptions } from './export-common.util';
import { loadImageElement } from './load-image.util';
import { MarkerTypeService } from './marker-type.service';
import { PNG_H, PNG_W, type PngImages, renderTimelinePng } from './png-export-renderer';
import { saveBlob } from './download.util';
import { TimelineService } from './timeline.service';

const SCALE = 2; // 2x for a crisp 3840x2160 output

@Injectable({ providedIn: 'root' })
export class PngExportService {
  private timeline = inject(TimelineService);
  private brand = inject(BrandContextService);
  private markerTypeService = inject(MarkerTypeService);

  async exportDashboard(companies: Company[], options: ExportOptions): Promise<void> {
    if (companies.length === 0) return;
    const { startYear, endYear, zoomLevel } = options;

    let allTypes: Awaited<ReturnType<MarkerTypeService['list']>> = [];
    try {
      allTypes = await this.markerTypeService.list(companies[0]?.space_id);
    } catch {
      allTypes = [];
    }

    const agency = this.brand.agency();
    const [tenantLogo, agencyLogo, companyLogos] = await Promise.all([
      loadImageElement(this.brand.logoUrl()),
      loadImageElement(agency?.logo_url ?? null),
      this.loadCompanyLogos(companies),
    ]);
    const images: PngImages = { tenantLogo, agencyLogo, companyLogos };

    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoomLevel);
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W * SCALE;
    canvas.height = PNG_H * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context for the image.');
    ctx.scale(SCALE, SCALE);

    renderTimelinePng(ctx, {
      companies,
      options,
      appDisplayName: this.brand.appDisplayName(),
      primaryColor: this.brand.primaryColor() || '#0d9488',
      agencyName: agency?.name ?? null,
      dateStr: new Date().toLocaleDateString('en-US', {
        year: 'numeric',
        month: 'long',
        day: 'numeric',
      }),
      legendGroups: buildLegendGroups(allTypes),
      columns: this.timeline.getColumns(startYear, endYear, zoomLevel),
      totalPx,
      dateToX: (date) => this.timeline.dateToX(date, startYear, endYear, totalPx),
      images,
    });

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png')
    );
    if (!blob) throw new Error('Could not generate the image.');
    // Deterministically free the large backing store; Safari accounts canvas
    // memory per page and does not GC until the canvas element is released.
    canvas.width = 0;
    canvas.height = 0;
    saveBlob(blob, 'clinical-trial-dashboard.png');
  }

  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, HTMLImageElement>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await loadImageElement(c.logo_url)] as const)
    );
    const map = new Map<string, HTMLImageElement>();
    for (const [id, img] of entries) {
      if (img) map.set(id, img);
    }
    return map;
  }
}
