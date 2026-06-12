import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('sidebar identity lockup template contract', () => {
  const src = readFileSync(join(__dirname, 'sidebar.component.ts'), 'utf8');

  it('expanded state leads with the Clint mark plus wordmark', () => {
    expect(src).toContain('identity-wordmark');
    expect(src).toMatch(/wordmark = computed\(\(\) =>\s*this\.brandContext\.appDisplayName\(\)/);
  });

  it('agency rides along as delivered-by instead of evicting the mark', () => {
    expect(src).toContain('Delivered by');
    expect(src).toContain('delivered-by__logo');
    expect(src).not.toContain('agency-wordmark');
  });

  it('collapsed rail keeps the agency chip or the mark', () => {
    expect(src).toContain('agency-initial');
    expect(src).toContain('<app-clint-logo [size]="24" [dark]="true" />');
  });
});
