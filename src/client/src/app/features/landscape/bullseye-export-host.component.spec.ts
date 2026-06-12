import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in the e2e export suite, which decodes the
// actual exported PNG. These source-level assertions pin the structural
// contract BrandedPngExportService depends on: the host stacks a title, the
// real bullseye chart, and the branded footer, and shrink-wraps to content
// width. The footer contract lives in its own spec; here we only verify the
// host delegates to it correctly with the Bullseye label.
describe('BullseyeExportHostComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'bullseye-export-host.component.ts'), 'utf8');

  it('stacks the title header, the real chart, and the footer in order', () => {
    const titleAt = src.indexOf('{{ title() }}');
    const chartAt = src.indexOf('<app-bullseye-chart');
    const footerAt = src.indexOf('<app-export-footer');
    expect(titleAt).toBeGreaterThan(-1);
    expect(chartAt).toBeGreaterThan(titleAt);
    expect(footerAt).toBeGreaterThan(chartAt);
  });

  it('binds the chart data and the real duplicated-asset set, no interaction inputs', () => {
    expect(src).toContain('[data]="data()"');
    expect(src).toContain('[duplicatedAssetIds]="duplicatedAssetIds()"');
    // Static snapshot: selection/hover/highlight stay at their defaults and are
    // never bound, and no chart outputs are wired. Assert on binding syntax so
    // prose mentions in comments don't trip the check.
    expect(src).not.toContain('[selectedAssetId]');
    expect(src).not.toContain('[hoveredAssetId]');
    expect(src).not.toContain('[highlightedRing]');
    expect(src).not.toContain('[matchedAssetIds]');
    expect(src).not.toContain('(productHover)');
    expect(src).not.toContain('(assetClick)');
    expect(src).not.toContain('(backgroundClick)');
  });

  it('shrink-wraps to content width so the chart never scroll-clips', () => {
    expect(src).toMatch(/host:.*w-max/s);
  });

  it('delegates the branded footer to ExportFooterComponent with the Bullseye label', () => {
    expect(src).toContain(
      `import { ExportFooterComponent } from '../../shared/export/export-footer.component'`,
    );
    expect(src).toContain('ExportFooterComponent');
    expect(src).toContain('<app-export-footer');
    expect(src).toContain('artifactLabel="Bullseye"');
  });

  it('forwards the tenant and agency context the footer needs', () => {
    expect(src).toContain('[tenantName]="tenantName()"');
    expect(src).toContain('[tenantLogoUrl]="tenantLogoUrl()"');
    expect(src).toContain('[agencyLogoUrl]="agencyLogoUrl()"');
  });
});
