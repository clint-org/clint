import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

// The unit runner is a plain node environment (vitest.units.config.ts), so
// rendered-DOM assertions live in e2e/tests/export.spec.ts, which decodes the
// actual exported PNG. These source-level assertions pin the structural
// contract every export host depends on once the branded footer was extracted
// out of export-snapshot-host into this shared component: the three-party
// footer (product mark + agency + tenant + date), the Clint mark, and the
// absent-segment / truncation behaviour.
describe('ExportFooterComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'export-footer.component.ts'), 'utf8');

  it('carries the three-party footer: product, agency, tenant, date', () => {
    expect(src).toContain('{{ artifactLabel() }}');
    expect(src).toContain('Delivered by');
    expect(src).toContain('Prepared for');
    expect(src).toContain('{{ exportDate }}');
  });

  it('leads with the Clint mark, not the host brand logo', () => {
    expect(src).toContain(`from '../components/clint-mark'`);
    expect(src).toContain('<polyline');
    expect(src).not.toContain('this.brand.logoUrl');
  });

  it('hides agency and tenant segments when absent and truncates long tenant names', () => {
    expect(src).toContain('@if (agencyName()');
    expect(src).toContain('@if (tenantName()');
    expect(src).toContain('truncate');
  });
});
