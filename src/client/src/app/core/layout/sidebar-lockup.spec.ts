import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('sidebar identity template contract', () => {
  const src = readFileSync(join(__dirname, 'sidebar.component.ts'), 'utf8');

  it('identity is always the Clint lockup, never the tenant or brand display name', () => {
    expect(src).toContain('identity-wordmark');
    expect(src).toContain('wordmark = PLATFORM_OPERATOR');
    expect(src).not.toContain('appDisplayName');
  });

  it('agency credit is a bottom-edge colophon, not a header row', () => {
    expect(src).toContain('Intelligence by');
    expect(src).toContain('agency-credit__logo');
    expect(src).not.toContain('Delivered by');
    expect(src).not.toContain('agency-wordmark');
  });

  it('collapsed rail shows the mark only', () => {
    expect(src).toContain('<app-clint-logo [size]="24" [dark]="true" />');
    expect(src).not.toContain('agency-initial');
  });
});
