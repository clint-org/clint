import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../../..');

const surfaces = [
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

  // events-page uses a separate html file: the loader element lives in the html
  // and the LoaderComponent import lives in the ts -- assert each file separately.
  it('features/events/events-page.component.html uses app-loader, not p-progressspinner', () => {
    const html = readFileSync(
      join(APP, 'features/events/events-page.component.html'),
      'utf8',
    );
    expect(html).toContain('app-loader');
    expect(html.toLowerCase()).not.toContain('p-progress');
  });

  it('features/events/events-page.component.ts imports LoaderComponent, not ProgressSpinner', () => {
    const ts = readFileSync(
      join(APP, 'features/events/events-page.component.ts'),
      'utf8',
    );
    expect(ts).toContain('LoaderComponent');
    expect(ts).not.toContain('ProgressSpinner');
  });

  it('the dead progressspinner stroke override is gone', () => {
    const css = readFileSync(join(APP, 'shared/styles/primeng-overrides.css'), 'utf8');
    expect(css).not.toContain('p-progressspinner-circle');
  });
});
