import { inject, Injectable, Injector } from '@angular/core';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { BrandContextService } from '../../../core/services/brand-context.service';
import { BrandedPngExportService } from '../../../shared/export/branded-png-export.service';
import { ExportSnapshotHostComponent } from './export-snapshot-host.component';

/** Live grid state captured at export time. The PNG shows the timeline as-is. */
export interface PngExportSnapshot {
  companies: Company[];
  zoomLevel: ZoomLevel;
  startYear: number;
  endYear: number;
  hideCompanyColumn: boolean;
  hideAssetColumn: boolean;
  hideTrialColumn: boolean;
  hideMoaColumn: boolean;
  hideRoaColumn: boolean;
  hideIndicationColumn: boolean;
  spaceId: string;
  tenantName: string;
  tenantLogoUrl: string | null;
  /** Download filename; defaults to the generic dashboard name when omitted. */
  filename?: string;
}

/**
 * PNG export as a DOM capture: renders ExportSnapshotHostComponent (the real
 * grid + legend + footer) off-screen and rasterizes it with modern-screenshot,
 * so the image is the app's own rendering rather than a canvas
 * re-implementation. The capture mechanics (mount, readiness, rasterize,
 * download) live in the content-agnostic BrandedPngExportService; this service
 * only supplies the timeline host and its inputs. See
 * docs/superpowers/specs/2026-06-11-png-export-dom-capture-design.md.
 */
@Injectable({ providedIn: 'root' })
export class PngExportService {
  private readonly brand = inject(BrandContextService);
  private readonly png = inject(BrandedPngExportService);

  /**
   * elementInjector must be the caller's Injector: the grid resolves
   * LandscapeStateService (providedIn: 'any') through it, so MOA/ROA
   * visibility in the capture matches the live view instead of resetting to
   * defaults.
   */
  async exportDashboard(snapshot: PngExportSnapshot, elementInjector: Injector): Promise<void> {
    if (snapshot.companies.length === 0) return;

    await this.png.capture({
      component: ExportSnapshotHostComponent,
      elementInjector,
      agencyLogoUrl: this.brand.agency()?.logo_url ?? null,
      tenantLogoUrl: snapshot.tenantLogoUrl,
      filename: snapshot.filename ?? 'clinical-trial-dashboard.png',
      setInputs: (ref, logos) => {
        ref.setInput('companies', snapshot.companies);
        ref.setInput('zoomLevel', snapshot.zoomLevel);
        ref.setInput('startYear', snapshot.startYear);
        ref.setInput('endYear', snapshot.endYear);
        ref.setInput('hideCompanyColumn', snapshot.hideCompanyColumn);
        ref.setInput('hideAssetColumn', snapshot.hideAssetColumn);
        ref.setInput('hideTrialColumn', snapshot.hideTrialColumn);
        ref.setInput('hideMoaColumn', snapshot.hideMoaColumn);
        ref.setInput('hideRoaColumn', snapshot.hideRoaColumn);
        ref.setInput('hideIndicationColumn', snapshot.hideIndicationColumn);
        ref.setInput('spaceId', snapshot.spaceId);
        ref.setInput('tenantName', snapshot.tenantName);
        ref.setInput('tenantLogoUrl', logos.tenantLogoUrl);
        ref.setInput('agencyLogoUrl', logos.agencyLogoUrl);
      },
    });
  }
}
