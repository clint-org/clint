import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// PngExportService no longer owns the capture mechanics: those moved to the
// content-agnostic BrandedPngExportService (whose source contract lives in
// shared/export/branded-png-export.service.spec.ts). This service now only
// supplies the timeline host and forwards the grid state. These source-level
// assertions pin that delegation so the timeline export stays wired to the
// shared capture pipeline.
describe('PngExportService delegation contract', () => {
  const src = readFileSync(join(__dirname, 'png-export.service.ts'), 'utf8');

  it('delegates capture to BrandedPngExportService', () => {
    expect(src).toContain(
      `import { BrandedPngExportService } from '../../../shared/export/branded-png-export.service'`,
    );
    expect(src).toContain('inject(BrandedPngExportService)');
    expect(src).toContain('this.png.capture(');
  });

  it('supplies the timeline host and filename to the shared service', () => {
    expect(src).toContain('component: ExportSnapshotHostComponent');
    // Caller-provided filename (space + view + date) with the generic default.
    expect(src).toContain("filename: snapshot.filename ?? 'clinical-trial-dashboard.png'");
  });

  it('forwards the brand agency logo and snapshot tenant logo for rasterization', () => {
    expect(src).toContain('agencyLogoUrl: this.brand.agency()?.logo_url ?? null');
    expect(src).toContain('tenantLogoUrl: snapshot.tenantLogoUrl');
  });

  it('passes the resolved logo data URIs through to the host inputs', () => {
    expect(src).toContain("ref.setInput('tenantLogoUrl', logos.tenantLogoUrl)");
    expect(src).toContain("ref.setInput('agencyLogoUrl', logos.agencyLogoUrl)");
  });

  it('no longer imports the raw capture primitives', () => {
    expect(src).not.toContain("from 'modern-screenshot'");
    expect(src).not.toContain('createComponent');
    expect(src).not.toContain('domToCanvas');
  });
});
