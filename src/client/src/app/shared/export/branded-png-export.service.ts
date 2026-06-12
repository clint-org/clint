import {
  ApplicationRef,
  ComponentRef,
  createComponent,
  EnvironmentInjector,
  inject,
  Injectable,
  Injector,
  Type,
} from '@angular/core';
import { domToCanvas } from 'modern-screenshot';

import { saveBlob } from '../../core/services/download.util';
import { logoToPngDataUrl } from '../../core/services/load-image.util';
import { clampExportScale } from '../../core/services/export-scale.util';
import {
  EXPORT_WAITING_SELECTOR,
  includeInCapture,
} from '../../features/dashboard/export/export-capture.util';

const TARGET_SCALE = 2;
const READY_TIMEOUT_MS = 5000;

export interface BrandedPngOptions<C> {
  /** Off-screen host component that renders chart + title + <app-export-footer>. */
  component: Type<C>;
  /**
   * Sets host inputs. Receives the resolved logo data URIs so the host can pass
   * them straight to <app-export-footer> without re-fetching.
   */
  setInputs: (
    ref: ComponentRef<C>,
    logos: { agencyLogoUrl: string | null; tenantLogoUrl: string | null },
  ) => void;
  /** Caller's Injector so the host resolves providedIn:'any'/route-scoped state. */
  elementInjector: Injector;
  /** Raw (un-rasterized) logo URLs; resolved to CORS-safe data URIs before mount. */
  agencyLogoUrl: string | null;
  tenantLogoUrl: string | null;
  filename: string;
}

/**
 * PNG export as an off-screen DOM capture, generalized from the timeline's
 * PngExportService. The host component decides what is captured; this service
 * owns logo rasterization, mounting, readiness waiting, rasterization at 2x,
 * and download. See docs/superpowers/specs/2026-06-11-export-across-pages-design.md.
 */
@Injectable({ providedIn: 'root' })
export class BrandedPngExportService {
  private readonly appRef = inject(ApplicationRef);
  private readonly envInjector = inject(EnvironmentInjector);

  async capture<C>(opts: BrandedPngOptions<C>): Promise<void> {
    // Footer logos are pre-rasterized to PNG data URIs: modern-screenshot has
    // to re-fetch every <img> to inline it into the capture, and logo hosts
    // without CORS headers silently rasterize as a blank gap. The canvas
    // round-trip (crossOrigin=anonymous) either yields an embeddable data URI
    // or null, in which case the footer falls back to name text.
    const [agencyLogoUrl, tenantLogoUrl] = await Promise.all([
      logoToPngDataUrl(opts.agencyLogoUrl),
      logoToPngDataUrl(opts.tenantLogoUrl),
    ]);

    const ref = createComponent(opts.component, {
      environmentInjector: this.envInjector,
      elementInjector: opts.elementInjector,
    });
    opts.setInputs(ref, { agencyLogoUrl, tenantLogoUrl });

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
        canvas!.toBlob(resolve, 'image/png'),
      );
      if (!blob) throw new Error('Could not generate the image.');
      saveBlob(blob, opts.filename);
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
 * The capture must not race async content: webfonts, async content flagged by
 * [data-export-waiting], and logo images. brand-logo renders loading="lazy",
 * which never fires off-viewport, so images are flipped to eager before
 * awaiting their decode.
 */
async function waitForReady(el: HTMLElement): Promise<void> {
  await document.fonts?.ready;

  const deadline = Date.now() + READY_TIMEOUT_MS;
  while (el.querySelector(EXPORT_WAITING_SELECTOR) && Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 50));
  }

  const imgs = Array.from(el.querySelectorAll('img'));
  for (const img of imgs) img.loading = 'eager';
  await Promise.all(
    imgs.map((img) => (img.complete ? Promise.resolve() : img.decode().catch(() => undefined))),
  );

  await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
}
