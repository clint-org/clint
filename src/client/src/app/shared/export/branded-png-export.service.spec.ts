import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in e2e/tests/export.spec.ts, which decodes the
// actual exported PNG. These source-level assertions pin the capture mechanics
// that moved out of PngExportService when the timeline export was generalized:
// off-screen mount, readiness waiting, 2x rasterization via modern-screenshot,
// pre-rasterized logos, and download. The content (which host renders) is
// supplied by the caller; this service is content-agnostic.
describe('BrandedPngExportService capture mechanics contract', () => {
  const src = readFileSync(join(__dirname, 'branded-png-export.service.ts'), 'utf8');

  it('mounts a caller-supplied host off-screen through Angular', () => {
    expect(src).toContain('createComponent(opts.component');
    expect(src).toContain('elementInjector: opts.elementInjector');
    expect(src).toContain('this.appRef.attachView(ref.hostView)');
    expect(src).toContain("el.style.position = 'fixed'");
    expect(src).toContain("el.style.left = '-100000px'");
  });

  it('pre-rasterizes both logos to CORS-safe PNG data URIs before mount', () => {
    expect(src).toContain('logoToPngDataUrl(opts.agencyLogoUrl)');
    expect(src).toContain('logoToPngDataUrl(opts.tenantLogoUrl)');
    expect(src).toContain('opts.setInputs(ref, { agencyLogoUrl, tenantLogoUrl })');
  });

  it('rasterizes at a clamped 2x scale via modern-screenshot, dropping excluded nodes', () => {
    expect(src).toContain("from 'modern-screenshot'");
    expect(src).toContain('const TARGET_SCALE = 2');
    expect(src).toContain('clampExportScale(el.offsetWidth, el.offsetHeight, TARGET_SCALE)');
    expect(src).toContain('domToCanvas(el, { scale, filter: includeInCapture })');
  });

  it('waits on fonts, [data-export-waiting], eager image decode, then double rAF', () => {
    expect(src).toContain('await document.fonts?.ready');
    expect(src).toContain('el.querySelector(EXPORT_WAITING_SELECTOR)');
    expect(src).toContain("img.loading = 'eager'");
    expect(src).toContain('img.decode()');
    expect(src).toContain('requestAnimationFrame(() => requestAnimationFrame(r))');
  });

  it('downloads the PNG and tears the host + canvas backing store down', () => {
    expect(src).toContain("canvas!.toBlob(resolve, 'image/png')");
    expect(src).toContain('saveBlob(blob, opts.filename)');
    expect(src).toContain('canvas.width = 0');
    expect(src).toContain('this.appRef.detachView(ref.hostView)');
    expect(src).toContain('ref.destroy()');
    expect(src).toContain('el.remove()');
  });
});
