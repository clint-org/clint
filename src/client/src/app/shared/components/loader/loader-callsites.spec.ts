import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { describe, expect, it } from 'vitest';

const APP = join(__dirname, '../../..');

// Surfaces whose template is inline in the .ts file: the app-loader element and
// the LoaderComponent import both live in the same file.
const inlineSurfaces = [
  'features/landscape/entity-marker-drawer.component.ts',
  'features/landscape/landscape-shell.component.ts',
  'features/auth/auth-callback.component.ts',
  'features/spaces/seed-demo.component.ts',
  'features/spaces/space-list.component.ts',
  'features/materials-browse/materials-browse-page.component.ts',
  'features/help/markers-help.component.ts',
  'features/help/taxonomies-help.component.ts',
  'shared/components/detail-panel-history.component.ts',
  'shared/components/intelligence-drawer/intelligence-drawer.component.ts',
  'core/layout/command-palette/palette-result-list.component.ts',
];

// Surfaces with a separate .html file: the loader element lives in the html and
// the LoaderComponent import lives in the ts. Assert each file separately.
const htmlSurfaces = [
  'features/landscape/landscape-filter-bar.component',
  'features/events/events-page.component',
  'features/spaces/space-archived-list.component',
  'features/dashboard/legend/legend.component',
  'features/manage/engagement/engagement-detail.component',
  'features/manage/assets/asset-detail.component',
  'features/manage/companies/company-detail.component',
  'features/events/event-detail-panel.component',
  'shared/components/materials-section/materials-section.component',
  'shared/components/entity-events-panel/entity-events-panel.component',
];

describe('loader call sites', () => {
  for (const rel of inlineSurfaces) {
    it(`${rel} uses app-loader, not an ad-hoc spinner or text-only state`, () => {
      const src = readFileSync(join(APP, rel), 'utf8');
      expect(src).toContain('app-loader');
      expect(src).toContain('LoaderComponent');
      expect(src.toLowerCase()).not.toContain('p-progress');
      // No raw Tailwind border-spinner ring tinted to the host brand.
      expect(src).not.toContain('animate-spin');
    });
  }

  for (const rel of htmlSurfaces) {
    it(`${rel}.html uses app-loader, not an ad-hoc spinner`, () => {
      const html = readFileSync(join(APP, `${rel}.html`), 'utf8');
      expect(html).toContain('app-loader');
      expect(html.toLowerCase()).not.toContain('p-progress');
      expect(html).not.toContain('animate-spin');
    });

    it(`${rel}.ts imports LoaderComponent, not ProgressSpinner`, () => {
      const ts = readFileSync(join(APP, `${rel}.ts`), 'utf8');
      expect(ts).toContain('LoaderComponent');
      expect(ts).not.toContain('ProgressSpinner');
    });
  }

  it('the dead progressspinner stroke override is gone', () => {
    const css = readFileSync(join(APP, 'shared/styles/primeng-overrides.css'), 'utf8');
    expect(css).not.toContain('p-progressspinner-circle');
  });
});
