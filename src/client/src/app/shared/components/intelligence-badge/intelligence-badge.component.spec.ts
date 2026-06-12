import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

describe('IntelligenceBadgeComponent template contract', () => {
  const src = readFileSync(join(__dirname, 'intelligence-badge.component.ts'), 'utf8');

  it('always labels as "Clint Intelligence" in Clint teal, never the host brand', () => {
    expect(src).toContain('PLATFORM_OPERATOR');
    expect(src).toContain('{{ platform }}');
    expect(src).toContain('Intelligence');
    // The AI engine is Clint's, so the badge never tints to the host brand.
    expect(src).not.toContain('appDisplayName');
    expect(src).not.toContain('text-brand-600');
    expect(src).not.toContain('var(--brand-600)');
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
