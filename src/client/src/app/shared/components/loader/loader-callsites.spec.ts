import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../../..');

const surfaces = [
  'features/dashboard/export-dialog/export-dialog.component.ts',
  'features/landscape/landscape-filter-bar.component.html',
  'features/landscape/entity-marker-drawer.component.ts',
  'features/landscape/landscape-shell.component.ts',
];

describe('loader call sites', () => {
  for (const rel of surfaces) {
    it(`${rel} uses app-loader, not p-progressspinner`, () => {
      const src = readFileSync(join(APP, rel), 'utf8');
      expect(src).toContain('app-loader');
      expect(src.toLowerCase()).not.toContain('p-progress');
    });
  }

  it('the dead progressspinner stroke override is gone', () => {
    const css = readFileSync(join(APP, 'shared/styles/primeng-overrides.css'), 'utf8');
    expect(css).not.toContain('p-progressspinner-circle');
  });
});
