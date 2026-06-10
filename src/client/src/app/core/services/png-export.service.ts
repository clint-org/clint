import { inject, Injectable } from '@angular/core';

import { environment } from '../../../environments/environment';
import { resolveBrandLogoSrc } from '../../shared/components/brand-logo-url';
import { Company } from '../models/company.model';
import { BrandContextService } from './brand-context.service';
import { buildLegendGroups, type ExportOptions } from './export-common.util';
import { MarkerTypeService } from './marker-type.service';
import { PNG_H, PNG_W, type PngImages, type PngSurface, renderTimelinePng } from './png-export-renderer';
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
    const images: PngImages = {
      tenantLogo: await this.loadImage(this.brand.logoUrl()),
      agencyLogo: await this.loadImage(agency?.logo_url ?? null),
      companyLogos: await this.loadCompanyLogos(companies),
    };

    const totalPx = this.timeline.getTimelineWidth(startYear, endYear, zoomLevel);
    const canvas = document.createElement('canvas');
    canvas.width = PNG_W * SCALE;
    canvas.height = PNG_H * SCALE;
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Could not create a drawing context for the image.');
    ctx.scale(SCALE, SCALE);

    renderTimelinePng(ctx as PngSurface, {
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
    saveBlob(blob, 'clinical-trial-dashboard.png');
  }

  /**
   * Load a logo URL as an image element for canvas drawImage. Brandfetch URLs
   * are enriched the same way the app renders them. Resolves null on any
   * failure (404, cross-origin block, timeout) so the image just omits the logo.
   */
  private loadImage(rawUrl: string | null | undefined): Promise<HTMLImageElement | null> {
    if (!rawUrl) return Promise.resolve(null);
    const url = resolveBrandLogoSrc(rawUrl, environment.brandfetchClientId) ?? rawUrl;
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      let settled = false;
      const finish = (v: HTMLImageElement | null): void => {
        if (!settled) {
          settled = true;
          resolve(v);
        }
      };
      const timer = setTimeout(() => finish(null), 8000);
      img.onload = (): void => {
        clearTimeout(timer);
        finish(img);
      };
      img.onerror = (): void => {
        clearTimeout(timer);
        finish(null);
      };
      img.src = url;
    });
  }

  private async loadCompanyLogos(companies: Company[]): Promise<Map<string, HTMLImageElement>> {
    const entries = await Promise.all(
      companies
        .filter((c) => c.logo_url)
        .map(async (c) => [c.id, await this.loadImage(c.logo_url)] as const)
    );
    const map = new Map<string, HTMLImageElement>();
    for (const [id, img] of entries) {
      if (img) map.set(id, img);
    }
    return map;
  }
}
