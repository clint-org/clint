import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in e2e/tests/export.spec.ts, which decodes the
// actual exported PNG. These source-level assertions pin the structural
// contract PngExportService depends on: the host stacks the real grid, the
// real legend, and the footer, and shrink-wraps to content width.
describe('ExportSnapshotHostComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'export-snapshot-host.component.ts'), 'utf8');

  it('stacks the real grid, the real legend, and a footer', () => {
    const gridAt = src.indexOf('<app-dashboard-grid');
    const legendAt = src.indexOf('<app-legend');
    const footerAt = src.indexOf('<footer');
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
      '[hideNotesColumn]="hideNotesColumn()"',
    ]) {
      expect(src).toContain(binding);
    }
    expect(src).toContain('[spaceId]="spaceId()"');
  });

  it('shrink-wraps to content width so the grid never scroll-clips', () => {
    expect(src).toMatch(/host:.*w-max/s);
  });

  it('carries the three-party footer: product, agency, tenant, date', () => {
    expect(src).toContain('{{ appDisplayName() }}');
    expect(src).toContain('Delivered by');
    expect(src).toContain('Prepared for');
    expect(src).toContain('{{ exportDate }}');
  });

  it('leads with the Clint mark, not the host brand logo', () => {
    expect(src).toContain(`from '../../../shared/components/clint-mark'`);
    expect(src).not.toContain('this.brand.logoUrl');
  });

  it('hides agency and tenant segments when absent and truncates long tenant names', () => {
    expect(src).toContain('@if (agencyName()');
    expect(src).toContain('@if (tenantName()');
    expect(src).toContain('truncate');
  });
});
