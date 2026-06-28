import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in e2e/tests/export.spec.ts, which decodes the
// actual exported PNG. These source-level assertions pin the structural
// contract PngExportService depends on: the host stacks the real grid, the
// real legend, and the branded footer, and shrink-wraps to content width. The
// footer markup itself was extracted into the shared ExportFooterComponent;
// its contract lives in shared/export/export-footer.component.spec.ts. Here we
// only verify the host delegates to it correctly.
describe('ExportSnapshotHostComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'export-snapshot-host.component.ts'), 'utf8');

  it('stacks the real grid, the real legend, and the footer', () => {
    const gridAt = src.indexOf('<app-dashboard-grid');
    const legendAt = src.indexOf('<app-legend');
    const footerAt = src.indexOf('<app-export-footer');
    expect(gridAt).toBeGreaterThan(-1);
    expect(legendAt).toBeGreaterThan(gridAt);
    expect(footerAt).toBeGreaterThan(legendAt);
  });

  it('forwards every grid input the live timeline passes', () => {
    for (const binding of [
      '[companies]="companies()"',
      '[zoomLevel]="zoomLevel()"',
      '[startYear]="startYear()"',
      '[endYear]="endYear()"',
      '[hideCompanyColumn]="hideCompanyColumn()"',
      '[hideAssetColumn]="hideAssetColumn()"',
      '[hideTrialColumn]="hideTrialColumn()"',
      '[hideMoaColumn]="hideMoaColumn()"',
      '[hideRoaColumn]="hideRoaColumn()"',
    ]) {
      expect(src).toContain(binding);
    }
    expect(src).toContain('[spaceId]="spaceId()"');
  });

  it('shrink-wraps to content width so the grid never scroll-clips', () => {
    expect(src).toMatch(/host:.*w-max/s);
  });

  it('delegates the branded footer to ExportFooterComponent with the Timeline label', () => {
    expect(src).toContain(
      `import { ExportFooterComponent } from '../../../shared/export/export-footer.component'`
    );
    expect(src).toContain('ExportFooterComponent');
    expect(src).toContain('<app-export-footer');
    expect(src).toContain('artifactLabel="Timeline"');
  });

  it('forwards the tenant and agency context the footer needs', () => {
    expect(src).toContain('[tenantName]="tenantName()"');
    expect(src).toContain('[tenantLogoUrl]="tenantLogoUrl()"');
    expect(src).toContain('[agencyLogoUrl]="agencyLogoUrl()"');
  });
});
