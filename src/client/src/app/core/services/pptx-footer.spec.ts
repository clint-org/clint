import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('pptx footer source contract', () => {
  const src = readFileSync(join(__dirname, 'pptx-export.service.ts'), 'utf8');

  it('FooterBrand carries all three parties plus the product mark', () => {
    expect(src).toContain('productMark: string | null');
    expect(src).toContain('tenantName: string | null');
    expect(src).toContain('tenantLogo: string | null');
    expect(src).toContain('agencyLogo: string | null');
  });

  it('renders the delivered-by and prepared-for microlabels', () => {
    expect(src).toContain('DELIVERED BY');
    expect(src).toContain('PREPARED FOR');
  });

  it('rasterizes the shared mark geometry for the footer', () => {
    expect(src).toContain('clintMarkSvgDataUri');
  });
});
