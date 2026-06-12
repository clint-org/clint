import {
  ApplicationRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injectable,
  Injector,
} from '@angular/core';
import { domToCanvas } from 'modern-screenshot';

import { Company } from '../../../core/models/company.model';
import { ZoomLevel } from '../../../core/models/dashboard.model';
import { saveBlob } from '../../../core/services/download.util';
import { clampExportScale } from '../../../core/services/export-scale.util';
import { EXPORT_WAITING_SELECTOR, includeInCapture } from './export-capture.util';
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
  hideNotesColumn: boolean;
  spaceId: string;
  tenantName: string;
  tenantLogoUrl: string | null;
}

const TARGET_SCALE = 2;
/** Upper bound on waiting for the legend's marker-type fetch. */
const LEGEND_TIMEOUT_MS = 5000;

/**
 * PNG export as a DOM capture: renders ExportSnapshotHostComponent (the real
 * grid + legend + footer) off-screen and rasterizes it with modern-screenshot,
 * so the image is the app's own rendering rather than a canvas
 * re-implementation. See docs/superpowers/specs/2026-06-11-png-export-dom-capture-design.md.
 */
@Injectable({ providedIn: 'root' })
export class PngExportService {
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);

  /**
   * elementInjector must be the caller's Injector: the grid resolves
   * LandscapeStateService (providedIn: 'any') through it, so MOA/ROA/Notes
   * visibility in the capture matches the live view instead of resetting to
   * defaults.
   */
  async exportDashboard(snapshot: PngExportSnapshot, elementInjector: Injector): Promise<void> {
    if (snapshot.companies.length === 0) return;

    const ref = createComponent(ExportSnapshotHostComponent, {
      environmentInjector: this.envInjector,
      elementInjector,
    });
    ref.setInput('companies', snapshot.companies);
    ref.setInput('zoomLevel', snapshot.zoomLevel);
    ref.setInput('startYear', snapshot.startYear);
    ref.setInput('endYear', snapshot.endYear);
    ref.setInput('hideCompanyColumn', snapshot.hideCompanyColumn);
    ref.setInput('hideAssetColumn', snapshot.hideAssetColumn);
    ref.setInput('hideTrialColumn', snapshot.hideTrialColumn);
    ref.setInput('hideMoaColumn', snapshot.hideMoaColumn);
    ref.setInput('hideRoaColumn', snapshot.hideRoaColumn);
    ref.setInput('hideNotesColumn', snapshot.hideNotesColumn);
    ref.setInput('spaceId', snapshot.spaceId);
    ref.setInput('tenantName', snapshot.tenantName);
    ref.setInput('tenantLogoUrl', snapshot.tenantLogoUrl);

    const el = ref.location.nativeElement as HTMLElement;
    // Off-viewport, not display:none; layout must run for the capture.
    el.style.position = 'fixed';
    el.style.left = '-100000px';
    el.style.top = '0';
    document.body.appendChild(el);
    this.appRef.attachView(ref.hostView);

    let canvas: HTMLCanvasElement | null = null;
    try {
      await waitForReady(el);
      const scale = clampExportScale(el.offsetWidth, el.offsetHeight, TARGET_SCALE);
      canvas = await domToCanvas(el, { scale, filter: includeInCapture });
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas!.toBlob(resolve, 'image/png')
      );
      if (!blob) throw new Error('Could not generate the image.');
      saveBlob(blob, 'clinical-trial-dashboard.png');
    } finally {
      if (canvas) {
        // Deterministically free the large backing store; Safari accounts
        // canvas memory per page and does not GC until release.
        canvas.width = 0;
        canvas.height = 0;
      }
      this.appRef.detachView(ref.hostView);
      ref.destroy();
      el.remove();
    }
  }
}

/**
 * The capture must not race async content: webfonts, the legend's marker-type
 * fetch (flagged by [data-export-waiting]), and logo images. brand-logo
 * renders loading="lazy", which never fires off-viewport, so images are
 * flipped to eager before awaiting their decode.
 */
async function waitForReady(el: HTMLElement): Promise<void> {
  await document.fonts?.ready;

  const deadline = Date.now() + LEGEND_TIMEOUT_MS;
  while (el.querySelector(EXPORT_WAITING_SELECTOR) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const imgs = Array.from(el.querySelectorAll('img'));
  for (const img of imgs) img.loading = 'eager';
  await Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined)))
  );

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
