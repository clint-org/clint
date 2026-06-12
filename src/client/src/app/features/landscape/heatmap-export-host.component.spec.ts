import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in the e2e export suite, which decodes the
// actual exported PNG. These source-level assertions pin the structural
// contract BrandedPngExportService depends on: the host stacks a title, the
// real heatmap matrix, and the branded footer, and shrink-wraps to content
// width. The footer contract lives in its own spec; here we only verify the
// host delegates to it correctly with the Heatmap label.
describe('HeatmapExportHostComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'heatmap-export-host.component.ts'), 'utf8');

  it('stacks the title header, the real matrix, and the footer in order', () => {
    const titleAt = src.indexOf('{{ title() }}');
    const matrixAt = src.indexOf('<app-heatmap');
    const footerAt = src.indexOf('<app-export-footer');
    expect(titleAt).toBeGreaterThan(-1);
    expect(matrixAt).toBeGreaterThan(titleAt);
    expect(footerAt).toBeGreaterThan(matrixAt);
  });

  it('binds the live-view matrix inputs with a pinned-null selection', () => {
    expect(src).toContain('[bubbles]="bubbles()"');
    expect(src).toContain('[countUnit]="countUnit()"');
    expect(src).toContain('[selectedBubble]="null"');
    expect(src).toContain('[sortField]="sortField()"');
    expect(src).toContain('[sortDir]="sortDir()"');
    expect(src).toContain('[latestEventDate]="latestEventDate()"');
    expect(src).toContain('[showPreclinical]="showPreclinical()"');
  });

  it('never wires the matrix interaction outputs', () => {
    // Assert on binding syntax (output)= so prose mentions in the doc comment
    // don't trip the check.
    expect(src).not.toContain('(rowClick)=');
    expect(src).not.toContain('(sortChange)=');
  });

  it('shrink-wraps to content width so the matrix never scroll-clips', () => {
    expect(src).toMatch(/host:.*w-max/s);
  });

  it('delegates the branded footer to ExportFooterComponent with the Heatmap label', () => {
    expect(src).toContain(
      `import { ExportFooterComponent } from '../../shared/export/export-footer.component'`,
    );
    expect(src).toContain('ExportFooterComponent');
    expect(src).toContain('<app-export-footer');
    expect(src).toContain('artifactLabel="Heatmap"');
  });

  it('forwards the tenant and agency context the footer needs', () => {
    expect(src).toContain('[tenantName]="tenantName()"');
    expect(src).toContain('[tenantLogoUrl]="tenantLogoUrl()"');
    expect(src).toContain('[agencyLogoUrl]="agencyLogoUrl()"');
  });
});
