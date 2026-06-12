import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('IntelligenceBadgeComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'intelligence-badge.component.ts'), 'utf8');

  it('labels as "{appDisplayName} Intelligence" with the brand accent', () => {
    expect(src).toContain('appDisplayName()');
    expect(src).toContain('text-brand-600');
    expect(src).toContain('Intelligence');
  });

  it('animates only when active', () => {
    expect(src).toContain('@if (active())');
    expect(src).toContain('clint-mark-draw');
  });

  it('renders a full-strength mark at rest (track classes only while active)', () => {
    expect(src).toContain(`[class.clint-mark-track]="active()"`);
  });
});

describe('import page intelligence wiring', () => {
  const src = readFileSync(
    join(__dirname, '../../../features/source-import/import-page.component.ts'),
    'utf8'
  );

  it('signs the extraction progress with the badge and uses the loader on the active step', () => {
    expect(src).toContain('app-intelligence-badge');
    expect(src).toContain('app-loader');
    expect(src).not.toContain('animate-ping');
  });
});
